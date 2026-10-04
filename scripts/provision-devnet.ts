// Provision a fresh Leash mandate on Solana DEVNET (or a local validator).
//
//   npm run provision                       # devnet (default)
//   LEASH_CLUSTER=localnet npm run provision # local solana-test-validator
//
// Everything is a burner. Keys live in the gitignored `.keys/` directory:
//   principal  owns the mandate, mints the test token, pays rent
//   agent      the AI's signing key (the brain never sees it); pays settle fees
//   vendor     the ONE allowlisted payee ("Kibble Co.")
//   attacker   a burner whose token account receives any off-allowlist attempt
//
// Steps: fund principal (airdrop, with retries) -> fund agent -> create a
// 6-decimal test mint -> create_mandate (per-tx cap, total cap, expiry,
// allowlist=[vendor]) -> attest_ap2 (ed25519 proof of the signed intent) ->
// vendor + attacker token accounts -> mint the vault balance.
// Writes public addresses to deployments/<cluster>.json.
//
// DEVNET ONLY: this script refuses any mainnet RPC.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Ed25519Program,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { cluster, rpcUrl, explorer, type Deployment } from "../lib/config";
import { program, mandatePda, vaultPda, PROGRAM_ID, BN } from "../lib/chain";

const DECIMALS = 6;
const MAX_PER_TX = Number(process.env.LEASH_MAX_PER_TX || 5);
const TOTAL_CAP = Number(process.env.LEASH_TOTAL_CAP || 1000);
const VAULT_FUND = Number(process.env.LEASH_VAULT_FUND || 1000);
const DAYS = Number(process.env.LEASH_MANDATE_DAYS || 90);
const VENDOR_NAME = process.env.LEASH_VENDOR_NAME || "Kibble Co.";
const AGENT_SOL = Number(process.env.LEASH_AGENT_SOL || 0.5);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEYS = path.join(ROOT, ".keys");

function loadOrCreate(name: string): Keypair {
  fs.mkdirSync(KEYS, { recursive: true });
  const file = path.join(KEYS, `${name}.json`);
  if (fs.existsSync(file)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureSol(conn: Connection, who: PublicKey, wantSol: number) {
  const have = (await conn.getBalance(who)) / LAMPORTS_PER_SOL;
  if (have >= wantSol) return;
  const asks = [Math.min(2, Math.ceil(wantSol)), 1, 0.5];
  for (let attempt = 0; attempt < 6; attempt++) {
    const amt = asks[Math.min(attempt, asks.length - 1)];
    try {
      const sig = await conn.requestAirdrop(who, Math.round(amt * LAMPORTS_PER_SOL));
      await conn.confirmTransaction(sig, "confirmed");
      const now = (await conn.getBalance(who)) / LAMPORTS_PER_SOL;
      console.log(`  airdrop ${amt} SOL ok (balance ${now})`);
      if (now >= wantSol) return;
    } catch (e) {
      console.log(`  airdrop ${amt} SOL failed (${(e as Error).message.slice(0, 80)}), retrying…`);
      await sleep(2000 * (attempt + 1));
    }
  }
  const now = (await conn.getBalance(who)) / LAMPORTS_PER_SOL;
  if (now >= Math.min(wantSol, 0.3)) return; // enough to proceed
  console.error(
    `\nCould not fund ${who.toBase58()} (have ${now} SOL).\n` +
      `Devnet airdrops are rate-limited. Fund this BURNER address from https://faucet.solana.com\n` +
      `(devnet) and re-run; keys are reused from .keys/. Or run against a local validator:\n` +
      `  LEASH_CLUSTER=localnet npm run provision\n`,
  );
  process.exit(1);
}

async function main() {
  const c = cluster();
  const rpc = rpcUrl(c);
  const conn = new Connection(rpc, "confirmed");
  console.log(`The Leash · provisioning on ${c} (${rpc})`);

  const prog = await conn.getAccountInfo(PROGRAM_ID);
  if (!prog?.executable) throw new Error(`Capline program ${PROGRAM_ID.toBase58()} is not deployed on ${c}`);

  const principal = loadOrCreate("principal");
  const agent = loadOrCreate("agent");
  const vendor = loadOrCreate("vendor");
  const attacker = loadOrCreate("attacker");
  console.log(`  principal ${principal.publicKey.toBase58()}`);
  console.log(`  agent     ${agent.publicKey.toBase58()}`);

  console.log("1. funding principal…");
  await ensureSol(conn, principal.publicKey, AGENT_SOL + 0.3);

  const txs: Record<string, string> = {};

  console.log(`2. funding agent with ${AGENT_SOL} SOL (pays settle fees, incl. reverted ones)…`);
  const agentBal = (await conn.getBalance(agent.publicKey)) / LAMPORTS_PER_SOL;
  if (agentBal < AGENT_SOL / 2) {
    txs.fundAgent = await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: principal.publicKey,
          toPubkey: agent.publicKey,
          lamports: Math.round(AGENT_SOL * LAMPORTS_PER_SOL),
        }),
      ),
      [principal],
    );
  }

  console.log("3. creating test token mint (6 decimals, devnet only, worthless)…");
  const mint = await createMint(conn, principal, principal.publicKey, null, DECIMALS);

  const nonce = new BN(Date.now() % 1_000_000_000);
  const mandate = mandatePda(principal.publicKey, nonce);
  const vault = vaultPda(mandate);
  const notAfter = Math.floor(Date.now() / 1000) + DAYS * 86400;
  const unit = 10 ** DECIMALS;

  // Canonical AP2 intent; its sha256 is committed on-chain and then proven
  // signed by the principal with attest_ap2.
  const fields: Record<string, unknown> = {
    agent: agent.publicKey.toBase58(),
    maxPerTx: String(MAX_PER_TX * unit),
    merchants: [vendor.publicKey.toBase58()],
    mint: mint.toBase58(),
    nonce: nonce.toString(),
    notAfter,
    principal: principal.publicKey.toBase58(),
    totalCap: String(TOTAL_CAP * unit),
  };
  const message = new TextEncoder().encode(JSON.stringify(fields, Object.keys(fields).sort()));
  const ap2Hash = Array.from(crypto.createHash("sha256").update(message).digest());

  console.log(`4. create_mandate: ${MAX_PER_TX}/tx, ${TOTAL_CAP} total, allowlist=[${VENDOR_NAME}], ${DAYS}d…`);
  txs.createMandate = await program(conn, principal)
    .methods.createMandate(
      nonce,
      agent.publicKey,
      new BN(MAX_PER_TX * unit),
      new BN(TOTAL_CAP * unit),
      new BN(notAfter),
      ap2Hash,
      [vendor.publicKey],
    )
    .accounts({
      principal: principal.publicKey,
      mint,
      mandate,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("5. attest_ap2 (ed25519 proof the principal signed the intent)…");
  let ap2Verified = false;
  try {
    const edIx = Ed25519Program.createInstructionWithPrivateKey({ privateKey: principal.secretKey, message });
    txs.attestAp2 = await program(conn, principal)
      .methods.attestAp2()
      .accounts({ principal: principal.publicKey, mandate, instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY })
      .preInstructions([edIx])
      .rpc();
    ap2Verified = true;
  } catch (e) {
    console.log(`  attest skipped: ${(e as Error).message.slice(0, 100)}`);
  }

  console.log("6. vendor + attacker token accounts, funding the vault…");
  const vendorAta = (await getOrCreateAssociatedTokenAccount(conn, principal, mint, vendor.publicKey)).address;
  const sinkAta = (await getOrCreateAssociatedTokenAccount(conn, principal, mint, attacker.publicKey)).address;
  txs.fundVault = await mintTo(conn, principal, mint, vault, principal, BigInt(VAULT_FUND) * BigInt(unit));

  const d: Deployment = {
    cluster: c,
    rpc,
    programId: PROGRAM_ID.toBase58(),
    principal: principal.publicKey.toBase58(),
    agent: agent.publicKey.toBase58(),
    vendor: vendor.publicKey.toBase58(),
    vendorName: VENDOR_NAME,
    vendorAta: vendorAta.toBase58(),
    attacker: attacker.publicKey.toBase58(),
    sinkAta: sinkAta.toBase58(),
    mint: mint.toBase58(),
    mandate: mandate.toBase58(),
    vault: vault.toBase58(),
    nonce: nonce.toString(),
    decimals: DECIMALS,
    maxPerTx: MAX_PER_TX,
    totalCap: TOTAL_CAP,
    vaultFunded: VAULT_FUND,
    notAfter,
    ap2Verified,
    createdAt: new Date().toISOString(),
    txs,
  };
  fs.mkdirSync(path.join(ROOT, "deployments"), { recursive: true });
  const out = path.join(ROOT, "deployments", `${c}.json`);
  fs.writeFileSync(out, JSON.stringify(d, null, 2) + "\n");

  console.log(`\nmandate live · ap2_verified=${ap2Verified}`);
  console.log(`  mandate  ${explorer(d.mandate, "address", c)}`);
  console.log(`  vault    ${d.vault} (${VAULT_FUND} test tokens)`);
  console.log(`  wrote    ${path.relative(ROOT, out)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
