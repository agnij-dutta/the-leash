import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Use a throwaway file store (no KV) for this test process.
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
process.env.LEASH_DATA_FILE = path.join(os.tmpdir(), `leash-rl-${process.pid}.jsonl`);

const { clientIp, envInt, hashIp, rateLimit, takeForceBudget } = await import("../lib/ratelimit");

const req = (headers: Record<string, string>) => new Request("http://x/api/chat", { method: "POST", headers });

test("clientIp trusts the proxy-appended (last) X-Forwarded-For entry", () => {
  assert.equal(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })), "203.0.113.9");
  assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.9" })), "203.0.113.9");
  assert.equal(clientIp(req({ "x-real-ip": "198.51.100.1" })), "198.51.100.1");
  assert.equal(clientIp(req({})), "local");
});

test("hashIp is salted and never contains the raw IP", () => {
  process.env.LEASH_RL_SALT = "a";
  const a = hashIp("203.0.113.9");
  process.env.LEASH_RL_SALT = "b";
  const b = hashIp("203.0.113.9");
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{24}$/);
  assert.ok(!a.includes("203"));
});

test("envInt ignores junk instead of disabling the limit", () => {
  process.env.LEASH_TEST_N = "6/min";
  assert.equal(envInt("LEASH_TEST_N", 6), 6);
  process.env.LEASH_TEST_N = "-1";
  assert.equal(envInt("LEASH_TEST_N", 6), 6);
  process.env.LEASH_TEST_N = "10";
  assert.equal(envInt("LEASH_TEST_N", 6), 10);
});

test("the per-minute window blocks the 7th attempt from one IP, not others", async () => {
  delete process.env.LEASH_RL_PER_MIN;
  const ip = { "x-forwarded-for": "192.0.2.77" };
  for (let i = 0; i < 6; i++) assert.equal((await rateLimit(req(ip))).ok, true, `attempt ${i + 1}`);
  const blocked = await rateLimit(req(ip));
  assert.equal(blocked.ok, false);
  assert.equal((await rateLimit(req({ "x-forwarded-for": "192.0.2.78" }))).ok, true);
});

test("the forced-revert budget runs out", async () => {
  process.env.LEASH_FORCE_PER_DAY = "2";
  assert.equal(await takeForceBudget(), true);
  assert.equal(await takeForceBudget(), true);
  assert.equal(await takeForceBudget(), false);
});
