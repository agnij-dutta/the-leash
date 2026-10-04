import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fameScore, LocalStore } from "../lib/store";
import type { Attempt } from "../lib/types";

const mk = (over: Partial<Attempt>): Attempt => ({
  id: Math.random().toString(36).slice(2, 12),
  ts: Date.now(),
  prompt: "p",
  reply: "r",
  brain: "scripted",
  outcome: "held",
  call: null,
  violations: [],
  cluster: "localnet",
  ...over,
});

test("stats count outcomes and only submitted-but-failed txs as reverted", async () => {
  const s = new LocalStore(null);
  await s.add(mk({ outcome: "held" }));
  await s.add(
    mk({ outcome: "jailbroken", call: { to: "x", amount: 9 }, chain: { submitted: true, ok: false, error: "PerTxCapExceeded" } }),
  );
  await s.add(mk({ outcome: "jailbroken", call: { to: "x", amount: 9 }, chain: { submitted: false, ok: false, skipped: "budget" } }));
  await s.add(mk({ outcome: "legit", call: { to: "Kibble Co.", amount: 3 }, chain: { submitted: true, ok: true } }));
  assert.deepEqual(await s.stats(), { total: 4, jailbroken: 2, held: 1, legit: 1, reverted: 1 });
});

test("hall of fame ranks jailbreaks by attempted amount and survives absurd numbers", async () => {
  const s = new LocalStore(null);
  await s.add(mk({ id: "small", outcome: "jailbroken", call: { to: "x", amount: 10 } }));
  await s.add(mk({ id: "huge", outcome: "jailbroken", call: { to: "x", amount: 1e300 } }));
  await s.add(mk({ id: "nan", outcome: "jailbroken", call: { to: "x", amount: Number.NaN } }));
  await s.add(mk({ id: "legit", outcome: "legit", call: { to: "x", amount: 5 } }));
  assert.deepEqual(
    (await s.fame(10)).map((a) => a.id),
    ["huge", "small", "nan"],
  );
  assert.equal(fameScore(mk({ outcome: "jailbroken", call: { to: "x", amount: -5 } })), 0);
});

test("the file store round-trips and skips corrupt lines", async () => {
  const file = path.join(os.tmpdir(), `leash-store-${process.pid}.jsonl`);
  fs.rmSync(file, { force: true });
  const a = new LocalStore(file);
  await a.add(mk({ id: "one" }));
  fs.appendFileSync(file, "{not json\n");
  const b = new LocalStore(file);
  assert.equal((await b.get("one"))?.id, "one");
  assert.equal((await b.stats()).total, 1);
  fs.rmSync(file, { force: true });
});
