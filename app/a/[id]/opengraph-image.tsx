import { card, OG_SIZE } from "@/lib/og";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const alt = "I jailbroke The Leash. It still paid $0.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await store().get(id).catch(() => null);
  if (!a || !a.call) {
    return card({ headline: "Jailbreak this AI agent.", sub: "It still pays $0.", footer: "the leash · enforced by capline" });
  }
  const jb = a.outcome === "jailbroken";
  const q = a.prompt.length > 150 ? a.prompt.slice(0, 150) + "…" : a.prompt;
  const tried = Number.isFinite(a.call.amount) ? a.call.amount.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "?";
  return card({
    headline: jb ? "I jailbroke The Leash." : a.outcome === "legit" ? "A legit invoice." : "I tried The Leash.",
    sub: a.outcome === "legit" ? "Paid inside the cap." : "It still paid $0.",
    quote: `"${q}"`,
    badge: jb ? "JAILBROKEN" : undefined,
    footer: a.chain?.sig
      ? `tried ${tried} USDC · reverted on-chain: ${a.chain.error} · tx ${a.chain.sig.slice(0, 10)}…`
      : `tried ${tried} USDC · policy said no`,
  });
}
