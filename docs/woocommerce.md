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

The generated client exports `cart` and `createCartClient`: get/add/update/remove,
update the customer address, select shipping, and subscribe to updates. It calls Woo's
same-origin Store API with the Woo session cookie and rotating nonce. It uses no Cart-Token
or TypedPress shopper session. Money normalizes minor units to exact decimal strings.

Checkout is a public `page.md` containing the native Woo Checkout Block. It remains a real
WordPress Page inside the app layout. Receipt and order-pay endpoints use that same Page;
full-page navigation initializes Woo's scripts. Removing the checkout block or trashing
its Page is refused. Cart, checkout and receipts are private/no-store and noindex; catalog
HTML stays public for a guest with a Woo cookie. Native stock changes purge item and listing
reads through TypedPress's usual purge hook.

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

Spacefast must complete its [host checklist](../migrate/docs/spacefast-host-checklist.md#commerce-host-qualification)
before deployment: Woo provisioning, a maximum 20-character table prefix, isolated preview
databases, mail/callbacks/jobs and the required cache exclusions. Playground proof does not
qualify arbitrary payment gateways or the live host. The complete v1 decisions and deferred
scope are in the [design](design-woocommerce.md).
