import { isAttemptId, store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET -> {attempt}. 404 for unknown ids, 503 when storage is down. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isAttemptId(id)) return Response.json({ error: "not found" }, { status: 404 });
  try {
    const a = await store().get(id);
    if (!a) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ attempt: a });
  } catch (e) {
    console.error("[attempt]", e instanceof Error ? e.message : e);
    return Response.json({ error: "storage unavailable" }, { status: 503 });
  }
}
