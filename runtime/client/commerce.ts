/** Cart contracts and error-cart handling adapted from @woo/storefront-core (MIT),
 * packages/core/src/contracts.ts and packages/core/src/transport.ts.
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
  billingAddress?: WooAddress;
  shippingAddress?: WooAddress;
  coupons: { code: string; totals: { totalDiscount: string } }[];
  fees: { id: string; name: string; total: string; totalTax: string }[];
}

/** The codes Woo 11.3.0's cart routes send for the requests this client makes (`StoreApi/Routes/V1/Cart*.php`,
 * `Utilities/CartController.php`, `Utilities/QuantityLimits.php`, `Authentication.php`), with their statuses. */
export type WooStoreErrorCode =
  | "invalid_quantity" // 400: below the minimum, above the maximum (which includes the stock), or not a multiple
  | "rate_limit_exceeded" // 429
  | "readonly_quantity" // 400: the line's quantity cannot be changed
  | "rest_invalid_param" // 400: an argument or address WordPress or Woo rejects
  | "woocommerce_rest_add_to_cart_error" // 400: an extension's `woocommerce_add_to_cart_validation` notice
  | "woocommerce_rest_cart_error" // 500: Woo has no cart
  | "woocommerce_rest_cart_invalid_key" // 409: the line no longer exists; the error carries the cart
  | "woocommerce_rest_cart_invalid_parent_product" // 400
  | "woocommerce_rest_cart_invalid_product" // 400 on add, 404 on update
  | "woocommerce_rest_cart_item_exists" // 400: an add that names a line key
  | "woocommerce_rest_cart_missing_rate_id" // 400
  | "woocommerce_rest_invalid_nonce" // 403
  | "woocommerce_rest_invalid_variation_data" // 400
  | "woocommerce_rest_missing_attributes" // 400: a variable product needs its variation
  | "woocommerce_rest_missing_nonce" // 401
  | "woocommerce_rest_missing_variation_data" // 400
  | "woocommerce_rest_product_invalid_quantity" // 400: zero or less
  | "woocommerce_rest_product_not_purchasable" // 400
  | "woocommerce_rest_product_out_of_stock" // 400
  | "woocommerce_rest_product_partially_out_of_stock" // 400: fewer in stock than asked for
  | "woocommerce_rest_shipping_disabled" // 404
  | "woocommerce_rest_unknown_server_error" // 500
  | "woocommerce_rest_variation_id_from_variation_data"; // 400: no variation matches

export class WooStoreError extends Error {
  /** The string Woo sent, unchanged. Extensions and other Woo versions send codes outside `WooStoreErrorCode`.
   * `http_error` is this client's own: the answer was not a Woo error, such as a proxy's or a maintenance page. */
  readonly code: WooStoreErrorCode | (string & {});
  readonly status: number;
  /** The current cart. Woo sends it with a 409 only. */
  readonly cart: WooCart | undefined;

  /** `message` is plain text: Woo's HTML entities are already decoded. */
  constructor(code: WooStoreErrorCode | (string & {}), message: string, status: number, cart?: WooCart) {
    super(message);
    this.name = "WooStoreError";
    this.code = code;
    this.status = status;
    this.cart = cart;
  }
}
/** Woo's messages are HTML text (`The quantity of &quot;Mug&quot; ...`). The result is plain text, never markup to insert. */
function wooPlainText(html: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return html.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos|nbsp));/gi, (entity, decimal, hex, name) => {
    if (name) return named[name.toLowerCase()];
    const point = decimal ? Number(decimal) : parseInt(hex, 16);
    return point > 0 && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff) ? String.fromCodePoint(point) : entity;
  });
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
    billingAddress: wooReadAddress(data.billing_address), shippingAddress: wooReadAddress(data.shipping_address),
    totals: { totalItems: decimal(data.totals.total_items), totalPrice: decimal(data.totals.total_price), totalShipping: data.totals.total_shipping === null ? null : decimal(data.totals.total_shipping), totalDiscount: decimal(data.totals.total_discount), totalFees: decimal(data.totals.total_fees ?? '0'), totalTax: decimal(data.totals.total_tax), currencyCode: data.totals.currency_code, currencyMinorUnit: precision },
    coupons: data.coupons.map((coupon: any) => ({ code: coupon.code, totals: { totalDiscount: decimal(coupon.totals.total_discount) } })),
    fees: (data.fees ?? []).map((fee: any) => ({ id: fee.key, name: fee.name, total: decimal(fee.totals.total), totalTax: decimal(fee.totals.total_tax) })),
    shippingRates: (data.shipping_rates ?? []).map((pack: any) => ({ packageId: pack.package_id, name: pack.name,
      rates: pack.shipping_rates.map((rate: any) => ({ id: rate.rate_id, name: rate.name, price: wooDecimal(rate.price, rate.currency_minor_unit), selected: rate.selected, currencyCode: rate.currency_code, currencyMinorUnit: rate.currency_minor_unit })) })),
  };
}

function isWooRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wooReadAddress(value: unknown): WooAddress | undefined {
  if (!isWooRecord(value)) return undefined;
  const text = (key: string) => typeof value[key] === "string" ? value[key] : undefined;
  return {
    firstName: text("first_name"), lastName: text("last_name"), company: text("company"),
    address1: text("address_1"), address2: text("address_2"), city: text("city"), state: text("state"),
    postcode: text("postcode"), country: text("country"), email: text("email"), phone: text("phone"),
  };
}

/** Woo adds the current cart to a 409 answer, and to no other (`AbstractCartRoute::get_route_error_response`). */
function wooErrorCart(payload: Record<string, unknown>): WooCart | undefined {
  const cart = isWooRecord(payload.data) ? payload.data.cart : undefined;
  if (!isWooRecord(cart)) return undefined;
  // A broken error payload must not hide Woo's original refusal.
  try { return wooCart(cart); } catch { return undefined; }
}

/** One same-origin Woo cookie session, also consumed by the native Checkout Block. Browser only. */
export interface WooCartClient {
  get(): Promise<WooCart>;
  add(id: number, quantity?: number): Promise<WooCart>;
  /** Sets a line's quantity. Woo refuses a quantity of zero, so zero removes the line. */
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
    // An HTML maintenance or proxy page is not JSON: report the status, not the parse failure.
    const data: unknown = await response.json().catch(() => undefined);
    if (!response.ok || data === undefined) {
      const error = isWooRecord(data) ? data : {};
      throw new WooStoreError(
        typeof error.code === "string" ? error.code : "http_error",
        typeof error.message === "string" ? wooPlainText(error.message) : "The cart request failed",
        response.status,
        wooErrorCart(error),
      );
    }
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
    update: (key: string, quantity: number) => quantity === 0 ? queue("/remove-item", { key }) : queue("/update-item", { key, quantity }),
    remove: (key: string) => queue("/remove-item", { key }),
    updateCustomer: (input: { billing?: WooAddress; shipping?: WooAddress }) => queue("/update-customer", { ...(input.billing ? { billing_address: address(input.billing) } : {}), ...(input.shipping ? { shipping_address: address(input.shipping) } : {}) }),
    selectShipping: (packageId: number, rateId: string) => queue("/select-shipping-rate", { package_id: packageId, rate_id: rateId }),
    subscribe: (listener: (cart: WooCart) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export const cart: WooCartClient = createCartClient();
