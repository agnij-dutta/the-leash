// Per-IP fixed-window rate limiting, plus a global daily budget for forced
// on-chain reverts. KV-backed when KV is configured (shared across serverless
// instances), in-memory otherwise (per instance, so weaker on Vercel).
//
// Every jailbreak costs the agent a real transaction fee, so these limits
// protect the agent's SOL float as much as the LLM bill.
import { createHash } from "node:crypto";
import { store } from "./store";

/** Positive integer from env, else the default. A typo ("6/min", "") must not
 *  silently turn into NaN, because `n > NaN` is false and would disable the
 *  limit entirely. */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** The client IP as seen by the closest proxy. Uses the LAST entry of
 *  X-Forwarded-For: earlier entries are whatever the client sent, and a
 *  client can put anything there. On Vercel the header is overwritten with the
 *  real client IP, so first and last agree. Self-hosted, put the app behind
 *  exactly one proxy that appends to X-Forwarded-For. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.headers.get("x-real-ip")?.trim() || "local";
}

let warnedSalt = false;

/** Salted, truncated SHA-256 of the IP. Raw IPs are never stored or logged.
 *  The IPv4 space is small enough to brute-force an unsalted hash, so set
 *  LEASH_RL_SALT to a random secret in any public deployment. */
export function hashIp(ip: string): string {
  const salt = process.env.LEASH_RL_SALT;
  if (!salt && process.env.NODE_ENV === "production" && !warnedSalt) {
    warnedSalt = true;
    console.warn("[ratelimit] LEASH_RL_SALT is unset: IP hashes use a public default salt");
  }
  return createHash("sha256")
    .update(`${salt || "leash"}:${ip}`)
    .digest("hex")
    .slice(0, 24);
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfter: number; reason: string };

/** Count one attempt against the caller's per-minute and per-day windows.
 *  Throws if the store is unreachable; the caller must fail closed. */
export async function rateLimit(req: Request): Promise<RateLimitResult> {
  const perMin = envInt("LEASH_RL_PER_MIN", 6);
  const perDay = envInt("LEASH_RL_PER_DAY", 120);
  const ip = hashIp(clientIp(req));
  const s = store();
  const minute = await s.incr(`m:${ip}`, 60);
  if (minute > perMin) return { ok: false, retryAfter: 60, reason: `easy, tiger: ${perMin} attempts per minute` };
  const day = await s.incr(`d:${ip}`, 86400);
  if (day > perDay) return { ok: false, retryAfter: 3600, reason: `daily limit of ${perDay} attempts reached` };
  return { ok: true };
}

/** Take one slot from the global daily budget of forced reverts
 *  (`LEASH_FORCE_PER_DAY`, default 2000, about 0.01 SOL of fees a day).
 *  Returns false once the budget is spent, or if the store cannot be reached:
 *  skipping a revert is safe, overspending the agent's SOL is not. */
export async function takeForceBudget(): Promise<boolean> {
  const budget = envInt("LEASH_FORCE_PER_DAY", 2000);
  const day = new Date().toISOString().slice(0, 10);
  try {
    return (await store().incr(`force:${day}`, 86400)) <= budget;
  } catch (e) {
    console.error("[ratelimit] force budget unavailable", e instanceof Error ? e.message : e);
    return false;
  }
}
