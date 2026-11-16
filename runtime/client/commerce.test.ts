import { test } from "node:test";
import assert from "node:assert/strict";
import { createCartClient, wooDecimal, WooStoreError } from "./commerce.ts";
const empty = {
  items: [], items_count: 0, needs_shipping: true, coupons: [], shipping_rates: [],
  totals: { total_items: "900719925474099301", total_price: "900719925474099301", total_shipping: null, total_discount: "0", total_tax: "0", currency_code: "EUR", currency_minor_unit: 2 },
};
test("cart money keeps exact minor units and currency precision", () => {
  assert.equal(wooDecimal("900719925474099301", 2), "9007199254740993.01");
  assert.equal(wooDecimal("9", 3), "0.009");
  assert.equal(wooDecimal("123", 0), "123");
  assert.equal(wooDecimal("-5", 2), "-0.05");
  assert.throws(() => wooDecimal("1.2", 2));
});
test("cart writes initialize and rotate the Woo nonce in one cookie session, serialized", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = createCartClient({ fetch: (async (url, init) => {
    calls.push({url: String(url), init: init!});
    return Response.json(empty, {headers: {Nonce: `nonce-${calls.length}`}});
  }) as typeof fetch });
  const [first] = await Promise.all([client.add(42), client.update("item", 2)]);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(c => c.init.method), ["GET", "POST", "POST"]);
  assert.deepEqual(calls.map(c => new Headers(c.init.headers).get("Nonce")), [null, "nonce-1", "nonce-2"]);
  assert.ok(calls.every(c => c.init.credentials === "same-origin" && c.init.cache === "no-store" && !new Headers(c.init.headers).has("Cart-Token")));
  assert.equal(first.totals.totalPrice, "9007199254740993.01");
});
test("a rejected nonce refreshes before retry, and stock errors do not poison later writes", async () => {
  let calls = 0;
  const client = createCartClient({ fetch: (async () => {
    calls++;
    if (calls === 2) return Response.json({code: "woocommerce_rest_invalid_nonce", message: "Expired"}, {status: 403});
    if (calls === 5) return Response.json({code: "woocommerce_rest_product_not_enough_stock", message: "Insufficient stock"}, {status: 409});
    return Response.json(empty, {headers: {Nonce: `nonce-${calls}`}});
  }) as typeof fetch });
  await client.add(1);
  assert.equal(calls, 4);
  await assert.rejects(client.update("one", 99), (error: WooStoreError) => error.status === 409 && error.code === "woocommerce_rest_product_not_enough_stock");
  await client.remove("one");
  assert.equal(calls, 6);
});
