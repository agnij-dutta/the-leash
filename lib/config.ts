// Cluster, RPC, deployment and agent-key config. Server-only: it reads the
// filesystem and secrets. Client components must never import this module
// (they import types from `lib/types.ts` instead).
//
// DEVNET / LOCALNET ONLY. There is deliberately no "mainnet" value anywhere:
// pointing The Leash at real money is a launch decision (audit, multisig,
// legal review), not a config flip. The guard has two layers:
//   1. `cluster()` and `rpcUrl()` reject anything but devnet/localnet by name.
//   2. `connection()` asks the RPC for its genesis hash and refuses mainnet
//      (and anything that is not devnet when the cluster is devnet). Names and
//      URLs can lie (a Triton or self-hosted mainnet URL need not contain the
//      word "mainnet"); the genesis hash cannot.
import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

export type Cluster = "devnet" | "localnet";

/** Genesis hashes of the public Solana clusters (from `getGenesisHash`). */
export const GENESIS = {
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
} as const;

/** The configured cluster (`LEASH_CLUSTER`, default devnet). Throws on any
 *  other value, including "mainnet" and "mainnet-beta". */
export function cluster(): Cluster {
  const c = (process.env.LEASH_CLUSTER || "devnet").trim().toLowerCase();
  if (c === "localnet" || c === "localhost" || c === "local") return "localnet";
  if (c === "devnet") return "devnet";
  throw new Error(`unsupported cluster "${c}": The Leash runs on devnet or a local validator only`);
}

/** RPC endpoint: `LEASH_RPC_URL` if set (e.g. a Helius devnet URL), else the
 *  public default for the cluster. Rejects URLs that name mainnet; the
 *  genesis check in `connection()` catches the ones that do not. */
export function rpcUrl(c: Cluster = cluster()): string {
  const custom = process.env.LEASH_RPC_URL?.trim();
  if (custom) {
    if (/mainnet/i.test(custom)) throw new Error("refusing a mainnet RPC: The Leash is devnet/localnet only");
    return custom;
  }
  return defaultRpc(c);
}

function defaultRpc(c: Cluster): string {
  return c === "devnet" ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899";
}

/** The RPC URL with credentials stripped (query string, userinfo), safe to
 *  write into `deployments/*.json` or send to a browser. Helius and friends put
 *  the API key in `?api-key=`. */
export function publicRpcUrl(c: Cluster = cluster()): string {
  try {
    const u = new URL(rpcUrl(c));
    if (u.search || u.username || u.password) return defaultRpc(c);
    return u.toString().replace(/\/$/, "");
  } catch {
    return defaultRpc(c);
  }
}

/** Throws unless `genesisHash` is acceptable for cluster `c`. Exported for tests. */
export function assertGenesis(c: Cluster, genesisHash: string): void {
  if (genesisHash === GENESIS.mainnet) {
    throw new Error("refusing to run: the RPC is Solana MAINNET (genesis hash match). The Leash is devnet/localnet only");
  }
  if (c === "devnet" && genesisHash !== GENESIS.devnet) {
    throw new Error(`refusing to run: LEASH_CLUSTER=devnet but the RPC's genesis hash is ${genesisHash}, not devnet's`);
  }
  if (c === "localnet" && (genesisHash === GENESIS.devnet || genesisHash === GENESIS.testnet)) {
    throw new Error("refusing to run: LEASH_CLUSTER=localnet but the RPC is a public cluster");
  }
}

const verified = new Map<string, Promise<void>>();

/** A Connection to the configured RPC, after proving (once per URL per
 *  process) that it is not mainnet. A failed check is not cached, so a flaky
 *  RPC is retried on the next call; it always fails closed. */
export async function connection(c: Cluster = cluster()): Promise<Connection> {
  const url = rpcUrl(c);
  const conn = new Connection(url, "confirmed");
  let check = verified.get(url);
  if (!check) {
    check = conn.getGenesisHash().then((h) => assertGenesis(c, h));
    verified.set(url, check);
    check.catch(() => verified.delete(url));
  }
  await check;
  return conn;
}

/** Explorer link that works for devnet and for a local validator. */
export function explorer(sigOrAddr: string, kind: "tx" | "address" = "tx", c: Cluster = cluster()): string {
  const base = `https://explorer.solana.com/${kind}/${sigOrAddr}`;
  if (c === "devnet") return `${base}?cluster=devnet`;
  return `${base}?cluster=custom&customUrl=${encodeURIComponent(publicRpcUrl(c))}`;
}

/** Everything `scripts/provision-devnet.ts` writes. Public addresses only. */
export interface Deployment {
  cluster: Cluster;
  /** RPC used at provision time, credentials stripped. Informational only:
   *  the app always connects through `rpcUrl()`. */
  rpc: string;
  programId: string;
  principal: string;
  agent: string;
  vendor: string;
  vendorName: string;
  vendorAta: string;
  /** A burner "attacker" whose token account receives any off-allowlist
   *  settle attempt. Its balance IS the "paid out" number, read from chain. */
  attacker: string;
  sinkAta: string;
  mint: string;
  mandate: string;
  vault: string;
  nonce: string;
  decimals: number;
  maxPerTx: number; // whole tokens
  totalCap: number; // whole tokens
  vaultFunded: number; // whole tokens
  notAfter: number; // unix seconds
  ap2Verified: boolean;
  createdAt: string;
  txs: Record<string, string>;
}

let cachedDeployment: Deployment | null = null;

/** The deployment for the configured cluster: `LEASH_DEPLOYMENT_JSON` (for
 *  serverless), else `deployments/<cluster>.json`. Rejects a deployment that
 *  was provisioned for a different cluster. */
export function deployment(): Deployment {
  if (cachedDeployment) return cachedDeployment;
  const c = cluster();
  let raw: string;
  let source: string;
  const inline = process.env.LEASH_DEPLOYMENT_JSON;
  if (inline) {
    raw = inline;
    source = "LEASH_DEPLOYMENT_JSON";
  } else {
    const file = path.join(process.cwd(), "deployments", `${c}.json`);
    if (!fs.existsSync(file)) {
      throw new Error(`no deployment at deployments/${c}.json: run \`npm run provision${c === "localnet" ? ":local" : ""}\` first`);
    }
    raw = fs.readFileSync(file, "utf8");
    source = `deployments/${c}.json`;
  }
  let d: Deployment;
  try {
    d = JSON.parse(raw) as Deployment;
  } catch {
    throw new Error(`${source} is not valid JSON`);
  }
  if (d.cluster !== c) {
    throw new Error(`${source} was provisioned for ${d.cluster}, but LEASH_CLUSTER is ${c}`);
  }
  cachedDeployment = d;
  return d;
}

/** Parse a Solana keypair file / env value (a JSON array of 64 bytes).
 *  Never echoes the input: a `JSON.parse` SyntaxError quotes the text it
 *  choked on, and that text is a secret key. */
export function parseSecretKey(raw: string, source: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${source} is not a JSON byte array`);
  }
  if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new Error(`${source} must be a JSON array of 64 bytes (a solana-keygen keypair file)`);
  }
  return Uint8Array.from(parsed as number[]);
}

let cachedAgent: Keypair | null = null;

/** The agent's burner key. It signs `settle` and pays its fees. The LLM never
 *  sees it, and it never leaves the server.
 *
 *  Capline semantics this relies on: the program bounds whatever this key
 *  signs (per-tx cap, total cap, expiry, allowlist), so a leaked agent key can
 *  at worst pay the allowlisted vendor up to the caps, or burn the agent's SOL
 *  on fees. It cannot move vault funds anywhere else.
 *
 *  Env first (serverless), then the gitignored `.keys/agent.json` written by
 *  the provision script. Must match the mandate's agent in the deployment. */
export function agentKeypair(): Keypair {
  if (cachedAgent) return cachedAgent;
  const env = process.env.LEASH_AGENT_SECRET;
  let bytes: Uint8Array;
  if (env) bytes = parseSecretKey(env, "LEASH_AGENT_SECRET");
  else {
    const file = path.join(process.cwd(), ".keys", "agent.json");
    if (!fs.existsSync(file)) throw new Error("no agent key: set LEASH_AGENT_SECRET or run the provision script");
    bytes = parseSecretKey(fs.readFileSync(file, "utf8"), ".keys/agent.json");
  }
  let kp: Keypair;
  try {
    kp = Keypair.fromSecretKey(bytes);
  } catch {
    throw new Error("agent key bytes are not a valid ed25519 keypair");
  }
  if (!kp.publicKey.equals(new PublicKey(deployment().agent))) {
    throw new Error("agent key does not match the deployment's mandate agent");
  }
  cachedAgent = kp;
  return kp;
}
