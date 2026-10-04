// Shared OG card renderer (next/og). Brutalist: near-black, acid lime, cap line.
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

let archivo: Promise<Buffer> | null = null;
function display() {
  return (archivo ??= readFile(join(process.cwd(), "assets", "Archivo-Black.ttf")));
}

export const OG_SIZE = { width: 1200, height: 630 };

export async function card(opts: { headline: string; sub: string; quote?: string; footer: string; badge?: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0a0a0a",
          color: "#ededed",
          padding: "56px 64px",
          fontFamily: "Archivo",
          backgroundImage: "linear-gradient(to right, #141414 1px, transparent 1px), linear-gradient(to bottom, #141414 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 22, letterSpacing: 4, color: "#8a8a8a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 4, background: "#c6f806" }} />
            <div style={{ width: 12, height: 12, background: "#c6f806" }} />
            <div style={{ display: "flex", marginLeft: 8, color: "#ededed", fontWeight: 900 }}>THE LEASH</div>
          </div>
          {opts.badge ? (
            <div style={{ display: "flex", background: "#ff2d2d", color: "#0a0a0a", padding: "6px 14px", fontWeight: 900 }}>{opts.badge}</div>
          ) : (
            <div style={{ display: "flex" }}>ENFORCED BY CAPLINE</div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 48, position: "relative" }}>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 900, lineHeight: 1.02, letterSpacing: -1, textTransform: "uppercase" }}>{opts.headline}</div>
          <div style={{ display: "flex", position: "relative", marginTop: 18 }}>
            <div style={{ display: "flex", fontSize: 92, fontWeight: 900, color: "#c6f806", letterSpacing: -2, textTransform: "uppercase" }}>{opts.sub}</div>
            <div style={{ position: "absolute", left: -16, right: -16, top: 30, height: 5, background: "#c6f806", display: "flex" }} />
          </div>
        </div>

        {opts.quote ? (
          <div style={{ display: "flex", marginTop: 28, borderLeft: "4px solid #3d3d3d", paddingLeft: 20, fontSize: 26, color: "#8a8a8a", lineHeight: 1.3 }}>
            {opts.quote}
          </div>
        ) : null}

        <div style={{ display: "flex", marginTop: "auto", fontSize: 20, color: "#8a8a8a", letterSpacing: 1 }}>{opts.footer}</div>
      </div>
    ),
    { ...OG_SIZE, fonts: [{ name: "Archivo", data: await display(), weight: 900, style: "normal" }] },
  );
}
