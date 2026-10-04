// Attempt storage:
//   KV_REST_API_URL + KV_REST_API_TOKEN set -> Upstash / Vercel KV over REST
//   else, local dev                         -> JSONL file (.data/attempts.jsonl)
//   else (serverless, no KV)                -> in-memory (per instance)
//
// The store is bookkeeping: the feed, share cards and the jailbroken/held
// counters. It is never the source of the "paid out" number (that is read
// from chain), and every method may throw; callers decide how to degrade.
import fs from "node:fs";
import path from "node:path";

import type { Attempt, Stats } from "./types";

export type { Attempt, Outcome, Stats } from "./types";

/** Storage backend for attempts and rate-limit counters. */
export interface Store {
  readonly kind: "kv" | "file" | "memory";
  add(a: Attempt): Promise<void>;
  get(id: string): Promise<Attempt | null>;
  recent(n: number): Promise<Attempt[]>;
  fame(n: number): Promise<Attempt[]>;
  stats(): Promise<Stats>;
  /** fixed-window counter for rate limiting; returns the count after increment */
  incr(key: string, windowSec: number): Promise<number>;
}

/** Hall-of-fame rank: the attempted amount of a jailbreak, capped so a
 *  model asking for 1e300 cannot break sorting. Non-jailbreaks score 0. */
export function fameScore(a: Attempt): number {
  if (a.outcome !== "jailbroken" || !a.call) return 0;
  const amt = Number.isFinite(a.call.amount) ? Math.max(0, a.call.amount) : 0;
  return Math.min(amt, 1e15);
}

function emptyStats(): Stats {
  return { total: 0, jailbroken: 0, held: 0, legit: 0, reverted: 0 };
}

// --- memory / file ----------------------------------------------------------
/** In-memory store, optionally appended to a JSONL file. Single process only:
 *  two processes (say `npm run dev` and `npm run e2e`) each keep their own
 *  view until restarted. */
export class LocalStore implements Store {
  readonly kind: "file" | "memory";
  private items: Attempt[] = [];
  private counters = new Map<string, { n: number; exp: number }>();
  constructor(private file: string | null) {
    this.kind = file ? "file" : "memory";
    if (file && fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          this.items.push(JSON.parse(line) as Attempt);
        } catch {
          /* skip corrupt line */
        }
      }
    }
  }
  async add(a: Attempt) {
    this.items.push(a);
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, `${JSON.stringify(a)}\n`);
    }
  }
  async get(id: string) {
    return this.items.find((a) => a.id === id) ?? null;
  }
  async recent(n: number) {
    return this.items.slice(-n).reverse();
  }
  async fame(n: number) {
    return this.items
      .filter((a) => a.outcome === "jailbroken")
      .sort((x, y) => fameScore(y) - fameScore(x) || y.ts - x.ts)
      .slice(0, n);
  }
  async stats() {
    const s = emptyStats();
    for (const a of this.items) {
      s.total++;
      s[a.outcome]++;
      if (a.chain?.submitted && !a.chain.ok) s.reverted++;
    }
    return s;
  }
  async incr(key: string, windowSec: number) {
    const now = Date.now();
    // Drop expired windows now and then, so a long-running process does not
    // keep one entry per IP forever.
    if (this.counters.size > 10_000) {
      for (const [k, v] of this.counters) if (v.exp < now) this.counters.delete(k);
    }
    const c = this.counters.get(key);
    if (!c || c.exp < now) {
      this.counters.set(key, { n: 1, exp: now + windowSec * 1000 });
      return 1;
    }
    c.n++;
    return c.n;
  }
}

// --- Upstash / Vercel KV REST ------------------------------------------------
/** Upstash Redis REST (also what Vercel KV / Marketplace Redis exposes).
 *  Every call is one `/pipeline` request. */
class KvStore implements Store {
  readonly kind = "kv" as const;
  constructor(
    private url: string,
    private token: string,
  ) {}
  private async pipeline(cmds: (string | number)[][]): Promise<unknown[]> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(cmds),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`kv pipeline failed: ${res.status}`);
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    return out.map((r) => {
      if (r.error) throw new Error(`kv: ${r.error}`);
      return r.result;
    });
  }
  private async mget(ids: string[]): Promise<Attempt[]> {
    if (ids.length === 0) return [];
    const [vals] = await this.pipeline([["MGET", ...ids.map((id) => `leash:attempt:${id}`)]]);
    return ((vals as (string | null)[]) ?? []).filter((v): v is string => !!v).map((v) => JSON.parse(v) as Attempt);
  }
  async add(a: Attempt) {
    const cmds: (string | number)[][] = [
      ["SET", `leash:attempt:${a.id}`, JSON.stringify(a)],
      ["LPUSH", "leash:recent", a.id],
      ["LTRIM", "leash:recent", 0, 499],
      ["HINCRBY", "leash:stats", "total", 1],
      ["HINCRBY", "leash:stats", a.outcome, 1],
    ];
    if (a.chain?.submitted && !a.chain.ok) cmds.push(["HINCRBY", "leash:stats", "reverted", 1]);
    if (a.outcome === "jailbroken") cmds.push(["ZADD", "leash:fame", fameScore(a), a.id]);
    await this.pipeline(cmds);
  }
  async get(id: string) {
    return (await this.mget([id]))[0] ?? null;
  }
  async recent(n: number) {
    const [ids] = await this.pipeline([["LRANGE", "leash:recent", 0, n - 1]]);
    return this.mget(ids as string[]);
  }
  async fame(n: number) {
    const [ids] = await this.pipeline([["ZRANGE", "leash:fame", 0, n - 1, "REV"]]);
    return this.mget(ids as string[]);
  }
  async stats() {
    const [flat] = await this.pipeline([["HGETALL", "leash:stats"]]);
    const s = emptyStats();
    const arr = (flat as string[]) ?? [];
    for (let i = 0; i + 1 < arr.length; i += 2) {
      const k = arr[i] as keyof Stats;
      if (k in s) s[k] = Number(arr[i + 1]) || 0;
    }
    return s;
  }
  async incr(key: string, windowSec: number) {
    const [n] = await this.pipeline([
      ["INCR", `leash:rl:${key}`],
      ["EXPIRE", `leash:rl:${key}`, windowSec, "NX"],
    ]);
    return Number(n);
  }
}

function make(): Store {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) return new KvStore(url, token);
  if (process.env.VERCEL) return new LocalStore(null); // read-only FS
  return new LocalStore(process.env.LEASH_DATA_FILE || path.join(process.cwd(), ".data", "attempts.jsonl"));
}

// One store per process, kept on globalThis so Next dev hot reloads reuse it.
const g = globalThis as unknown as { __leashStore?: Store };
/** The process-wide store, picked from env on first use. */
export function store(): Store {
  if (!g.__leashStore) g.__leashStore = make();
  return g.__leashStore;
}

/** Shape check for ids from URLs, before they reach a storage key. */
export function isAttemptId(id: string): boolean {
  return /^[a-z0-9]{1,16}$/.test(id);
}

/** Random 10-char id for share URLs (/a/<id>). Not a secret. */
export function newId(): string {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 10);
}
