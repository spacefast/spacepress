# `@typedpress/astro`

Use a **SpacePress** (`spacepress.dev`) WordPress backend as the content source for an **Astro 7+** site — with build-time and live Content Layer loaders, automatic cache tags, signed webhook invalidation, and EmDash integration.

## Requirements

- **Node.js >= 22.23.4**
- **Astro >= 7.4.0 < 8**

## Installation

```bash
npm install @typedpress/astro
```

## Configuration

Set environment variables (or pass options directly to each loader):

- `TP_URL` — your SpacePress site URL (e.g. `https://cms.example.com`)
- `TP_APP_PASSWORD` — optional `user:application-password` for Basic auth (needed for drafts/private kinds)
- `TP_TOKEN` — optional SpacePress Identity bearer token
- `TP_WEBHOOK_SECRET` — shared secret matching `webhooks[].secret` in `typedpress.config.ts`

In your SpacePress project's `typedpress.config.ts`, set `frontend: "https://your-astro-site.com"` so WordPress permalinks, previews, and feeds point to your Astro site.

## Build-Time & Live Content Collections

```ts
// src/content.config.ts
import { defineCollection } from "astro:content";
import { tpLoader, tpLiveLoader } from "@typedpress/astro";

export const collections = {
  // Fetched at build time with media & relation expansion
  docs: defineCollection({
    loader: tpLoader("docs", {
      where: { status: "published" },
      with: { parent: true },
    }),
  }),

  // Fetched live per request; returns cacheHint.tags (<kind>, <kind>:<id>)
  posts: defineCollection({
    loader: tpLiveLoader("posts", {
      rendered: "entries",
      with: { cover: true },
    }),
  }),
};
```

## Signed Webhook Cache Invalidation

Mount `tpWebhook()` as an Astro endpoint to verify `TypedPress-Signature` HMAC-SHA256 headers (with 5-minute replay tolerance) and purge matching cache tags (`<collection>` and `<collection>:<id>`):

```ts
// src/pages/api/tp-webhook.ts
import { tpWebhook } from "@typedpress/astro";

export const POST = tpWebhook({
  onEvent: async ({ tags, event }) => {
    console.log("Invalidated tags:", tags, event.event);
  },
});
```

## Additional Exports

- `connect(options)` — shared low-level HTTP client (`request`, `describe`)
- `verifySignature(secret, header, body)` & `eventTags(event)` — manual webhook verification helpers
- `TypedPressError` — structured API error class (`status`, `code`, `detail`, `pointer`)
- `@typedpress/astro/emdash` — integration adapter for running EmDash templates against a SpacePress backend

## License

MIT
