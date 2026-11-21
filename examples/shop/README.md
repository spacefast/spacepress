# Everyday objects

A native WooCommerce shop created by `typedpress add shop`: a physical mug, a downloadable
field guide, categories and tags, a cart, and Woo's Checkout Block inside the app layout.

```sh
typedpress dev examples/shop --port 8873
```

Open `/shop`. `tp/shop.ts` declares EUR prices, Poland/Germany shipping and cash on delivery.
The first install seeds the catalog. Later builds preserve merchant edits, stock and orders;
run `typedpress sync examples/shop --site <url>` to merge file and merchant edits explicitly.
Stock and orders remain in Woo administration. Download links use native Woo permissions;
COD does not mark a digital order paid automatically.

The browser cart calls Woo's same-origin Store API with its cookie and rotating nonce.
Checkout and receipts use full-page navigation so Woo owns payment validation and scripts.
A storefront on another origin, or one that sets no cookies, uses the same client with
Woo's `Cart-Token` session. [Carts without cookies](../../docs/woocommerce.md#carts-without-cookies)

To rerun the full Playground proof (PHP 8.4, WordPress 7.2-beta5, SQLite 3.1.2, Woo 11.3.0):

```sh
cargo build
cargo test --test commerce
cd docs-site
pnpm install
pnpm exec playwright install chromium
pnpm exec node --test tests/playground/commerce.test.ts
```

`CHROME_CHANNEL=chrome` selects an installed Chrome instead. The proof creates a disposable
site, captures mail without sending it, and adds a test-only gateway to exercise payment
decline/retry and paid downloads. It also buys through stock COD, fills a cookieless cart
from a second origin and takes it through both checkouts, drives the real sync CLI, and
checks desktop and mobile layouts. It does not charge money or deploy a live store.

Spacefast deployment still needs the [host upgrade](../../docs/spacefast-host-checklist.md).
A commerce site requires a table prefix of at most 20 characters, isolated preview databases,
Woo callbacks and `wp_mail`, and no shared caching for the Store API, cart or checkout.
