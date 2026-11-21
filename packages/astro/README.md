# @typedpress/astro

A TypedPress site as the content source of an Astro site. The Astro project needs only the site's URL;
it can live in the same repository as the TypedPress app or in another one.

```sh
npm install @typedpress/astro
```

Astro 7.4+ (and the Node version it requires, 22.23.4+).

## Build-time collections

```ts
// src/content.config.ts
import { defineCollection } from "astro:content";
import { tpLoader } from "@typedpress/astro";

export const collections = {
  posts: defineCollection({ loader: tpLoader("posts") }),
  featured: defineCollection({ loader: tpLoader("posts", { where: { featured: true } }) }),
};
```

```astro
---
// src/pages/posts/[id].astro
import { getCollection, render } from "astro:content";
export async function getStaticPaths() {
  return (await getCollection("posts")).map((post) => ({ params: { id: post.id }, props: { post } }));
}
const { post } = Astro.props;
const { Content } = await render(post);
---
<h1>{post.data.title}</h1>
<Content />
```

- **Entries** are the kind's published rows as an anonymous visitor reads them, through the same read
  rules and field access as the site's own API. The entry id is the kind's slug field, else its
  primary key (`id` option: another field, or a function of the row).
- **Media fields** come as media rows (`url`, `width`, `height`, `alt`, `sizes`), so an `<img>` needs no
  second request. `media: false` keeps them as ids.
- **`render(entry)`** renders WordPress's own HTML of the kind's content field: blocks, shortcodes and
  embeds as the site renders them.
- **The schema** comes from the site (`GET /wp-json/typedpress/v1`), so `entry.data` is typed in the editor
  with no schema written in the Astro project. A `schema` you pass to `defineCollection` wins.
- **Each build pulls only what changed.** The collection is read as primary-key ranges of up to 100
  rows through the site's subscription endpoint (`POST /wp-json/typedpress/v1/_live`). Each range keeps the
  token of its last answer in the content layer's `meta` store; the next build sends the tokens back,
  and a range nobody wrote to answers "not modified" without its rows. A changed range returns its
  rows, and Astro's digest skips the ones that didn't change. Deleted and unpublished rows leave the
  collection. The build log says what happened: `posts: 1 changed, 0 removed, 230 entries, 2 of 3
  pages not modified`. "Not modified" saves the transfer and the rendering; whether the site also
  skips the read depends on what the reader may see (a kind with media fields, or fields hidden from
  some readers, is read on the server every time; see the reactive queries decision).
- **Rendered HTML** is fetched for changed entries only. HTML that depends on other content (a
  reusable block, an embed) changes when that entry is next saved, or on a build with
  `astro build --force`.

Options (all of them also on `tpLiveLoader`):

| Option | Default | |
|---|---|---|
| `site` | `TP_URL` | the TypedPress site's URL |
| `appPassword` | `TP_APP_PASSWORD` | `user:application-password`, to read as that user |
| `token` | `TP_TOKEN` | a TypedPress Identity bearer token, instead |
| `where` | | a filter, as the typed client takes it |
| `with` | media fields | relations to load into each row: `{ author: true }` |
| `drafts` | `false` | include drafts (the reader must be allowed to see them) |
| `id` | slug, else primary key | the entry id: a field name or `(row) => string`; two rows with one id are a build error |
| `query` | | WordPress's own kinds (`posts`, `pages`, ...): core's list parameters, `{ categories: 3 }`. They don't take `where`, `orderBy` or `with` |
| `pageSize` | 100 | rows per request (build-time only) |

Read as a user only when you mean to publish what that user sees: a build with an editor's password
renders fields and drafts an anonymous visitor would not get.

## Live collections

```ts
// src/live.config.ts
import { defineLiveCollection } from "astro:content";
import { tpLiveLoader } from "@typedpress/astro";

export const collections = {
  posts: defineLiveCollection({ loader: tpLiveLoader("posts") }),
};
```

```astro
---
// src/pages/posts/[slug].astro, rendered on demand
import { getLiveEntry, render } from "astro:content";
const { entry, error, cacheHint } = await getLiveEntry("posts", Astro.params.slug!);
if (error || !entry) return Astro.redirect("/404");
if (cacheHint) Astro.cache.set(cacheHint);
const { Content } = await render(entry);
---
<h1>{entry.data.title}</h1>
<Content />
```

- `getLiveEntry("posts", "hello")` finds the row whose slug (or `id` option field) is `hello`;
  `getLiveEntry("posts", { rank: 3 })` matches fields; `{ where: {...} }` takes any filter. The
  loader's own `where` holds for every read.
- `getLiveCollection("posts", { where, orderBy, limit, offset, search, locale, with })` lists.
- Every entry's `cacheHint.tags` are `<kind>:<id>` for the row and for each related row and media
  item it loaded; a collection's hint adds `<kind>`. The kind is its storage name (`field_notes`),
  as in webhook events; the loaders take either that or the typed client's name (`fieldNotes`).
- `tpLiveLoader()` without a kind serves every kind; the filter names it:
  `getLiveEntry("site", { kind: "posts", id: "hello" })`.

## Webhooks: purge or rebuild on write

In `typedpress.config.ts`, send writes to the Astro site:

```ts
webhooks: [{ url: env("ASTRO_HOOK_URL"), secret: env("ASTRO_HOOK_SECRET"), events: ["posts.created", "posts.updated", "posts.deleted"] }],
```

In the Astro site, receive them:

```ts
// src/pages/api/tp.ts
import { tpWebhook } from "@typedpress/astro";
export const prerender = false;
export const POST = tpWebhook(); // TP_WEBHOOK_SECRET holds the same secret
```

The endpoint checks the `TypedPress-Signature` header (HMAC-SHA256 over `"<t>.<body>"`, five minutes'
tolerance) and answers 401 otherwise. It then invalidates the tags `<kind>` and `<kind>:<id>` in
Astro's route cache when one is configured, and calls `onEvent({ tags, event, context })`, where a
static site starts a rebuild instead. Deliveries are TypedPress jobs, retried with backoff. Webhooks fire
for the app's own kinds, so a `media:<id>` tag is not purged by a media edit; it purges with the row
that shows it.

## EmDash's official templates

`@typedpress/astro/emdash` runs EmDash's official Astro templates (blank, starter, blog) on a TypedPress site
with no code in the template: their `emdash`, `emdash/ui`, `emdash/page` and `emdash/runtime`
imports resolve to it.

```js
// astro.config.mjs
import node from "@astrojs/node";
import { defineConfig } from "astro/config";
import { tpEmdash } from "@typedpress/astro/emdash";

export default defineConfig({ output: "server", adapter: node({ mode: "standalone" }), integrations: [tpEmdash()] });
```

It reads the site at `TP_URL`, and adds type declarations for the `emdash` modules, so a template type-checks (`astro check`) with its own upstream tsconfig and no EmDash package. The TypedPress app declares what the templates show:

| The template reads | The TypedPress app declares |
|---|---|
| posts and pages (`getEmDashCollection`, `getEmDashEntry`) | `posts` and `pages` collections with `title`, `slug`, `body` (content), and optionally `excerpt`, `cover` (media), `seoTitle`, `seoDescription` |
| categories, tags, bylines | `category`, `tag` and `credits` taxonomies on `posts` (`credits` with a `role` text field) |
| widget areas | a `widgets` global: `{ areas: json<unknown[]>() }` |
| site title, tagline, logo, icon | WordPress's settings |
| the primary menu | a menu at WordPress's `primary` location |
| comments | `comments: true` on `posts`; the comment form posts to WordPress through the integration |

Anything the app leaves out reads as empty. The integration also answers `/_emdash/admin` (to
wp-admin), `/wp-comments-post.php` (forwarded to WordPress) and `/api/search` (the live search), and
reads a draft through a staged-version preview token (`?preview=`).

Not covered:

- `Astro.locals.user` stays unset, so the templates' admin link doesn't show. Core accepts the login
  cookie only with a REST nonce, which a page served elsewhere doesn't have.
- WordPress sees every comment the form forwards as coming from the Astro server's IP, so its
  per-IP flood and spam checks treat all visitors as one.
- A draft preview shows the staged version's block markup as saved; WordPress doesn't render a
  staged version, so dynamic blocks and shortcodes don't run in it.
- The site's description (its kinds and fields) is read once per server process: restart the Astro
  server after a schema change.

## Hosting

TypedPress never runs the Astro site. A static build is plain files and goes on any static host; an
on-demand one runs where Astro's adapter puts it. On Spacefast, the TypedPress app and the Astro site are
two Spaces: see [docs/astro.md](../../docs/astro.md) in the TypedPress repository.

## Tests

`node --test packages/astro/test/emdash.test.mjs` runs the `emdash` API and an `astro build` of a page written against it on the same kind of site. `node --test packages/astro/test/paging.test.mjs` checks the paging against a stand-in for the subscription endpoint through thousands of random writes. `node --test packages/astro/test/loader.test.mjs` builds `test/fixture` with `typedpress build`, serves it
on WordPress-on-SQLite, and runs both loaders, the webhook endpoint and a real `astro build` against
it. It needs PHP 8.2+ with `pdo_sqlite`, `target/debug/typedpress` (or `TP_BIN`) and `npm ci` here.

MIT.
