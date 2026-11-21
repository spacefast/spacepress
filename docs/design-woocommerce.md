# WooCommerce support in TypedPress

Date: 2026-11-16. Status: implemented and exercised on Playground; Spacefast host qualification remains separate.

## Goal and scope

An agent builds a TypedPress application, adds commerce, and deploys it on Spacefast.
TypedPress provides the authoring and typed API; WooCommerce supplies the commerce runtime.
The current scope is a complete store on Playground, where TypedPress already runs (WordPress
on SQLite). Running it on Spacefast needs the host upgrade in the
[Spacefast host checklist](spacefast-host-checklist.md), which proceeds in parallel and does
not block this work. A separate Astro commerce product, standalone distribution milestone, or
open-source release plan is not part of this work.

The v1 store sells simple physical and downloadable products through an interactive TypedPress
storefront backed by Woo. Downloads use Woo's native permissions and delivery mechanism;
additional file-access protection outside Woo is deferred. Checkout uses Woo's native Checkout Block inside a TypedPress page.
Products, inventory, carts, orders and payment processing remain
native Woo objects. TypedPress must use Woo's APIs rather than maintain a second commerce
database or write directly to Woo tables.

## Commerce in the schema

**Decision:** commerce is declared the way everything else is: by exports. There is no
`commerce` key in `defineConfig`.

```ts
// tp/shop.ts
import { store, product, productCategory, productTag, order } from "typedpress";

export const shop = store({
  currency: "EUR",
  country: "PL",
  address: { line1: "Rynek 1", city: "Kraków", postcode: "31-042" },
  sellTo: ["PL", "DE", "CZ"],
  units: { weight: "kg", dimension: "cm" },
  shipping: [
    { name: "Poland", countries: ["PL"], methods: [
      { type: "flatRate", title: "Courier", cost: "15.00" },
      { type: "freeShipping", title: "Free over 200", minimum: "200.00" },
    ] },
    { name: "Europe", countries: ["DE", "CZ"], methods: [
      { type: "flatRate", title: "Courier", cost: "40.00" },
    ] },
  ],
  payments: ["cod"],
  email: { fromName: "Mug Shop", fromAddress: "shop@example.com" },
});

export const products = product({ sync: "content/products/*.md", url: "/products/:slug" });
export const categories = productCategory({ sync: "content/product-categories/*.md", url: "/shop/:path" });
export const tags = productTag({ sync: "content/product-tags/*.md" });
export const orders = order();
```

### The store

One `store()` export turns commerce on. With it, the build adds WooCommerce as a platform
plugin at a version TypedPress pins, as `locales` adds Polylang; on a hosted build it is a
manifest requirement the host provides. `product()`, `productCategory()`, `productTag()` and
`order()` without a store are build errors, and so is a second store.

| Key | Required | Meaning | Woo |
| --- | --- | --- | --- |
| `currency` | yes | ISO 4217 code; every `price` is in it | `woocommerce_currency` |
| `country` | yes | Where the store is: ISO 3166-1, with a state as `"US:CA"` | `woocommerce_default_country` |
| `address` | no | `{ line1, line2?, city, postcode }`, shown in emails and used as the shipping origin | `woocommerce_store_address`, `_address_2`, `_city`, `_postcode` |
| `sellTo` | no, default `"all"` | Countries orders are accepted from; shipping destinations follow it | `woocommerce_allowed_countries`, `woocommerce_specific_allowed_countries` |
| `units` | no | `{ weight, dimension }` | `woocommerce_weight_unit`, `woocommerce_dimension_unit` |
| `shipping` | no | Zones in match order: `{ name, countries, methods }`, where `countries` is a list or `"rest"`. Methods are `flatRate` (`title`, `cost`), `freeShipping` (`title`, optional `minimum`) and `localPickup` (`title`, optional `cost`) | Woo shipping zones and their `flat_rate`, `free_shipping` and `local_pickup` methods |
| `payments` | no | Woo gateway ids offered at checkout, in order | the gateways checkout offers |
| `email` | no | `{ fromName, fromAddress }` of order emails | `woocommerce_email_from_name`, `woocommerce_email_from_address` |
| `checkout` | no, default `"/checkout"` | The checkout page's path ([storefront](#storefront-urls-and-templates)) | Woo's checkout page |

Rules:

- **A declared key is the source's.** It is applied on every build, shown read-only in Woo
  administration, and never comes back through `typedpress sync`. A key left out is Woo's:
  its default at first, then whatever the admin sets.
- **Scalar keys are applied by hooks**, as [opinionated WordPress](config-api.md#opinionated-wordpress)
  applies its switches: the runtime answers the option, and nothing is stored. Removing the key
  gives the stored value back.
- **Shipping zones are rows, so they are written**, through Woo's own zone CRUD when a build is
  initialized. A declared `shipping` is the whole zone list: zones are matched by `name`,
  updated to the source, and a zone the source no longer names is removed. `shipping: []` is a
  store that ships nothing. This transaction covers shipping reconciliation, not the whole
  deployment. Managed hosts must enforce the [shipping compatibility and recovery prerequisite](host-contract.md#lifecycle):
  selecting an older ready build does not restore its shipping rows, and a later installation
  failure does not undo an already completed shipping step. Keep checkout suspended until the
  selected build and installed policy agree; recover through a new initialized build when needed.
- **`payments` filters the gateways checkout offers**, on `woocommerce_available_payment_gateways`. A gateway that needs credentials takes
  them from its own settings in v1; `env()`-backed gateway settings come with the pilot gateway.
- Money is an exact decimal string. An unknown key, currency, country or method is a build error.

Not in the store: taxes, coupons, account pages (disabled below), price display format,
inventory thresholds and email templates (Woo administration).

This is what makes a fresh site sellable. A preview or a first deployment seeded from source
has its currency, destinations, shipping rates and payment methods without anyone opening
Woo administration.

### Products, terms and orders are kinds

Each builder is a kind with a fixed shape over Woo's own objects, as `userProjection()` is
over WordPress users: it creates no post type, taxonomy or table of its own.

| Builder | Rows | Fields | Operations | Options |
| --- | --- | --- | --- | --- |
| `product()` | Woo products | [the v1 field list](#v1-product-field-list), plus read-only `id`, `url`, `type`, `purchasable` and `availability` | list, get, create, update, trash | `sync`, `url`, `api`, `agents`, `label` |
| `productCategory()`, `productTag()` | terms of `product_cat` and `product_tag` | a term row: `name`, `slug`, `description`, `parent` on categories, `count`, `url` | as a `taxonomy()` | `sync`, `url`, `api`, `agents`, `label` |
| `order()` | Woo orders | [order reads](#dashboard-scope) | list, get | `api`, `agents`, `label` |

- At most one of each per app. A kind left out is not served: an app with no `order()` has no
  order API.
- The fields are fixed in v1: a builder takes options and no field list. Authored fields on a
  product are later work.
- `access` is refused in v1; the defaults under [access boundaries](#access-boundaries) apply.
- Being kinds, they need nothing of their own for the API (`/wp-json/typedpress/v1/products`), the typed
  client, `db.query.products`, OpenAPI, abilities, item URLs, purges or sync: each comes from
  the kind machinery. What is new is one store behind each, beside the post and term stores,
  that reads and writes through Woo CRUD.
- `products.categories` and `products.tags` are `terms()` fields to the two term kinds, so
  filters, `with` loads and the reverse lists work as on any taxonomy.

## Product ownership

Static definitions and database storage are compatible: source files can describe products,
and Woo stores the resulting records. The decision is which surface owns subsequent edits.

**Decision:** products use the existing seed and explicit `typedpress sync` model. Deployment
creates missing products and preserves existing products; sync reconciles subsequent file and
Woo edits, reporting conflicting changes. Products remain editable through authorized APIs
and Woo administration. A deployment-only ownership mode is not required for this integration.

Products follow collection seed/sync behavior as a kind of their own, not a `collection()`.
Collection writes use WordPress post APIs; product writes must use Woo CRUD. Markdown is the
default product authoring format, with structured front matter and the description in the body.

Sync covers authored fields such as names, descriptions, prices and taxonomy assignments.
Stock quantities, sales counters and orders are operational state, not synced
content. Configure inventory through Woo administration initially; source files contain neither
current nor initial stock quantities.

### V1 product field list

**Decision:** keep the initial writable and synced catalog surface small. This is the complete agreed list,
not just the fields shown in a minimal example:

| Field | Purpose |
| --- | --- |
| `uid` | Persistent source identity; derived when absent and written into the file by sync, as for collections |
| `name` | Product name |
| `slug` | Optional editable URL slug; Woo derives it on creation when absent |
| `sku` | Optional merchant SKU, independent of identity |
| `status` | The collection values: `draft`, `pending`, `scheduled`, `published` or `private`, mapped to Woo's post statuses (`published` is `publish`, `scheduled` is `future`). As for collections, an absent status is `published` |
| Markdown body | Full product description |
| `shortDescription` | Optional short description |
| `price` | Exact decimal price in the store currency; maps to Woo's regular price internally |
| `images` | Ordered media references using existing collection media semantics; first image is primary |
| `categories` | Product category UIDs |
| `tags` | Product tag UIDs |
| `virtual` | Whether the product requires no shipping; independent of downloadability |
| `downloadable` | Enables Woo's native downloadable-product behavior |
| `downloads` | Array of `{ id, name, file }` entries with stable string IDs; contract below |

Products created through this interface are simple products, physical or downloadable. A source file supplies
`name` and may supply an explicit `uid`; a product offered for sale needs a valid price. Exact required-field validation
for unpublished drafts follows Woo. Reuse existing sync omission/clearing semantics rather
than invent an independent field-ownership mode.

Defer `backorders`, `manageStock`, stock quantity, initial stock, `soldIndividually`, weight,
dimensions, shipping class, tax class, catalog visibility controls and featured products from
the writable/synced API. Sale pricing is not supported: no `salePrice`, sale schedules or
sale-specific storefront features in v1, and a sale price stored in Woo has no effect (below).
Omitted settings remain available in Woo administration and sync never writes them. The
disabled capabilities below are turned off by hooks, not by writing product values. Newly
created products use Woo's normal defaults for omitted settings.
Read projections still expose current price, purchasability and availability so the storefront
reflects Woo's actual state. Cart quantities, shipping rates and totals continue to be validated
and calculated by Woo; omitting shipping dimensions from source does not remove checkout shipping.

### Disabled capabilities in v1

**Decision:** disable coupons, product reviews and star ratings, Woo customer signup,
backorders, sale pricing and Woo tax calculation on the TypedPress commerce store. Keep guest checkout,
stock management, shipping and order emails available.

Use native Woo options and behavioral filters rather than only hiding controls:

- Coupons: `woocommerce_enable_coupons = no` and the `woocommerce_coupons_enabled` filter.
- Reviews/ratings: `woocommerce_enable_reviews = no` and `woocommerce_enable_review_rating = no`.
- Customer signup: `woocommerce_enable_signup_and_login_from_checkout`,
  `woocommerce_enable_myaccount_registration` and `woocommerce_enable_delayed_account_creation`
  are `no`; `woocommerce_enable_guest_checkout` is `yes`. This does not disable TypedPress
  identity or merchant sign-in.
- Backorders: turned off by hooks alone. `woocommerce_product_backorders_allowed` returns
  false and `woocommerce_product_get_backorders` returns `no`, whatever a product stores, and
  `woocommerce_product_get_stock_status` turns a stored `onbackorder` into `outofstock`. No
  product value is written, so nothing needs repair and the stored settings are intact if the
  restriction is lifted.
- Sale pricing: turned off the same way. `woocommerce_product_get_sale_price` returns empty,
  `woocommerce_product_get_price` returns the regular price and `woocommerce_product_is_on_sale`
  returns false. A sale price or schedule entered in Woo administration is stored and ignored;
  the product's current price is always its synced `price`. Woo registers its own
  `woocommerce_product_get_price` filter for scheduled sales, so TypedPress's runs after it.
- Coming-soon mode: a new Woo install sets `woocommerce_coming_soon` to `yes`, which hides the
  storefront behind a placeholder. The runtime answers `no`; a store is live when it is deployed.

The product getters above are filtered when Woo reads a product for display, the cart and the
Store API (`get_prop` in `view` context). They do not change stored values or Woo's lookup
tables, so a stored sale price can still affect Woo's own price sorting and filtering; product
lists served by TypedPress sort on the regular price.
- Taxes: `woocommerce_calc_taxes = no` and `wc_tax_enabled = false`. Woo must not calculate or
  add tax to new carts/orders in v1.

These are enforced v1 restrictions, not initial defaults merchants can inadvertently re-enable
through Woo settings. Settings UI must reflect the restrictions. Scope enforcement to the
TypedPress commerce store; preserve historical order amounts, tax lines and coupon lines.

## Sync integration

Extend the [existing seed/sync contract](config-api.md#seeding-and-typedpress-sync) to Woo
products and taxonomies: seed missing records, preserve runtime edits during deployment, merge
explicit sync changes and report conflicts. Missing files do not imply deletion. Reuse
[seed compilation](../src/bundle.rs), [seed execution](../runtime/TypedPress/Sync/Seed.php)
and the [record policy](../runtime/TypedPress/Sync/Routes.php) where compatible, with Woo CRUD
as the product writer. This support is new work, not an existing Woo integration.

**Decision:** reuse collection activation, rollback and retry semantics. Code rollback does not
restore earlier catalog content. Initial seeding must succeed before the build is marked ready;
seeding is not atomic across the whole deployment, so earlier completed resources can remain
when a later resource fails. Sync retries reconcile against current state through the existing
baseline and merge contract. Verify Woo CRUD hooks, cache updates and stable identities under
failure and retry; these are implementation checks, not a separate commerce lifecycle policy.

### Source files and an example

**Decision:** reuse collection source-authoring behavior. Builds accept a missing UID and derive
it without modifying the file. `typedpress sync` derives a missing UID and writes it into the
file before applying changes. Once explicit, the UID survives file, SKU and slug renames;
renaming a file before persisting its derived UID can change its identity. Category and tag
references use UIDs, never numeric term IDs. Use the existing per-field merge, baseline and
conflict workflow; do not introduce a second baseline store or a commerce-specific sync command.

The product field list and sync behavior are settled. Implementing Woo value normalization,
change detection and writes through this existing contract is implementation work, not a new
merge-policy decision.

Images reuse existing collection media behavior for now: media fields may contain site-local
numeric attachment IDs, and Markdown body images retain their URLs. Sync does not download
those images or turn them into portable project assets. This is an explicit exception to using
UIDs for product and term references, and limits media portability between stores.

Example project layout:

```text
content/
  products/ceramic-mug.md
  product-categories/home.md
  product-tags/handmade.md
```

Proposed `content/products/ceramic-mug.md` (not implemented yet):

```md
---
uid: zr_8b3e7c9d2a104f65b012
name: Ceramic mug
slug: ceramic-mug
sku: MUG-BLUE
status: published
price: "24.00"
categories:
  - zr_15a702bc4d8e6390fa12
tags:
  - zr_6c9d201e4a7b8350fd12
images:
  - 42
---
A handmade ceramic mug for your morning coffee.
```

Price uses the store's configured currency. The UID is opaque, persisted in the file and
independent of the file's name. For example, renaming this file to `blue-mug.md` must still
update the same product. Image `42` is an existing attachment on this store, not a product or
term identity; its alt text belongs to the media record. No current stock quantity belongs in
this synced document.

Proposed `content/product-categories/home.md`:

```md
---
uid: zr_15a702bc4d8e6390fa12
name: Home
slug: home
---
Everyday objects for the home.
```

Proposed `content/product-tags/handmade.md`:

```md
---
uid: zr_6c9d201e4a7b8350fd12
name: Handmade
slug: handmade
---
Made by hand.
```

Taxonomy Markdown bodies map to term descriptions; parent references, when present, also use
UIDs. One `typedpress sync` processes the declared taxonomies and product references in dependency
order. First deployment seeds missing terms and products. After that:

- Changing `price` in the file and syncing updates that Woo product's regular price.
- Editing its description in Woo and syncing brings the description into the Markdown body.
- Changing the same field differently in both places reports a conflict through existing sync.
- Removing a file leaves its Woo product unchanged, including its publication status.
- To stop selling a product, set `status: draft` and sync. To resume, set `status: published`
  and sync with the same UID. Existing orders remain untouched. Reuse this existing status
  and no-delete behavior; no separate retirement or reintroduction mechanism is needed.

Different stores may assign different internal product and term IDs; their UIDs remain stable.
Media IDs and image URLs retain the existing collection portability limitations.

### Future shared sync improvements

Portable project-relative image references, downloading Woo/editor-added images into local
assets, content-based reuse and replacement/conflict handling belong in the shared sync system
for collections and products. They are deferred, not prerequisites or open v1 decisions.
Stricter build-time requirements for explicit UIDs can also be considered as a shared change;
v1 does not add a Woo-specific rule.

## Proposed minimum commerce API

Product CRUD is the catalog foundation, but does not by itself provide a buying flow. The
initial API also needs shopper cart operations and checkout, plus authorized order reads
for application dashboards. Operation names are set during implementation.

| Resource | Initial operations | Data contract |
| --- | --- | --- |
| Products | List, get, create, update, trash; seed and sync | The v1 field list above; reads additionally expose native runtime ID, current price, purchasability and availability |
| Categories and tags | Existing taxonomy/terms API, extended to bind Woo taxonomies and support product relationships | Native term ID, stable source identity, name, slug; categories also have a parent. No separate commerce category/tag CRUD API |
| Cart | Read current cart, add item, change quantity, remove item, update destination, choose shipping rate; Woo's Store API called from the browser ([cart session](#cart-session)) | Session-scoped lines, current prices, availability, shipping choices, fees and Woo-calculated totals |
| Checkout | Render Woo's Checkout Block inside a TypedPress page | Session continuity, address and shipping validation, supported payment integration, order result and receipt |
| Orders | Authorized list/get, including line and refund details | Status, currency, timestamps, historical line items, totals, billing/shipping snapshots, optional customer reference, payment method label and refund summaries |
| Store information | Read the [store](#the-store) as it is in effect, and supported capabilities | Currency and precision, display conventions, measurement units, destinations, supported product types and whether checkout is available; no gateway secrets |

Use simple physical and downloadable products for the first proof. Virtual and downloadable are
independent Woo flags, not mutually exclusive product types: a digital-only download normally
sets both. Reject unsupported variable, grouped, external or extension-defined
product writes explicitly. Read projections should identify unsupported types without pretending
they are simple products. Variation authoring and sync are deferred.

### Cart session

**Decision:** the cart has one session store, Woo's, reached two ways through the Store
API. TypedPress adds no cart routes, no session table and no shopper session.

- **Cookie session**, the default on the store's own origin: Woo's session cookie and
  rotating nonce. The native Checkout Block reads the same cookie, so the cart a shopper
  fills on a TypedPress page is the cart checkout shows.
- **Token session**, the default for a Store API on another origin: no cookie. Woo's
  `Cart-Token` header names the session (`StoreApi\SessionHandler`, the same
  `woocommerce_sessions` table) and stands in for the nonce
  (`AbstractCartRoute::requires_nonce`). The browser keeps the token in `localStorage`,
  or in memory.
- **A token cart reaches checkout** through `POST /wc/store/v1/checkout` with the token,
  with no cookie at all, or through Woo 11.3's `?session=<token>` on the checkout page,
  where `WC_Session_Handler::init_session_from_request` copies a guest token's cart into a
  new cookie session for the Checkout Block. The Block itself has no token mode, so that
  page needs cookies. An expired token is ignored by Woo; the client starts a new cart
  for a write and refuses checkout.
- **The handoff is made repeatable with Woo's own session code.** Woo copies a token's
  cart once per cookie session and never empties the token's cart after a cookie-side
  order. TypedPress drops the cookie before Woo reads a valid `?session=` token, so Woo
  copies again into a new session; redirects to the address without the token; and, when
  Woo empties a cookie cart for an order and the token's cart has the same lines, deletes
  the token's session (`WC_Session::delete_session`). No cart data is stored or copied by
  TypedPress.
- **An external `frontend` reads the Store API without credentials.** Its origin is
  answered on dispatched `/wc/store/` routes only, with `Access-Control-Allow-Credentials`
  removed, and is not added to `allowed_http_origins`: that list also opens admin-ajax,
  and `WC()->is_store_api_request()` is true for any address carrying
  `?rest_route=/wc/store/`.

Guest TypedPress pages eligible for shared caching start Woo without the cart cookies
(`Commerce\Module::isolateSharedCart`). This keeps Woo's cart-dependent prefetch hints,
saved cart items and notices out of shared HTML. The router checks the result, not the
request: an answer is shared only when the session cookie did not reach Woo. The generated storefront reads its cart in
the browser and prefetches the checkout script once the cart has an item. Every Store API
response, every shopper page and every response Woo sets a cookie on is private and no-store.
[Storefront setup](woocommerce.md#cart-checkout-and-agents)

### Categories and tags reuse taxonomies

TypedPress already exposes `taxonomy()` kinds and `terms(taxonomy)` fields on collections.
Reuse that model for Woo product categories and tags rather than introduce parallel commerce
CRUD. Terms are not ordinary post-backed collections: they have their own store and access
rules, but participate in the shared query and relationship machinery.

Bind the native Woo `product_cat` and `product_tag` taxonomies; do not create replacement
`tp_*` taxonomies or take over Woo's registration. Woo remains the owner of their registration,
capabilities and callbacks. Product assignments must go through the Woo product writer so its
normal save behavior runs. Term edits can reuse the native WordPress term APIs and TypedPress
authorization, with Woo capabilities respected. Category-specific metadata such as images
needs an explicit mapping rather than assuming TypedPress's `tp_*` term-meta convention.

Implement shared taxonomy seed/sync as part of this work, along with native-taxonomy bindings
and product term relationships. Apply parent terms before children and resolve product references
after their terms exist. Sync explicitly declared terms; never silently create terms from a
product's display names. Report missing references and conflicting edits through the same sync
workflow. A collection may
share a product taxonomy only through an explicit attachment, not automatically for every
collection. Preserve WordPress's aggregate term-count semantics across attached kinds.

See [the current taxonomy contract](config-api.md#taxonomies) and
[the term store](../runtime/TypedPress/Wp/WpTermStore.php).

### Nested data rather than extra CRUD resources

Order lines, addresses, shipping lines, tax lines, fee lines, applied coupon lines and refund
summaries belong in order reads. They are purchase-time snapshots: a later catalog edit must
not rewrite an old order's title, price or totals. Refund detail can be a nested read for large
orders. Do not expose unrestricted order updates, payment completion or refund creation in the
initial API. Native Woo administration remains the operational surface for those actions.

A customer directory is not needed for an order dashboard. Include a nullable customer reference
and authorized billing/shipping information on orders; guest orders need no registered customer.
Account management, customer search and buyer order history can follow with an explicit identity
mapping. Do not infer ownership from an email address supplied by the caller.

Images use the existing media pipeline. Downloadable products use Woo's native file declarations,
order download permissions, delivery handler, receipts and email links in v1. TypedPress does not
add an entitlement service or its own download endpoint.

**Decision:** download fields use an array of `{ id, name, file }` entries:

```yaml
virtual: true
downloadable: true
downloads:
  - id: field-guide
    name: Field guide PDF
    file: https://files.example.com/field-guide.pdf
```

The download ID is an explicit author-chosen stable string, unique within the product, not an
auto-increment ID. Preserve its corresponding Woo download identity during repeated sync and
updates; files pulled from Woo retain their existing opaque download IDs. Changing the label or
file URL keeps the ID and updates the existing entry in place, so previously entitled buyers
receive the replacement through Woo's existing permissions. Do not recreate entries on each sync
or introduce purchased-version storage.

`name` is the buyer-facing label and `file` is a Woo-supported file URL. Woo accepts a
download only from an approved directory. It adds a new file's parent URL to that list by
itself, but enables it only when the current user is a site administrator, and seeding at
deploy has no current user: the save would fail with `product_invalid_download`. The product
store therefore approves and enables the parent URL of each declared download before it
writes the product, for seed and sync alike. Automatic local-file
upload/protection is deferred. Download limits and expiry remain native Woo settings rather than
new TypedPress fields for now.

Additional protection of backing files outside Woo, private storage provisioning, direct-origin
access checks and retention/versioning policy are deferred. Native Woo authorization of its
download endpoint does not establish that a backing URL is inaccessible directly; v1 makes no
such protection claim. Do not add anonymous backing-URL denial as a v1 acceptance gate.
The public catalog exposes download names and IDs, while the existing field-access rules
restrict backing `file` locations to administrators (and `--personal` scoped credentials).
This prevents catalog disclosure without claiming to protect a directly accessible origin.
The selected checkout must provide a receipt and preserve Woo order emails.
Coupon application and tax calculation are disabled in v1. Coupon CRUD and custom promotion
engines are deferred. Shipping settings remain in Woo administration; carts expose Woo's
calculated results. Historical order reads retain their original tax and discount breakdowns.

### Shared value types and query contracts

- **Money:** exact decimal strings with currency and precision at the containing resource;
  never floating-point arithmetic. Normalize Store API minor-unit strings at the adapter boundary.
  Preserve Woo's calculated totals and historical order tax breakdowns; new v1 checkout does
  not calculate tax.
- **Identity:** source files use persistent sync UIDs for products, terms and references, never
  site-local auto-increment product or term IDs. Reuse the existing UID format and mapping;
  native Woo IDs remain local runtime identifiers. Preserve explicit UIDs when renaming or
  moving files. Deriving a missing UID from a filename does not guarantee rename stability:
  run sync to persist the UID before relying on moves. SKU and slug remain editable attributes,
  not identity. Media retains collection semantics, including numeric attachment IDs and image
  URLs; portable asset mapping is deferred. Test product and term UID mapping independently of
  those media portability limits.
- **Lists:** bounded pagination and explicit supported filters. Product filters include status,
  search, category, tag and availability; order filters include date range, status and customer.
  Use deterministic ordering. Do not imply arbitrary SQL joins or the complete `db` query language.
- **States:** preserve Woo order statuses, including extension-defined values. An order status
  is not a generic payment or shipment status; expose native facts without inventing equivalences.
- **Metadata:** no wholesale Woo metadata dump. Add explicitly typed extension fields when needed.

### Access boundaries

**Decisions:** public visitors can read published, storefront-visible products. Drafts and private
products require management access. Product and taxonomy writes use TypedPress's existing
access-rule model with `admin` access by default; sync uses its authenticated caller's
permissions. Order reads are `admin`-only initially: public storefront access does not
expose order lists, addresses or customer details, including through server-side helpers.
Buyer checkout and receipts use Woo's cart/session and order authorization. Guest checkout
does not grant general order-read access.
Keep gateway credentials on the server.

Allow native Woo administration for products, orders, inventory, shipping and payment settings,
subject to the disabled-feature restrictions. No new TypedPress commerce dashboard is required.
The merchant is the site's `admin`: TypedPress's existing role, which already holds Woo's
capabilities. There is no separate commerce login, `merchant` role or shop-manager tier in v1.

The [existing access syntax](config-api.md#access) supports per-operation booleans, audience/role
shorthands and context functions returning booleans or row filters. V1 commerce uses the agreed
permission defaults. Author-customizable product/order rules are deferred for a later decision;
they are not required for v1.

Expose product and order operations through TypedPress's existing action, permission and client
mechanisms. Native Woo CRUD runs in-process on the server; a loopback REST request and a second
set of merchant API credentials are unnecessary. The cart is the exception: it goes from the
browser to Woo's Store API ([cart session](#cart-session)).

### Agents

**Decision:** agents get the store through the app's abilities and MCP server, under the same
rules as every other caller, and through nothing else.

- **Products, categories and tags** have the abilities any kind has (`agents: false` hides
  them). Reads are public; writes need `admin` and a credential with `--write`.
- **Orders** have `list` and `get` only. Every order carries a buyer's name, address and
  email, so the whole kind is personal data: a scoped credential needs `--personal` to call
  either, and without it the tools are not listed. There is no order write tool.
- **The store** has one read ability, the same answer as the store information read. It has
  no write: the source owns it.
- **Cart and checkout** are not abilities in v1. An agent does not buy.
- **Woo's own surfaces stay closed to scoped credentials.** Woo registers its own abilities
  under `woocommerce/*` on every site, among them `orders-query`, `order-create`,
  `order-update`, `order-delete`, `customers-query` and `payment-gateway-update`, each gated
  by a Woo capability and none by TypedPress's rules. The MCP Adapter, a TypedPress platform
  plugin, exposes registered abilities, so these would reach agents beside the app's own. A
  scoped credential is refused every `woocommerce/*` ability and every Woo REST namespace
  except the Store API (`wc/v1` to `wc/v4`, `wc-admin`, `wc-analytics`,
  `wc-push-notifications`, `wc-telemetry`), and the app's MCP server never lists them. An
  alias under core REST for Woo post types or taxonomies (`/wp/v2/product`, `product_cat`,
  `product_tag`, and their related Woo resources) is closed to a scoped credential too. An
  unscoped admin credential works on them as WordPress ships, which is its owner's choice.
- **Woo's agent-commerce features stay off.** `ucp` (the catalog and a cart for AI shopping
  agents), `agent_readiness` and `mcp_integration` are experimental and off by default; v1
  does not turn them on.
- Core's content abilities never see products: the `product` post type keeps
  `show_in_abilities` false, as TypedPress's own post types do.

### Dashboard scope

**Decision:** v1 provides authorized paginated order lists and individual order details. Order
details include status, dates, purchased items, quantities, prices, totals, billing/shipping
addresses, customer reference, payment method and refund summaries. These are read-only;
order changes and stock quantity changes remain in Woo administration. No dedicated TypedPress
stock-write API is included in v1.

Aggregate reporting APIs, revenue charts and best-selling-product reports are deferred. They
require a later bounded reporting API with defined timezone, currency,
status and refund treatment; clients must not sum one page of orders and present it as store revenue.
Expose native order notes as a subsequent authorized read if the first support interface needs
them. Refund, cancellation and fulfillment writes should be explicit actions with lifecycle
semantics when added, rather than generic order CRUD.

References: [Woo Store API](https://developer.woocommerce.com/docs/apis/store-api/),
[merchant REST resource contracts](https://woocommerce.github.io/woocommerce-rest-api-docs/),
and [Woo CRUD](https://developer.woocommerce.com/docs/best-practices/data-management/crud-objects).
The resource shapes are reference material, not a commitment to wrap every upstream endpoint.

## TypedPress and Spacefast integration

### Configuration and compiler

The compiler reads the `store()` and the commerce kinds ([commerce in the schema](#commerce-in-the-schema)),
validates them and emits them in the schema. A local build pins and fetches WooCommerce as a
platform plugin. A hosted build names it under the manifest's `requires` rather than
introduce a separate application deployment system.

Hosted source capture currently rejects app-declared WordPress plugins. Local plugin ZIP
support therefore does not establish hosted Woo support. Extend host requirements and
Spacefast provisioning together; keep the tested plugin set controlled by the host.

### PHP runtime and typed APIs

Provide typed product reads and authorized mutations backed by
Woo CRUD. Keep merchant operations separate from public shopper reads, carts and checkout.
Do not adopt Woo tables through `existingTable` or mirror products and orders into `table()`.

**Decision:** orders are stored as WordPress posts. Woo turns its custom order tables (HPOS)
on for a new shop; the runtime answers false on `woocommerce_enable_hpos_by_default_for_new_shops`
before Woo is first installed, so they never are. Posts storage is the older and more widely
exercised path, and it is the same on Playground, previews and production. Woo's source
handles SQLite for Studio and Playground, in its HPOS queries too, so this is a choice for
one storage everywhere, not a workaround. Existing shops with HPOS authoritative or order
synchronization enabled are refused before order storage is selected; TypedPress never forces
their stored settings to change. Complete synchronization and select legacy storage in Woo
before enabling this runtime. Supporting HPOS later must also update order query selection.

Reuse the Woo Store SDK's cart types and Store API client in TypedPress client components; its
cross-origin session and checkout handoff are not needed ([cart session](#cart-session)). Full Woo PHP class bindings and a new frontend framework adapter are
not prerequisites for the first store.

### Host lifecycle

Provision and initialize Woo before commerce readiness. Verify database and cache scope,
plugin load order, scheduled jobs, checkout routes, Store API routes, gateway callbacks,
assets, cookies and merchant administration on Spacefast. Woo's emails go through `wp_mail`,
which Spacefast delivers; they need no `tp_mail_transport`.

**Decision:** a site with commerce has a table prefix of at most 20 characters. MySQL and
MariaDB refuse a table name over 64 characters, and Woo's longest,
`woocommerce_downloadable_product_permissions`, is 44. The [host contract](host-contract.md#table-prefix)
allows 35 without commerce, and Spacefast's `sfz_<24 hex>_` is 29, so Spacefast gives a
commerce site a shorter prefix. The hosted manifest's `maxTablePrefix` is 20 when the app
has a `store()`, and the runtime refuses to initialize Woo under a longer one, naming the
limit. SQLite has no such limit, so the refusal applies there too: a preview must not pass
where production would fail.

The [Spacefast host checklist](spacefast-host-checklist.md) records the existing compiler and
runtime integration gap. That upgrade is a prerequisite for commerce on Spacefast and runs in
parallel with this work, which is proved on Playground first.

### Preview databases

**Decision:** each preview gets its own isolated WordPress SQLite database, preseeded from that
preview's initial source configuration, including declared products and taxonomy terms. Previews
do not share the live store's database or each other's database, and do not copy live orders,
customers or inventory. Preview catalog edits and test orders stay in that preview.

This is the intended host design, not a claim that Spacefast already implements it. Reuse the
normal seed and Woo initialization paths, and qualify Woo plus the supported plugin set against
SQLite. Promotion publishes source/code through the production deployment path; it does not
promote preview database contents into the live store. Verify that preview payment configuration,
email delivery and callbacks cannot perform live commerce side effects. Preview provisioning,
retention and cleanup belong to the host lifecycle rather than a separate commerce staging system.

### Storefront URLs and templates

**Decision:** TypedPress pages are the storefront. Woo renders the Checkout Block and nothing
else a shopper sees.

| URL | Served by | Source |
| --- | --- | --- |
| `/products/:slug` | `tp/app/products/[slug]/page.tsx`, with the product as `item` | the product kind's `url` |
| `/shop/:path` | `tp/app/shop/[...path]/page.tsx`, a category and its products | the category kind's `url` |
| `/shop` | `tp/app/shop/page.tsx`, the catalog | a page |
| `/cart` | `tp/app/cart/page.tsx`, a client component over the cart client | a page |
| `/checkout` | `tp/app/checkout/page.md`, a WordPress Page holding Woo's Checkout Block, in the app's layout | the store's `checkout` |
| `/checkout/order-received/:id` | the same Page, Woo's order confirmation | Woo's endpoint on the checkout page |

- **A kind's `url` is the only address of its items**, as for collections. Woo's product and
  term links answer with it, so order emails, the cart, wp-admin's "View" and the sitemap all
  point at the TypedPress page. Woo's own product, archive and taxonomy templates never render.
- **Woo creates no pages.** The runtime empties `woocommerce_create_pages`, so Woo's shop,
  cart, checkout and My Account pages are never installed. `woocommerce_get_cart_url` answers
  the cart route.
- **Checkout is a real WordPress Page.** Woo recognizes checkout by the Page itself:
  `is_checkout()`, the order-received and order-pay endpoints and the Checkout Block's own
  checks all test `is_page()` against the checkout page id and read WordPress's query
  variables. A [`page.md`](pages.md#markdown-pages) is already a WordPress Page rendered in
  the app's layout, so checkout is one, and the runtime names it on
  `woocommerce_get_checkout_page_id`. Woo's checkout URL, order-received URL and gateway
  return URLs then follow from the Page's permalink with nothing else to filter. A TSX route
  would need each of those checks filtered separately.
- **The templates are files the author owns.** `typedpress add shop` writes `tp/shop.ts`, the
  pages above, a mini-cart client component and two example products, under the rules of
  [`typedpress add`](decisions/2026-11-13-first-add.md): it only creates, never edits, and the
  project compiles before and after. An agent starts from a working store and edits pages.
- Products and their categories get what a public kind gets: a `.md` twin, `/llms.txt` and
  sitemap entries. Cart and checkout get none and are `noindex`.

Verify three things about the checkout Page. A `page.md` route must pass Woo's endpoint
paths (`/checkout/order-received/<id>/`) through to the Page. In a block theme Woo renders
order confirmation from its own `order-confirmation` block template, not from the Page's
content, so the app's layout must carry that template. And the Page is the site's after its
first version, so an editor can remove the block: the runtime should refuse that edit or
report it.

### Page caching

**Decision:** catalog pages are cached as any anonymous page is; nothing about a shopper is in
them.

- **Product, category and catalog pages** are cacheable anonymous renders. Price and
  availability are in the HTML, so they must be purged when Woo changes them.
- **Purges.** A product or term saved through TypedPress or Woo administration already purges
  the pages that read it, as any post or term write does. Stock is the gap: Woo changes it on
  every order without saving the post. The product store therefore reports a change on
  `woocommerce_product_set_stock` and `woocommerce_product_set_stock_status`, which purges the
  product's page and the listings that show it, in the one announcement the request makes.
- **Cart, checkout and order-received** answer `private, no-store`, like any page that is
  rendered for one visitor.
- **Woo's session cookie is not a sign-in.** A guest with a cart gets the same catalog page
  as anyone, with the shared cache headers, because the cart is drawn in the browser. An
  edge need not bypass or vary on `wp_woocommerce_session_*`, and must never cache
  `/wp-json/wc/store/*`. Batcache is the exception a host cannot configure away from
  TypedPress: it skips every request with a `wp*` cookie before plugins load, so a
  cookie-session cart visitor is rendered by PHP each time. A token cart has no cookie.

### Checkout presentation

TypedPress's [client bindings](pages.md#client-components) make an interactive product page,
mini-cart and cart feasible within the application. They do not automatically implement Woo's
payment-method registration, validation, payment events or gateway browser assets. Woo's
[Checkout Block](https://developer.woocommerce.com/docs/block-development/extensible-blocks/cart-and-checkout-blocks/how-checkout-processes-an-order/)
and [payment integration contract](https://developer.woocommerce.com/docs/block-development/extensible-blocks/cart-and-checkout-blocks/checkout-payment-methods/payment-method-integration/)
own behavior beyond rendering reactive fields.

**Decision:** render Woo's native Checkout Block inside a TypedPress page/layout for v1.
TypedPress owns the surrounding page and styling; Woo owns the checkout fields, validation,
shipping/payment UI and submission. Reuse TypedPress's existing block-rendering mechanism if
it can carry this integration before adding a checkout-specific component. A fully custom
TypedPress checkout form is deferred.

Verify embedding and asset loading, session continuity, address/shipping recalculation, payment validation, decline/retry,
authentication redirects, receipt rendering and navigation/remount behavior. Interactivity API
bindings alone are not evidence of Checkout Block or arbitrary gateway compatibility. Keep Woo
authoritative for totals, payment processing and orders. Use full-page checkout navigation if
client-side navigation cannot safely initialize its scripts; verify receipt and return routes too.
A separate Woo checkout page is a contingency if embedding proves unworkable, not a parallel
v1 deliverable. Revisit the decision with that evidence rather than silently switching approaches.
Use a dummy gateway for the first proof and a stock gateway for the pilot. Custom managed
payments are deferred. Use Woo's default emails initially; custom email authoring is follow-up.

## Decision status

Every item marked **Decision** defines the v1 contract. The implementation and usage are
documented in [WooCommerce shops](woocommerce.md). The scaffold uses a `(shop)` route group
so its layout, styles and cart script work alongside an existing app layout; the public
URLs in this document are unchanged. Spacefast provisioning and the explicitly deferred
work remain outside this implementation.

Verification on 2026-11-16: `tests/commerce.rs` exercises native Woo CRUD, term UIDs,
settings, repeat seeds, private order reads, scoped credentials, MCP tool visibility,
historical tax/coupon snapshots and stock purges. The three browser journeys in
`docs-site/tests/playground/commerce.test.ts` pass on WordPress 7.2-beta5, PHP 8.4,
SQLite 3.1.2 and Woo 11.3.0: stock COD checkout with shipping recalculation; dummy payment
decline/retry and an authorized paid PDF download from receipt/email; and the real CLI's
push/pull/conflict/partial-retry workflow while preserving stock, orders and grants.
Desktop, mobile and long product names are inspected in Chrome. Mail is captured, no
external payment is charged, and optional TypedPress Identity is not activated in this
guest-only Playground fixture.

Broader regression checks include the compiler, existing sync and browser suites, PHP
runtime suites, TypeScript declarations, cart-client tests, formatting and clippy. The
native macOS PHP 8.5 full run also exposes unrelated existing failures: the 8 MiB prebuilt
streaming memory-budget test (`fpassthru` buffers under this SAPI), cURL connection metadata,
and the mail fixture's Linux-only `/bin/true`. The non-UTF-8 filename test is skipped on this
filesystem, which rejects the fixture filename itself. These are separate from the passing
Playground commerce proof.

## First implementation proof

Build one TypedPress example with a physical product and a digital download on Playground, from
`typedpress add shop`. Prove that the declared store gives a fresh site its currency, shipping
zones and payment method with no step in Woo administration. Prove product
and taxonomy creation and repeat deployment, live product reads, quantity changes, shipping,
cart continuity, the embedded Woo Checkout Block and a real dummy-gateway Woo order. Prove that
the digital order receives a native Woo download grant and a working authorized link in its
receipt/email rendering, and that unchanged sync preserves the download identity and grant.

Prove file-to-Woo updates, Woo-to-file updates, conflicting edits, preserved stock and orders,
partial-sync retry, file removal leaving products unchanged, draft/publish transitions with
stable identity, and that a stock change purges the product's page. Verify authorized order reads and
refusal of unauthorized reads, including an agent credential without `--personal`. Compatibility claims
must come from those flows, not merely successful plugin installation.

On Spacefast, once the host upgrade lands: repeat the proof, prove preview isolation, then
qualify the stock gateway with a payment and refund.

Verify that coupons cannot be applied, reviews/ratings and customer signup are disabled,
guest checkout works, insufficient tracked stock cannot be backordered, and new checkout totals
contain no calculated tax. Historical order reads must remain unchanged by these restrictions.

Variations, subscriptions, bookings, customer-account flows, a new commerce dashboard and custom
payment infrastructure are deferred. Additional download-file protection outside Woo and custom
email templates are follow-up scope. Reuse native product operations and existing checkout integration where they fit the
selected presentation; no catalog-wide source ownership restriction is needed.

## Prior work and inspirations

The following work informed this design. It provides context and implementation candidates,
not additional requirements: decisions in this TypedPress document supersede conflicting older
plans. Historical progress reports do not establish current deployment readiness.

- [Agent-native WooCommerce PRD](https://github.com/spacefast/batuhan-notes/blob/main/internal-docs/agent-native-woocommerce-prd.md)
  ([PR #2](https://github.com/spacefast/batuhan-notes/pull/2)): agent-created stores, native Woo
  commerce ownership, product synchronization and the first-purchase experience. Its separate
  Astro and standalone release milestones are outside this TypedPress effort.
- [Milestone 1 implementation plan](https://github.com/spacefast/batuhan-notes/blob/main/internal-docs/agent-native-woocommerce-m1-plan-2026-10-23.md)
  ([PR #3](https://github.com/spacefast/batuhan-notes/pull/3)): prior decisions about PHP integration,
  catalog synchronization, checkout, administration and deployment. Reuse suitable mechanisms;
  this design instead follows TypedPress seed/sync and per-preview SQLite databases.
- [WooCommerce replacement plan](https://github.com/spacefast/batuhan-notes/blob/main/internal-docs/sell-woocommerce-replacement-plan-2026-10-07.md)
  ([PR #4](https://github.com/spacefast/batuhan-notes/pull/4)): earlier managed-commerce architecture,
  native Woo orders and downloads, and the boundary between Woo and the hosting platform.
  Its custom payment bridge and broader replacement scope are not v1 requirements here.
- [Managed-Woo implementation progress](https://github.com/spacefast/batuhan-notes/blob/main/internal-docs/sell-managed-woo-implementation-progress-2026-10-08.md)
  (also PR #4): historical implementation evidence, reusable components and unresolved provider
  integration gaps. Reverify candidate code and its behavior before adopting it.
- [Woo Store SDK](https://github.com/spacefast/woo-store-sdk): existing commerce types, browser
  integrations and the `woo-storefront` checkout/session integration. Evaluate reuse against
  TypedPress's native pages and the selected embedded Woo Checkout Block.
