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

Two behaviors are under consideration:

- **Runtime-managed:** source files seed products; authorized application or admin operations
  can edit them. An explicit sync reconciles file and database changes.
- **Deployment-managed:** source files own the authored catalog fields. Activating a new
  deployment applies those fields; ordinary application and admin operations can only read them.

The current proposal is to make deployment ownership a shared concept for collections and
products. Products would follow the same ownership rules without becoming ordinary
TypedPress collections. Collection writes use WordPress post APIs; product writes must use
Woo CRUD. Public syntax, defaults and whether both modes ship initially remain open.

Deployment ownership must distinguish authored fields from operational state. Product names,
descriptions, prices and download declarations can be source-owned. Woo still needs to change
stock, sales counters and order-related state during normal operation. An initial stock value
must not reset stock on every deployment.

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

## Proposed deployment ownership contract

Reuse the existing seed/sync identity and serialization mechanisms where they fit. Add an
explicit ownership policy rather than interpreting all seeded content as read-only.

For a deployment-managed resource:

1. The generated TypeScript surface exposes reads and refuses ordinary catalog/content writes.
2. Runtime enforcement also rejects those writes through APIs and admin editing. Type checking
   alone is insufficient; ordinary application handlers must not bypass the policy.
3. The trusted deployment path applies authored fields through the resource's own writer.
4. Admin screens identify the source as the editing surface.
5. Stock and other operational fields remain writable by their owning runtime.

Sharing this behavior does not require one generic storage adapter framework. First identify
which parts of the existing sync implementation can serve both writers without assuming that
Woo products are normal posts or TypedPress tables.

## TypedPress and Spacefast integration

### Configuration and compiler

Represent commerce enablement, supported operations and ownership in TypedPress. Exact API
names and the product-file format are not decided. Emit the required Woo capabilities through
the existing hosted manifest rather than introduce a separate application deployment system.

Hosted source capture currently rejects app-declared WordPress plugins. Local plugin ZIP
support therefore does not establish hosted Woo support. Extend host requirements and
Spacefast provisioning together; keep the tested plugin set controlled by the host.

### PHP runtime and typed APIs

Provide typed product reads and, for runtime-managed catalogs, authorized mutations backed by
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

- **Ownership API and default:** how collections and products select runtime or deployment
  ownership; whether the first release supports both.
- **Sync semantics:** whether deployment-managed content uses a one-way portion of sync;
  how explicit `typedpress sync` behaves for it without writing runtime drift into source.
- **Identity and removal:** stable product keys, file renames, missing definitions and
  reintroduction. Prefer retirement over destructive deletion, but settle this separately from
  current sync's no-delete behavior. Preserve order history and purchased-file access.
- **Activation and rollback:** when source changes reach the shared database, what a partial
  apply leaves behind, and whether promoting an older build reapplies older content. Existing
  ready-build initialization does not re-seed, so rollback cannot rely on it implicitly.
- **Previews:** previews must not alter the live catalog or enable test purchases against live
  operational data. Choose read-only previews or an isolated staging store.
- **Permissions and administration:** who can manage runtime-owned products, how source-owned
  fields appear, and which Woo admin surfaces the initial integration supports.
- **Private assets and emails:** authoring format, upload ownership, retention, replacements
  and supported native email overrides.

## First implementation proof

Build one TypedPress example with an ebook and a physical product on Spacefast. Prove product
creation and repeat deployment, live product reads, quantity changes, shipping, cart continuity,
native checkout, a real dummy-gateway Woo order and an authorized download. Anonymous direct
access to the purchased file must fail.

After choosing ownership semantics, prove source updates, rejected runtime edits where
applicable, preserved stock and orders, partial-apply retry, removal behavior and preview
isolation. Then qualify the stock gateway with a payment and refund. Compatibility claims
must come from those flows, not merely successful plugin installation.

Variations, subscriptions, bookings, customer-account flows, a new commerce dashboard and custom
payment infrastructure are deferred. The first implementation should reuse the existing
checkout handoff, native product operations and private-file handling where suitable, without
bringing along assumptions that every catalog must be source-managed.
