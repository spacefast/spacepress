---
uid: zr_9ea0ec70d2a7500a544d
title: WooCommerce Native Storefront
description: Configure WooCommerce stores, products, shipping zones, orders, and optimistic cart hooks in TypeScript.
order: 2
status: published
publishedAt: 2026-11-21T09:10:00.000Z
---
## Scaffolding a storefront

Add a complete WooCommerce storefront to any project with:

```bash
npx spacepress add shop
```

## Declarative store & catalog builders

Export `store()`, `product()`, `productCategory()`, `productTag()`, and `order()` from `sp/shop.ts` (re-exported in `spacepress.config.ts`):

```ts
import { store, product, productCategory, productTag, order } from "spacepress";

export const shop = store({
  currency: "EUR",
  country: "PL",
  sellTo: ["PL", "DE"],
  shipping: [
    {
      name: "Poland",
      countries: ["PL"],
      methods: [
        { type: "flatRate", title: "Courier", cost: "15.00" },
        { type: "freeShipping", title: "Free over 200", minimum: "200.00" },
      ],
    },
  ],
  payments: ["cod"],
});

export const products = product({ sync: "content/products/*.md", url: "/products/:slug" });
export const categories = productCategory({ url: "/shop/:path" });
export const tags = productTag();
export const orders = order();
```

## Optimistic cart client & React hooks

Whenever a project exports `store()`, `spacepress build` emits `commerce.ts`, `cart-store.ts`, and `cart-react.ts` in `sp/_generated/client/`. Call `createCartHooks(React)` to obtain `useCart()` and `useCartCount()` with optimistic item quantity updates and automatic rollback on failure.

If a token cart checkout succeeds and the cart refresh fails, `checkout()` still returns the order. The store sets `stale` until WooCommerce returns the current cart.

A checkout link can import a cart into an empty guest session or refresh an unedited copy of the same cart. Signed-in shoppers and guests with other items keep their existing carts.
