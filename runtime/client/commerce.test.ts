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
test("cart fees retain Woo's distinct keys and exact amounts", async () => {
  const client = createCartClient({ fetch: (async () => Response.json({ ...empty, fees: [
    { key: 'handling', name: 'Handling', totals: { total: '125', total_tax: '25' } },
    { key: 'gift', name: 'Gift wrap', totals: { total: '200', total_tax: '0' } },
  ] })) as typeof fetch });
  assert.deepEqual((await client.get()).fees, [
    { id: 'handling', name: 'Handling', total: '1.25', totalTax: '0.25' },
    { id: 'gift', name: 'Gift wrap', total: '2.00', totalTax: '0.00' },
  ]);
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
test("a rejected nonce refreshes before retry, and refusals do not poison later writes", async () => {
  let calls = 0;
  const client = createCartClient({ fetch: (async () => {
    calls++;
    if (calls === 2) return Response.json({code: "woocommerce_rest_invalid_nonce", message: "Nonce is invalid.", data: {status: 403}}, {status: 403});
    // QuantityLimits::validate_cart_item_quantity, sent with a 400 by CartController::set_cart_item_quantity.
    if (calls === 5) return Response.json({code: "invalid_quantity", message: "The maximum quantity of &quot;Mug &amp; saucer&quot; allowed in the cart is 3", data: {status: 400}}, {status: 400});
    return Response.json(empty, {headers: {Nonce: `nonce-${calls}`}});
  }) as typeof fetch });
  await client.add(1);
  assert.equal(calls, 4);
  await assert.rejects(client.update("one", 99), (error: WooStoreError) => {
    assert.equal(error.status, 400);
    assert.equal(error.code, "invalid_quantity");
    assert.equal(error.message, 'The maximum quantity of "Mug & saucer" allowed in the cart is 3');
    assert.equal(error.cart, undefined);
    return true;
  });
  await client.remove("one");
  assert.equal(calls, 6);
});
test("error codes pass through unchanged, and only a 409's data.cart is read as the cart", async () => {
  const answers = [
    // A code from an extension, or from the Cart-Token session another client adds.
    Response.json({code: "cart_token_expired", message: "Sign in again &#8211; &#x2014; &bogus; &#0;", data: {status: 401}}, {status: 401}),
    Response.json({code: "rate_limit_exceeded", message: "Too many requests. Please wait 7 seconds before trying again.", data: {status: 429}}, {status: 429}),
    Response.json({code: "woocommerce_rest_cart_invalid_key", message: "Cart item does not exist.", data: {status: 409, cart: {...empty, items_count: 4}}}, {status: 409}),
    // Woo never puts a cart anywhere else, so nothing else is read as one.
    Response.json({code: "woocommerce_rest_unknown_server_error", message: "Internal server error", data: {status: 500}, cart: empty, ...empty}, {status: 500}),
  ];
  const client = createCartClient({ fetch: (async () => answers.shift()!) as typeof fetch });
  const failure = (run: Promise<unknown>) => run.then(() => assert.fail("expected a refusal"), (error: WooStoreError) => error);
  let error = await failure(client.get());
  assert.ok(error instanceof WooStoreError);
  assert.deepEqual([error.code, error.status, error.message], ["cart_token_expired", 401, "Sign in again \u2013 \u2014 &bogus; &#0;"]);
  assert.equal("rawCode" in error, false);
  error = await failure(client.get());
  assert.deepEqual([error.code, error.status, error.cart], ["rate_limit_exceeded", 429, undefined]);
  error = await failure(client.get());
  assert.deepEqual([error.code, error.status, error.cart?.itemsCount], ["woocommerce_rest_cart_invalid_key", 409, 4]);
  error = await failure(client.get());
  assert.deepEqual([error.code, error.status, error.cart], ["woocommerce_rest_unknown_server_error", 500, undefined]);
});
test("an answer that is not JSON reports its status, not a parse failure", async () => {
  const page = () => new Response("<!doctype html><title>Briefly unavailable for scheduled maintenance.</title>", {status: 503, headers: {"Content-Type": "text/html"}});
  const client = createCartClient({ fetch: (async () => page()) as typeof fetch });
  for (const run of [client.get(), client.add(1)]) {
    await assert.rejects(run, (error: WooStoreError) => {
      assert.ok(error instanceof WooStoreError);
      assert.deepEqual([error.code, error.status, error.message, error.cart], ["http_error", 503, "The cart request failed", undefined]);
      return true;
    });
  }
});
