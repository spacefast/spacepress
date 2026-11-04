# Pages (optional)

`@spacefast/zero-pages` adds TSX pages to a Zero app. Pages compile once, at
build time, to Gutenberg block markup. WordPress renders that markup on every
request, with the visitor's own data. It is an add-on: an app without `pages/`
builds and runs exactly as before. Zero core never loads this package or Blocks.

This is the first implementation of the optional pages contract in
[the pages design](design-pages-and-agents.md). It covers static pages,
layouts, collection item routes, listings, metadata, CSS and assets, and one
Interactivity API island. Its limits are listed under [Not in this release](#not-in-this-release).

## A site in five files

```text
site/
├── zero.config.ts            # collections, access rules, actions: unchanged
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
import { Island, RichText, Show, collectionPage, orElse, type CollectionPageContext, type CollectionPageProps, type Metadata } from "@spacefast/zero-pages";
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

## Build and install

```sh
zero build site                     # the backend, and the compiled schema pages read
zero-pages build site               # writes site/.zero/wp-content/plugins/zero-pages-<app>/
```

`zero-pages build [project] [--out <wp-content>] [--json]` exits `0` when it
built (or there is no `pages/`), `1` with diagnostics, `2` on usage errors.
Install the `zero-pages-<app>` plugin beside the app plugin and activate it.
On a build error nothing is written, and the previous plugin stays in place.

Pages read the app's schema from `zero build` output (`zero/client/schema.ts`,
`zero/migrations/snapshot.json`). They never execute `zero.config.ts`, and a
page cannot import runtime values from `"zero"`; use type imports and name
collections as strings.

## Files and routes

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
refuses the slug `featured` (Zero's API answers `409 reserved_slug`; core
REST and wp-admin store a suffixed slug instead). Paths WordPress owns
(`/wp-admin`, `/wp-json`, `/feed`, ...) cannot be claimed.

Route IDs follow the design: `p:` plus the hex of the pattern, or
`export const route = { id: "notes.show" }` for an ID that survives moving
the file. Generated file names use a SHA-256 key of the app and route ID.

## WordPress identity

- Each static page is a **hidden, code-owned WordPress Page**. Zero creates it,
  stores the compiled body in `post_content`, sets `/` as the front page, and
  keeps one Page per route ID across rebuilds. Menus, SEO plugins and
  `get_permalink()` see a normal published Page whose link is the route URL.
- Code Pages are absent from the wp-admin Pages list, its counts and REST
  `context=edit` lists. `edit_post`/`delete_post` are denied on them, and a
  write that bypasses capabilities keeps the stored fields. Another URI for
  the Page (`/?page_id=6`) redirects to its route.
- An item route serves the collection's **existing posts**. There is no
  duplicate Page per item.

A temporary ownership conflict keeps the managed Page and its ID in place;
Zero resumes serving it when the conflict clears. A managed Page write failure
keeps the last successful route mapping and digest. WordPress continues
serving requests, an administrator sees a separate error notice, and Zero
retries reconciliation on the next request.

## Data: what a page may do

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

Every read goes through Zero's own read pipeline with the visitor's `Viewer`:
read rules, draft visibility and field access apply exactly as on the REST
API. An anonymous visitor never sees a draft or a staff-only field, and no
page reads with the trusted viewer. A missing, draft, unreadable or
password-protected item is a real `404` with the not-found page. Query
values may use `item` and `params` fields, never another query's rows.

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
| `import { db } from "zero"` | `trusted_db` | `load({ content })` |
| async components, `Date.now()`, `new Date()`, `Math.random()`, browser globals | `async_component`, `dynamic_call`, `browser_global` | `load()`, stored fields, an island |
| catch-all, parallel and intercepting routes, `template.tsx`, `page.md` | `route_shape` | supported files |

Markup errors come from Zero Blocks' own mapper and serializer (for example
`style_prop_unsupported`, `unmappable_element`); pages reuse it unchanged.
`orElse()` composes with `<Show>`, query values, metadata and island context;
empty strings and zero are retained. `<RichText>` takes the stored field
directly; render fallback text separately with `<Show not>`.

## Metadata, CSS and assets

`metadata` or `generateMetadata(props)` (not both) sets `title`,
`description`, `canonical` and `robots`. A layout's
`title: { default, template }` applies once to the page title. Canonical
defaults to the route URL under `home_url()`. Zero emits the only `<title>`
and canonical link on its routes; `robots` goes through `wp_robots`.

`import "./x.css"` is a global stylesheet; `import styles from "./x.module.css"`
is a class map with build-time class names; images and fonts imported from a
page become hashed files. Each route's CSS is enqueued before `wp_head`.

Every managed response sends `Cache-Control: private, no-store`. Rendered HTML
depends on the visitor, so no shared cache may keep it.

## Islands

`<Island namespace module actions context>` wraps plain HTML with
`data-wp-*` directives. Its module is bundled for the browser with
`@wordpress/interactivity` left to WordPress, registered as a script module,
and given each named action's URL and a REST nonce through `getConfig()`.
The server runs `wp_interactivity_process_directives()` on the island so the
first paint matches the client state. Island children are escaped HTML;
`on*` attributes, `style` and raw-text elements are refused.
Routes may reuse a namespace only with the same client module. A build that
assigns different modules to one namespace is refused.

## Escaping

Values never pass through the block parser. After WordPress renders the
blocks, placeholders are replaced by walking the HTML with WordPress's HTML
API: text with `set_modifiable_text`, attributes with `set_attribute` (which
applies `esc_url` to URL attributes). Only `http`, `https`, `mailto`,
root-relative and fragment URLs survive a per-request value. A value can
never produce markup, block delimiters or another placeholder.

## Not in this release

- Content-owned pages (`page.md`, `page.blocks.html`) and `zero sync` for pages.
- Emitted block themes (`theme.config.ts`); layouts render in the plugin canvas.
- Native post passwords on routed items (such items are not served).
- React builds of shared components (`@spacefast/zero-blocks/universal`).
- SEO-provider adapters, sitemaps of item routes, redirects for moved routes.
- A `zero build` integration: run `zero-pages build` after `zero build`.
- Full-page HTML caching; managed routes bypass shared caches.
- Arbitrary TSX/React semantics: only the subset above compiles.
