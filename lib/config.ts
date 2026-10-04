// Cluster + deployment config. Server-only (reads the filesystem and secrets).
//
// DEVNET ONLY. There is deliberately no "mainnet" value here: pointing The
// Leash at real money is a launch decision, not a config flip. See README.
import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";

export type Cluster = "devnet" | "localnet";

export function cluster(): Cluster {
  const c = (process.env.LEASH_CLUSTER || process.env.NEXT_PUBLIC_CLUSTER || "devnet").toLowerCase();
  if (c === "localnet" || c === "localhost" || c === "local") return "localnet";
  if (c === "devnet") return "devnet";
  throw new Error(`unsupported cluster "${c}": The Leash runs on devnet or a local validator only`);
}

export function rpcUrl(c: Cluster = cluster()): string {
  if (process.env.LEASH_RPC_URL) {
    if (/mainnet/i.test(process.env.LEASH_RPC_URL)) throw new Error("refusing a mainnet RPC: devnet only");
    return process.env.LEASH_RPC_URL;
  }
  return c === "devnet" ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899";
}

/** Explorer link that works for devnet and for a local validator. */
export function explorer(sigOrAddr: string, kind: "tx" | "address" = "tx", c: Cluster = cluster()): string {
  const base = `https://explorer.solana.com/${kind}/${sigOrAddr}`;
  if (c === "devnet") return `${base}?cluster=devnet`;
  return `${base}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl(c))}`;
}

/** Everything `scripts/provision-devnet.ts` writes. Public addresses only. */
export interface Deployment {
  cluster: Cluster;
  rpc: string;
  programId: string;
  principal: string;
  agent: string;
  vendor: string;
  vendorName: string;
  vendorAta: string;
  /** a burner "attacker" whose token account receives any off-allowlist
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

let cached: Deployment | null = null;

export function deployment(): Deployment {
  if (cached) return cached;
  // Vercel / serverless: pass the whole JSON as an env var.
  const inline = process.env.LEASH_DEPLOYMENT_JSON;
  let d: Deployment;
  if (inline) d = JSON.parse(inline) as Deployment;
  else {
    const file = path.join(process.cwd(), "deployments", `${cluster()}.json`);
    if (!fs.existsSync(file)) {
      throw new Error(`no deployment at deployments/${cluster()}.json: run \`npm run provision\` first`);
    }
    d = JSON.parse(fs.readFileSync(file, "utf8")) as Deployment;
  }
  cached = d;
  return d;
}

export function hasDeployment(): boolean {
  try {
    deployment();
    return true;
  } catch {
    return false;
  }
}

/** The agent's burner key. It signs `settle` and nothing else matters about
 *  it: the program bounds whatever it signs. Env first (serverless), then the
 *  gitignored `.keys/agent.json` written by the provision script. */
export function agentKeypair(): Keypair {
  const raw = process.env.LEASH_AGENT_SECRET;
  let bytes: number[];
  if (raw) bytes = JSON.parse(raw) as number[];
  else {
    const file = path.join(process.cwd(), ".keys", "agent.json");
    if (!fs.existsSync(file)) throw new Error("no agent key: set LEASH_AGENT_SECRET or run the provision script");
    bytes = JSON.parse(fs.readFileSync(file, "utf8")) as number[];
  }
  const kp = Keypair.fromSecretKey(Uint8Array.from(bytes));
  const d = deployment();
  if (!kp.publicKey.equals(new PublicKey(d.agent))) {
    throw new Error("agent key does not match the deployment's mandate agent");
  }
  return kp;
}
