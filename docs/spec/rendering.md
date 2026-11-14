# Rendering, interactivity and caching (`first/app/`)

Owner: one workstream. The TSX → PHP renderer and the TSX →
Interactivity compiler are gated on the spike in [tsx-to-php.md](tsx-to-php.md).
Routing, modes, markdown and caching can be built first. Schema, queries and
modes are in [spec.md](spec.md).

Decisions (2026-11-08):
- Pages are rendered by PHP on each request, provided caching is excellent.
- Prebuild everything possible.
- `app/` with `route.ts`.
- Go all in on the Interactivity API.
- Caching uses WP Cloud's existing Batcache and edge cache, with URL purges.

## 1. Routing: what we took from whom

| | Next.js App Router | TanStack Router/Start | Vite ecosystem (vite-plugin-pages, Remix/RR7, SvelteKit, Astro) | **First** |
|---|---|---|---|---|
| Layout | folders, one name per role (`page`, `layout`, `route`) | flat dot files or folders, `__root.tsx`, `route.tsx` | folders (`+page`, `[slug].astro`) or flat (`posts.$id.tsx`) | **folders, Next names** (`page`, `layout`, `not-found`, `error`, `route`) |
| Params | `[slug]`, `[...rest]`, `[[...opt]]` | `$postId`, `$` splat, `{-$opt}` | mostly `[slug]` | **`[slug]`, `[...rest]`, `[[...opt]]`**. Brackets are what most frameworks use and what agents write by default |
| Non-routes | `_private`, `(group)` | `-file` excluded, `(group)`, `_pathless` | `_` prefix | **`_private`, `(group)`** |
| Page + API in one file | no (`route.ts` is separate) | yes (`server.handlers` on the route) | RR7/SvelteKit: yes (`action` export, `+page.server`) | **yes**: a `page.tsx` may export `POST` etc.; `route.ts` is for files with no page |
| Typed links | no (string `href`) | **yes**: `<Link to="/posts/$id" params>` is checked | SvelteKit partly | **yes**: `_generated/routes.d.ts` types `href` and `params`, and kind URLs come from `item.url` |
| Typed search params | `searchParams` is a string map | **`validateSearch` with a schema** | no | **yes**: `export const search = { page: integer().default(1), q: text().optional() }`, parsed and typed |
| Data loading | async server component | `loader` + `useLoaderData` | `load` functions | **async server component** (it runs in PHP, so there is no separate loader) |
| Forms | server actions | server functions | RR7/SvelteKit form actions (work without JS) | **form actions that work without JS**, upgraded by the Interactivity API (§4) |
| Head | `metadata` / `generateMetadata` | `head()` | `<svelte:head>`, frontmatter | **`metadata` object or function** |
| Middleware | `middleware.ts` | route and handler middleware | hooks | **`layout.tsx` may export `guard`** (§2) |

So First uses Next's file names because agents write them most reliably. From
TanStack it takes typed links, typed search params and page+handler in one
file. From React Router 7 and SvelteKit it takes forms that work without JavaScript.

## 2. Files

```text
first/app/
├── layout.tsx                    # root layout: <html>, <head>, router region
├── page.tsx                      # /
├── not-found.tsx                 # unclaimed URLs when app/ owns the front end
├── error.tsx                     # render errors (logged; never leaks details)
├── about/page.md                 # content-owned: a real WordPress Page
├── blog/page.tsx                 # /blog?page=2
├── blog/[year]/[slug]/page.tsx   # matches posts' url → `item`
├── topics/[slug]/page.tsx        # matches topics' url → `item`
├── account/layout.tsx            # export const guard = "subscriber"
├── account/page.tsx
├── (marketing)/pricing/page.tsx
├── feed.xml/route.ts             # GET only, no page
└── webhooks/stripe/route.ts      # POST, signed
```

- A page whose path matches a kind's `url` pattern receives `item` and 404s for
  missing, unpublished or unreadable items. You don't export anything to bind it.
- `export const guard = "subscriber" | (ctx) => true | redirect("/login")` on a
  layout protects everything below it.
- A page that exports `prerender = true` is prebuilt, and with `defineConfig({ output: "static" })`
  every page is: built, [decision](../decisions/2026-11-13-static-output.md) (§6.1).
- `page.md` (built, [decision](../decisions/2026-11-13-content-pages.md)): the file is the first
  version of a WordPress Page. The site stores it once per file version and never overwrites a
  Page someone edited; the route renders the stored Page inside its layouts. Front matter is
  `title`, `description`, `status`, `canonical` and `robots`; typed fields belong to a kind.

## 3. A page

```tsx
// first/app/blog/[year]/[slug]/page.tsx
import { likes } from "first:db";
import { Content, Comments, Link, type PageProps } from "first/app";
import LikeButton from "../../../../components/LikeButton";

export const metadata = ({ item }: PageProps<"posts">) => ({ title: item.title, description: item.excerpt });

export default async function Post({ item }: PageProps<"posts">) {
  const count = await likes.count({ where: { post: item.id } });
  return (
    <article>
      <h1>{item.title}</h1>
      {item.cover && <img src={item.cover.sizes.card.url} alt={item.cover.alt} />}
      <Content value={item.body} />
      {item.categories.map((c) => <Link key={c.id} href={c.url}>{c.name}</Link>)}
      <LikeButton postId={item.id} count={count} />
      <Comments for={item} />
    </article>
  );
}
```

Server components are ordinary async functions that compile to PHP. `&&`,
`?:`, `??`, `.map`, `.length` and string methods all work.

## 4. Interactivity: all in on the Interactivity API

**Every** interactive behavior in First compiles to the WordPress Interactivity API:
- client components;
- forms;
- navigation;
- live updates;
- First's built-in components (`<Comments>`, sign-in, search).

That gives one runtime, about 11 kB, which WordPress already ships and which
core blocks and plugins share. There is no React or Preact bundle of our own
and no second hydration model.

### 4.1 Client components

```tsx
// first/components/LikeButton.tsx
"use client";
import { useState } from "first/client";
import { like } from "../server/posts";

export default function LikeButton({ postId, count: initial }: { postId: number; count: number }) {
  const [count, setCount] = useState(initial);
  const [busy, setBusy] = useState(false);
  const label = count === 1 ? "1 like" : `${count} likes`;
  return (
    <button disabled={busy} onClick={async () => { setBusy(true); setCount(await like({ postId })); setBusy(false); }}>
      ♥ {label}
    </button>
  );
}
```

The compiler produces:

1. **Server HTML (PHP)** with real values and directives, so the page is
   correct before JavaScript loads:
   `<button data-wp-interactive="first/LikeButton" data-wp-context='{"postId":42,"count":7,"busy":false}' data-wp-bind--disabled="context.busy" data-wp-on--click="actions.click">♥ <span data-wp-text="state.label">7 likes</span></button>`
2. **A store module (JS)**, registered as a script module and loaded only on
   pages that use the component:
   `store("first/LikeButton", { state: { get label() { … } }, actions: { *click() { … } } })`.
3. **Derived values compiled to PHP too** (`wp_interactivity_state` closures),
   so step 1 can print "7 likes". Parity between the PHP and JS output is tested ([tsx-to-php.md](tsx-to-php.md)).

How it reacts:

- `useState` values become fields in the instance's `data-wp-context`. Each
  instance gets its own copy.
- The context is a proxy over Preact signals. Reading `ctx.count` subscribes to it.
- Writing `ctx.count = 8` updates only the nodes that read it. Nothing is
  re-rendered and there is no virtual DOM diff.
- Derived values are getters, recomputed lazily.
- Handlers become actions; async ones compile to generators so the runtime
  can restore scope after each `await`.
- The browser takes over the server HTML in place rather than rendering it again.

The TSX → directive mapping, which also defines what's supported:

| You write | Compiles to |
|---|---|
| `useState(x)` | a `data-wp-context` field |
| a `const` derived from state or props | a `state` getter (JS) and a closure (PHP) |
| `{value}` text | `data-wp-text` |
| `attr={value}` | `data-wp-bind--attr` |
| `className={{ active: on }}` / `clsx` | `data-wp-class--active` |
| `style={{ color }}` | `data-wp-style--color` |
| `onClick`, `onInput`, … | `data-wp-on--click`, … (`withSyncEvent` for `preventDefault`) |
| window/document listeners via `useEvent("resize", …)` | `data-wp-on-window--resize` |
| `{cond && <X/>}`, `{a ? <X/> : <Y/>}` | a `<template data-wp-each--first-shown>` per branch over a derived `[1]` or `[]`; a condition that reads nothing reactive renders once on the server |
| `{list.map((x) => <li key={x.id}>…)}` | `<template data-wp-each--x="…" data-wp-each-key="…">`, after the server's items marked `data-wp-each-child` |
| `useEffect(fn, [deps])` | `data-wp-watch` (cleanup returned) |
| `useMount(fn)` | `data-wp-init` |
| `useRef()` | `getElement().ref` |
| shared state across components: `export const cart = sharedState({ items: [] })` | the store's global `state` for that namespace |
| `fetch` / server action calls | `fetch` to the action endpoint with the REST nonce from `getConfig()` |

The build refuses these and names the alternative: React context (use
`sharedState`), third-party React components, `dangerouslySetInnerHTML` (use
`<Html value>`, which compiles to `wp-html` with `asDangerousHTML`), and
components defined inside render.

### 4.2 Forms

```tsx
<form action={subscribe}>                           {/* server action from server/ */}
  <input name="email" type="email" required />
  <button>Subscribe</button>
</form>
```

- Without JavaScript, the form POSTs to the action endpoint and redirects back
  to the page, with errors in a flash. As built: form-encoded to
  `/__first/api/v1/actions/<name>`, `303` to the hidden `_first_return` path
  with `?_flash=<id>`, the flash a sealed read-once cookie; the marked render
  is `private, no-store` ([pages.md](../pages.md#forms)).
- With JavaScript, an Interactivity store submits it with `fetch`, keeps
  `pending`, `error` and `result` in context, and updates in place.
- `useFormState()` reads those values.

### 4.3 Navigation

The root layout marks the content region with `data-wp-router-region`. `<Link>`
uses `actions.navigate()` from `@wordpress/interactivity-router`: it fetches the
next page's HTML, swaps the region, and re-reads server state
(`getServerState`/`getServerContext`). This mode is stable since WordPress 6.9.
On a page with a `<Link>`, the region's wrapper goes through core's directive
pass (`wp_interactivity_process_directives()`), so the page gets what a block
theme's router region gets: `core/router`'s `state.url` from the server, the
navigation animation styles and the loading bar. The page's own HTML is not
processed again.
Full-page navigation is still experimental in WordPress, so it stays off until
core marks it stable. `<Link prefetch>` uses the router's `prefetch`.

### 4.4 Live data over Cast

This already exists on main (monorepo #5152, zero #128):
1. A committed write fires `first_realtime_changes` with ids only.
2. The control plane broadcasts `first.changes` into the Space's Cast room.
3. `/__spacefast/client.js` holds one socket per page.
4. The client re-runs its own query through the normal API, so a viewer only
   ever sees rows its own read returns.
5. With the socket down, the page polls every 30 seconds; while live, a safety
   refresh runs about every minute.

This spec adds:

- `<Live>{…}</Live>` around part of a server page. On a notice for any kind the
  region read, it calls the router to re-fetch the page and swap only that
  region. No client data code is needed. As built: a `page` read on the
  subscription endpoint (`{ op: "page", args: { url, region } }`, decision
  [2026-11-14](../decisions/2026-11-14-live-regions.md)); the server half lands
  first, the browser half with the component's browser swap.
- `useLive(kind, query)` inside client components: the result lives in
  context, and directives update when it changes. As built: a list read,
  seeded by `Live\Module::evaluate` in the first render and subscribed through
  the typed client served as `@first/client` ([pages.md](../pages.md#client-components)).

Both load Cast only on pages that use them, through the engine client.
Real-time co-editing is out of scope.

### 4.5 Built-in interactive components

`<Comments for>` (thread + form + moderation state; as built, see
[the decision](../decisions/2026-11-14-comments.md)), `<SignIn>`,
`<Search kind>`, `<Pagination>`, `<Menu name>`. They are written in the same
TSX subset, so they are examples as well as product.

## 5. Markdown and llms.txt

- `GET /blog/2026/hello.md` returns markdown. Each HTML page links to it with
  `<link rel="alternate" type="text/markdown">`. The `.md` URL is the cacheable
  markdown representation, with its own Batcache and edge entry, purged
  alongside the HTML URL.
- `Accept: text/markdown` on the HTML URL also returns markdown, but it must
  never share a cache entry with the HTML. Batcache keys on the URL; it varies on
  `Accept` only for JSON-only clients (wpcom `wp-content/advanced-cache.php`),
  and it answers before page code runs. So `Vary: Accept` on the response is not
  enough. First's early hook (the engine's pre-WordPress lane, before
  `advanced-cache.php` loads) sees `Accept: text/markdown` and answers it
  before any cache lookup:
  - it renders with `batcache_cancel()` (`MarkdownTwins::negotiate()`), also for a prebuilt page:
    the prebuilt-file lane leaves `Accept: text/markdown` to it (#457). This lane doesn't serve
    the prebuilt `.md` file;
  - and answers with
    `Cache-Control: private, no-store`, plus `Vary: Accept` and
    `Content-Location: <url>.md`.

  The origin then never stores a markdown body under the HTML key, and
  Batcache never hands its HTML copy to an agent. One limit remains: the WP
  Cloud edge answers before the origin, and nothing in our code shows it
  honoring `Vary: Accept`. An agent can therefore still get the edge's cached
  HTML for `/x`, although it can never poison it. So the `.md` URL is the
  contract for agents. HTML responses advertise it in both a `Link: <…>.md;
  rel="alternate"; type="text/markdown"` header and the `<link>` tag, and
  `Accept` negotiation is a convenience on top. Before relying on negotiation
  at the edge, verify whether it keys on `Accept`.
- A site that also turns on WordPress/ai's Markdown Feeds experiment serves
  Markdown twice (its `?output_format=markdown` and `/feed/markdown/` next to
  the `.md` twins). The app plugin names itself on that plugin's
  `wpai_markdown_feeds_conflicting_plugins` list, so its settings say so.
- Items render to markdown from their stored content (`Markdown::fromBlocks`).
  Code pages render from their compiled output, as an anonymous visitor (built). A prebuilt page's
  twin is written beside its HTML and served from the same file lane (§6.1).
- `/llms.txt` lists kinds with URLs plus pages, with descriptions.
- In WordPress-rendered mode, First serves markdown for every kind URL.
- Backend-only sites: `GET /wp-json/wp/v2/posts/<id>?format=md` (built), and `GET /__first/api/v1/posts/<id>?format=md` once the facade lands (workstream 2).

## 6. Caching

The plan is to use WP Cloud's existing stack:
- Batcache, a full-page cache in the object cache;
- the edge cache;
- URL purges.

First's job is to tell those layers what each page is and to purge the right
URLs. This covers pages WordPress serves. A frontend hosted elsewhere, such as
Astro, owns its own cache; First only sends it the webhook (04).

Already on main in the runtime:
- `runtime/engine/shared/purge.php` sends durable, per-host purge records to
  the site's edge-cache gateway (`/edge-cache/<site>/purge/`), with retries
  from housekeeping.
- Static files are served before WordPress (and Batcache) boots.
- Purges are whole-host today because the provider's URI purge can't address
  every query variant.

### 6.1 Policy per response (decided by the router, never configured)

Built ([decision](../decisions/2026-11-12-cache-policy-per-response.md)): the router decides the
policy for each response.

| The response is | Policy |
|---|---|
| an anonymous visitor's 200 render of a page no layout guards | **cacheable**: Batcache stores it, and the edge caches with `public, max-age=0, s-maxage=<window>, must-revalidate`; signed-in users, previews and comment-author cookies bypass |
| anything else (a signed-in visitor, a guarded section, an error, a 404) | `private, no-store`; still fast, because the shell has no viewer data when the viewer part is a client component |

Every read in a render is bound to the visitor, so an anonymous render is what any anonymous
visitor sees.

**Prebuilt pages** (built, [decision](../decisions/2026-11-13-static-output.md)) need no proof that a
route is viewer-independent: a prebuilt page is the same anonymous render, made ahead of time.
- **Which pages.** A page opts in with `export const prerender = true`, or every page is prebuilt
  under `output: "static"`. A page that can't be prebuilt (a layout `guard`, `search`, a viewer
  function, a dynamic segment with nothing to list) is a build error.
- **On WordPress** (`output: "server"` only). An Action Scheduler action renders each prebuilt URL
  as a signed-out visitor and writes its HTML and `.md` below `wp-content/cache/first-prebuilt/`.
  The app plugin serves them before WordPress parses the request. A write that purges a prebuilt
  URL removes its files and schedules the rebuild (on-demand regeneration). What no write
  announces (an option a page reads, a menu, the time) can be up to an hour old: a file is never
  served past an hour, and every file is rebuilt after 45 minutes. Site-wide settings drop every
  file at once.
- **As a static site** (`output: "static"`). `first export` writes the whole site to
  `first/dist/static/` from local content or from a hosted site. Nothing is prebuilt on a WordPress
  site for a static app.

Still deferred: a policy decided per route at build time, and `first check --json` printing it.

### 6.2 Purges by URL

- At render time, a cacheable page records which kinds and ids it read. The
  compiler knows the queries, so the runtime only collects ids. These are
  stored as a URL → reads index in the object cache, with a database copy so
  eviction can't lose it.
- On every committed write, First computes the affected URLs:
  - the item's own `url` and its old URL if the slug changed;
  - every indexed page that read that id, or listed that kind;
  - the item's term archives, author archive, home, feeds, the sitemap, and each URL's `.md` twin.
- The URLs go into the existing durable purge records, as one purge obligation
  in the same transaction as the write. It is retried until the gateway accepts it.
- Batcache entries for those URLs are deleted in the same step.
- **Query variants:** First purges each URL plus every query variant its index
  saw (`?page=2`, typed `search` params). Unknown variants fall back to the
  `s-maxage` window. A purge that touches more than N URLs, or a kind-wide
  change such as a schema deploy or a settings change, becomes the existing whole-host purge.
- Publishing a new version purges the whole host, as today.

### 6.3 Inside PHP

- Query results are memoized per request.
- The route table, kinds, fields and roles are compiled arrays. With `runtimeSchema`
  (spec.md §2.10), one autoloaded option adds the site's own changes to them.
- OPcache holds the compiled pages.
- No JSON parsing or reflection happens at request time.

**Budget:** p50 server time on a cache miss under 30 ms on a box; on a hit, Batcache or edge time only.

### 6.4 What the platform supports (checked 2026-11-08)

- **Representations:** every cacheable URL has exactly one representation per
  cache key. HTML and markdown are separate URLs (`/x` and `/x.md`). Content
  negotiation on `/x` (§5) bypasses every cache, because neither Batcache nor
  the app plugin's prebuilt-file lane keys on `Accept` (the file lane steps aside for it).

- **URL purge:** the edge-cache purge action accepts `purge_uris` (query strings
  kept, each host checked against the site) and purges the whole domain only
  when none is given. Our runtime sends only `wp_domain` today; URL purges add
  `purge_uris` to the same durable records. No URL-count limit is enforced.
- **Batcache:** stores a URL on its second hit within two minutes, reads only
  `max-age`, ignores tracking params in its key. Public First pages stay in
  Batcache; viewer-dependent ones call `batcache_cancel()`, as the WordPress
  lanes already do.
- Still open: the edge TTL ceiling, which only sets the fallback window.

## 7. Kept from today

- Hidden code-owned WordPress Page records for static routes (`First\Wp\RoutePages`): one Page per
  parameterless `page.tsx` route, its permalink the route URL, `/` the front page.
- Escaping through the HTML API.
- Route IDs that survive moving a file: `export const route = { id }` in a `page.tsx`, `id:` in a
  `page.md`; the folder path otherwise.

## 8. Acceptance

`examples/full-site` and an EmDash `blog` counterpart in this layout, with browser tests:

- Published vs draft as an anonymous visitor.
- Rendering and access:
  - a client component round trip;
  - a form with JavaScript disabled and enabled;
  - `<Comments>` posting as a guest into moderation.
- Live and navigation:
  - `<Live>` updating from another browser's write;
  - region navigation.
- Agents: markdown twins and `llms.txt`.
- Modes and fallbacks:
  - a 404 in First-owned mode;
  - WordPress rendering a kind URL that has no page.
- Caching:
  - a cache hit (Batcache, then edge) after the first request;
  - a URL purge after an edit that leaves unrelated cached pages untouched.
