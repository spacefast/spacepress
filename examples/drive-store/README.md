# Drive Store

A used hard-drive shop: a storefront that renders on WordPress, a custom backend of kinds, hooks
and actions, and TypedPress Admin for the staff. It puts most of TypedPress in one app. Nothing is for sale:
the Buy button places a fake order, takes no payment and ships nothing, and the pages say so.

| What | Where | How |
| --- | --- | --- |
| Inventory | [`tp/schema.ts`](tp/schema.ts) `drives` | A `collection()`: WordPress posts with drafts and revisions, a page at `/drives/:slug` (`url`) |
| Orders and the stock log | `orders`, `stockMovements` | `table()` kinds with `ref()`s to drives and orders. An order's read rule is coded: staff read every order, a customer reads their own |
| The shop's rules | `drives` and `orders` hooks | `beforeCreate` prices an order from the drive and refuses more than is in stock; `afterCreate` takes the stock down and logs it; a price has two decimals at most. They hold on every path: the storefront, the API, TypedPress Admin and wp-admin |
| Shop settings | `shop` | A `global()`: shop name, currency, a notice banner and the low-stock threshold, edited in TypedPress Admin |
| Actions | [`tp/server.ts`](tp/server.ts) | `buy` (anyone), `restock` and `markShipped` (editors and admins). Each is also a WordPress Ability and an MCP tool |
| Storefront | [`tp/app/`](tp/app) | TSX pages compiled to PHP: the catalog with search and filters, a product page, My orders and a staff page |
| Forms without JavaScript | product and staff pages | `<form action={buy}>` posts to the action and comes back with `useFormState`: the order code, or the refusal |
| Reviews | product page | `comments: true` on `drives` and `<Comments for={item} />`: signed-in customers only, a first review is held for moderation |
| Live stock | product page | `<Live id="stock">` updates the stock line in place when someone buys |
| Guards | `tp/app/orders/layout.tsx`, `tp/app/staff/layout.tsx` | `guard = "authenticated"` and `guard = "editor"` |
| RSS | layout | WordPress's own feed of the post type, `/?feed=rss2&post_type=tp_drives`, linked from every page and in `<head>` |
| Starting stock | [`content/drives/`](content/drives) | Synced Markdown (`sync`): a publish seeds it, and `typedpress sync` loads it into a dev site |
| Styles | [`tp/app/site.css`](tp/app/site.css) | An imported stylesheet with light and dark color tokens |
| Admin | TypedPress Admin at `/wp-admin/new/` | Generated from the kinds: drives (with their reviews), orders, stock movements and the shop settings, each field labelled by its `.ui({ label })` |

## Run it

To include the highlighted source browser, build its assets from this directory:

```sh
bun install --frozen-lockfile
bun run build:source
```

Run `bun run build:source` again before publishing or after editing files shown on `/source`.
The build highlights the files listed in `browser/build.mjs` and writes the previews to `public/drive-source`. Only `/source` loads them.

From the repository root:

```sh
cargo build --release
./target/release/typedpress dev examples/drive-store --port 8931
```

Sign in at `http://localhost:8931/wp-admin/` with `admin` / `typedpress-test-admin` (local development
only). A new dev site has no drives yet. Load the ones in `content/drives/` with `typedpress sync`:

```sh
PW=$(./target/release/typedpress wp --site examples/drive-store user application-password create admin sync --porcelain)
TP_APP_PASSWORD="admin:$PW" ./target/release/typedpress sync examples/drive-store
```

Then open `http://localhost:8931/`:

- `/` is the catalog, with search and filters.
- `/drives/seagate-exos-x16` is a product page. Buy one as a guest; the order code comes back on
  the page and the stock goes down. Ask for more than is left and the order is refused.
- `/source` is a read-only browser for the project's hand-written files.
- `/orders` lists a signed-in customer's own orders. Create a subscriber in wp-admin to try it.
- `/staff` is for editors and admins: ship orders and restock drives that are running low.
- Add and edit drives, moderate reviews and change the shop settings in TypedPress Admin.

Stop it with `typedpress dev stop examples/drive-store`; the site's data is kept for the next start.

## Tests

`cargo test --test app_router drive_store_example_sells_on_wordpress` builds this example, seeds
it from `content/drives/` as a publish does, and uses it on WordPress-on-SQLite the way a browser
with scripts off would ([`tests/php/drive_store.php`](../../tests/php/drive_store.php)): search
and filters, buying and the stock rule, My orders, the staff page and its actions, reviews, the RSS
feed and the settings global.


To compare changes on the same machine, run the integration test once per build with
`TP_DRIVE_PROFILE=/absolute/path/to/report.json`. Each named state gets one warm-up
and five timed GETs against the disposable WordPress site. The report records the
median response time, response bytes, included PHP files, SQL statements
(WordPress plus the separate TypedPress connection), and joins to the WordPress
postmeta table in TypedPress statements. Purchases, reviews, shipping,
and restocking run once in the surrounding functional test. Compare corresponding
states to find where a change adds or removes work.
