# Pages (optional)

A First app can render its own front end from `first/app/`: React-style TSX
that the compiler turns into PHP, rendered by WordPress on each request. It is
one way, TSX to WordPress. It is optional: without `first/app/`, WordPress
renders the site with its theme, and nothing here loads.

## `first/app/`

```text
first/app/
├── layout.tsx                 # wraps every page: export const metadata, default component
├── page.tsx                   # /
├── not-found.tsx              # the 404 for URLs no route serves, and for notFound()
├── error.tsx                  # a render error (logged; the page shows only this)
├── about/page.tsx             # /about
├── (marketing)/pricing/page.tsx  # /pricing: a group adds no segment
├── notes/page.tsx             # /notes?page=2, with export const search
├── notes/[slug]/page.tsx      # /notes/<slug>: params.slug
├── docs/[[...path]]/page.tsx  # /docs, /docs/a/b: params.path is a string[]
├── account/layout.tsx         # export const guard = "subscriber"
├── api/notes/route.ts         # export async function GET(req) { … }
└── _lib/                      # never routed: colocated helpers
```

| Name | Meaning |
|---|---|
| `page.tsx` | A route. It may also export `POST`, `PUT`, `PATCH` or `DELETE` handlers for its URL. |
| `route.ts` | HTTP handlers only (`GET`, `POST`, …), for a URL with no page. |
| `layout.tsx` | Wraps every page below it, outermost first. May export `guard`. |
| `not-found.tsx` | At the root only. |
| `error.tsx` | The nearest one above a page renders when the page throws. |
| `[x]` / `[...x]` / `[[...x]]` | One segment / one or more / zero or more (last folder only). |
| `(group)` / `_private` | No URL segment / never routed. |

Two files that serve one URL, a folder that shadows WordPress (`wp-admin`,
`wp-json`, `feed`, …), a misspelled export (`metdata`) and a layout that wraps
no page are build errors at the file, with the fix.

## A page

```tsx
// first/app/notes/[slug]/page.tsx
import { db } from "first";
import { Content, notFound, type PageProps, type RouteRequest } from "first/app";

export const metadata = ({ params }: PageProps<"notes/[slug]">) => ({ title: params.slug, canonical: `/notes/${params.slug}` });

export default async function Note({ params }: PageProps<"notes/[slug]">) {
  const note = await db.query.notes.findFirst({ where: { slug: params.slug } });
  if (!note) notFound();
  return (
    <article>
      <h1>{note.title}</h1>
      {note.dek && <p>{note.dek}</p>}
      <Content value={note.body} />
    </article>
  );
}

export async function POST(req: RouteRequest) {
  return { status: 303, headers: { location: `/notes/${req.params.slug}?sent=1` } };
}
```

- Components are ordinary (async) functions. `&&`, `?:`, `??`, `.map`,
  `.length` and string methods work as in React; the HTML matches what React
  renders, byte for byte, which the parity tests check.
- **Reads run as the visitor.** The router binds every read a render makes to
  the person viewing the page, so drafts, rows they may not read and masked
  fields never reach the HTML.
- `notFound()` renders `not-found.tsx` with a 404. `redirect(url, status?)`
  redirects (302 by default).
- `metadata` is an object or a function of the page's props: `title`,
  `description`, `canonical`, `robots: { index, follow }`. A layout's
  `title: { default, template: "%s · Site" }` wraps its pages' titles.
- `export const search = { page: integer().default(1), q: text().optional() }`
  types the query string. A value a field refuses (`?page=abc`) reads as absent.
- `guard` on a layout: a role (`"subscriber"`, `"editor"`, …),
  `"authenticated"`, or `({ user }) => boolean`. A signed-out visitor goes to
  the login page; a signed-in one gets a 403.
- `<Link href>` is an `<a>` that, once JavaScript runs, swaps only the router
  region (`@wordpress/interactivity-router`). `<Link prefetch>` prefetches on hover.
- `<Content value>` renders a post body through `the_content`. `<Html value>`
  places a literal as written and runs anything else through `wp_kses_post`.

`first build` writes `first/_generated/routes.d.ts`. With it, `<Link href>` is
checked against the app's routes and `PageProps<"notes/[slug]">` types
`params`. Point TypeScript at First's JSX types:

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "first" } }
```

## Stylesheets and images

```tsx
// first/app/layout.tsx
import "./site.css";
// first/app/notes/[slug]/page.tsx
import styles from "./note.module.css";
import compass from "./compass.svg";

<article className={styles.note}><img src={compass} alt="" /></article>
```

- `import "./x.css"` links the stylesheet on every page whose page or layouts
  import it, directly or through a component. Each file is linked once, in
  import order, the root layout's first.
- `import styles from "./x.module.css"` renames each class to
  `<file stem>_<class>` (`note.module.css`'s `.dek` is `note_dek`), and
  `styles.dek` is that name. If two modules define the same class name, the
  later one by path gets a number (`note_dek2`). A `"use client"` component may
  import a CSS module, and its class can depend on state.
- `import logo from "./x.svg"` gives the file's URL.
- Every file is copied into the app plugin under `first/app/assets/`, named by a
  hash of its bytes, with a year's cache. A changed file gets a new URL.
- These are refused at the line, with the fix: `@import` (import each file from
  TSX), a relative `url(...)` (put the file in `public/` and write
  `url(/name.png)`), `:global`, `:local` and `composes` in a module, and an SVG
  imported by a `"use client"` component (pass the URL as a prop). Other files,
  binary images and fonts among them, go in `public/`, by their URL.

## On WordPress

The router answers on `template_redirect`, before the theme. wp-admin, login,
`/wp-json`, feeds, robots and First's own paths never reach it. When
`first/app/` exists, a URL no route serves renders `not-found.tsx`. URLs
WordPress itself resolves (a post, a category archive) keep the theme until a
route serves them.

The site's sitemap is WordPress's own, `/wp-sitemap.xml`. It lists the app's
pages that have no parameters and no `guard` and render for a signed-out
visitor, unless the page's metadata says `robots: { index: false }`, and the
items of every kind with a `url` that a signed-out visitor may read. A draft, a
row an access rule hides and a password-protected item are never in it.

## The `pages/` pipeline (being replaced)

Until the cutover finishes, root `pages/` still builds through the separate Node
`first-pages build` described below. `first/app/` replaces it; the old path and
its helpers (`load()`, `<Show>`, `orElse()`, `count()`, `<Island>`) are deleted
in the same stack of changes.

`@spacefast/first-pages` adds TSX pages to a First app. Pages compile once, at
build time, to Gutenberg block markup. WordPress renders that markup on every
request, with the visitor's own data. It is an add-on: an app without `pages/`
builds and runs exactly as before. First core never loads this package or Blocks.

This is the first implementation of the optional pages contract in
[the pages design](design-pages-and-agents.md). It covers static pages,
layouts, collection item routes, listings, metadata, CSS and assets, and one
Interactivity API island. Its limits are listed under [Not in this release](#not-in-this-release).

### A site in five files

```text
site/
├── first.config.ts            # collections, access rules, actions: unchanged
├── pages/
│   ├── layout.tsx            # wraps every page
│   ├── page.tsx              # /
│   ├── not-found.tsx         # body of a claimed 404
│   ├── about/page.tsx        # /about
│   └── notes/
│       ├── page.tsx          # /notes: a listing
│       ├── featured/page.tsx # /notes/featured: static, wins over [slug]
│       └── [slug]/page.tsx   # /notes/<slug>: collectionPage("notes")
├── components/NoteCard.tsx
├── islands/cheer.client.ts   # browser module for one island
└── styles/global.css
```

[`examples/full-site`](../examples/full-site) is this site, complete.

```tsx
// pages/notes/[slug]/page.tsx
import { Island, RichText, Show, collectionPage, orElse, type CollectionPageContext, type CollectionPageProps, type Metadata } from "@spacefast/first-pages";
import styles from "./note.module.css";

export const route = { id: "notes.show" };
export const page = collectionPage("notes");

export function load({ content, item }: CollectionPageContext<"notes">) {
  return { cheers: content.query.cheers.findFirst({ where: { noteId: item.id } }) };
}

type Props = CollectionPageProps<typeof page, ReturnType<typeof load>>;

export function generateMetadata({ item, href }: Props): Metadata {
  return { title: item.title, description: orElse(item.dek, ""), canonical: href };
}

export default function NotePage({ item, cheers }: Props) {
  return (
    <article className={styles.note}>
      <h1>{item.title}</h1>
      <Show when={item.dek}><p>{item.dek}</p></Show>
      <RichText value={item.body} />
      <Island namespace="fullsite/cheer" module="../../../islands/cheer.client.ts" actions={["cheer"]}
        context={{ noteId: item.id, count: orElse(cheers.count, 0) }}>
        <button type="button" data-wp-on--click="actions.cheer">Cheer</button>
        <span data-wp-text="context.count">{orElse(cheers.count, 0)}</span>
      </Island>
    </article>
  );
}
```

### Build and install

```sh
first build site                     # the backend, and the compiled schema pages read
first-pages build site               # writes site/first/dist/wp-content/plugins/first-pages-<app>/
```

`first-pages build [project] [--out <wp-content>] [--json]` exits `0` when it
built (or there is no `pages/`), `1` with diagnostics, `2` on usage errors.
Install the `first-pages-<app>` plugin beside the app plugin and activate it.
On a build error nothing is written, and the previous plugin stays in place.

The build also writes `first/pages.json`, the render artifact. It holds the
plugin's manifest, every template, body and asset, the compiled schema the
pages were rendered against, and a SHA-256 of each authored input (routes,
layouts, components, islands, CSS, imported SVGs). It holds no PHP. Commit it
with the pages.

### Publish on Spacefast

A Spacefast box compiles your app without Node, so it cannot run page modules.
Run `first build` and `first-pages build` locally, then `sf publish`. Capture
(`first sources`, or the CLI's WebAssembly compiler) checks `first/pages.json`
and bundles it with its inputs. The host's `compile-sources` checks it again
and writes `first-pages-<app>` next to the app plugin. The plugin is byte for
byte what `first-pages build` installs: the artifact's files plus the pages
runtime the compiler embeds. The compiled manifest names it under `pages`.

Capture refuses with `first_source_needs_local_capture`, before anything is
uploaded, when:

- `pages/` exists and there is no `first/pages.json`;
- a page, layout, component, island or stylesheet changed after the render;
- a `page.tsx`, `layout.tsx` or `not-found.tsx` was added after the render;
- `first.config.ts` now compiles to a different schema than the pages saw.

Run `first build` and `first-pages build` again, then publish. The host also
refuses an artifact that names a non-asset file, PHP, an unknown island or
action, or a route WordPress owns. An uploaded artifact can only carry markup
and static assets, never server code.

Pages read the app's schema from `first build` output (`first/_generated/client/schema.ts`,
`first/_generated/migrations/snapshot.json`). They never execute `first.config.ts`, and a
page cannot import runtime values from `"first"`; use type imports and name
collections as strings.

### Files and routes

| File | Meaning |
|---|---|
| `page.tsx` | A route. Only this name creates one. |
| `layout.tsx` | Wraps every page below it, outermost first. |
| `not-found.tsx` | At the root only: the body of a claimed 404. |
| `(group)/` | Groups files without adding a URL segment. |
| `[param]/` | One segment, last in the path; needs `collectionPage()`. |
| `_private/`, other files | Colocated modules, never routes. |

Two pages with one URL shape are an error, across groups and parameter
names. A static page beside an item route (`notes/featured` next to
`notes/[slug]`) always wins: matching is static first, and the collection
refuses the slug `featured` (First's API answers `409 reserved_slug`; core
REST and wp-admin store a suffixed slug instead). Paths WordPress owns
(`/wp-admin`, `/wp-json`, `/feed`, ...) cannot be claimed.

Route IDs follow the design: `p:` plus the hex of the pattern, or
`export const route = { id: "notes.show" }` for an ID that survives moving
the file. Generated file names use a SHA-256 key of the app and route ID.

### WordPress identity

- Each static page is a **hidden, code-owned WordPress Page**. First creates it,
  stores the compiled body in `post_content`, sets `/` as the front page, and
  keeps one Page per route ID across rebuilds. Menus, SEO plugins and
  `get_permalink()` see a normal published Page whose link is the route URL.
- Code Pages are absent from the wp-admin Pages list, its counts and REST
  `context=edit` lists. `edit_post`/`delete_post` are denied on them, and a
  write that bypasses capabilities keeps the stored fields. Another URI for
  the Page (`/?page_id=6`) redirects to its route.
- An item route serves the collection's **existing posts**. There is no
  duplicate Page per item. A native WordPress Page at the same URL keeps
  ownership until it is moved or removed.

A temporary ownership conflict keeps the managed Page and its ID in place;
First resumes serving it when the conflict clears. A managed Page write failure
keeps the last successful route mapping and digest. WordPress continues
serving requests, an administrator sees a separate error notice, and First
retries reconciliation on the next request. Page publication, ownership metadata,
route mappings and front-page settings commit in one First transaction, under
the existing connection-owned database lock. An interrupted transaction rolls
back rather than leaving a published Page outside its ownership map.
Lock contention skips without changing any existing error notice. A failure
to acquire the lock for another reason produces an administrator notice and
retries on the next request.

### Data: what a page may do

A page runs once at build time. Data exists only per request, so values from
`load()`, `item` and `params` are placeholders that PHP fills per request,
as the visitor:

| You write | It becomes |
|---|---|
| `{item.title}`, `href={note.href}`, `` `${item.title}!` `` | Escaped text or attribute value, per request |
| `rows.map((row) => ...)` | A server-rendered loop |
| `count(rows)` | The viewer-bound query's row count, per request |
| `<Show when={v}>`, `<Show when={v} not>`, `<Show when={v} is="x">` | A server-side condition (JavaScript truthiness) |
| `orElse(v, "fallback")` | `v ?? "fallback"`, decided per request |
| `<RichText value={item.body} />` | The routed item's stored body, rendered through `the_content` |
| `link("/notes")` | That page's URL under the site's home URL |
| `content.query.<name>.findMany/findFirst({ where, orderBy, limit, offset })` | One query, run as the visitor |

Every read goes through First's own read pipeline with the visitor's `Viewer`:
read rules, draft visibility and field access apply exactly as on the REST
API. An anonymous visitor never sees a draft or a staff-only field, and no
page reads with the trusted viewer. A missing, draft, unreadable or
password-protected item is a real `404` with the not-found page. A suspended
account receives a plain `404` without rendering the custom error page.
Query values may use `item` and `params` fields, never another query's rows.

The checker proves primitive literal and immutable primitive `const`
conditions are static. Other conditions, operators and calls are refused
even when a helper's value might happen to be static. This keeps aliases,
destructured props and imported components from silently deciding a
request-dependent branch at build time. Use the explicit rendering helpers
for request data.

These are refused at build time, with `file:line:column`, before or while the
page runs:

| Refused | Code | Instead |
|---|---|---|
| `item.dek ? a : b`, `&&`, `\|\|`, `??`, `if`, `!` on request data | `dynamic_region` | `<Show>`, `orElse()` |
| `item.title + "!"`, comparisons, arithmetic | `dynamic_operator` | template strings, `<Show is>` |
| `item.title.toUpperCase()` and other calls | `dynamic_call` | render the value as stored |
| `rows.length`, `String(item.title).length`, computed property introspection | `dynamic_operator` | `count(rows)` for query counts; render fields directly |
| a request value in `className`, `id`, `style`, `on*`, `data-wp-*` | `dynamic_attribute` | branch with `<Show>` |
| `item.titel` | `unknown_field` (with a suggestion) | the schema's field name |
| `import { db } from "first"` | `trusted_db` | `load({ content })` |
| async components, `Date.now()`, `new Date()`, `Math.random()`, browser globals | `async_component`, `dynamic_call`, `browser_global` | `load()`, stored fields, an island |
| catch-all, parallel and intercepting routes, `template.tsx`, `page.md` | `route_shape` | supported files |

Markup errors come from First Blocks' own mapper and serializer (for example
`style_prop_unsupported`, `unmappable_element`); pages reuse it unchanged.
`orElse()` composes with `<Show>`, query values, metadata and island context;
empty strings and zero are retained. `<RichText>` takes the stored field
directly; render fallback text separately with `<Show not>`.

### Metadata, CSS and assets

`metadata` or `generateMetadata(props)` (not both) sets `title`,
`description`, `canonical` and `robots`. A layout's
`title: { default, template }` applies once to the page title. Canonical
defaults to the route URL under `home_url()`. First emits the only `<title>`
and canonical link on its routes; `robots` goes through `wp_robots`.

`import "./x.css"` is a global stylesheet; `import styles from "./x.module.css"`
is a class map with build-time class names; images and fonts imported from a
page become hashed files. Each route's CSS is enqueued before `wp_head`.

Every managed response sends `Cache-Control: private, no-store`. Rendered HTML
depends on the visitor, so no shared cache may keep it.

### Islands

`<Island namespace module actions context>` wraps plain HTML with
`data-wp-*` directives. Its module is bundled for the browser with
`@wordpress/interactivity` left to WordPress, registered as a script module,
and given each named action's URL and a REST nonce through `getConfig()`.
The server runs `wp_interactivity_process_directives()` on the island so the
first paint matches the client state. Island children are escaped HTML;
`on*` attributes, `style` and raw-text elements are refused.
Routes may reuse a namespace only with the same client module. A build that
assigns different modules to one namespace is refused.

### Escaping

Values never pass through the block parser. After WordPress renders the
blocks, placeholders are replaced by walking the HTML with WordPress's HTML
API: text with `set_modifiable_text`, attributes with `set_attribute` (which
applies `esc_url` to URL attributes). Only `http`, `https`, `mailto`,
root-relative and fragment URLs survive a per-request value. A value can
never produce markup, block delimiters or another placeholder.

### Not in this release

- Content-owned pages (`page.md`, `page.blocks.html`) and `first sync` for pages.
- Emitted block themes (`theme.config.ts`); layouts render in the plugin canvas.
- Native post passwords on routed items (such items are not served).
- React builds of shared components (`@spacefast/first-blocks/universal`).
- SEO-provider adapters, sitemaps of item routes, redirects for moved routes.
- A `first build` integration: run `first-pages build` after `first build`, locally,
  before publishing.
- Full-page HTML caching; managed routes bypass shared caches.
- Arbitrary TSX/React semantics: only the subset above compiles.
