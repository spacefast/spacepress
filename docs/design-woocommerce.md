# WooCommerce support in TypedPress

Date: 2026-11-16. Status: draft for discussion.

## Goal and scope

An agent builds a TypedPress application, adds commerce, and deploys it on Spacefast.
TypedPress provides the authoring and typed API; WooCommerce supplies the commerce runtime.
The immediate target is TypedPress on Spacefast. A separate Astro commerce product,
standalone distribution milestone, or open-source release plan is not part of this work.

The proposed v1 store sells simple physical products through an interactive TypedPress
storefront backed by Woo. Downloadable products are proposed for deferral; confirm that scope
before implementation. Checkout presentation is an open decision, not a requirement to leave
the TypedPress experience. Products, inventory, carts, orders and payment processing remain
native Woo objects. TypedPress must use Woo's APIs rather than maintain a second commerce
database or write directly to Woo tables.

## Product ownership

Static definitions and database storage are compatible: source files can describe products,
and Woo stores the resulting records. The decision is which surface owns subsequent edits.

**Decision:** products use the existing seed and explicit `typedpress sync` model. Deployment
creates missing products and preserves existing products; sync reconciles subsequent file and
Woo edits, reporting conflicting changes. Products remain editable through authorized APIs
and Woo administration. A deployment-only ownership mode is not required for this integration.

Products follow collection seed/sync behavior without becoming ordinary TypedPress collections.
Collection writes use WordPress post APIs; product writes must use Woo CRUD. Markdown is the
default product authoring format, with structured front matter and the description in the body.
Exact configuration syntax and field names remain to be finalized.

Sync covers authored fields such as names, descriptions, prices and taxonomy assignments.
Stock quantities, sales counters and orders are operational state, not synced
content. Configure inventory through Woo administration initially; source files contain neither
current nor initial stock quantities.

### Proposed v1 product field list

Keep the initial writable and synced catalog surface small. This is the complete proposed list,
not just the fields shown in a minimal example:

| Field | Purpose |
| --- | --- |
| `uid` | Required persistent source identity; immutable |
| `name` | Product name |
| `slug` | Optional editable URL slug; Woo derives it on creation when absent |
| `sku` | Optional merchant SKU, independent of identity |
| `status` | `draft`, `pending`, `private` or `publish`; new products default to draft |
| Markdown body | Full product description |
| `shortDescription` | Optional short description |
| `regularPrice` | Exact decimal price in the store currency |
| `images` | Ordered project-relative image paths with optional alt text; first image is primary |
| `categories` | Product category UIDs |
| `tags` | Product tag UIDs |

Products created through this interface are simple physical products. A source file supplies
`uid` and `name`; a product offered for sale needs a valid price. Exact required-field validation
for unpublished drafts follows Woo. Reuse existing sync omission/clearing semantics rather
than invent an independent field-ownership mode.

Defer `backorders`, `manageStock`, stock quantity, initial stock, `soldIndividually`, weight,
dimensions, shipping class, tax class, catalog visibility controls and featured products from
the writable/synced API. Sale pricing is also deferred: no `salePrice`, sale schedules or
sale-specific storefront features in v1. Omitted settings remain available in Woo administration
and are preserved on sync except for the explicitly disabled capabilities below. Newly created
products use Woo's normal defaults for other omitted settings.
Read projections still expose current price, purchasability and availability so the storefront
reflects Woo's actual state. Cart quantities, shipping rates and totals continue to be validated
and calculated by Woo; omitting shipping dimensions from source does not remove checkout shipping.

### Disabled capabilities in v1

**Decision:** disable coupons, product reviews and star ratings, Woo customer signup,
backorders and Woo tax calculation on the TypedPress commerce store. Keep guest checkout,
stock management, shipping and order emails available.

Use native Woo options and behavioral filters rather than only hiding controls:

- Coupons: `woocommerce_enable_coupons = no` and the `woocommerce_coupons_enabled` filter.
- Reviews/ratings: `woocommerce_enable_reviews = no` and `woocommerce_enable_review_rating = no`.
- Customer signup: disable checkout registration, My Account registration and delayed account
  creation; keep `woocommerce_enable_guest_checkout = yes`. This does not disable TypedPress
  identity or merchant sign-in.
- Backorders: set supported products to disallow backorders and enforce
  `woocommerce_product_backorders_allowed = false` for them. Verify existing `onbackorder`
  stock states and quantity validation; the filter alone must not be treated as stock repair.
- Taxes: `woocommerce_calc_taxes = no` and `wc_tax_enabled = false`. Woo must not calculate or
  add tax to new carts/orders in v1.

These are enforced v1 restrictions, not initial defaults merchants can inadvertently re-enable
through Woo settings. Settings UI must reflect the restrictions. Scope enforcement to the
TypedPress commerce store; preserve historical order amounts, tax lines and coupon lines.
Keep sale-price enforcement as a separate open implementation question: Woo has no equivalent
single sale-pricing disable switch.

## Sync integration

Extend the [existing seed/sync contract](config-api.md#seeding-and-typedpress-sync) to Woo
products and taxonomies: seed missing records, preserve runtime edits during deployment, merge
explicit sync changes and report conflicts. Missing files do not imply deletion. Reuse
[seed compilation](../src/bundle.rs), [seed execution](../runtime/TypedPress/Sync/Seed.php)
and the [record policy](../runtime/TypedPress/Sync/Routes.php) where compatible, with Woo CRUD
as the product writer. This support is new work, not an existing Woo integration.

### Source files and an example

**Decisions:** each product and term file carries a persistent explicit UID. Category and tag
references use those UIDs, never numeric WordPress IDs. Renaming a file, SKU or slug preserves
its UID. Use the existing per-field merge, baseline and conflict workflow; do not introduce a
second baseline store or a commerce-specific sync command.

For images, the proposed reference is a path relative to the project root, such as
`assets/products/ceramic-mug.jpg`, not relative to the product file and not an attachment ID.
Moving the product file therefore does not change its image reference. The asset pipeline resolves
the path to a media record on each target store. Pulling an image added in Woo needs to materialize
a local asset and write its portable path; exact naming and replacement behavior remain open.

Example project layout:

```text
content/
  products/ceramic-mug.md
  product-categories/home.md
  product-tags/handmade.md
assets/products/ceramic-mug.jpg
```

Proposed `content/products/ceramic-mug.md` (field names are illustrative; this is not implemented):

```md
---
uid: zr_8b3e7c9d2a104f65b012
name: Ceramic mug
slug: ceramic-mug
sku: MUG-BLUE
status: publish
regularPrice: "24.00"
categories:
  - zr_15a702bc4d8e6390fa12
tags:
  - zr_6c9d201e4a7b8350fd12
images:
  - path: assets/products/ceramic-mug.jpg
    alt: Blue ceramic mug
---
A handmade ceramic mug for your morning coffee.
```

Price uses the store's configured currency. The UID is opaque, persisted in the file and
independent of the file's name. For example, renaming this file to `blue-mug.md` must still
update the same product. No current stock quantity belongs in this synced document.

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

- Changing `regularPrice` in the file and syncing updates that Woo product.
- Editing its description in Woo and syncing brings the description into the Markdown body.
- Changing the same field differently in both places reports a conflict through existing sync.
- Removing a file does not delete its Woo record.

Different stores may assign different internal product, term and media IDs. These source files
and references remain the same on both stores.

## Proposed minimum commerce API

Product CRUD is the catalog foundation, but does not by itself provide a buying flow. The
initial API also needs shopper cart operations and checkout, plus authorized order reads
for application dashboards. These are proposed boundaries; names below are illustrative.

| Resource | Initial operations | Data contract |
| --- | --- | --- |
| Products | List, get, create, update, trash; seed and sync | The v1 field list above; reads additionally expose native runtime ID, current price, purchasability and availability |
| Categories and tags | Existing taxonomy/terms API, extended to bind Woo taxonomies and support product relationships | Native term ID, stable source identity, name, slug; categories also have a parent. No separate commerce category/tag CRUD API |
| Cart | Read current cart, add item, change quantity, remove item, update destination, choose shipping rate | Session-scoped lines, current prices, availability, discounts, shipping choices, taxes, fees and Woo-calculated totals |
| Checkout | Complete the current cart through Woo; presentation to be selected by a spike | Session continuity, address and shipping validation, supported payment integration, order result and receipt |
| Orders | Authorized list/get, including line and refund details | Status, currency, timestamps, historical line items, totals, billing/shipping snapshots, optional customer reference, payment method label and refund summaries |
| Store information | Read safe configuration and supported capabilities | Currency precision, display conventions, measurement units, supported product types and whether checkout is available; no gateway secrets |

Use simple physical products for the proposed first proof. Virtual and downloadable are independent
Woo flags, not mutually exclusive product types; their authoring and fulfillment are outside that
proof. Reject unsupported variable, grouped, external or extension-defined
product writes explicitly. Read projections should identify unsupported types without pretending
they are simple products. Variation authoring and sync are deferred.

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

Images use the existing media pipeline. Protected file ingestion, download grants, file retention
and downloadable-product fulfillment are proposed follow-up scope, not v1 acceptance gates.
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
  materialize/persist the UID before relying on moves, with the exact authoring step to be defined.
  SKU and slug remain editable attributes, not identity. Image references use portable source
  assets resolved to local media IDs; numeric attachment IDs must not leak into portable files.
  Export/sync must convert runtime references back to stable source references and report missing
  mappings rather than copy raw IDs. Test one source catalog on two stores with different IDs.
- **Lists:** bounded pagination and explicit supported filters. Product filters include status,
  search, category, tag and availability; order filters include date range, status and customer.
  Use deterministic ordering. Do not imply arbitrary SQL joins or the complete `db` query language.
- **States:** preserve Woo order statuses, including extension-defined values. An order status
  is not a generic payment or shipment status; expose native facts without inventing equivalences.
- **Metadata:** no wholesale Woo metadata dump. Add explicitly typed extension fields when needed.

### Access boundaries

Public product projections contain only storefront-visible data. Merchant product reads may also
contain drafts and inventory details. Order lists and customer addresses require
merchant authorization; a public page cannot obtain them by calling a server-side helper.
Shopper carts belong to their session, and receipts require Woo's ownership/order authorization.
Keep credentials and handoff-signing secrets on the server.

Expose these operations through TypedPress's existing action, permission and client mechanisms
where possible. Native Woo CRUD should run in-process on the server; a loopback REST request
and a second set of merchant API credentials are unnecessary for local operations.

### Dashboard scope

Order lists/details, refund reads and product inventory reads are enough for an initial operational
dashboard. Sales charts require a later bounded reporting API with defined timezone, currency,
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

Represent commerce enablement, supported operations and product sync sources in TypedPress. Exact API
names and the product-file format are not decided. Emit the required Woo capabilities through
the existing hosted manifest rather than introduce a separate application deployment system.

Hosted source capture currently rejects app-declared WordPress plugins. Local plugin ZIP
support therefore does not establish hosted Woo support. Extend host requirements and
Spacefast provisioning together; keep the tested plugin set controlled by the host.

### PHP runtime and typed APIs

Provide typed product reads and authorized mutations backed by
Woo CRUD. Keep merchant operations separate from public shopper reads, carts and checkout.
Do not adopt Woo tables through `existingTable` or mirror products and orders into `table()`.

Use the existing Woo Store SDK and checkout integration where compatible with TypedPress pages
and client components. Full Woo PHP class bindings and a new frontend framework adapter are
not prerequisites for the first store.

### Host lifecycle

Provision and initialize Woo before commerce readiness. Verify database and cache scope,
plugin load order, scheduled jobs, checkout routes, Store API routes, gateway callbacks,
assets, cookies and merchant administration on Spacefast.

The [Spacefast host checklist](spacefast-host-checklist.md) records the existing compiler and
runtime integration gap. Its upgrade and Woo integration need a coordinated implementation;
the local source review does not establish the current production deployment state.

### Checkout presentation

TypedPress's [client bindings](pages.md#client-components) make an interactive product page,
mini-cart and cart feasible within the application. They do not automatically implement Woo's
payment-method registration, validation, payment events or gateway browser assets. Woo's
[Checkout Block](https://developer.woocommerce.com/docs/block-development/extensible-blocks/cart-and-checkout-blocks/how-checkout-processes-an-order/)
and [payment integration contract](https://developer.woocommerce.com/docs/block-development/extensible-blocks/cart-and-checkout-blocks/checkout-payment-methods/payment-method-integration/)
own behavior beyond rendering reactive fields.

Spike two in-app presentation options: render Woo's native Checkout Block within the TypedPress
page/layout, or author the form with TypedPress bindings over the Store API and a deliberately
supported gateway integration. The first is the recommended starting investigation because it
can preserve existing gateway UI; embedding and asset loading still need verification. A separate
native checkout page remains a fallback, not a fixed product requirement.

Compare session continuity, address/shipping recalculation, payment validation, decline/retry,
authentication redirects, receipt rendering and navigation/remount behavior. Interactivity API
bindings alone are not evidence of Checkout Block or arbitrary gateway compatibility. Keep Woo
authoritative for totals, payment processing and orders whichever presentation is chosen.
Use a dummy gateway for the first proof and a stock gateway for the pilot. Custom managed
payments are deferred. Use Woo's default emails initially; custom email authoring is follow-up.

## Decisions still needed

- **Product sync details:** confirm the proposed v1 field list above; implement Woo conflict
  detection through the existing baseline and merge contract.
- **Source authoring details:** how new files receive their required persistent UIDs; confirm
  project-relative image paths and define pulled-image naming and replacement behavior.
- **Checkout presentation:** choose after the in-app block versus custom-form spike.
- **V1 product scope:** confirm the proposed physical-only proof and downloadable-product deferral.
- **Removal:** explicit retirement and reintroduction. Prefer retirement over destructive
  deletion, but settle this separately from
  current sync's no-delete behavior. Preserve order history.
- **Activation and rollback:** source changes apply through explicit sync; code rollback must
  not silently roll back the catalog. Define partial-sync retry and first-seed failure handling.
- **Previews:** previews must not alter the live catalog or enable test purchases against live
  operational data. Choose read-only previews or an isolated staging store.
- **Permissions and administration:** who can manage products and read orders, how TypedPress
  identities map to Woo capabilities, and which native admin surfaces the integration supports.
- **API scope:** confirm the proposed resource table, especially inventory
  mutations, order detail depth and the first dashboard's reporting needs.
- **Follow-up assets and emails:** when downloads are added, define protection, retention and
  replacements; decide custom email authoring separately from v1 Woo default emails.

## First implementation proof

Under the proposed physical-only scope, build one TypedPress example on Spacefast. Prove product
and taxonomy creation and repeat deployment, live product reads, quantity changes, shipping,
cart continuity, the selected checkout presentation and a real dummy-gateway Woo order.

Prove file-to-Woo updates, Woo-to-file updates, conflicting edits, preserved stock and orders,
partial-sync retry, removal behavior and preview isolation. Verify authorized order reads and
refusal of unauthorized reads. Then qualify the stock gateway with a payment and refund. Compatibility claims
must come from those flows, not merely successful plugin installation.

Verify that coupons cannot be applied, reviews/ratings and customer signup are disabled,
guest checkout works, insufficient tracked stock cannot be backordered, and new checkout totals
contain no calculated tax. Historical order reads must remain unchanged by these restrictions.

Variations, subscriptions, bookings, customer-account flows, a new commerce dashboard and custom
payment infrastructure are deferred. Downloads and custom email templates are proposed follow-up
scope. Reuse native product operations and existing checkout integration where they fit the
selected presentation; no catalog-wide source ownership restriction is needed.
