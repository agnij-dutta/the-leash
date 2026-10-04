import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { assertGenesis, cluster, explorer, GENESIS, parseSecretKey, publicRpcUrl, rpcUrl } from "../lib/config";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

test("cluster() accepts devnet and localnet only", () => {
  delete process.env.LEASH_CLUSTER;
  assert.equal(cluster(), "devnet");
  for (const c of ["localnet", "LOCAL", "localhost"]) {
    process.env.LEASH_CLUSTER = c;
    assert.equal(cluster(), "localnet");
  }
  for (const c of ["mainnet", "mainnet-beta", "testnet", "Mainnet "]) {
    process.env.LEASH_CLUSTER = c;
    assert.throws(() => cluster(), /devnet or a local validator only/, c);
  }
});

test("NEXT_PUBLIC_CLUSTER is not a way to pick the cluster", () => {
  delete process.env.LEASH_CLUSTER;
  process.env.NEXT_PUBLIC_CLUSTER = "mainnet";
  assert.equal(cluster(), "devnet");
});

test("rpcUrl() refuses URLs that name mainnet", () => {
  process.env.LEASH_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=x";
  assert.throws(() => rpcUrl("devnet"), /mainnet/);
  process.env.LEASH_RPC_URL = "https://api.MAINNET-beta.solana.com";
  assert.throws(() => rpcUrl("devnet"), /mainnet/);
});

test("the genesis check catches mainnet behind an innocent-looking URL", () => {
  assert.throws(() => assertGenesis("devnet", GENESIS.mainnet), /MAINNET/);
  assert.throws(() => assertGenesis("localnet", GENESIS.mainnet), /MAINNET/);
  assert.throws(() => assertGenesis("devnet", GENESIS.testnet), /not devnet/);
  assert.throws(() => assertGenesis("devnet", "SomeLocalValidatorHash111111111111111111111"), /not devnet/);
  assert.throws(() => assertGenesis("localnet", GENESIS.devnet), /public cluster/);
  assert.doesNotThrow(() => assertGenesis("devnet", GENESIS.devnet));
  assert.doesNotThrow(() => assertGenesis("localnet", "SomeLocalValidatorHash111111111111111111111"));
});

test("RPC credentials never reach deployment files or explorer links", () => {
  process.env.LEASH_RPC_URL = "http://127.0.0.1:8899/?api-key=SECRET123";
  assert.equal(publicRpcUrl("localnet"), "http://127.0.0.1:8899");
  assert.ok(!explorer("abc", "tx", "localnet").includes("SECRET123"));
  process.env.LEASH_RPC_URL = "https://devnet.helius-rpc.com/?api-key=SECRET123";
  assert.equal(publicRpcUrl("devnet"), "https://api.devnet.solana.com");
  process.env.LEASH_RPC_URL = "https://user:pass@rpc.example.com";
  assert.equal(publicRpcUrl("devnet"), "https://api.devnet.solana.com");
});

test("parseSecretKey validates shape and never echoes the input", () => {
  const secretish = "[12,34,56,not-json";
  try {
    parseSecretKey(secretish, "LEASH_AGENT_SECRET");
    assert.fail("should throw");
  } catch (e) {
    assert.ok(!(e as Error).message.includes("12,34"), (e as Error).message);
  }
  assert.throws(() => parseSecretKey("[1,2,3]", "x"), /64 bytes/);
  assert.throws(() => parseSecretKey(JSON.stringify(Array(64).fill(256)), "x"), /64 bytes/);
  assert.equal(parseSecretKey(JSON.stringify(Array(64).fill(7)), "x").length, 64);
});
