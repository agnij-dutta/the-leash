import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const view = url.searchParams.get("view") === "recent" ? "recent" : "fame";
  const n = Math.min(50, Math.max(1, Number(url.searchParams.get("n")) || 20));
  const items = view === "recent" ? await store().recent(n) : await store().fame(n);
  return Response.json({ view, items }, { headers: { "cache-control": "no-store" } });
}
