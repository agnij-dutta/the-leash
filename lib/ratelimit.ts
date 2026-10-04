// Per-IP fixed-window rate limiting. KV-backed when KV is configured (shared
// across serverless instances), in-memory otherwise. Every turn can cost a
// devnet transaction fee, so this also protects the agent's SOL balance.
import { createHash } from "node:crypto";
import { store } from "./store";

const PER_MIN = Number(process.env.LEASH_RL_PER_MIN || 6);
const PER_DAY = Number(process.env.LEASH_RL_PER_DAY || 120);

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "local";
}

export async function rateLimit(req: Request): Promise<{ ok: true } | { ok: false; retryAfter: number; reason: string }> {
  // never store raw IPs
  const ip = createHash("sha256").update(clientIp(req) + (process.env.LEASH_RL_SALT || "leash")).digest("hex").slice(0, 24);
  const s = store();
  const minute = await s.incr(`m:${ip}`, 60);
  if (minute > PER_MIN) return { ok: false, retryAfter: 60, reason: `easy, tiger: ${PER_MIN} attempts per minute` };
  const day = await s.incr(`d:${ip}`, 86400);
  if (day > PER_DAY) return { ok: false, retryAfter: 3600, reason: `daily limit of ${PER_DAY} attempts reached` };
  return { ok: true };
}
