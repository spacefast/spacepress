---
uid: zr_989fad54379af473492f
title: Astro & Generated Typed Clients
description: The generated api references and typed client, how calls reach WordPress, React hooks, and @spacepress/astro.
order: 4
status: published
publishedAt: 2026-11-21T09:12:00.000Z
---
Every `spacepress build` writes two things a frontend can import from `sp/_generated/` (or `<dir>/_generated/` with `defineConfig({ dir })`). Neither contains server code.

| File | What it is | Use it from |
|---|---|---|
| `api.js` / `api.d.ts` | Typed references: `api.<kind>.list(query)`, `api.<kind>.get(id, query)`, `api.actions.<name>`, `api.globals.<name>`, `api.files.<bucket>` | `"use client"` islands with `useLive` and `useMutation` from `"spacepress/react"`, and external React apps |
| `client/` | A dependency-free `fetch` client: `createClient(options)` for kinds, actions, globals, media, revisions, uploads, sign-in and live subscriptions; `react.ts` with `createHooks(React)` | Next.js, Vite, Astro, Node, Bun, Deno, mobile |

## How calls reach WordPress

Each kind's `list`, `get`, `create`, `update`, `delete`, pagination and staged steps, each query and mutation (`client.actions.<name>`), and each global's reads and writes run as one of the app's WordPress Abilities through core's run route:

```text
/wp-json/wp-abilities/v1/abilities/<app>/<name>/run
```

`client.posts.list()` runs `<app>/posts-list`, `client.actions.rate()` runs `<app>/rate`, and a global's `get()` runs `<app>/global-<name>-get`. WordPress checks each ability's input schema, permission and output. Run answers are `private, no-store`.

The app API under `/wp-json/spacepress/v1/` carries the rest: `count()` and live subscriptions, media, revisions, soft-delete `restore` and `purge`, `auth.me()`, uploads, file downloads, sign-in, the schema, and every call on a kind that has no abilities, such as a taxonomy. Route all of `/wp-json/*` to WordPress and never cache it.

A query or mutation with `agents: false` stays off REST discovery and MCP, but the run route still serves it to the app's own typed client.

## The typed client

```ts
import { createClient, SpacePressError } from "./sp/_generated/client/index.ts";

const client = createClient({ url: "https://example.test/wp-json" });

const posts = await client.posts.list({ where: { tags: { has: "news" } }, orderBy: { createdAt: "desc" }, limit: 10 });
try {
  await client.actions.rate({ id: posts[0].id, stars: 5 });
} catch (error) {
  if (error instanceof SpacePressError) console.log(error.status, error.code, error.pointer);
}
```

- **`url`** is the site's REST root. On a page SpacePress renders, `createClient()` with no `url` reads the REST root, the app API's namespace and a signed-in visitor's REST nonce from the page. Signed-out pages print no nonce, so they stay cacheable.
- **`api`** is the app API's route below the REST root when a host moves it from `spacepress/v1` (the `sp_api_namespace` filter or `SP_API_NAMESPACE` constant).
- **Credentials** for an external client: an application password, a SpacePress Identity Bearer token (`auth: { clientId, redirectUri }`), or a cookie nonce.
- **Lists** return at most 100 rows per call; paginate for more.

Every read is a `Query`: `await` it for one answer, or call `.subscribe()` to keep it current. The generated `client/README.md` documents sign-in, guests, live updates and uploads.

## React hooks

**In SpacePress `"use client"` islands**, import `useLive`, `useMutation` and `uploadFile` from `"spacepress/react"` and pass them references from `_generated/api`. They compile to WordPress Interactivity API state; no React ships to the page. See [Pages, Layouts & Interactive Islands](/docs/core/pages-and-islands#use-client-interactive-islands).

**In an external React app** (React 18+, or Preact through `preact/compat`), use the generated `client/react.ts`. You pass it your React, so the hooks use the React your app already bundles:

```ts
import * as React from "react";
import { createClient } from "./sp/_generated/client/index.ts";
import { createHooks } from "./sp/_generated/client/react.ts";

export const client = createClient({ url: "https://example.test/wp-json" });
export const { useQuery, useMutation } = createHooks(React);
```

`useQuery(client.todos.list({ limit: 20 }))` keeps a read current. `useMutation((title: string) => client.todos.create({ title }), { optimistic })` wraps a write, applies optimistic updates and rolls them back if the write fails.

The `@spacepress/client` npm package has the same client and hooks for apps that don't want the CLI as a dependency. `spacepress/client` and `spacepress/react` re-export it.

## `@spacepress/astro`

For Astro 7.4 and later, install `@spacepress/astro`:

- `spLoader(kind, options)`: a build-time Content Layer loader with relation and media expansion.
- `spLiveLoader(kind, options)`: a live loader that returns `cacheHint.tags` (`<kind>`, `<kind>:<id>`).
- `spWebhook(options)`: an Astro endpoint that verifies the `SpacePress-Signature` header of SpacePress's webhooks and invalidates those cache tags.

Set `frontend: "https://your-astro-site.com"` in `defineConfig()` so WordPress permalinks, previews and feeds point to the Astro site.
