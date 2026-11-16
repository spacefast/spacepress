# WooCommerce support in TypedPress

Date: 2026-11-16. Status: draft for discussion.

## Goal and scope

An agent builds a TypedPress application, adds commerce, and deploys it on Spacefast.
TypedPress provides the authoring and typed API; WooCommerce supplies the commerce runtime.
The immediate target is TypedPress on Spacefast. A separate Astro commerce product,
standalone distribution milestone, or open-source release plan is not part of this work.

The initial store should sell a downloadable product and a simple physical product through
native Woo checkout. Products, inventory, carts, orders, payment processing and download
permissions remain native Woo objects. TypedPress must use Woo's APIs rather than maintain
a second commerce database or write directly to Woo tables.

## Product ownership

Static definitions and database storage are compatible: source files can describe products,
and Woo stores the resulting records. The decision is which surface owns subsequent edits.

**Decision:** products use the existing seed and explicit `typedpress sync` model. Deployment
creates missing products and preserves existing products; sync reconciles subsequent file and
Woo edits, reporting conflicting changes. Products remain editable through authorized APIs
and Woo administration. A deployment-only ownership mode is not required for this integration.

Products follow collection seed/sync behavior without becoming ordinary TypedPress collections.
Collection writes use WordPress post APIs; product writes must use Woo CRUD. Public syntax and
the exact product-file format remain open.

Sync covers authored fields such as names, descriptions, prices and download declarations.
Stock quantities, sales counters, orders and download grants are operational state, not synced
content. An optional initial stock value is create-only and must never reset stock on sync.

## Existing seed and sync behavior

Collections currently declare source files through `sync`, not a separate `seed` option:

```ts
export const posts = collection(
  { title: text(), content: richText() },
  { sync: "content/posts/*.md" },
);
```

The compiler packages synced files as seed records. The hosted loader applies them while
initializing a new build, before recording readiness. An already-ready build returns its
stored receipt without applying seed again.

| Source and database state | Collection seed | Table seed |
| --- | --- | --- |
| Record is missing | Create | Create |
| Existing record matches | Leave unchanged | Leave unchanged |
| Existing record differs | Preserve database content; report `skipped_existing` | Apply source values |
| Record is trashed | Leave trashed | Leave trashed |
| Source file disappears | Keep database record | Keep database record |

Records have stable UIDs; the compiler derives an identity when a file does not supply one.
Seed applies each collection in its own transaction, not the whole build in one transaction.

`typedpress sync` is a separate operation. It reconciles files and database content per field,
using a sync baseline and reporting conflicts where both sides changed the same field.
It does not delete records merely because files disappear.

For existing collections, deployment followed by sync can therefore create records and apply
source changes when there are no conflicting runtime edits. This gives the desired data result,
but does not enforce source ownership. Products do not participate in this mechanism yet.

Implementation references:

- [Seed compilation](../src/bundle.rs): `seed_records`.
- [Hosted initialization](../runtime/wp-plugin/typedpress-loader.php): `Loader::initialize`.
- [Seed execution](../runtime/TypedPress/Sync/Seed.php).
- [Per-record seed policy](../runtime/TypedPress/Sync/Routes.php): `seedRecord`.
- [Current sync contract](config-api.md#seeding-and-typedpress-sync).

## Proposed minimum commerce API

Product CRUD is the catalog foundation, but does not by itself provide a buying flow. The
initial API also needs shopper cart operations and hosted checkout, plus authorized order reads
for application dashboards. These are proposed boundaries; names below are illustrative.

| Resource | Initial operations | Data contract |
| --- | --- | --- |
| Products | List, get, create, update, trash; seed and sync | Stable source identity and Woo ID, SKU, slug, name, descriptions, status, visibility, simple product type, virtual/downloadable flags, prices, images, stock configuration and availability, shipping dimensions, protected download declarations |
| Categories and tags | Existing taxonomy/terms API, extended to bind Woo taxonomies and support product relationships | Native term ID, stable source identity, name, slug; categories also have a parent. No separate commerce category/tag CRUD API |
| Cart | Read current cart, add item, change quantity, remove item, update destination, choose shipping rate | Session-scoped lines, current prices, availability, discounts, shipping choices, taxes, fees and Woo-calculated totals |
| Checkout | Obtain a native checkout handoff for the current cart | Hosted URL and session continuity; Woo collects payment and creates the order |
| Orders | Authorized list/get, including line and refund details | Status, currency, timestamps, historical line items, totals, billing/shipping snapshots, optional customer reference, payment method label and refund summaries |
| Store information | Read safe configuration and supported capabilities | Currency precision, display conventions, measurement units, supported product types and whether checkout is available; no gateway secrets |

Use simple products initially. Virtual and downloadable are independent Woo flags, not mutually
exclusive product types. Reject unsupported variable, grouped, external or extension-defined
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

This requires extending current support: taxonomies presently create TypedPress-owned names,
`terms()` attaches to supported collections, and taxonomy `sync` is not implemented. Product
sync must resolve stable term references and report missing or conflicting terms; it must not
silently create terms from names. Decide whether first-release term definitions use shared
taxonomy seed/sync or an explicit term-creation step before product sync. A collection may
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

Images use the existing media pipeline. Private downloadable files need a protected upload and
reference boundary with Woo-owned grants; they must not become ordinary public media URLs.
The initial buyer receipt and download experience can remain in native Woo checkout and email.
Coupon application may remain in hosted checkout; coupon CRUD and custom promotion engines are
deferred. Shipping and tax settings remain in Woo administration; carts expose calculated results.

### Shared value types and query contracts

- **Money:** exact decimal strings with currency and precision at the containing resource;
  never floating-point arithmetic. Normalize Store API minor-unit strings at the adapter boundary.
  Preserve Woo's tax-inclusive/exclusive display semantics and calculated totals.
- **Identity:** stable source keys for sync, native Woo IDs for runtime relations. Renames must
  not create duplicates; source identity is distinct from an editable SKU or slug.
- **Lists:** bounded pagination and explicit supported filters. Product filters include status,
  search, category, tag and availability; order filters include date range, status and customer.
  Use deterministic ordering. Do not imply arbitrary SQL joins or the complete `db` query language.
- **States:** preserve Woo order statuses, including extension-defined values. An order status
  is not a generic payment or shipment status; expose native facts without inventing equivalences.
- **Metadata:** no wholesale Woo metadata dump. Add explicitly typed extension fields when needed.

### Access boundaries

Public product projections contain only storefront-visible data. Merchant product reads may also
contain drafts, private assets and inventory details. Order lists and customer addresses require
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

### Checkout and delivery

Keep native Woo checkout and its order lifecycle. Use a dummy gateway for the initial test
purchase, followed by a tested stock gateway for a live-store pilot. Custom managed payments
are deferred.

Purchased files must remain outside public build output and be delivered through Woo's
authorization. Email templates can be authored with the app, with order details and authorized
download links bound at runtime. File replacement and historical download access need an
explicit policy before implementation.

## Decisions still needed

- **Product sync contract:** file format, field allowlist, stable identity, baseline storage and
  Woo conflict detection. Reuse the current sync behavior rather than introduce a second command.
- **Identity and removal:** stable product keys, file renames, missing definitions and
  reintroduction. Prefer retirement over destructive deletion, but settle this separately from
  current sync's no-delete behavior. Preserve order history and purchased-file access.
- **Activation and rollback:** source changes apply through explicit sync; code rollback must
  not silently roll back the catalog. Define partial-sync retry and first-seed failure handling.
- **Previews:** previews must not alter the live catalog or enable test purchases against live
  operational data. Choose read-only previews or an isolated staging store.
- **Permissions and administration:** who can manage products and read orders, how TypedPress
  identities map to Woo capabilities, and which native admin surfaces the integration supports.
- **API scope:** confirm the proposed resource table, especially taxonomy support, inventory
  mutations, order detail depth and the first dashboard's reporting needs.
- **Private assets and emails:** authoring format, upload ownership, retention, replacements
  and supported native email overrides.

## First implementation proof

Build one TypedPress example with an ebook and a physical product on Spacefast. Prove product
creation and repeat deployment, live product reads, quantity changes, shipping, cart continuity,
native checkout, a real dummy-gateway Woo order and an authorized download. Anonymous direct
access to the purchased file must fail.

Prove file-to-Woo updates, Woo-to-file updates, conflicting edits, preserved stock and orders,
partial-sync retry, removal behavior and preview isolation. Verify authorized order reads and
refusal of unauthorized reads. Then qualify the stock gateway with a payment and refund. Compatibility claims
must come from those flows, not merely successful plugin installation.

Variations, subscriptions, bookings, customer-account flows, a new commerce dashboard and custom
payment infrastructure are deferred. The first implementation should reuse the existing
checkout handoff, native product operations and private-file handling where suitable, without
bringing along assumptions that every catalog must be source-managed.
