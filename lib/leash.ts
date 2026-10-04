// One chat turn, end to end:
//   brain -> tool call? -> score -> Layer A (capline SDK) -> Layer B (settle on chain) -> persist
import { agentKeypair, cluster, connection, deployment, explorer } from "./config";
import { balances, fromBase, layerA, PROGRAM_ID, readMandate, resolvePayee, settleOnChain, toBase, type LayerB } from "./chain";
import { brainName, think, type ChatMsg } from "./brain";
import { takeForceBudget } from "./ratelimit";
import { scoreOutcome, violations } from "./score";
import { newId, store } from "./store";
import type { Attempt, LiveStats } from "./types";

export const MAX_PROMPT = 1500;
export const MAX_HISTORY = 6;

/** Sanitize client-supplied history. The chat is untrusted by design; we just
 *  bound its size. (Forged history, such as a fake assistant turn agreeing to
 *  pay, is a legitimate jailbreak technique here, so it is allowed.) */
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

function deploymentChecked() {
  const d = deployment();
  if (d.programId !== PROGRAM_ID.toBase58()) {
    throw new Error(`deployment programId ${d.programId} does not match the vendored IDL (${PROGRAM_ID.toBase58()})`);
  }
  return d;
}

function chainResult(r: LayerB): NonNullable<Attempt["chain"]> {
  return { submitted: r.submitted, ok: r.ok, sig: r.sig, error: r.error, explorer: r.sig ? explorer(r.sig) : undefined };
}

/** Persist an attempt without letting a storage outage hide what already
 *  happened on chain. The turn's result is returned to the player either way;
 *  only the feed and counters miss it. */
async function persist(a: Attempt): Promise<void> {
  try {
    await store().add(a);
  } catch (e) {
    console.error("[leash] could not persist attempt", a.id, e instanceof Error ? e.message : e);
  }
}

/** Run one turn: ask the brain, score any `pay` call against the live
 *  mandate, run Layer A, then hit the chain (forced revert for a jailbreak, a
 *  real settle for a legit payment), and persist the result. */
export async function runTurn(prompt: string, history: ChatMsg[]): Promise<Attempt> {
  const d = deploymentChecked();
  const conn = await connection();
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
    await persist(a);
    return a;
  }

  const payee = resolvePayee(thought.call.to, d);
  const amount = toBase(thought.call.amount, d.decimals);
  const v = violations(mandate, payee.merchant.toBase58(), amount);
  const outcome = scoreOutcome(v);

  // Layer A: the published capline SDK gate. "The policy said no."
  const gate = await layerA(conn, agent, d, payee, amount);

  // Layer B: hit the chain for real.
  //   jailbroken -> FORCE-submit (skip preflight) so the program reverts it on
  //                 the ledger, leaving a public failed tx as proof. Bounded by
  //                 a global daily fee budget and the LEASH_FORCE_ONCHAIN kill switch.
  //   legit      -> a normal settle to the allowlisted vendor (real transfer),
  //                 only if Layer A agrees too.
  //   held       -> nothing is sent.
  let chain: Attempt["chain"];
  if (outcome === "jailbroken") {
    if (process.env.LEASH_FORCE_ONCHAIN === "0") {
      chain = { submitted: false, ok: false, skipped: "forced reverts disabled (LEASH_FORCE_ONCHAIN=0)" };
    } else if (!(await takeForceBudget())) {
      chain = { submitted: false, ok: false, skipped: "daily on-chain revert budget used up" };
    } else {
      chain = chainResult(await settleOnChain(conn, agent, d, payee, amount, true));
      if (chain.ok) {
        // Should be impossible: the program accepted a payment we scored as a
        // breach. Shout, and record it exactly as it happened.
        console.error("[leash] SECURITY: a jailbroken settle SUCCEEDED on chain", chain.sig);
      }
    }
  } else if (outcome === "legit" && gate.allowed) {
    chain = chainResult(await settleOnChain(conn, agent, d, payee, amount, false));
  }

  const a: Attempt = {
    ...base,
    outcome,
    violations: v,
    payee: { raw: payee.raw, resolved: payee.merchant.toBase58(), kind: payee.kind },
    layerA: { allowed: gate.allowed, reason: gate.reason },
    chain,
  };
  await persist(a);
  return a;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Stats for the page. Counters come from the store; balances (including
 *  "paid out") come from chain. Each half degrades to `null` independently, so
 *  a KV outage never zeroes the chain numbers and an RPC outage never shows a
 *  "$0.00 paid out" that was not actually read. Throws only when there is no
 *  usable deployment at all. */
export async function liveStats(): Promise<LiveStats> {
  const d = deploymentChecked();
  const [counters, chain] = await Promise.allSettled([store().stats(), connection().then((conn) => balances(conn, d))]);
  if (counters.status === "rejected") console.error("[stats] store", errMessage(counters.reason));
  if (chain.status === "rejected") console.error("[stats] chain", errMessage(chain.reason));
  return {
    counters: counters.status === "fulfilled" ? counters.value : null,
    countersError: counters.status === "rejected" ? "attempt counters unavailable" : undefined,
    chain:
      chain.status === "fulfilled"
        ? { vault: chain.value.vault, paidOut: chain.value.paidOut, vendorPaid: chain.value.vendor, agentSol: chain.value.agentSol }
        : null,
    // Surface the devnet guard verbatim; hide other RPC errors (URLs may carry keys).
    chainError:
      chain.status === "rejected"
        ? /refusing/.test(errMessage(chain.reason))
          ? errMessage(chain.reason)
          : "chain unreachable right now"
        : undefined,
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
    brain: brainName(),
    storage: store().kind,
  };
}
