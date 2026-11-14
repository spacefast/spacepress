# External frontends and agents

Owner: one workstream. Packages live in spacefast/zero (`packages/astro`,
`packages/next`, `packages/tanstack`). Index: [index.md](index.md).
Depends on [spec.md](spec.md) (the spec and typed client; the client is imported from `first/_generated/client`).

## Caching boundary

WP Cloud's Batcache and edge cache only cover pages WordPress serves ([rendering.md](rendering.md) §6).
An Astro, Next or TanStack site hosted elsewhere owns its own cache. First's part
is the signed webhook with tags and URLs after each committed write, plus the
adapters' receivers.

## Goal

First as the backend for Astro, Next.js or TanStack Start, in the same repo or a
separate one, with no per-framework configuration beyond the site URL. First
never compiles those frameworks; they run where they run (Node, a static host,
or a static Space built by Spacefast's build pipeline).

## One spec, one tag vocabulary

- The deployed site serves its spec (collections, fields, actions, access summary)
  at `GET /__first/api/v1` (mapped from core's REST index and the Abilities
  list). `first pull` turns it into `first/api.d.ts`,
  `openapi.json` and Zod schemas.
- Every read result carries cache tags `<kind>` and `<kind>:<id>`. The same
  strings are used for Astro cache hints, Next `cacheTag`, CDN surrogate keys
  and the outgoing webhook.
- On write, after commit, First sends one signed webhook per configured URL:
  `{ tags: ["posts", "posts:42"], event: "posts.updated" }` (a job, so retried).

## Adapters

| Framework | Package | What the user writes |
|---|---|---|
| Astro, build time | `@first/astro` | `posts: defineCollection({ loader: firstLoader("posts") })`. Pulls only changed entries (digest plus `meta` cursor), media as CDN URLs. Built: the cursor is one `_live` token per page of 100 rows ([docs/astro.md](../astro.md)). |
| Astro, live | `@first/astro` | one `defineLiveCollection({ loader: firstLiveLoader() })`; `getLiveEntry("posts", slug)` returns `cacheHint` with tags for `Astro.cache.set`. Built, with `firstWebhook()` as the receiver. |
| Next.js 16 | `@first/next` | `firstFetch` tags results with `cacheTag`; `app/api/first/route.ts` re-exports a handler that verifies the webhook and calls `revalidateTag(tag, { expire: 0 })`, and also handles draft mode |
| TanStack Start | `@first/tanstack` | `postsQuery(params)` returns `queryOptions` usable in loaders and components; a TanStack DB collection on top of the change feed |
| anything else | `first/client` + `openapi.json` | the typed client or plain REST |

Static rebuilds: with Astro in static mode on Spacefast, the webhook can trigger
a rebuild of the frontend Space instead of revalidation (verify which build
entry point to call before promising this).

## Preview

One contract for every framework. `frontend` in `first.config.ts` plus a preview
path (default `/api/first/preview`). The editor's Preview button opens
`{frontend}{previewPath}?token=…&path=/blog/hello`. The token is short-lived and
lets that one request read drafts. Each adapter ships the handler.

## Realtime

The host's realtime transport owns live updates; on Spacefast that is Cast, not
yet wired for First builds ([host checklist](../spacefast-host-checklist.md),
item 7). First writes a change feed in the same transaction as each write and
the host fans it out. For external frontends this is exposed as a resumable SSE
stream of tags, which the TanStack DB collection and a `useZeroQuery` hook
consume. No Postgres-style logical replication promised (WordPress is MySQL).

## Agents

- Every collection operation and every action is an Ability, so the MCP Adapter
  exposes them under WordPress capability checks. Anonymous exposure is opt-in
  per collection or action (`abilities: { public: true }`, compiled to the 7.1
  `meta.public` flag).
- Markdown twins and `llms.txt` ([rendering.md](rendering.md)) work for agents reading the site.
- `first init` writes `AGENTS.md`: commands, layout, where the docs are.

## Acceptance

1. Official EmDash `blog` Astro template running on `@first/astro` with no
   adapter code in the template (replaces `examples/emdash/official-sites` bridge).
2. A Next.js 16 example: edit a post in wp-admin, the page updates without a
   redeploy; preview shows a draft.
3. A TanStack Start example with a live list updated by another browser's write.
