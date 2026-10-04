import { liveStats } from "@/lib/leash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET -> LiveStats. Counters from the store, balances from chain; either may
 *  be null on its own (see `liveStats`). 503 only without a deployment. */
export async function GET() {
  try {
    return Response.json(await liveStats(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[stats]", msg);
    const safe = /no deployment|provisioned for|not valid JSON|does not match/.test(msg) ? msg : "stats unavailable right now";
    return Response.json({ error: safe }, { status: 503 });
  }
}
