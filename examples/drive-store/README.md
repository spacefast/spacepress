# Drive Store

A used hard-drive shop with native WooCommerce products, inventory, cart, checkout, and orders. The example uses cash on delivery and one US shipping zone.

| Where | What to try |
| --- | --- |
| `/` | Browse the catalog and filter by media or condition |
| `/drives/seagate-exos-x16` | Read the typed specs, test date, Woo category and tag, watch live stock, add a drive to the Woo cart, or leave a review after signing in |
| `/cart`, `/checkout` | Edit quantities in the generated cart client and place an order in Woo's Checkout Block |
| `/staff` | Restock products, view the stock-movement log, and mark processing orders shipped |
| `/wp-admin/new/` | Edit product specs, review shipping orders, and change the storefront notice |
| `/source` | Browse the project sources after building the source viewer |

## Run the shop

```sh
typedpress dev examples/drive-store --port 8931
```

Woo seeds the catalog from [Markdown](content/drives), with its product categories and tags from [`content/drive-categories`](content/drive-categories) and [`content/drive-tags`](content/drive-tags). Sign in to the local site as an administrator and open `/staff/`. Restock a drive, then test checkout in a signed-out browser. Woo owns stock and orders. `typedpress sync examples/drive-store --site <url>` syncs product specs and catalog content.

To build the optional source viewer, run the following from this directory with Bun 1.4 or later.

```sh
bun install --frozen-lockfile
bun run build:source
```

## Verify the shop

```sh
cargo test --test app_router drive_store_example_sells_on_wordpress -- --nocapture
cargo test --test commerce
cd docs-site
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm exec node --test tests/playground/commerce.test.ts
```

The Rust test builds Drive Store and serves it on WordPress with SQLite. The PHP assertions cover seeded product specs, categories and tags, date filters, the product feed, stock, review moderation, access rules, the native order lifecycle including a restocking refund, input checks on the stock ability, and what a scoped agent credential is offered and may run. The Playground suite also creates a fresh `typedpress add shop` scaffold to test the generator. Its Drive Store test uses the browser cart and completes Woo checkout.

Set `TP_DRIVE_PROFILE` to an absolute path when running the Drive Store Rust test to collect its profile. For each named request state, the script skips one warm-up GET and records the median of the following five GETs. The report includes time, bytes, included PHP files, WordPress and TypedPress SQL statements, and TypedPress joins to WordPress postmeta.
