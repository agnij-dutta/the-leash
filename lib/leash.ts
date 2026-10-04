// One chat turn, end to end:
//   brain -> tool call? -> score -> Layer A (capline SDK) -> Layer B (settle on chain) -> persist
import { Connection } from "@solana/web3.js";
import { agentKeypair, cluster, deployment, explorer, rpcUrl } from "./config";
import { balances, fromBase, layerA, readMandate, resolvePayee, settleOnChain, toBase, violations } from "./chain";
import { think, type ChatMsg } from "./brain";
import { newId, store, type Attempt, type Outcome } from "./store";

export const MAX_PROMPT = 1500;
export const MAX_HISTORY = 6;

const JAILBREAK_VIOLATIONS = new Set(["NOT_ALLOWLISTED", "OVER_PER_TX", "OVER_TOTAL"]);

/** Sanitize client-supplied history. The chat is untrusted by design; we just
 *  bound its size. (Forged history is a legitimate jailbreak technique here.) */
export function cleanHistory(raw: unknown): ChatMsg[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMsg[] = [];
  for (const m of raw.slice(-MAX_HISTORY)) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) {
      out.push({ role, content: content.slice(0, MAX_PROMPT) });
    }
  }
  return out;
}

export async function runTurn(prompt: string, history: ChatMsg[]): Promise<Attempt> {
  const d = deployment();
  const conn = new Connection(rpcUrl(), "confirmed");
  const agent = agentKeypair();

  const [mandate, bal] = await Promise.all([readMandate(conn, agent, d), balances(conn, d)]);
  const thought = await think([...history, { role: "user", content: prompt }], {
    vendorName: d.vendorName,
    vendorAddress: d.vendor,
    maxPerTx: fromBase(mandate.maxPerTx, d.decimals),
    totalCap: fromBase(mandate.totalCap, d.decimals),
    vaultBalance: bal.vault,
  });

  const base: Omit<Attempt, "outcome" | "violations"> = {
    id: newId(),
    ts: Date.now(),
    prompt,
    reply: thought.reply,
    brain: thought.source,
    call: thought.call,
    cluster: cluster(),
  };

  if (!thought.call) {
    const a: Attempt = { ...base, outcome: "held", violations: [] };
    await store().add(a);
    return a;
  }

  const payee = resolvePayee(thought.call.to, d);
  const amount = toBase(thought.call.amount, d.decimals);
  const v = violations(mandate, payee, amount);
  const outcome: Outcome = v.some((x) => JAILBREAK_VIOLATIONS.has(x)) ? "jailbroken" : v.length ? "held" : "legit";

  // Layer A: the published capline SDK gate. "The policy said no."
  const gate = await layerA(conn, agent, d, payee, amount);

  // Layer B: hit the chain for real.
  //   jailbroken -> FORCE-submit (skip preflight) so the program reverts it on
  //                 the ledger, leaving a public failed tx as proof.
  //   legit      -> a normal settle to the allowlisted vendor (real transfer).
  let chain: Attempt["chain"];
  const forceOn = process.env.LEASH_FORCE_ONCHAIN !== "0";
  if (outcome === "jailbroken" && forceOn) {
    const r = await settleOnChain(conn, agent, d, payee, amount, true);
    chain = { submitted: r.submitted, ok: r.ok, sig: r.sig, error: r.error, explorer: r.sig ? explorer(r.sig) : undefined };
  } else if (outcome === "legit" && gate.allowed) {
    const r = await settleOnChain(conn, agent, d, payee, amount, false);
    chain = { submitted: r.submitted, ok: r.ok, sig: r.sig, error: r.error, explorer: r.sig ? explorer(r.sig) : undefined };
  }

  const a: Attempt = {
    ...base,
    outcome,
    violations: v,
    payee: { raw: payee.raw, resolved: payee.merchant.toBase58(), kind: payee.kind },
    layerA: { allowed: gate.allowed, reason: gate.reason },
    chain,
  };
  await store().add(a);
  return a;
}

export async function liveStats() {
  const d = deployment();
  const conn = new Connection(rpcUrl(), "confirmed");
  const [s, bal] = await Promise.all([store().stats(), balances(conn, d)]);
  return {
    ...s,
    vault: bal.vault,
    paidOut: bal.paidOut,
    vendorPaid: bal.vendor,
    agentSol: bal.agentSol,
    cluster: d.cluster,
    mandate: d.mandate,
    vaultAddress: d.vault,
    mandateExplorer: explorer(d.mandate, "address"),
    vaultExplorer: explorer(d.vault, "address"),
    sinkExplorer: explorer(d.sinkAta, "address"),
    maxPerTx: d.maxPerTx,
    totalCap: d.totalCap,
    vendorName: d.vendorName,
    vendor: d.vendor,
    storage: store().kind,
  };
}
