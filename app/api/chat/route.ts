import { cleanHistory, MAX_PROMPT, runTurn } from "@/lib/leash";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST {prompt, history} -> {attempt}. One scored, on-chain-judged turn. */
export async function POST(req: Request) {
  let body: { prompt?: unknown; history?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return Response.json({ error: "say something" }, { status: 400 });
  if (prompt.length > MAX_PROMPT) return Response.json({ error: `keep it under ${MAX_PROMPT} characters` }, { status: 400 });

  // Fail closed: if the limiter's store is down, refuse the turn rather than
  // let unmetered traffic spend the agent's SOL and the LLM budget.
  let rl: Awaited<ReturnType<typeof rateLimit>>;
  try {
    rl = await rateLimit(req);
  } catch (e) {
    console.error("[chat] rate limiter unavailable", e instanceof Error ? e.message : e);
    return Response.json({ error: "rate limiter unavailable, try again shortly" }, { status: 503 });
  }
  if (!rl.ok) {
    return Response.json({ error: rl.reason }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  }

  try {
    const attempt = await runTurn(prompt, cleanHistory(body.history));
    return Response.json({ attempt });
  } catch (e) {
    console.error("[chat]", e instanceof Error ? e.message : e);
    return Response.json({ error: "Leash tripped over its own leash. Try again in a moment." }, { status: 502 });
  }
}
