export function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function amt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1e12) return n.toExponential(2);
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function short(s: string, head = 4, tail = 4): string {
  if (!s) return "";
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const VIOLATION_LABEL: Record<string, string> = {
  OVER_PER_TX: "over per-tx cap",
  OVER_TOTAL: "over total cap",
  NOT_ALLOWLISTED: "payee not on allowlist",
  EXPIRED: "mandate expired",
  REVOKED: "mandate revoked",
  BAD_AMOUNT: "invalid amount",
};
