import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, verify, safeEqual } from "../convex/lib/hmac";

const secret = "s3cret";
const body = JSON.stringify({ a: 1 });

test("valid signature verifies", async () => {
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = await sign(secret, ts, body);
  assert.deepEqual(await verify({ secret, timestamp: ts, signature, body }), { ok: true });
});
test("matches node:crypto HMAC-SHA256 reference", async () => {
  const sig = await sign("s3cret", "1700000000", body);
  assert.match(sig, /^[0-9a-f]{64}$/);
  const { createHmac } = await import("node:crypto");
  assert.equal(sig, createHmac("sha256", "s3cret").update(`1700000000.${body}`).digest("hex"));
});
test("tampered body rejected", async () => {
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = await sign(secret, ts, body);
  const r = await verify({ secret, timestamp: ts, signature, body: body + " " });
  assert.equal(r.ok, false);
});
test("wrong secret rejected", async () => {
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = await sign("other", ts, body);
  assert.equal((await verify({ secret, timestamp: ts, signature, body })).ok, false);
});
test("stale timestamp rejected (replay)", async () => {
  const ts = String(Math.floor(Date.now() / 1000) - 3600);
  const signature = await sign(secret, ts, body);
  const r = await verify({ secret, timestamp: ts, signature, body });
  assert.equal(r.ok, false);
});
test("missing headers / missing server secret rejected", async () => {
  assert.equal((await verify({ secret, timestamp: null, signature: null, body })).ok, false);
  assert.equal((await verify({ secret: undefined, timestamp: "1", signature: "x", body })).ok, false);
});
test("safeEqual", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "ab"), false);
});
