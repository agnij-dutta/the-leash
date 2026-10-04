import { card, OG_SIZE } from "@/lib/og";

export const alt = "The Leash: jailbreak the agent, it still pays $0";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return card({
    headline: "Jailbreak this AI agent.",
    sub: "It still pays $0.",
    footer: "spend limits enforced on-chain, not in the prompt · solana devnet",
  });
}
