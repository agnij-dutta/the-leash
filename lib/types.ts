// Shared data shapes. This module has no runtime imports on purpose: client
// components import from here, so nothing server-only (keys, fs, RPC clients)
// can be pulled into the browser bundle through it.

/** How one chat turn is scored. See `lib/score.ts` for the rules. */
export type Outcome = "jailbroken" | "held" | "legit";

/** What the mandate would say about a payment, mirroring the checks in
 *  Capline's `settle` instruction (plus BAD_AMOUNT, which never reaches it). */
export type Violation = "OVER_PER_TX" | "OVER_TOTAL" | "NOT_ALLOWLISTED" | "EXPIRED" | "REVOKED" | "BAD_AMOUNT";

/** How the model's free-text `to` was mapped onto an on-chain merchant. */
export type PayeeKind = "vendor" | "address" | "stand-in";

/** One persisted turn. Everything here is public: it is served by
 *  `/api/attempts` and rendered on share cards. */
export interface Attempt {
  id: string;
  ts: number;
  prompt: string;
  reply: string;
  /** e.g. "groq:llama-3.3-70b-versatile" or "scripted" */
  brain: string;
  outcome: Outcome;
  call: { to: string; amount: number } | null;
  payee?: { raw: string; resolved: string; kind: PayeeKind };
  violations: Violation[];
  layerA?: { allowed: boolean; reason?: string };
  chain?: {
    /** the tx reached the chain (a forced revert or a real settle) */
    submitted: boolean;
    /** the tx succeeded; for a jailbreak this must always be false */
    ok: boolean;
    sig?: string;
    /** Capline program error name, e.g. PerTxCapExceeded */
    error?: string;
    explorer?: string;
    /** set when Layer B was skipped on purpose (fee budget, kill switch) */
    skipped?: string;
  };
  cluster: string;
}

/** Counters kept by the store. These are bookkeeping, not proof: the "paid
 *  out" figure is never derived from them (see `/api/stats`). */
export interface Stats {
  total: number;
  jailbroken: number;
  held: number;
  legit: number;
  reverted: number;
}

/** Shape of `GET /api/stats`. A section is `null` when its source (the store
 *  or the chain) could not be read, so the UI can say "unknown" instead of
 *  showing a zero that was never measured. */
export interface LiveStats {
  counters: Stats | null;
  countersError?: string;
  chain: {
    vault: number;
    /** live balance of the attacker sink token account */
    paidOut: number;
    vendorPaid: number;
    agentSol: number;
  } | null;
  chainError?: string;
  cluster: string;
  mandate: string;
  vaultAddress: string;
  mandateExplorer: string;
  vaultExplorer: string;
  sinkExplorer: string;
  maxPerTx: number;
  totalCap: number;
  vendorName: string;
  vendor: string;
  brain: string;
  storage: string;
}
