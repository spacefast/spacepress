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
    fees: (data.fees ?? []).map((fee: any) => ({ id: fee.id, name: fee.name, total: decimal(fee.totals.total), totalTax: decimal(fee.totals.total_tax) })),
    shippingRates: (data.shipping_rates ?? []).map((pack: any) => ({ packageId: pack.package_id, name: pack.name,
      rates: pack.shipping_rates.map((rate: any) => ({ id: rate.rate_id, name: rate.name, price: wooDecimal(rate.price, rate.currency_minor_unit), selected: rate.selected, currencyCode: rate.currency_code, currencyMinorUnit: rate.currency_minor_unit })) })),
  };
}
/** One same-origin Woo cookie session, also consumed by the native Checkout Block. Browser only. */
export interface WooCartClient {
  get(): Promise<WooCart>;
  add(id: number, quantity?: number): Promise<WooCart>;
  update(key: string, quantity: number): Promise<WooCart>;
  remove(key: string): Promise<WooCart>;
  updateCustomer(input: { billing?: WooAddress; shipping?: WooAddress }): Promise<WooCart>;
  selectShipping(packageId: number, rateId: string): Promise<WooCart>;
  subscribe(listener: (cart: WooCart) => void): () => void;
}
export function createCartClient(options: { base?: string; fetch?: typeof fetch } = {}): WooCartClient {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = (options.base ?? "/wp-json/wc/store/v1").replace(/\/$/, "");
  let nonce: string | null = null;
  let pending: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(cart: WooCart) => void>();
  async function send(path: string, body?: unknown): Promise<WooCart> {
    const response = await request(`${base}/cart${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      headers: body === undefined ? {} : { "Content-Type": "application/json", ...(nonce ? { Nonce: nonce } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    nonce = response.headers.get("Nonce") ?? nonce;
    const data = await response.json();
    if (!response.ok) throw new WooStoreError(data.code ?? "woocommerce_error", data.message ?? "The cart request failed", response.status);
    const cart = wooCart(data); for (const listener of listeners) listener(cart); return cart;
  }
  function queue(path: string, body?: unknown): Promise<WooCart> {
    const next = pending.catch(() => undefined).then(async () => {
      if (body !== undefined && !nonce) await send("");
      try { return await send(path, body); }
      catch (error) {
        if (body !== undefined && error instanceof WooStoreError && error.code === "woocommerce_rest_invalid_nonce") { nonce = null; await send(""); return send(path, body); }
        throw error;
      }
    }); pending = next; return next;
  }
  const address = (input: WooAddress) => Object.fromEntries(Object.entries(input).map(([key, value]) => [{ firstName: "first_name", lastName: "last_name", address1: "address_1", address2: "address_2" }[key as "firstName"] ?? key, value]));
  return {
    get: () => queue(""),
    add: (id: number, quantity = 1) => queue("/add-item", { id, quantity }),
    update: (key: string, quantity: number) => queue("/update-item", { key, quantity }),
    remove: (key: string) => queue("/remove-item", { key }),
    updateCustomer: (input: { billing?: WooAddress; shipping?: WooAddress }) => queue("/update-customer", { ...(input.billing ? { billing_address: address(input.billing) } : {}), ...(input.shipping ? { shipping_address: address(input.shipping) } : {}) }),
    selectShipping: (packageId: number, rateId: string) => queue("/select-shipping-rate", { package_id: packageId, rate_id: rateId }),
    subscribe: (listener: (cart: WooCart) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export const cart: WooCartClient = createCartClient();
