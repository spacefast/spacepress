import assert from "node:assert/strict";
import { test } from "node:test";
import { createCartHooks, type CartHooks } from "./cart-react.ts";
import { createCartClient, WooStoreError, type WooCartClient } from "./commerce.ts";

function wireCart(quantity: number, country = "PL", selected = "courier") {
  const totals = {
    total_items: "2400", total_price: "3900", total_shipping: "1500", total_discount: "0", total_tax: "0",
    currency_code: "EUR", currency_minor_unit: 2,
  };
  return {
    items: quantity ? [{
      key: "mug", id: 42, name: "Ceramic mug", quantity, images: [], variation: [],
      prices: { price: "2400", currency_code: "EUR", currency_minor_unit: 2 },
      totals: { line_total: "2400", line_subtotal: "2400" },
    }] : [],
    items_count: quantity, needs_shipping: true, coupons: [], totals, shipping_address: { country },
    shipping_rates: [{ package_id: 0, name: "Shipping", shipping_rates: ["courier", "pickup"].map((id) => ({
      rate_id: id, name: id, price: "1500", selected: id === selected, currency_code: "EUR", currency_minor_unit: 2,
    })) }],
  };
}

const answer = (cart: ReturnType<typeof wireCart>) => Response.json(cart, { headers: { Nonce: "test-nonce" } });

// Exercise the hooks through React's external store interface without a DOM.
function mount<T>(client: WooCartClient, use: (hooks: CartHooks) => T) {
  let stop: (() => void) | undefined;
  const updates: T[] = [];
  const hooks = createCartHooks({
    useSyncExternalStore(subscribe, snapshot) {
      stop ??= subscribe(() => updates.push(read()));
      return snapshot();
    },
  }, client);
  const read = () => use(hooks);
  const initial = read();
  return { initial, read, updates, unmount: () => stop?.() };
}

test("cart hooks share a single read and roll back a refused new item", async (t) => {
  const write = Promise.withResolvers<Response>();
  let reads = 0;
  const client = createCartClient({ fetch: async (url) => {
    if (String(url).endsWith("/cart")) {
      reads++;
      return answer(wireCart(1));
    }
    return write.promise;
  } });
  const cart = mount(client, (hooks) => hooks.useCart());
  const count = mount(client, (hooks) => hooks.useCartCount());
  t.after(() => { cart.unmount(); count.unmount(); });
  assert.equal(cart.initial.loading, true);
  assert.equal(count.initial, undefined);
  await cart.read().refresh();
  assert.equal(reads, 1);

  const added = cart.read().add(123, 2);
  assert.equal(cart.read().pending, true);
  assert.equal(cart.read().cart?.items.length, 1);
  assert.equal(count.read(), 3);
  write.resolve(Response.json({ code: "stock_extension", message: "Out of stock." }, { status: 409 }));
  await assert.rejects(added, WooStoreError);
  assert.equal(count.read(), 1);
  assert.equal(cart.read().pending, false);
  const error = cart.read().error;
  assert.ok(error instanceof WooStoreError);
  assert.equal(error.message, "Out of stock.");
  assert.equal(error.rawCode, "stock_extension");
  assert.equal(error.cart, undefined);
});

test("a refusal replaces the cart and keeps later optimistic writes in order", async (t) => {
  const first = Promise.withResolvers<Response>();
  const second = Promise.withResolvers<Response>();
  const firstSent = Promise.withResolvers<void>();
  const secondSent = Promise.withResolvers<void>();
  const writes: string[] = [];
  const client = createCartClient({ fetch: async (url) => {
    const path = String(url).split("/").at(-1) ?? "";
    if (path === "cart") return answer(wireCart(1));
    writes.push(path);
    if (path === "update-item") {
      firstSent.resolve();
      return first.promise;
    }
    secondSent.resolve();
    return second.promise;
  } });
  const cart = mount(client, (hooks) => hooks.useCart());
  const count = mount(client, (hooks) => hooks.useCartCount());
  t.after(() => { cart.unmount(); count.unmount(); });
  await cart.read().refresh();

  const updated = cart.read().update("mug", 2);
  assert.equal(cart.read().cart?.items[0]?.quantity, 2);
  const added = cart.read().add(42, 2);
  assert.equal(count.read(), 4);
  await firstSent.promise;
  assert.deepEqual(writes, ["update-item"]);
  first.resolve(Response.json({
    code: "woocommerce_rest_product_out_of_stock", message: "Out of stock.", data: { cart: wireCart(3) },
  }, { status: 409 }));
  await assert.rejects(updated, (error) => {
    assert.ok(error instanceof WooStoreError);
    assert.equal(error.status, 409);
    assert.equal(error.code, "woocommerce_rest_product_out_of_stock");
    assert.equal(error.cart?.items[0]?.quantity, 3);
    assert.equal(error.cart?.totals.totalPrice, "39.00");
    assert.equal(cart.read().error, error);
    return true;
  });
  assert.equal(cart.read().cart?.items[0]?.quantity, 5);
  assert.equal(cart.read().pending, true);
  await secondSent.promise;
  assert.deepEqual(writes, ["update-item", "add-item"]);
  second.resolve(answer(wireCart(5)));
  await added;
  assert.equal(cart.read().error, undefined);
  assert.equal(cart.read().pending, false);
  assert.equal(count.read(), 5);
  assert.ok(count.updates.every((quantity) => quantity === undefined || quantity <= 5));
});

test("shipping and removal previews keep confirmed prices and roll back independently", async (t) => {
  const first = Promise.withResolvers<Response>();
  const second = Promise.withResolvers<Response>();
  const third = Promise.withResolvers<Response>();
  const client = createCartClient({ fetch: async (url) => {
    if (String(url).endsWith("/cart")) return answer(wireCart(1));
    if (String(url).endsWith("/update-customer")) return first.promise;
    if (String(url).endsWith("/select-shipping-rate")) return second.promise;
    return third.promise;
  } });
  const cart = mount(client, (hooks) => hooks.useCart());
  t.after(cart.unmount);
  await cart.read().refresh();
  const address = cart.read().updateCustomer({ shipping: { country: "DE", postcode: "10115" } });
  const shipping = cart.read().selectShipping(0, "pickup");
  const removal = cart.read().remove("mug");
  const chosen = () => cart.read().cart?.shippingRates[0]?.rates.find((rate) => rate.selected)?.id;
  assert.equal(cart.read().cart?.shippingAddress?.postcode, "10115");
  assert.equal(chosen(), "pickup");
  assert.deepEqual(cart.read().cart?.items, []);
  assert.equal(cart.read().cart?.totals.totalPrice, "39.00");

  first.resolve(answer(wireCart(1, "DE")));
  await address;
  second.resolve(Response.json({ code: "shipping_changed", data: { cart: { items: [] } } }, { status: 409 }));
  await assert.rejects(shipping, (error) => error instanceof WooStoreError && error.cart === undefined);
  assert.equal(chosen(), "courier");
  assert.equal(cart.read().cart?.shippingAddress?.country, "DE");
  assert.equal(cart.read().cart?.itemsCount, 0);

  third.resolve(answer(wireCart(0, "DE")));
  await removal;
  assert.equal(cart.read().pending, false);
  assert.deepEqual(cart.read().cart?.items, []);
});
