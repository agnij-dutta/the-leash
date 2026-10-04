import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?view=fame|recent&n=1..50 -> {view, items}. 503 (not an empty list)
 *  when storage is down, so the client can tell "nobody yet" from "unknown". */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const view = url.searchParams.get("view") === "recent" ? "recent" : "fame";
  const n = Math.min(50, Math.max(1, Math.floor(Number(url.searchParams.get("n"))) || 20));
  try {
    const items = view === "recent" ? await store().recent(n) : await store().fame(n);
    return Response.json({ view, items }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[attempts]", e instanceof Error ? e.message : e);
    return Response.json({ view, error: "attempt feed unavailable" }, { status: 503 });
  }
}
