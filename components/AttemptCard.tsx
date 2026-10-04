"use client";

import type { Attempt } from "@/lib/store";
import { amt, short, VIOLATION_LABEL } from "./format";

/** The three-beat proof under every tool call: model -> Layer A -> chain. */
export function Verdict({ a, compact = false }: { a: Attempt; compact?: boolean }) {
  if (!a.call) {
    return (
      <div className="border-l-2 border-safe pl-3 font-mono text-[11px] uppercase tracking-wider text-safe">
        held · no tool call · the model refused
      </div>
    );
  }
  const jb = a.outcome === "jailbroken";
  return (
    <div className="space-y-0 font-mono text-[12px]">
      <Row n="01" label="model" tone={jb ? "danger" : a.outcome === "legit" ? "safe" : "dim"}>
        called <span className="text-fg">pay(</span>
        <span className="text-fg">{short(a.call.to, 10, 4)}</span>
        <span className="text-fg">, {amt(a.call.amount)})</span>
        {jb && <span className="ml-2 bg-danger px-1.5 py-0.5 text-[10px] font-bold text-bg">JAILBROKEN</span>}
        {a.outcome === "legit" && <span className="ml-2 bg-safe px-1.5 py-0.5 text-[10px] font-bold text-bg">LEGIT</span>}
        {!compact && a.violations.length > 0 && (
          <div className="mt-0.5 text-[11px] text-dim">{a.violations.map((v) => VIOLATION_LABEL[v] ?? v).join(" · ")}</div>
        )}
      </Row>
      {a.layerA && (
        <Row n="02" label="layer a" tone={a.layerA.allowed ? "safe" : "accent"}>
          {a.layerA.allowed ? "policy said yes" : <>policy said no: <span className="text-fg">{a.layerA.reason}</span></>}
        </Row>
      )}
      {a.chain && (
        <Row n="03" label="chain" tone={a.chain.ok ? "safe" : "accent"}>
          {a.chain.ok ? "settled" : a.chain.submitted ? "reverted on-chain:" : "rejected:"}{" "}
          {!a.chain.ok && <span className="text-fg">{a.chain.error}</span>}
          {a.chain.sig && (
            <a href={a.chain.explorer} target="_blank" rel="noreferrer" className="ml-2 text-accent underline decoration-1 underline-offset-2 hover:bg-accent hover:text-bg">
              tx {short(a.chain.sig, 6, 6)} ↗
            </a>
          )}
        </Row>
      )}
      {jb && a.chain && !a.chain.ok && (
        <div className="mt-2 border-2 border-accent bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-bg">
          jailbreak succeeded · theft failed · paid out $0.00
        </div>
      )}
    </div>
  );
}

function Row({ n, label, tone, children }: { n: string; label: string; tone: "danger" | "safe" | "accent" | "dim"; children: React.ReactNode }) {
  const c = tone === "danger" ? "text-danger" : tone === "safe" ? "text-safe" : tone === "accent" ? "text-accent" : "text-dim";
  return (
    <div className="flex gap-3 border-l-2 border-line py-1 pl-3">
      <span className="text-faint">{n}</span>
      <span className={`w-16 shrink-0 uppercase ${c}`}>{label}</span>
      <div className="min-w-0 break-words text-dim">{children}</div>
    </div>
  );
}
