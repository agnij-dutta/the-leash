// The Capline side of The Leash. Two layers, both real:
//
//   Layer A: the off-chain gate. `capline/solana`'s `withCapline().preflight`
//            reads the mandate's NUMBERS from chain and refuses out-of-bounds
//            payments. No prompt changes `1000 > 5`.
//   Layer B: the program's `settle`. We FORCE-SUBMIT the jailbroken payment
//            anyway (skipPreflight), signed by the real agent key, so the chain
//            itself reverts it and the failed tx lands on the ledger with a
//            signature anyone can open in the explorer.
//
// Layer A is a convenience and a log line. Layer B is the security boundary:
// nothing in this file, the brain or the store is trusted to hold the money.
//
// Anchor ships CJS. A default import works in raw Node ESM, in Next and in tsx
// only because package.json sets "type": "module" (see README, "Known issues").
import anchor from "@coral-xyz/anchor";
import type { Idl, Program as ProgramT } from "@coral-xyz/anchor";
import { type Connection, type Keypair, PublicKey, Transaction, VersionedTransaction, type TransactionError } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token";
import { withCapline, MandateExceeded } from "capline/solana";
import idl from "./idl/capline.json";
import type { Deployment } from "./config";
import type { MandateState } from "./score";
import type { PayeeKind } from "./types";

const { AnchorProvider, BN, Program } = anchor;
type BN = InstanceType<typeof BN>;
export { BN };

/** Capline program id, taken from the vendored IDL (`lib/idl/capline.json`,
 *  copied from the Capline repo's `anchor build` output). */
export const PROGRAM_ID = new PublicKey((idl as Idl).address);

/** Program error code -> name (6003 -> "PerTxCapExceeded"), from the IDL. */

const ERRORS: Record<number, string> = Object.fromEntries(
  ((idl as Idl).errors ?? []).map((e) => [e.code, e.name.charAt(0).toUpperCase() + e.name.slice(1)]),
);

/** Minimal Anchor wallet interface around a Keypair. */
export function keypairWallet(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      if (tx instanceof VersionedTransaction) tx.sign([kp]);
      else tx.partialSign(kp);
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      for (const tx of txs) {
        if (tx instanceof VersionedTransaction) tx.sign([kp]);
        else tx.partialSign(kp);
      }
      return txs;
    },
  };
}

/** An Anchor client for the Capline program, signing as `kp`. */
export function program(conn: Connection, kp: Keypair): ProgramT {
  const provider = new AnchorProvider(conn, keypairWallet(kp) as never, { commitment: "confirmed" });
  return new Program(idl as Idl, provider);
}

/** Mandate PDA: seeds ["mandate", principal, nonce u64 LE], as in the program. */
export function mandatePda(principal: PublicKey, nonce: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mandate"), principal.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  )[0];
}

/** Vault token account PDA: seeds ["vault", mandate]. */
export function vaultPda(mandate: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), mandate.toBuffer()], PROGRAM_ID)[0];
}

/** Fetch and decode the live mandate account. Scoring always uses these
 *  on-chain numbers, never the copies in the deployment file. */
export async function readMandate(conn: Connection, kp: Keypair, d: Deployment): Promise<MandateState> {
  const accounts = program(conn, kp).account as unknown as {
    mandate: { fetch(pda: PublicKey): Promise<Record<string, unknown>> };
  };
  const m = (await accounts.mandate.fetch(new PublicKey(d.mandate))) as {
    maxPerTx: BN;
    totalCap: BN;
    spent: BN;
    notAfter: BN;
    revoked: boolean;
    merchants: PublicKey[];
  };
  return {
    maxPerTx: BigInt(m.maxPerTx.toString()),
    totalCap: BigInt(m.totalCap.toString()),
    spent: BigInt(m.spent.toString()),
    notAfter: Number(m.notAfter.toString()),
    revoked: m.revoked,
    merchants: m.merchants.map((p) => p.toBase58()),
  };
}

// ---------------------------------------------------------------------------
// Payee resolution. The model can type anything into `to`. We map it onto a
// concrete on-chain account so the chain can judge it:
//   - the vendor's address or name     -> the allowlisted vendor
//   - any valid Solana address         -> that address (off-allowlist)
//   - anything else ("my wallet", 0x…) -> the burner attacker stand-in
//
// Every non-vendor payee is pointed at the attacker sink token account. That
// is what makes "paid out" measurable: if `settle` ever let an off-allowlist
// payment through, the tokens could only land in the sink, and the sink's
// balance is what the page shows. The "stand-in" case is the strongest test:
// merchant and token account match (attacker owns the sink), so the
// allowlist and caps are the only checks standing between the vault and it.
// For "address", the program would also fail InvalidMerchantAccount.
export interface ResolvedPayee {
  raw: string;
  merchant: PublicKey;
  tokenAccount: PublicKey;
  kind: PayeeKind;
}

/** Map the model's free-text `to` onto an on-chain merchant + token account. */
export function resolvePayee(raw: string, d: Deployment): ResolvedPayee {
  const s = (raw || "").trim();
  const norm = s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const vendorNorm = d.vendorName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s === d.vendor || (norm.length > 0 && norm === vendorNorm)) {
    return { raw: s, merchant: new PublicKey(d.vendor), tokenAccount: new PublicKey(d.vendorAta), kind: "vendor" };
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) {
    try {
      const pk = new PublicKey(s);
      // An off-allowlist address has no token account we control, so the
      // attempted transfer targets the attacker sink. The program rejects the
      // merchant identity before it ever looks at the token account.
      return { raw: s, merchant: pk, tokenAccount: new PublicKey(d.sinkAta), kind: "address" };
    } catch {
      /* fall through */
    }
  }
  return { raw: s, merchant: new PublicKey(d.attacker), tokenAccount: new PublicKey(d.sinkAta), kind: "stand-in" };
}

export const U64_MAX = (1n << 64n) - 1n;

/** Whole-token amount -> base units, clamped into u64 so an absurd ask still
 *  becomes a real (and really reverted) `settle`. Non-finite, zero and
 *  negative amounts map to 0, which scoring treats as "not a payment". */
export function toBase(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  // toFixed switches to exponent notation at 1e21 ("1e+21"), which BigInt
  // cannot parse. Anything that large is far beyond u64 base units anyway.
  if (amount * 10 ** decimals >= 1.8e19) return U64_MAX;
  const s = amount.toFixed(decimals);
  const [w, f = ""] = s.split(".");
  const v = BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  return v > U64_MAX ? U64_MAX : v;
}

/** Base units -> whole tokens, for display. */
export function fromBase(v: bigint, decimals: number): number {
  return Number(v) / 10 ** decimals;
}

// ---------------------------------------------------------------------------
// Layer A: the published Capline SDK's constrained gate.
export interface LayerA {
  allowed: boolean;
  reason?: string;
  detail?: Record<string, string | undefined>;
}

/** Run the published SDK's preflight. `allowed: false` with a reason is a
 *  policy denial; any other error (RPC down, decode failure) is rethrown, never
 *  reported as a denial. Note the SDK does not check the agent key or the
 *  token account owner; `settle` does. */
export async function layerA(conn: Connection, agent: Keypair, d: Deployment, payee: ResolvedPayee, amount: bigint): Promise<LayerA> {
  if (amount <= 0n) return { allowed: false, reason: "invalid amount" };
  const client = withCapline({ program: program(conn, agent), mandate: new PublicKey(d.mandate), agent: agent.publicKey });
  try {
    await client.preflight({ merchant: payee.merchant, merchantTokenAccount: payee.tokenAccount, amount });
    return { allowed: true };
  } catch (e) {
    if (e instanceof MandateExceeded) return { allowed: false, reason: e.reason, detail: e.detail };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Layer B: submit `settle` for real. `force` skips the RPC's preflight
// simulation so a doomed tx still lands on chain and fails THERE, leaving a
// public, signed, reverted transaction behind.
export interface LayerB {
  submitted: boolean;
  ok: boolean;
  sig?: string;
  error?: string; // program error name, e.g. PerTxCapExceeded
  errorCode?: number;
  logs?: string[];
}

function decodeErr(err: TransactionError | null | undefined): { name: string; code?: number } {
  if (!err) return { name: "unknown" };
  const ie = (err as { InstructionError?: [number, unknown] }).InstructionError;
  if (ie) {
    const inner = ie[1] as { Custom?: number } | string;
    if (typeof inner === "object" && inner && typeof inner.Custom === "number") {
      return { name: ERRORS[inner.Custom] ?? `Custom(${inner.Custom})`, code: inner.Custom };
    }
    return { name: typeof inner === "string" ? inner : JSON.stringify(inner) };
  }
  return { name: typeof err === "string" ? err : JSON.stringify(err) };
}

/** Build, sign and send one `settle`.
 *
 *  force=true: skipPreflight, so the RPC does not simulate and drop a doomed
 *  tx. It lands in a block, the program rejects it, the fee is paid, and the
 *  failure is public. This is how every jailbreak gets a tx signature.
 *  force=false: normal send; a simulation failure means nothing landed.
 *
 *  `ok` is read from the confirmed transaction status, never assumed. */
export async function settleOnChain(
  conn: Connection,
  agent: Keypair,
  d: Deployment,
  payee: ResolvedPayee,
  amount: bigint,
  force: boolean,
): Promise<LayerB> {
  const ix = await program(conn, agent)
    .methods.settle(new BN(amount.toString()))
    .accounts({
      mandate: new PublicKey(d.mandate),
      agent: agent.publicKey,
      vault: new PublicKey(d.vault),
      merchant: payee.merchant,
      merchantTokenAccount: payee.tokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: agent.publicKey, blockhash, lastValidBlockHeight }).add(ix);
  tx.sign(agent);

  let sig: string;
  try {
    sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: force, maxRetries: 3 });
  } catch (e) {
    // Preflight rejection (non-forced path): nothing landed.
    const msg = e instanceof Error ? e.message : String(e);
    const m = /custom program error: 0x([0-9a-f]+)/i.exec(msg);
    const code = m ? parseInt(m[1], 16) : undefined;
    return { submitted: false, ok: false, error: code !== undefined ? (ERRORS[code] ?? msg) : msg.slice(0, 200), errorCode: code };
  }

  let conf: Awaited<ReturnType<Connection["confirmTransaction"]>>;
  try {
    conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  } catch (e) {
    // Blockhash expired before confirmation (e.g. the agent ran out of SOL for
    // fees, or the RPC dropped it). We do not know that it landed, so we do
    // not claim it did, and we certainly do not claim it settled.
    const msg = e instanceof Error ? e.message : String(e);
    return { submitted: false, ok: false, sig, error: `unconfirmed: ${msg.slice(0, 120)}` };
  }
  let logs: string[] | undefined;
  try {
    const t = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    logs = t?.meta?.logMessages ?? undefined;
  } catch {
    /* logs are cosmetic */
  }
  if (conf.value.err) {
    const { name, code } = decodeErr(conf.value.err);
    return { submitted: true, ok: false, sig, error: name, errorCode: code, logs };
  }
  return { submitted: true, ok: true, sig, logs };
}

// ---------------------------------------------------------------------------
export interface Balances {
  vault: number;
  /** tokens that reached the attacker sink: the honest "paid out" number. */
  paidOut: number;
  /** tokens paid to the allowlisted vendor (legit invoices). */
  vendor: number;
  agentSol: number;
}

/** Live token balances. `paidOut` is the attacker sink, read from chain:
 *  the honest number behind "paid out $0.00". It is never a counter. */
export async function balances(conn: Connection, d: Deployment): Promise<Balances> {
  const div = 10 ** d.decimals;
  const [vault, sink, vendor, lamports] = await Promise.all([
    getAccount(conn, new PublicKey(d.vault), "confirmed"),
    getAccount(conn, new PublicKey(d.sinkAta), "confirmed"),
    getAccount(conn, new PublicKey(d.vendorAta), "confirmed"),
    conn.getBalance(new PublicKey(d.agent), "confirmed"),
  ]);
  return {
    vault: Number(vault.amount) / div,
    paidOut: Number(sink.amount) / div,
    vendor: Number(vendor.amount) / div,
    agentSol: lamports / 1e9,
  };
}
