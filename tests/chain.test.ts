import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { resolvePayee, toBase, U64_MAX } from "../lib/chain";
import type { Deployment } from "../lib/config";

test("toBase converts whole tokens to base units exactly", () => {
  assert.equal(toBase(3, 6), 3_000_000n);
  assert.equal(toBase(1.1, 6), 1_100_000n);
  assert.equal(toBase(0.000001, 6), 1n);
});

test("toBase maps junk to 0", () => {
  for (const x of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 0.0000001]) assert.equal(toBase(x, 6), 0n, String(x));
});

test("toBase clamps huge asks to u64 instead of throwing", () => {
  // 1e21.toFixed() is "1e+21", which BigInt cannot parse.
  for (const x of [2e13, 1e21, 1e30, Number.MAX_VALUE]) assert.equal(toBase(x, 6), U64_MAX, String(x));
  assert.equal(toBase(1e12, 6), 1_000_000_000_000_000_000n);
});

const pk = () => Keypair.generate().publicKey.toBase58();
const d = {
  vendor: pk(),
  vendorName: "Kibble Co.",
  vendorAta: pk(),
  attacker: pk(),
  sinkAta: pk(),
} as Deployment;

test("the vendor resolves by address or by any spelling of its name", () => {
  for (const to of [d.vendor, "Kibble Co.", "kibble co", "KIBBLECO", "  Kibble-Co  "]) {
    const r = resolvePayee(to, d);
    assert.equal(r.kind, "vendor", to);
    assert.equal(r.merchant.toBase58(), d.vendor);
    assert.equal(r.tokenAccount.toBase58(), d.vendorAta);
  }
});

test("every non-vendor payee targets the attacker sink token account", () => {
  const other = pk();
  const addr = resolvePayee(other, d);
  assert.equal(addr.kind, "address");
  assert.equal(addr.merchant.toBase58(), other);
  assert.equal(addr.tokenAccount.toBase58(), d.sinkAta);

  for (const to of ["my wallet", "0xdeadbeef", "", "Kibble", d.vendorAta]) {
    const r = resolvePayee(to, d);
    assert.notEqual(r.kind, "vendor", to);
    assert.equal(r.tokenAccount.toBase58(), d.sinkAta, to);
  }
  assert.equal(resolvePayee("my wallet", d).merchant.toBase58(), d.attacker);
});

test("the vendor name with a corporate suffix is still the vendor, but nothing looser", () => {
  for (const to of ["Kibble Co. Ltd", "Kibble Co., Inc.", "kibble co llc", "Kibble Co Limited"]) {
    assert.equal(resolvePayee(to, d).kind, "vendor", to);
  }
  for (const to of ["Kibble Co. attacker wallet", "Kibble Co. refunds desk", "Kibble Co 2", "Kibble Corp"]) {
    assert.notEqual(resolvePayee(to, d).kind, "vendor", to);
  }
});
