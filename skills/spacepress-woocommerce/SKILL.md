---
name: spacepress-woocommerce
description: "Use when adding or configuring a native WooCommerce storefront in a SpacePress project: scaffolding with spacepress add shop, declaring store(), product(), productCategory(), productTag(), order(), shipping zones, and optimistic cart hooks."
compatibility: "Targets SpacePress 0.3 (WordPress 7.1+, PHP 8.2+). Requires the `spacepress` CLI and Node.js 22+."
---

# Configure a WooCommerce storefront

## When to use

- Adding e-commerce (products, categories, shipping zones, payments, orders, cart) to a SpacePress project.
- Wiring optimistic cart hooks into a frontend or `"use client"` island.

## Inputs required

- Store currency, base country, allowed selling countries, shipping methods, and payment gateways.
- Whether products are authored in Markdown (`sync: "content/products/*.md"`) or managed in WordPress Admin.

## Procedure

1. For a project without a shop yet, scaffold the starter storefront module:

   ```bash
   spacepress add shop
   ```

2. Declare the store and catalog builders in a file under `sp/` (for example `sp/shop.ts`):

   ```ts
   // sp/shop-example.ts
   import { store, product, productCategory, productTag, order } from "spacepress/commerce";

   export const storefront = store({
     currency: "USD",
     country: "US",
     sellTo: ["US", "CA"],
     shipping: [
       {
         name: "North America",
         countries: ["US", "CA"],
         methods: [
           { type: "flatRate", title: "Standard", cost: "9.00" },
           { type: "freeShipping", title: "Free over 100", minimum: "100.00" },
         ],
       },
     ],
     payments: ["cod"],
   });

   export const catalogProducts = product({ sync: "content/products/*.md" });
   export const catalogCategories = productCategory();
   export const catalogTags = productTag();
   export const catalogOrders = order();
   ```

3. When the project has pages under `sp/app/`, add a public `sp/app/checkout/page.md` containing WooCommerce's native Checkout Block (required by the compiler whenever `store()` and `sp/app/` are both present):

   ```md
   <!-- sp/app/checkout/page.md -->
   ---
   title: Checkout
   robots: { index: false, follow: false }
   ---
   <!-- wp:woocommerce/checkout -->
   <div class="wp-block-woocommerce-checkout alignwide wc-block-checkout is-loading"></div>
   <!-- /wp:woocommerce/checkout -->
   ```

4. Run `spacepress build` to emit the native WooCommerce setup and generated cart client (`sp/_generated/client/commerce.ts`, `cart-store.ts`, `cart-react.ts`).

5. In React frontends, call `createCartHooks(React)` from the generated cart module for optimistic `useCart()` and `useCartCount()` updates with automatic rollback on error.

## Verification

Run `spacepress check` and `spacepress build`, then boot `spacepress dev` and verify products and orders appear in WordPress Admin and the generated storefront pages render cleanly.

## Failure modes / debugging

- **Missing generated cart files:** Ensure `store()` is exported from a module under `sp/` or `spacepress.config.ts` and re-run `spacepress build`.
- **Invalid currency or country codes:** Use ISO-4217 currency codes (`USD`, `EUR`) and ISO-3166 alpha-2 country codes (`US`, `DE`).

## Escalation

Read `www/content/docs/integrations/woocommerce.md` via `docs_read`. Never commit live payment gateway secrets into TypeScript files; ask the user to configure live payment credentials in WordPress or environment secrets.
