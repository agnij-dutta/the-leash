import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { store } from "@/lib/store";
import { Verdict } from "@/components/AttemptCard";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const a = await store().get(id);
  const title = a?.outcome === "jailbroken" ? "I jailbroke The Leash. It still paid $0." : "The Leash · it still paid $0";
  return {
    title,
    description: "An AI agent meant to be jailbroken. The jailbreak works, the theft does not: the chain reverts it.",
    openGraph: { title },
    twitter: { card: "summary_large_image", title },
  };
}

export default async function AttemptPage({ params }: Props) {
  const { id } = await params;
  const a = await store().get(id);
  if (!a) notFound();
  const jb = a.outcome === "jailbroken";
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8">
      <a href="/" className="kicker hover:text-accent">← the leash</a>
      <h1 className="mt-8 font-display text-5xl font-black uppercase leading-[0.95] tracking-[-0.03em] sm:text-6xl">
        {jb ? "I jailbroke The Leash." : a.outcome === "legit" ? "A legit Kibble invoice." : "The Leash held."}
      </h1>
      <div className="relative mt-3 inline-block font-display text-6xl font-black leading-none tracking-[-0.04em] text-accent sm:text-7xl">
        {a.outcome === "legit" ? "Paid inside the cap." : "It still paid $0."}
        <span className="capline-draw absolute -left-3 -right-3 top-[0.3em] h-[3px] bg-accent" />
      </div>

      <section className="mt-10 border-2 border-line">
        <div className="border-b border-line px-5 py-3 kicker">the prompt</div>
        <p className="whitespace-pre-wrap px-5 py-4 font-mono text-sm">{a.prompt}</p>
        <div className="border-y border-line px-5 py-3 kicker">leash replied</div>
        <p className="px-5 py-4 text-sm">{a.reply || <span className="text-dim">(no words, straight to the tool call)</span>}</p>
        <div className="border-y border-line px-5 py-3 kicker">what actually happened</div>
        <div className="px-5 py-4">
          <Verdict a={a} />
        </div>
      </section>

      <p className="mt-6 font-mono text-[11px] text-faint">
        brain {a.brain} · solana {a.cluster} · {new Date(a.ts).toISOString().replace("T", " ").slice(0, 16)} UTC
      </p>
      <a href="/" className="mt-8 inline-block bg-accent px-6 py-3 font-display text-sm font-black uppercase tracking-wider text-bg">
        Your turn: try to jailbreak it
      </a>
    </main>
  );
}
