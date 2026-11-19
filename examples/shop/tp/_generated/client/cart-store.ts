import { cart, WooStoreError, type WooCart, type WooCartClient } from "./commerce.ts";

export interface WooCartState {
  cart: WooCart | undefined;
  loading: boolean;
  pending: boolean;
  error: Error | undefined;
}

export interface WooCartActions extends Pick<WooCartClient, "add" | "update" | "remove" | "selectShipping" | "updateCustomer"> {
  refresh(): Promise<WooCart>;
}

export interface WooCartStore {
  subscribe(changed: () => void): () => void;
  snapshot(): WooCartState;
  serverSnapshot(): WooCartState;
  actions: WooCartActions;
}

const wooCartStores = new WeakMap<WooCartClient, WooCartStore>();

/** One cart store per client, shared by React hooks and other browser subscribers. */
export function createCartStore(client: WooCartClient = cart): WooCartStore {
  const shared = wooCartStores.get(client);
  if (shared) return shared;

  const initial: WooCartState = { cart: undefined, loading: true, pending: false, error: undefined };
  let state = initial;
  let confirmed: WooCart | undefined;
  const optimistic = new Set<(current: WooCart) => WooCart>();
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let reading: Promise<WooCart> | undefined;
  let writing = false;
  let receivedDuringWrite: WooCart | undefined;

  function publish(changes: Partial<WooCartState> = {}) {
    let cart = confirmed;
    if (cart) for (const update of optimistic) cart = update(cart);
    state = { ...state, ...changes, cart, pending: optimistic.size > 0 };
    for (const listener of listeners) listener();
  }

  function receive(cart: WooCart) {
    // The client's subscription can emit the write's own answer before its promise resolves.
    // Wait for that promise so we can drop the corresponding optimistic update at the same time.
    if (writing) {
      receivedDuringWrite = cart;
      return;
    }
    confirmed = cart;
    publish({ loading: false, error: undefined });
  }

  function describe(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  function enqueue(run: () => Promise<WooCart>): Promise<WooCart> {
    const next = tail.then(run);
    tail = next.catch(() => undefined);
    return next;
  }

  function refresh(): Promise<WooCart> {
    return reading ??= enqueue(async () => {
      try {
        const cart = await client.get();
        if (cart !== confirmed) receive(cart);
        return cart;
      } catch (error) {
        if (error instanceof WooStoreError && error.cart) confirmed = error.cart;
        publish({ loading: false, error: describe(error) });
        throw error;
      } finally {
        reading = undefined;
      }
    });
  }

  function write(run: () => Promise<WooCart>, update: (current: WooCart) => WooCart): Promise<WooCart> {
    optimistic.add(update);
    const result = enqueue(async () => {
      writing = true;
      let refusal: Error | undefined;
      try {
        confirmed = await run();
        return confirmed;
      } catch (error) {
        refusal = describe(error);
        const refreshed = error instanceof WooStoreError ? error.cart : undefined;
        confirmed = refreshed ?? receivedDuringWrite ?? confirmed;
        throw error;
      } finally {
        writing = false;
        receivedDuringWrite = undefined;
        optimistic.delete(update);
        publish({ loading: false, error: refusal });
      }
    });
    publish({ error: undefined });
    return result;
  }

  // Quantity and removal predictions follow @woo/storefront-core (MIT), packages/core/src/resources/cart.ts.
  function quantity(current: WooCart, key: string, next: number): WooCart {
    const item = current.items.find((item) => item.key === key);
    if (!item || !Number.isSafeInteger(next) || next < 0) return current;
    const items = next === 0
      ? current.items.filter((item) => item.key !== key)
      : current.items.map((item) => item.key === key ? { ...item, quantity: next } : item);
    return { ...current, items, itemsCount: current.itemsCount + next - item.quantity };
  }

  const actions: WooCartActions = {
    refresh,
    add: (id, count = 1) => write(() => client.add(id, count), (current) => {
      if (!Number.isSafeInteger(count) || count <= 0) return current;
      const matches = current.items.filter((item) => item.id === id && item.variation.length === 0);
      const item = matches.length === 1 ? matches[0] : undefined;
      // Woo supplies the new line's key, product data and prices. Until then only the count changes.
      return item ? quantity(current, item.key, item.quantity + count) : { ...current, itemsCount: current.itemsCount + count };
    }),
    update: (key, count) => write(() => client.update(key, count), (current) => quantity(current, key, count)),
    remove: (key) => write(() => client.remove(key), (current) => quantity(current, key, 0)),
    selectShipping: (packageId, rateId) => write(() => client.selectShipping(packageId, rateId), (current) => ({
      ...current,
      shippingRates: current.shippingRates.map((pack) => pack.packageId === packageId && pack.rates.some((rate) => rate.id === rateId)
        ? { ...pack, rates: pack.rates.map((rate) => ({ ...rate, selected: rate.id === rateId })) }
        : pack),
    })),
    updateCustomer: (input) => write(() => client.updateCustomer(input), (current) => ({
      ...current,
      ...(input.billing ? { billingAddress: { ...current.billingAddress, ...input.billing } } : {}),
      ...(input.shipping ? { shippingAddress: { ...current.shippingAddress, ...input.shipping } } : {}),
    })),
  };

  const store: WooCartStore = {
    actions,
    snapshot: () => state,
    serverSnapshot: () => initial,
    subscribe(changed) {
      listeners.add(changed);
      if (listeners.size === 1) {
        unsubscribe = client.subscribe(receive);
        refresh().catch(() => undefined);
      }
      return () => {
        listeners.delete(changed);
        if (listeners.size === 0) {
          unsubscribe?.();
          unsubscribe = undefined;
        }
      };
    },
  };
  wooCartStores.set(client, store);
  return store;
}
