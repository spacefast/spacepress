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

Each is a fixed native kind, with at most one export per builder. Native fields and access rules
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
Stock is operational data managed by Woo. Set `product({ inventory: true })` to
start new products with managed stock at zero and expose the read-only
`stockQuantity` field. Everything in this paragraph and the next exists only
with `inventory: true`; without it the app has no stock field, no stock or
fulfilment ability and no stock hook.

`inventory: true` adds two administrator-only abilities the app calls from its
actions with `abilities.call`:

| Ability | Input | Needs |
| --- | --- | --- |
| `<app>/increase-product-stock` | `{ id, quantity }`, `quantity` an integer of at least 1 | `inventory: true` |
| `<app>/complete-order` | `{ id }` of a processing order | `inventory: true` and an exported `order()` |

Both are refused with 422 for any other input. The app cannot declare an
action, kind, global or job whose ability name would be one of these two, or
`<app>/store-get`: `typedpress check` refuses it.

The `typedpress_woo_order_stock` hook (`tp/wp-hooks/typedpress_woo_order_stock.ts`)
receives the product ID, order ID, signed quantity and reason when Woo changes
stock for an order. The reason is `sale` when an order reduces stock, and
`return` when a cancelled, failed or pending order restores it or a refund is
made with "Restock refunded items". Its handler may be `async`. A restock
through `increase-product-stock` is not an order change and does not fire it.

Use `product({ fields: { capacityGb: integer().min(1).optional() } })` to add
typed scalar fields to Woo's product metadata. Optional fields allow the app
to read products created in Woo admin before the fields were declared.
A `date()` field is stored as `YYYY-MM-DD` and filters and sorts in that form.
TypedPress Admin and Markdown sync use the same field definitions.
Set `reviews: true` on `product()` to enable text reviews and render them
with `<Comments for={item} />`.

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
Taxes, coupons, signup/accounts, star ratings, sale prices and backorders stay disabled.
Historical order tax, coupon, item and refund snapshots remain readable.

## Cart, checkout and agents

The generated client exports `cart` and `createCartClient` for Woo's same-origin Store API.
The default client uses the Woo session cookie and refreshes an invalid nonce once before
retrying the write. Money is returned as exact decimal strings.

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

Checkout is a public `page.md` containing the native Woo Checkout Block. It remains a real
WordPress Page inside the app layout. Receipt and order-pay endpoints use that same Page;
full-page navigation initializes Woo's scripts. Removing the checkout block or trashing
its Page is refused. Cart, checkout and receipts are private/no-store and noindex; catalog
HTML stays public for a guest with a Woo cookie. Native stock changes purge item and listing
reads through TypedPress's usual purge hook.

Scoped agent credentials use app abilities. Product/term writes require `--write`; the
entire order kind additionally requires `--personal`. Without it every order ability
(`<app>/orders-list`, `<app>/orders-get`, ...) and `<app>/complete-order` is refused when
called, and the order kind's abilities are left out of every place abilities are listed or
described: `GET /wp-abilities/v1/abilities`, one ability's own route, each MCP server's
`tools/list`, and the default MCP server's `discover-abilities` and `get-ability-info`.

An action is left out of the same lists when its code needs the grant. The build decides
that from the action's code, not from what one call does. An action is marked when its
handler, or a helper it calls:

- reads an order kind (`db.query.orders`, a relation to it);
- calls an ability that needs the grant: `abilities.call("<app>/orders-list")`, any other
  ability of an order kind, or `abilities.call("<app>/complete-order")`;
- calls an action that is itself marked, however long the chain of actions is.

Because the mark comes from the code, it covers every branch. An action that reads orders
only when its input asks for them is hidden as a whole. Calling it is not refused as a
whole: the call runs until it reaches the order read or the ability, and is refused there
with a 403 that names the grant. A call that takes a branch with neither succeeds.

The build follows what the action calls, not what runs because of it. A collection hook
that one of the action's writes fires, and a `wp-hooks/` handler, are not followed: if one
of them reads orders, the action stays listed, and the order read is still refused for a
credential without the grant.

An action's `abilities.call` runs as the same credential. A credential limited with
`--abilities` therefore needs the inner ability on its list as well as the action
(`--abilities=shop/restock,shop/increase-product-stock`); the refusal names the missing one.
The store has one read tool. Scoped credentials cannot call Woo's merchant REST namespaces,
its core REST product/term aliases, or `woocommerce/*` abilities. Cart and checkout have no agent tools.

## Verification and hosting

[The Drive Store README](../examples/drive-store/README.md) gives the Playground test commands.
`tests/commerce.rs` checks declarations, scaffold preservation and native WordPress CRUD,
settings, access scopes, MCP visibility, stock purges and historical order reads.
`docs-site/tests/playground/commerce.test.ts` clicks cart/shipping/COD checkout and a dummy
paid gateway, verifies decline/retry and downloads, and drives the real sync CLI.

Spacefast must complete its [host checklist](spacefast-host-checklist.md#commerce-host-qualification)
before deployment: Woo provisioning, a maximum 20-character table prefix, isolated preview
databases, mail/callbacks/jobs and the required cache exclusions. Playground proof does not
qualify arbitrary payment gateways or the live host. The complete v1 decisions and deferred
scope are in the [design](design-woocommerce.md).
