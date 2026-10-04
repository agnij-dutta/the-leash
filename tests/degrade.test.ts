// Storage and RPC outages must degrade to "unknown", never to fake zeros.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.LEASH_CLUSTER = "localnet";
process.env.LEASH_RPC_URL = "http://127.0.0.1:9"; // nothing listens on the discard port
process.env.KV_REST_API_URL = "http://127.0.0.1:9";
process.env.KV_REST_API_TOKEN = "test";
process.env.LEASH_DEPLOYMENT_JSON = JSON.stringify({
  cluster: "localnet",
  rpc: "http://127.0.0.1:8899",
  programId: "DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp",
  principal: "AWBEjE2dYYtVJomKiSqNRVsi3uGyiCFQPhY19yMh8spQ",
  agent: "33DLfxCdVGhj71jXvHQ4Cuoo23zPrE2tzV2fWv2FKsX4",
  vendor: "77FrmDRGwdMSbJF9dfjjJLEHVR3eJ1sgZTrUhAXeV11Q",
  vendorName: "Kibble Co.",
  vendorAta: "3ZL1ozYUayBfRk5t1Bx8jKTnmFv7JmDNE7yPJegYrV9m",
  attacker: "3KMaaCpp3HxiNjuwRhiRfLFS6zEJHdMRsR5kMGw8Pcka",
  sinkAta: "Fyxjv9VRkMgceGNqffDU96C1Vdm9ZUxne3FeFcrzgWXS",
  mint: "7AwWrrwP21kgiPKzW7frNcNAEzASim8VACDAvoT21dUv",
  mandate: "6dFjedRW2UTwxK57vmUwFGzJSKJ2iDKBpCw6NFV2FumG",
  vault: "Ddt2ahCiU191Hrb77j5VVSArdNSmXdPH1xibgxEZH2z5",
  nonce: "1",
  decimals: 6,
  maxPerTx: 5,
  totalCap: 1000,
  vaultFunded: 1000,
  notAfter: 1798870188,
  ap2Verified: true,
  createdAt: "2026-10-04T00:00:00.000Z",
  txs: {},
});

const { liveStats } = await import("../lib/leash");
const { takeForceBudget } = await import("../lib/ratelimit");
const { GET: attemptsGET } = await import("../app/api/attempts/route");

test("with KV and RPC both down, stats report null, not zero", async () => {
  const s = await liveStats();
  assert.equal(s.counters, null);
  assert.equal(s.chain, null, "paid out must be unknown, not $0.00");
  assert.ok(s.countersError);
  assert.ok(s.chainError);
  assert.ok(!s.chainError?.includes("127.0.0.1"), "RPC URL must not leak to the client");
  assert.equal(s.vendorName, "Kibble Co.");
});

test("the forced-revert budget fails closed when storage is down", async () => {
  assert.equal(await takeForceBudget(), false);
});

test("the attempts feed answers 503, not an empty list, when storage is down", async () => {
  const res = await attemptsGET(new Request("http://x/api/attempts?view=recent"));
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { items?: unknown }).items, undefined);
});
