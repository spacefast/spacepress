---
uid: zr_989fad54379af473492f
title: Astro & Generated Typed Clients
description: Connect external React, Next.js, Vite, or Astro frontends to a SpacePress backend.
order: 4
status: published
publishedAt: 2026-11-21T09:12:00.000Z
---
## Generated TypeScript client & React hooks

Every build emits a typed client to `tp/_generated/client/`:

- `index.ts` — `createClient({ url })` for CRUD queries, pagination, live subscriptions, and typed server actions. Kind, action and global calls run the app's WordPress Abilities at core's run route; `url` is the site's REST root (`https://example.test/wp-json`). On a page SpacePress renders, `createClient()` reads the site's REST root and a signed-in visitor's nonce from the page; elsewhere it sends an application password, a TypedPress Identity Bearer token, or the cookie nonce you give it.
- `react.ts` — `createHooks(React)` returning `useQuery()` and `useMutation()` (with `optimistic` updates and rollback) for React 18+ or Preact without bundling React into SpacePress.

## `@typedpress/astro`

For Astro 7+ sites, install `@typedpress/astro`:

- `tpLoader(kind, opts)` — build-time Astro Content Layer loader with relation and media expansion.
- `tpLiveLoader(kind, opts)` — live on-demand loader returning `cacheHint.tags` (`<kind>`, `<kind>:<id>`).
- `tpWebhook(opts)` — Astro API route handler verifying `TypedPress-Signature` HMAC headers and invalidating cache tags automatically.

Set `frontend: "https://your-astro-site.com"` in `defineConfig()` so WordPress permalinks, previews, and feeds point to your Astro deployment.
