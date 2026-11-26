# `@spacepress/astro`

Use a **SpacePress** (`spacepress.dev`) WordPress backend as the content source for an **Astro 7+** site — with build-time and live Content Layer loaders, automatic cache tags, signed webhook invalidation, and EmDash integration.

## Requirements

- **Node.js >= 22.23.4**
- **Astro >= 7.4.0 < 8**

## Installation

```bash
npm install @spacepress/astro
```

## Configuration

Set environment variables (or pass options directly to each loader):

- `SP_URL` — your SpacePress site URL (e.g. `https://cms.example.com`)
- `SP_APP_PASSWORD` — optional `user:application-password` for Basic auth (needed for drafts/private kinds)
- `SP_TOKEN` — optional SpacePress Identity bearer token
- `SP_WEBHOOK_SECRET` — shared secret matching `webhooks[].secret` in `spacepress.config.ts`

In your SpacePress project's `spacepress.config.ts`, set `frontend: "https://your-astro-site.com"` so WordPress permalinks, previews, and feeds point to your Astro site.

## Build-Time & Live Content Collections

```ts
// src/content.config.ts
import { defineCollection } from "astro:content";
import { spLoader, spLiveLoader } from "@spacepress/astro";

export const collections = {
  // Fetched at build time with media & relation expansion
  docs: defineCollection({
    loader: spLoader("docs", {
      where: { status: "published" },
      with: { parent: true },
    }),
  }),

  // Fetched live per request; returns cacheHint.tags (<kind>, <kind>:<id>)
  posts: defineCollection({
    loader: spLiveLoader("posts", {
      rendered: "entries",
      with: { cover: true },
    }),
  }),
};
```

## Signed Webhook Cache Invalidation

Mount `spWebhook()` as an Astro endpoint to verify `SpacePress-Signature` HMAC-SHA256 headers (with 5-minute replay tolerance) and purge matching cache tags (`<collection>` and `<collection>:<id>`):

```ts
// src/pages/api/sp-webhook.ts
import { spWebhook } from "@spacepress/astro";

export const POST = spWebhook({
  onEvent: async ({ tags, event }) => {
    console.log("Invalidated tags:", tags, event.event);
  },
});
```

## Additional Exports

- `connect(options)` — shared low-level HTTP client (`request`, `describe`)
- `verifySignature(secret, header, body)` & `eventTags(event)` — manual webhook verification helpers
- `SpacePressError` — structured API error class (`status`, `code`, `detail`, `pointer`)
- `@spacepress/astro/emdash` — integration adapter for running EmDash templates against a SpacePress backend

## License

MIT
