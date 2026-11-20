# WooCommerce shops

`typedpress add shop` creates a working storefront over native Woo products, terms, carts
and orders. Woo is a pinned platform dependency only when the app exports a `store()`.
There is no second commerce database or merchant REST credential.
Orders use legacy WordPress post storage. Existing stores with HPOS or order synchronization
enabled are refused without changing their settings; complete synchronization and choose
legacy storage in WooCommerce before enabling TypedPress commerce.
On a plugin install the refusal closes the shop and its checkout and shows the reason as an
admin notice; wp-admin stays available for changing the setting back. A managed build is refused
before its host exposes it.

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
`GET /__tp/api/v1/store` supplies effective currency/precision, display conventions, units,
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
  storefront draws its own checkout form.
- **`cart.checkoutLink(checkoutUrl)`** returns the store's checkout address with Woo's
  `?session=<token>`. Opening it makes Woo copy the token's cart into a new cookie session
  (`WC_Session_Handler::init_session_from_request`), which the native Checkout Block
  reads. That page therefore needs cookies; the storefront before it does not. Woo copies
  the cart and leaves out the customer's address.

Woo answers another origin only when the request carries a valid token or WordPress allows
the origin. The first read has no token yet. A site whose config sets `frontend` to its
external address has that origin allowed for Store API requests, and only for those. Any
other origin is added through WordPress's `allowed_http_origins` filter. With `frontend`
set, WordPress redirects its own pages to that site, the checkout page included, so such a
storefront places orders with `checkout()`.
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

One page kind keeps cart-dependent output: a page the theme renders rather than `tp/app`
(a WordPress Page with no app route, a post in a theme template). TypedPress does not
start Woo without the cart there, because a theme or a Woo block on such a page may show
the cart. Woo's `AssetsController::add_resource_hints` then prints its prefetch links for
a visitor with items. Those responses are `private, no-store` for any request carrying
Woo's session cookie, and unchanged for everyone else.

Cart, checkout, receipts, order-pay, my-account and Woo's cart actions (`?add-to-cart=`,
`?wc-ajax=`, `?session=` and the like) are `private, no-store` with `A8C-Edge-Cache:
no-cache`, call `batcache_cancel()`, are never prebuilt and have no Markdown twin. So are
`/wp-json/wc/store/*` cart, checkout and batch answers. Only these responses set Woo's
cookies. Native stock changes purge item and listing reads through TypedPress's usual
purge hook.

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
