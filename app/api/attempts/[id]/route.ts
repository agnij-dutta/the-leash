import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await store().get(id);
  if (!a) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ attempt: a });
}
