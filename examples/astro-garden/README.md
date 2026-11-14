# Garden in Astro

The same plant guide as [`examples/garden`](../garden/README.md), rendered by Astro. The content
lives in that First app (WordPress); this site reads it at build time with
[`@first/astro`](../../packages/astro/README.md). Compare the two:

| | First app ([`examples/garden`](../garden)) | Astro ([this folder](.)) |
| --- | --- | --- |
| The plants | `export const plants = collection(...)` in `first/schema.ts`, synced from `content/plants/` | `plants: defineCollection({ loader: firstLoader("plants") })` in [`src/content.config.ts`](src/content.config.ts) |
| The list | [`first/app/page.tsx`](../garden/first/app/page.tsx): `db.query.plants.findMany(...)` | [`src/pages/index.astro`](src/pages/index.astro): `getCollection("plants")` |
| One plant | [`first/app/plants/[slug]/page.tsx`](../garden/first/app/plants/[slug]/page.tsx): the kind's URL hands the page its `item` | [`src/pages/plants/[slug].astro`](src/pages/plants/[slug].astro): `getStaticPaths()` and `render(plant)` |
| Rendered by | PHP in WordPress, on each request (cached at the edge) | Astro, once per build, as static files |
| An edit in wp-admin shows | at once | after the next build, which pulls only the changed plants |

Both render the body from WordPress's own HTML of the same content, and use the same stylesheet.

## Run it

Start the First app, then build this site against it:

```sh
first dev examples/garden --no-watch
first sync examples/garden
npm install --prefix examples/astro-garden
FIRST_URL=http://localhost:<port printed by first dev> npm run build --prefix examples/astro-garden
```

Astro 7.4 needs Node 22.23.4 or newer.

## Test

[`twins.test.mjs`](twins.test.mjs) builds the First app, seeds its plants as a publish does, serves
it on WordPress-on-SQLite, builds this site against it, and reads both in Chromium: the same list,
the same plant pages and text, the same stylesheet. An edit then shows on the First app at once,
and here after a rebuild whose log says `plants: 1 changed`.

```sh
node --test examples/astro-garden/twins.test.mjs
```

## On Spacefast

Not published; this is how it would run, from reading Spacefast's source on 2026-11-14.

- **Two Spaces.** A Space version holds one runtime, so `examples/garden` is one Space (the First
  app) and this site another. Reading the publish code (not run): a project with both an Astro
  config and a First app publishes only one of them, so keep them in separate folders.
- **This site is static** (`output: "static"`). Spacefast detects Astro, runs `astro build` and
  publishes `dist/` as files. Set `FIRST_URL` to the First Space's URL as a Space variable
  (`sf env set`), which a build reads. Verified in code; not run.
- **Publishing an edit** means building this Space again. Spacefast has a build trigger for a Space
  built from a connected repository; calling it from `firstWebhook({ onEvent })` on a webhook from
  the First app is the way to do that. Not tried.
- **On-demand pages** would use `@spacefast/astro/adapter` (a Functions worker) and
  `firstLiveLoader`. `@first/astro` uses only `fetch` and Web Crypto. Not tried.
