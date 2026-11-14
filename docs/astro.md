# Astro on First

An Astro site can take its content from a First app: First is the backend (WordPress admin, the
editor, users, access rules, actions), Astro renders the pages. First never builds or runs the Astro
site, and nothing in the First app changes for it. The package is `@first/astro`
([`packages/astro`](../packages/astro/README.md)); this page is how the pieces fit.

To render pages with First itself instead, write them under `first/app/` ([pages](pages.md)).
[`examples/garden`](../examples/garden/README.md) and [`examples/astro-garden`](../examples/astro-garden/README.md)
are the same site both ways.

## The three parts

| | What the Astro project writes | What it does |
|---|---|---|
| Build-time content | `defineCollection({ loader: firstLoader("posts") })` in `src/content.config.ts` | Every build reads the kind's published rows into Astro's content layer, asking the site only for the pages of rows that changed since the last build |
| Live content | `defineLiveCollection({ loader: firstLiveLoader("posts") })` in `src/live.config.ts` | On-demand pages read the site at request time; entries carry cache tags `posts` and `posts:<id>` |
| Purge or rebuild | `export const POST = firstWebhook()` in `src/pages/api/first.ts` | Verifies First's signed webhook and invalidates the event's tags, or starts a rebuild |

The site's URL is the only configuration: `FIRST_URL`. To read as a user, `FIRST_APP_PASSWORD`
(`user:application-password`) or `FIRST_TOKEN`.

## What the loaders read

The loaders call the same API as the typed client, `/__first/api/v1`:

- `GET /__first/api/v1` once per build, for the kinds and their fields. It gives each collection its
  Zod schema and the TypeScript type of `entry.data`.
- `POST /__first/api/v1/_live` for build-time pages ([reactive queries](decisions/2026-11-13-reactive-queries.md)):
  each page of up to 100 rows is a subscribed read whose token the content layer keeps between
  builds, so an unchanged page costs no rows. The answer is the visitor's own access-checked read
  either way.
- `GET /__first/api/v1/<kind>` for live collections and for WordPress's own kinds.
- Core's `/wp/v2/<type>` route, `_fields=id,content`, for the HTML WordPress renders from an entry's
  content field (`render(entry)` in Astro).

Every read is as the caller: anonymous by default, so a build publishes what any visitor may read.
Drafts are left out unless the `drafts` option is set and the credentials may read them.

## Cache tags

One vocabulary everywhere ([external frontends](spec/external-frontends.md)): `<kind>` for a list,
`<kind>:<id>` for a row, and `media:<id>` for a media item a row loaded. Live entries carry them in
`cacheHint.tags`; webhook events name `<kind>` and `<kind>:<id>` of the written row. An on-demand
page that calls `Astro.cache.set(cacheHint)` is purged by the next write to anything it showed, when
the Astro site has a route cache configured.

## Static sites and rebuilds

A static Astro site (`output: "static"`) shows what the site held at build time. To publish an edit,
build again; the loader's page tokens keep that build cheap. `firstWebhook({ onEvent })` is the hook
for starting the build: call your host's build trigger there. The First app sends the webhook after
each committed write (`webhooks` in `first.config.ts`, delivered as a retried job).

## On Spacefast

Checked against Spacefast's source on 2026-11-14. Nothing here was published.

| | |
|---|---|
| Two Spaces | A Space version holds one runtime. The First app is one Space; the Astro site is another, which reads the first one over HTTPS. Keep them in separate projects (or folders published separately): read from the publish code, not run, a project with both an Astro config and a First app publishes only one of them. |
| Static Astro | Spacefast detects Astro (`astro` in `package.json` or an `astro.config.*` file), runs `astro build` and publishes `dist/` as files. `FIRST_URL` is a Space variable (`sf env set`), read at build time. |
| On-demand Astro | Spacefast's own adapter, `@spacefast/astro/adapter`, builds the on-demand routes into a Functions worker; variables reach a page as `Astro.locals.runtime.env`. `@first/astro` uses only `fetch` and Web Crypto, which a worker has. Not run on Spacefast yet. |
| Rebuild on write | Spacefast has a build trigger for a Space built from a connected repository (`POST /v1/spaces/{id}/builds`, an API key with `builds:trigger`). Calling it from `onEvent` is the way to rebuild a static Astro Space after an edit. Not tried yet. |
| `/__first/api/v1` | Spacefast reserves `/__first` and marks `/__first/api/v1` as an API other frontends call. |
