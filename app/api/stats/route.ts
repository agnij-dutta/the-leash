import { liveStats } from "@/lib/leash";
import { brainName } from "@/lib/brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ ...(await liveStats()), brain: brainName() }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[stats]", e);
    const msg = e instanceof Error && /no deployment|no agent key/.test(e.message) ? e.message : "chain unreachable right now, numbers may be stale";
    return Response.json({ error: msg }, { status: 503 });
  }
}
