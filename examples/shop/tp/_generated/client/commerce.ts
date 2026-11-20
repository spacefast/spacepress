/** Cart contracts adapted from @woo/storefront-core (MIT), packages/core/src/contracts.ts.
 * Amounts here are exact decimal strings; the Store API's minor units are normalized on read.
 */
export interface WooCartItem {
  key: string; id: number; name: string; quantity: number;
  images: { id: number; src: string; thumbnail: string; alt: string }[];
  prices: { price: string; currencyCode: string; currencyMinorUnit: number };
  totals: { lineTotal: string; lineSubtotal: string };
  variation: { attribute: string; value: string }[];
}
export interface WooCartTotals {
  totalItems: string; totalPrice: string; totalShipping: string | null; totalDiscount: string; totalFees: string; totalTax: string;
  currencyCode: string; currencyMinorUnit: number;
}
export interface WooAddress {
  firstName?: string; lastName?: string; company?: string; address1?: string; address2?: string;
  city?: string; state?: string; postcode?: string; country?: string; email?: string; phone?: string;
}
export interface WooShippingPackage {
  packageId: number; name: string;
  rates: { id: string; name: string; price: string; selected: boolean; currencyCode: string; currencyMinorUnit: number }[];
}
export interface WooCart {
  items: WooCartItem[]; itemsCount: number; totals: WooCartTotals; needsShipping: boolean;
  shippingRates: WooShippingPackage[];
  coupons: { code: string; totals: { totalDiscount: string } }[];
  fees: { id: string; name: string; total: string; totalTax: string }[];
}
export class WooStoreError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) { super(message); this.name = "WooStoreError"; this.code = code; this.status = status; }
}
/** Exact conversion, including zero-decimal currencies. Never uses floating-point arithmetic. */
export function wooDecimal(minor: string, precision: number): string {
  if (!Number.isInteger(precision) || precision < 0 || precision > 12 || !/^-?\d+$/.test(minor)) throw new Error("Invalid Store API money");
  const negative = minor.startsWith("-");
  const digits = (negative ? minor.slice(1) : minor).padStart(precision + 1, "0");
  return (negative ? "-" : "") + (precision ? `${digits.slice(0, -precision)}.${digits.slice(-precision)}` : digits);
}
function wooCart(data: any): WooCart {
  const precision = data.totals.currency_minor_unit;
  const decimal = (value: string) => wooDecimal(value, precision);
  return {
    items: data.items.map((item: any) => ({ key: item.key, id: item.id, name: item.name, quantity: item.quantity, images: item.images, variation: item.variation,
      prices: { price: wooDecimal(item.prices.price, item.prices.currency_minor_unit), currencyCode: item.prices.currency_code, currencyMinorUnit: item.prices.currency_minor_unit },
      totals: { lineTotal: decimal(item.totals.line_total), lineSubtotal: decimal(item.totals.line_subtotal) } })),
    itemsCount: data.items_count, needsShipping: data.needs_shipping,
    totals: { totalItems: decimal(data.totals.total_items), totalPrice: decimal(data.totals.total_price), totalShipping: data.totals.total_shipping === null ? null : decimal(data.totals.total_shipping), totalDiscount: decimal(data.totals.total_discount), totalFees: decimal(data.totals.total_fees ?? '0'), totalTax: decimal(data.totals.total_tax), currencyCode: data.totals.currency_code, currencyMinorUnit: precision },
    coupons: data.coupons.map((coupon: any) => ({ code: coupon.code, totals: { totalDiscount: decimal(coupon.totals.total_discount) } })),
    fees: (data.fees ?? []).map((fee: any) => ({ id: fee.key, name: fee.name, total: decimal(fee.totals.total), totalTax: decimal(fee.totals.total_tax) })),
    shippingRates: (data.shipping_rates ?? []).map((pack: any) => ({ packageId: pack.package_id, name: pack.name,
      rates: pack.shipping_rates.map((rate: any) => ({ id: rate.rate_id, name: rate.name, price: wooDecimal(rate.price, rate.currency_minor_unit), selected: rate.selected, currencyCode: rate.currency_code, currencyMinorUnit: rate.currency_minor_unit })) })),
  };
}
/** Woo's Store API cart. Browser only. */
export interface WooCartClient {
  get(): Promise<WooCart>;
  add(id: number, quantity?: number): Promise<WooCart>;
  update(key: string, quantity: number): Promise<WooCart>;
  remove(key: string): Promise<WooCart>;
  updateCustomer(input: { billing?: WooAddress; shipping?: WooAddress }): Promise<WooCart>;
  selectShipping(packageId: number, rateId: string): Promise<WooCart>;
  subscribe(listener: (cart: WooCart) => void): () => void;
}
interface CartTransportOptions {
  /** Woo Store API root. An absolute URL on another origin selects a token session. */
  base?: string;
  fetch?: typeof fetch;
}

type WooCheckoutAddress = Omit<WooAddress, "firstName" | "lastName" | "address1" | "address2"> & {
  first_name?: string; last_name?: string; address_1?: string; address_2?: string;
};
export interface WooCheckoutInput {
  billing_address: WooCheckoutAddress;
  shipping_address?: WooCheckoutAddress;
  payment_method: string;
  payment_data?: { key: string; value: string | boolean }[];
  expected_total?: string;
  order_notes?: string;
  additional_fields?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}
export interface WooCheckoutResult {
  order_id: number;
  status: string;
  payment_result: { payment_status: string; redirect_url: string; payment_details: unknown };
}
export interface WooTokenCartClient extends WooCartClient {
  /** Places the order through Woo's Store API with the same token: no cookie at any step. */
  checkout(input: WooCheckoutInput): Promise<WooCheckoutResult>;
  /**
   * The store's checkout page address that hands this cart to Woo's Checkout Block. Woo copies the
   * token's cart into a new cookie session there (`?session=`), so that page needs cookies.
   */
  checkoutLink(checkoutUrl: string): string;
}

/**
 * `session: "cookie"` is Woo's session cookie and rotating nonce, the session the Checkout Block reads.
 * `session: "token"` sends no cookie: Woo's `Cart-Token` header names the session and replaces the nonce.
 * Left out, it is the cookie on the page's own origin and the token for a Store API on another one.
 */
export function createCartClient(options: CartTransportOptions & { session: "token" }): WooTokenCartClient;
export function createCartClient(options?: CartTransportOptions & { session?: "cookie" }): WooCartClient;
export function createCartClient(options: CartTransportOptions & { session?: "cookie" | "token" } = {}): WooCartClient {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = (options.base ?? "/wp-json/wc/store/v1").replace(/\/$/, "");
  const page = globalThis.location?.href;
  let resolved: string | undefined;
  let crossOrigin = false;
  try {
    const url = new URL(base, page);
    resolved = url.href;
    crossOrigin = page !== undefined && url.origin !== new URL(page).origin;
  } catch { /* A relative root with no page address to resolve it against (a server render) stays as written. */ }
  const root = resolved ?? base;
  // A browser sends another origin no Woo cookie, so every write there would start a new, empty cart.
  if (options.session === "cookie" && crossOrigin) throw new Error(`A cookie cart needs WooCommerce on this page's origin. Use session: "token" for ${root}.`);
  const tokenMode = options.session === "token" || (options.session === undefined && crossOrigin);
  const storageKey = `typedpress:woo-cart:${root}`;
  let token: string | null = null;
  let nonce: string | null = null;
  let pending: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(cart: WooCart) => void>();
  // Every tab shares one cart: the token is read before each request and saved after each response.
  // Blocked or absent storage leaves it in this client, for as long as the page stays open.
  function storedToken(): string | null {
    try { token = globalThis.localStorage.getItem(storageKey) ?? token; } catch { /* in memory */ }
    return token;
  }
  function storeToken(next: string | null): void {
    token = next;
    try { next === null ? globalThis.localStorage.removeItem(storageKey) : globalThis.localStorage.setItem(storageKey, next); } catch { /* in memory */ }
  }
  async function send(path: string, body?: unknown): Promise<unknown> {
    const headers = new Headers();
    const sent = tokenMode ? storedToken() : nonce;
    if (tokenMode && sent) headers.set("Cart-Token", sent);
    if (body !== undefined) {
      headers.set("Content-Type", "application/json");
      if (!tokenMode && sent) headers.set("Nonce", sent);
    }
    const response = await request(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: tokenMode ? "omit" : "same-origin",
      cache: "no-store",
      // The token belongs to the configured Store API, including when a server redirects.
      ...(tokenMode ? { redirect: "error" } : {}),
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!tokenMode) nonce = response.headers.get("Nonce") ?? nonce;
    const data = await response.json();
    if (!response.ok) throw new WooStoreError(data.code ?? "woocommerce_error", data.message ?? "The cart request failed", response.status);
    if (tokenMode) {
      const next = response.headers.get("Cart-Token");
      if (!next) throw new WooStoreError("cart_token_unavailable", "WooCommerce did not return a cart token. Check the Store API and its CORS settings.", response.status);
      storeToken(next);
    }
    return data;
  }

  async function readCart(path: string, body?: unknown): Promise<WooCart> {
    const cart = wooCart(await send(`/cart${path}`, body));
    for (const listener of listeners) listener(cart);
    return cart;
  }

  function queue<T>(run: () => Promise<T>): Promise<T> {
    const next = pending.catch(() => undefined).then(run);
    pending = next;
    return next;
  }
  // Woo asks a write for a nonce when it did not accept the credential sent: a stale nonce in a
  // cookie session, or a Cart-Token past its expiry (CartTokenUtils, 48 hours by default).
  const refused = tokenMode ? "woocommerce_rest_missing_nonce" : "woocommerce_rest_invalid_nonce";
  function cartRequest(path: string, body?: unknown): Promise<WooCart> {
    return queue(async () => {
      if (body !== undefined && !(tokenMode ? storedToken() : nonce)) await readCart("");
      try { return await readCart(path, body); }
      catch (error) {
        if (body === undefined || !(error instanceof WooStoreError) || error.code !== refused) throw error;
        // An expired token's cart is gone from Woo too: the write goes to the cart the read starts.
        nonce = null; if (tokenMode) storeToken(null);
        await readCart(""); return readCart(path, body);
      }
    });
  }
  const address = (input: WooAddress) => Object.fromEntries(Object.entries(input).map(([key, value]) => [{ firstName: "first_name", lastName: "last_name", address1: "address_1", address2: "address_2" }[key as "firstName"] ?? key, value]));
  const cart: WooCartClient = {
    get: () => cartRequest(""),
    add: (id: number, quantity = 1) => cartRequest("/add-item", { id, quantity }),
    update: (key: string, quantity: number) => cartRequest("/update-item", { key, quantity }),
    remove: (key: string) => cartRequest("/remove-item", { key }),
    updateCustomer: (input: { billing?: WooAddress; shipping?: WooAddress }) => cartRequest("/update-customer", { ...(input.billing ? { billing_address: address(input.billing) } : {}), ...(input.shipping ? { shipping_address: address(input.shipping) } : {}) }),
    selectShipping: (packageId: number, rateId: string) => cartRequest("/select-shipping-rate", { package_id: packageId, rate_id: rateId }),
    subscribe: (listener: (cart: WooCart) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  if (!tokenMode) return cart;
  const tokenCart: WooTokenCartClient = {
    ...cart,
    checkoutLink: checkoutUrl => {
      const sent = storedToken();
      if (!sent) throw new WooStoreError("cart_token_unavailable", "Load your cart before checking out.", 0);
      const link = new URL(checkoutUrl, resolved);
      link.searchParams.set("session", sent);
      return link.href;
    },
    checkout: input => queue(async () => {
      if (!storedToken()) throw new WooStoreError("cart_token_unavailable", "Load your cart before checking out.", 0);
      let data: unknown;
      try { data = await send("/checkout", input); }
      catch (error) {
        if (!(error instanceof WooStoreError) || error.code !== refused) throw error;
        storeToken(null);
        throw new WooStoreError("cart_token_expired", "Your cart expired. Add the items again before checking out.", error.status);
      }
      if (typeof data !== "object" || data === null || !("order_id" in data) || typeof data.order_id !== "number"
        || !("status" in data) || typeof data.status !== "string" || !("payment_result" in data)
        || typeof data.payment_result !== "object" || data.payment_result === null
        || !("payment_status" in data.payment_result) || typeof data.payment_result.payment_status !== "string"
        || !("redirect_url" in data.payment_result) || typeof data.payment_result.redirect_url !== "string"
        || !("payment_details" in data.payment_result)) {
        throw new WooStoreError("invalid_checkout_response", "WooCommerce returned an unexpected checkout response. Check your order before retrying.", 0);
      }
      return { order_id: data.order_id, status: data.status, payment_result: {
        payment_status: data.payment_result.payment_status,
        redirect_url: data.payment_result.redirect_url,
        payment_details: data.payment_result.payment_details,
      } };
    }),
  };
  return tokenCart;
}
export const cart: WooCartClient = createCartClient();
