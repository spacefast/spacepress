# WooCommerce shops

`typedpress add shop` creates a working storefront over native Woo products, terms, carts
and orders. Woo is a pinned platform dependency only when the app exports a `store()`.
There is no second commerce database or merchant REST credential.
Orders use legacy WordPress post storage. Existing stores with HPOS or order synchronization
enabled are refused without changing their settings; complete synchronization and choose
legacy storage in WooCommerce before enabling TypedPress commerce.
On a plugin install the refusal closes the shop and its checkout and shows the reason as an
admin notice. Use wp-admin to restore the setting. Changing either WooCommerce
option through WordPress invalidates the install marker. The runtime checks
order storage again on the next request, when a new build runs, or when the UTC
day changes. A managed build checks order storage before the host exposes it.

```sh
typedpress add shop
typedpress dev
```

The module creates `tp/shop.ts`, two source products, terms, a mini-cart component, browser
cart code and storefront pages under `tp/app/(shop)/`. The route group's layout supplies the
shop styles and scripts even when the app already has a root layout. It selects the blank block
template so its own header and cart remain visible. Existing files remain untouched.
Visit `/shop`; `/wp-admin/` remains the merchant interface for inventory and orders.

For deployment, use a standalone plugin installation or a qualified commerce host. The built-in
TypedPress `push` receiver currently refuses commerce builds, including rollback, because it does
not yet suspend checkout and shipping writers or enforce shipping-compatible selection/recovery.

For a standalone update that changes shipping policy, put the shop in maintenance mode and drain
in-flight checkout requests and shipping writers before replacing the plugin. Reopen checkout
once initialization succeeds and the active build’s shipping policy matches the installed zones.
If a later step fails, recover with a compatible build and verify the zones before reopening.
Restoring the previous plugin files alone does not restore shipping rows.

## Declarations

```ts
import { store, product, productCategory, productTag, order } from 'typedpress';

export const shop = store({
  currency: 'EUR', country: 'PL', sellTo: ['PL', 'DE'],
  shipping: [{ name: 'Poland', countries: ['PL'], methods: [
    { type: 'flatRate', title: 'Courier', cost: '15.00' },
  ] }],
  payments: ['cod'],
});
export const products = product({sync: 'content/products/*.md', url: '/products/:slug'});
export const categories = productCategory({sync: 'content/categories/*.md', url: '/shop/:path'});
export const tags = productTag({sync: 'content/tags/*.md'});
export const orders = order();
```

Each is a fixed native kind, with at most one export per builder. Fields and access rules
cannot be replaced. Products are public only while published and visible; writes require
`admin`. Orders are read-only and require `admin`, including server-side page reads.
Use the ordinary `db.query.products`, generated client, facade, OpenAPI and app abilities.
`GET /wp-json/typedpress/v1/store` supplies effective currency/precision, display conventions, units,
selling countries, supported product types, cart/checkout URLs and checkout availability.

Product fields are `uid`, `name`, `slug`, `sku`, `status`, description, `shortDescription`,
exact decimal `price`, ordered media `images`, category/tag references, `virtual`,
`downloadable`, and `downloads: [{id, name, file}]`. Reads add `type`, `purchasable`,
`availability` and `url`. Native variable/grouped/external products identify their type;
v1 writes accept simple products only. Schedule publication in WooCommerce, where you can set
the future date. TypedPress reads that status as `scheduled` and preserves an existing schedule when editing the product.
Stock is operational data managed by Woo.

Category and tag lists replace the current assignments and retain their submitted order in
TypedPress reads and sync. WooCommerce assigns its configured
default product category when `categories: []` is written; the returned product contains that
persisted category ID. `tags: []` removes all tags. This follows native Woo normalization.

Download names and IDs are public; backing `file` locations require administrator access.
Scoped credentials need `--personal` to read or edit these restricted locations, in addition
to `--write` for edits. Buyers use Woo's authorized receipt and email links.

Product filtering supports identity, name/slug/descriptions, SKU, status, price,
availability, virtual/downloadable flags and term membership. Order filtering supports
identity, status, creation/update date ranges, customer, total and currency. Projection
fields such as nested order addresses are not filterable; unsupported filters are refused.
Lists use the normal bounded pagination and deterministic ordering.

## Source and merchant edits

A first install seeds missing products and terms. Redeploying preserves existing catalog
edits, stock and orders. `typedpress sync --site <url>` merges subsequent file and merchant
edits through the ordinary UID-based sync workflow and writes conflicts for review.
References and category parents travel as UIDs; numeric Woo IDs are local to the site.
Catalog sync covers products and terms. Orders stay in WooCommerce.
Catalog sync v1 requires simple products. Native variable, grouped and external products
remain readable through the API; syncing a mixed catalog is not yet supported.
Removing a catalog source file leaves the native product/term unchanged. Retire it explicitly
through Woo administration or an authorized API operation.

Download IDs must remain stable: renaming a file or its display name keeps the same ID.
Changing its ID is a new file entitlement. Paid orders receive Woo's own download grants
and authorized receipt/email links. COD does not automatically mark a digital order paid.
Additional file-access protection beyond Woo is outside v1.

Declared store settings belong to source and are shown read-only in Woo settings. Scalars
are option filters, so removing a declaration restores the stored setting. Shipping uses
Woo zone CRUD: a declared list owns the whole zone list, matched by name; `[]` ships nothing.
Reconciliation is transactional: a failed replacement preserves the previous zones and methods.
Undeclared settings remain Woo's. Gateways take credentials from their own server settings.
Taxes, coupons, signup/accounts, reviews/ratings, sale prices and backorders stay disabled.
Historical order tax, coupon, item and refund snapshots remain readable.

## Cart, checkout and agents

The generated client exports `cart` and `createCartClient` for reading and updating Woo's
cart, setting the destination, selecting shipping, and subscribing to updates. Cart values
use exact decimal strings. The session is Woo's own in both modes: TypedPress adds no
session store and no shopper session.

Create the React hooks once in a client module. They use the React version your app
already loads.

```tsx
import * as React from "react";
import { createCartHooks } from "./tp/_generated/client/react.ts";

export const { useCart, useCartCount } = createCartHooks(React);

export function AddMug({ productId }: { productId: number }) {
	const { add, loading, pending } = useCart();
	// This button's own refusal. `useCart().error` is shared by every component on the page.
	const [refusal, setRefusal] = React.useState<string>();

	return (
		<>
			<button
				disabled={loading || pending}
				onClick={() => {
					setRefusal(undefined);
					add(productId).catch((error: Error) => setRefusal(error.message));
				}}
			>
				Add to cart
			</button>
			{refusal && <p role="alert">{refusal}</p>}
		</>
	);
}
```

The action's promise rejects for the component that called it, so the message appears
under that button only. `useCart().error` is one value for the whole cart: render it
once, next to the cart, not under every button.

`useCart()` returns `cart`, `loading`, `pending`, `error`, and the actions below.
`useCartCount()` returns the item count, or `undefined` before the cart loads. Both
hooks observe the same store. Pass a `WooCartClient` as the second argument to
`createCartHooks` to use a specific client.

| Action | What it does |
| --- | --- |
| `add(productId, quantity?)` | Adds a product. The default quantity is one. |
| `update(key, quantity)` | Sets the quantity of a line. Zero removes the line, because Woo refuses a quantity of zero. |
| `remove(key)` | Removes a line. |
| `selectShipping(packageId, rateId)` | Selects a rate for a shipping package. |
| `updateCustomer({ billing, shipping })` | Updates either or both cart addresses. |
| `refresh()` | Reads the current cart from Woo, after every write already queued. Callers share one read until the next write. |

Writes preview changes to quantities, item count, selected rates, and addresses while Woo
processes them in order. New lines appear when Woo returns their details. Prices and totals
stay at the values Woo last confirmed while `pending` is true.

If Woo refuses a write, the action rejects and `error` holds the failure. `error` stays
until the next write starts: a write that was already queued and then succeeds does not
clear it, and neither does `refresh()`. A failed read also sets `error`; that one clears
when Woo next answers with a cart.

Narrow the error with `instanceof WooStoreError` to read its `code`, HTTP `status`,
plain-text `message` (Woo's HTML entities are decoded) and optional `cart`. `code` is the
string Woo sent, unchanged. The `WooStoreErrorCode` type lists the codes Woo 11.3.0 sends
for these requests, so they autocomplete; an extension's code is any other string. An
answer that is not a Woo error, such as a maintenance page, has the code `http_error`.

| Refusal | Status | `code` | `cart` |
| --- | --- | --- | --- |
| Out of stock, or fewer in stock than asked for, on `add` | 400 | `woocommerce_rest_product_out_of_stock`, `woocommerce_rest_product_partially_out_of_stock` | none |
| Quantity below the minimum, above the maximum (on `update` the maximum includes the stock), or not a multiple, on `update` and on `add` to an existing line | 400 | `invalid_quantity` | none |
| The line's quantity cannot be changed (sold individually) | 400 | `readonly_quantity` | none |
| The product cannot be bought | 400 | `woocommerce_rest_product_not_purchasable` | none |
| The line no longer exists, on `update` and `remove` | 409 | `woocommerce_rest_cart_invalid_key` | the current cart |
| Too many requests, when the store enables Woo's rate limiting | 429 | `rate_limit_exceeded` | none |
| Woo failed | 500 | `woocommerce_rest_unknown_server_error` | none |

Woo sends the current cart with a 409 only, and the store then uses that cart. Every other
refusal, stock included, rolls back to the cart Woo last confirmed. Later pending writes
keep their previews in either case.

While a component is subscribed, the store reads the cart again when the browser restores
the page from its back/forward cache, and when a hidden tab is shown again at least five
seconds after Woo last answered. It does not poll.

TypedPress pages can use `createCartStore()` from `@typedpress/client` in a browser
script, as the native shop does. It shares the hooks' actions and optimistic state.

### Cookie and token sessions

| | Cookie session (default on the store's origin) | Token session (default for another origin) |
|---|---|---|
| Names the cart | Woo's `wp_woocommerce_session_*` cookie | Woo's `Cart-Token` header, kept by the browser |
| Guards a write | Woo's rotating `Nonce` header | the token; Woo asks for no nonce |
| Checkout | the native Checkout Block | `checkout()` through the Store API, or `checkoutLink()` to the Block |
| Batcache | misses for the visitor (see below) | not affected |

`createCartClient()` picks the mode from `base`: a Store API on the page's own origin gets
the cookie session, so the Checkout Block shows the cart the page filled. An absolute `base`
on another origin gets the token session, because a browser sends that origin no Woo cookie.
`session: "token"` selects the token session on the same origin too, and `session: "cookie"`
with another origin throws when the client is created.

### Carts without cookies

```ts
import { createCartClient } from "./tp/_generated/client";

const cart = createCartClient({ base: "https://shop.example.com/wp-json/wc/store/v1", session: "token" });
await cart.add(productId);
```

Naming `session: "token"` also types the two checkout methods below, which a cookie cart
does not have.

Every request goes out with `credentials: "omit"`. The first read returns Woo's token; each
later request sends it and stores the one Woo returns. The token lives in `localStorage`
under a key naming the Store API root, so a reload and other tabs see the same cart. Where
storage is blocked the token stays in the client, for as long as the page stays open. A
token lasts as long as Woo's session (`wc_session_expiration`, 48 hours by default). Woo
ignores an expired one: a write then starts a new, empty cart, and `checkout()` throws
`cart_token_expired` instead of placing an order for nothing.

A token cart reaches checkout in one of two ways, both Woo's:

- **`cart.checkout(input)`** posts the addresses, payment method and gateway fields to
  Woo's `POST /wc/store/v1/checkout` with the same token. No cookie is set at any step.
  Read `payment_result` for the gateway's status and the address to continue at. The
  storefront draws its own checkout form. The client reads the cart again once the order
  is placed, so subscribers see the cart Woo emptied. This is the checkout that needs no
  cookie anywhere.
- **`cart.checkoutLink(checkoutUrl)`** returns the store's checkout address with Woo's
  `?session=<token>`. Opening it makes Woo copy the token's cart into a new cookie session
  (`WC_Session_Handler::init_session_from_request`), which the native Checkout Block
  reads. That page therefore needs cookies; the storefront before it does not. Woo copies
  the cart and leaves out the customer's address.

`createCartHooks(React, tokenCart)` and `createCartStore(tokenCart)` add `checkout` to the
actions of a token cart. `pending` is true while the order is placed, and `cart` is the
cart Woo answers with afterwards.

What `checkoutLink()` guarantees, beyond Woo's own behavior:

- **The address is the store's.** `checkoutLink()` throws for an address on any origin
  other than the Store API's: the token in it is a credential for that cart.
- **The token leaves the address bar.** Once Woo has set its cookie, the store redirects
  to the same address without `session`, with `Referrer-Policy: same-origin` on that
  response. The token does not stay in the visible address or go out in a referrer to
  another site. It is still in the request the browser sent, so it reaches the server's
  access log like any query string; it expires with the cart, after 48 hours by default.
- **Every link shows the cart as it is now.** Woo alone copies a token's cart into a
  cookie session once and then keeps that copy. TypedPress starts a new cookie session
  for each link, so a shopper who goes back, changes the cart and follows the link again
  checks out the changed cart.
- **An order ends the token's cart.** When the cookie session places an order and the
  token's cart still holds the same lines, that token's session is deleted with it: the
  storefront's next read is an empty cart, not the one just paid for. A token cart
  changed after the link was followed is a different cart, and is kept.

Woo answers another origin only when the request carries a valid token or WordPress allows
the origin. The first read has no token yet. A site whose config sets `frontend` to its
external address answers that exact origin on `/wc/store/` routes, and only there:

- The origin is not added to WordPress's `allowed_http_origins`. That list also opens
  `admin-ajax.php` to an origin, with credentials.
- The answer carries no `Access-Control-Allow-Credentials`. A token cart sends no cookie,
  and a script on the frontend can never read a visitor's cookie cart, address or
  sign-in through the Store API. Use `session: "token"` there (the default for another
  origin); a cookie cart from the frontend origin does not work.

Any other origin is added through WordPress's `allowed_http_origins` filter, which grants
it Woo's credentialed access.

With `frontend` set, WordPress redirects its own front-end pages to that site with a 308
and the same path and query, the checkout page included. So such a storefront places
orders with `checkout()`, and the addresses Woo sends a shopper to afterwards arrive at
the frontend: `payment_result.redirect_url`, and a gateway's return or cancel address,
are `/checkout/order-received/<id>/?key=…` and `/checkout/order-pay/<id>/…` on the store,
which answer with a 308 to the same path on the frontend. The frontend must serve
`/checkout/order-received/…` (and `/checkout/order-pay/…` for a gateway that uses it).
A gateway's server-to-server notification (`?wc-api=`, a REST webhook) is not a page and
is not redirected.
[Woo Cart Tokens](https://developer.woocommerce.com/docs/apis/store-api/cart-tokens/) and
[Woo Checkout API](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/checkout/)

### Shared pages and private routes

The checkout source is a `page.md` containing the native Woo Checkout Block. It remains a real
WordPress Page inside the app layout. Receipt and order-pay endpoints use that same Page;
full-page navigation initializes Woo's scripts. Removing the checkout block or trashing
its Page is refused.

Catalog and product pages are the same bytes for every guest, with or without a cart:

- A guest's GET of an app page starts Woo without the cart cookies, so nothing Woo prints
  there depends on a cart. That removes the about 50 `<link rel="prefetch">` tags Woo's
  block assets add when the cart has items, and any cart notice or saved-cart output.
  Server code in such a page sees an empty `WC()->cart` for a guest; read the cart in the
  browser. The stored cart is not touched.
- The cart count and the mini cart are drawn by the browser from the Store API. The page
  carries one `<meta name="tp-woo-checkout-script">` with the checkout script's address,
  the same for everyone; the generated mini cart adds a prefetch for it once the cart has
  an item.
- These pages send the shared policy (`public`, `A8C-Edge-Cache: cache`) to a cart visitor
  as to anyone, set no cookie, and are served from prebuilt files when the page is prebuilt.
- The rule has no exceptions by query string or path spelling (`?page_id=`, `?p=`,
  `?preview=`, `//host/shop/`). The router shares an answer only when Woo's session
  cookie did not reach Woo on that request, so no address puts a cart on a shared page.
- Woo renews a cookie session only on a request where it reads the cookie, and an app
  page is no longer one. A cookie cart therefore expires 48 hours
  (`wc_session_expiration`) after the guest's last cart write or view of the cart or
  checkout page, however many catalog pages they open in between. Before, any page view
  near the end of that window renewed it.

One page kind keeps cart-dependent output: a page the theme renders rather than `tp/app`
(a WordPress Page with no app route, a post in a theme template). TypedPress does not
start Woo without the cart there, because a theme or a Woo block on such a page may show
the cart. Woo's `AssetsController::add_resource_hints` then prints its prefetch links for
a visitor with items. Those responses are `private, no-store` for any request carrying
Woo's session cookie, and unchanged for everyone else.

Cart, checkout, receipts, order-pay, my-account and Woo's cart actions (`?add-to-cart=`,
`?wc-ajax=`, `?session=` and the like) are `private, no-store` with `A8C-Edge-Cache:
no-cache`, call `batcache_cancel()`, are never prebuilt and have no Markdown twin. So is
every `/wp-json/wc/store/*` answer: carts, checkout, an order's addresses, and whatever
an extension adds there. And so is any response Woo sets a cookie on, whichever endpoint
or extension set it (Woo's `/checkout-link/` among them): the policy is applied where Woo
sets the cookie (`woocommerce_set_cookie_enabled`), not from a list of addresses. Native
stock changes purge item and listing reads through TypedPress's usual purge hook.

**Host limit: Batcache.** Batcache decides in `advanced-cache.php`, before any plugin
loads, and skips its cache for every request carrying a cookie whose name starts with
`wp`. Woo's `wp_woocommerce_session_*` is one. A cookie-session visitor with a cart is
therefore a Batcache miss on every page, and PHP renders the catalog for them. TypedPress
keeps Woo's cookie name, because the Checkout Block and Woo's extensions read it. Two
paths still give that visitor the shared copy. A prebuilt page is answered from its file
by PHP, whatever Batcache decided. And the response carries the shared cache headers, so
an edge in front of Batcache that does not bypass on that cookie serves its stored copy.
A token cart has no cookie, so it misses nothing.

Scoped agent credentials use app abilities. Product/term writes require `--write`; the
entire order kind additionally requires `--personal`, and its tools are hidden without it.
The store has one read tool. Scoped credentials cannot call Woo's merchant REST namespaces,
its core REST product/term aliases, or `woocommerce/*` abilities. Cart and checkout have no agent tools.

## Verification and hosting

[The example README](../examples/shop/README.md) gives the Playground test commands.
`tests/commerce.rs` checks declarations, scaffold preservation and native WordPress CRUD,
settings, access scopes, MCP visibility, stock purges and historical order reads.
`docs-site/tests/playground/commerce.test.ts` clicks cart/shipping/COD checkout and a dummy
paid gateway, verifies decline/retry and downloads, and drives the real sync CLI.

Spacefast must complete its [host checklist](spacefast-host-checklist.md#commerce-host-qualification)
before deployment: Woo provisioning, a maximum 20-character table prefix, isolated preview
databases, mail/callbacks/jobs and the required cache exclusions. Playground proof does not
qualify arbitrary payment gateways or the live host. The complete v1 decisions and deferred
scope are in the [design](design-woocommerce.md).
