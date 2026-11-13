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

## Client components

A file that starts with `"use client"` is a client component. Its first
render is ordinary server HTML; in the browser the WordPress Interactivity API
takes it over in place, with no second render and no bundle of its own.

```tsx
// first/components/CheerButton.tsx
"use client";
import { useState } from "first/client";
import { cheer } from "../actions";

export function CheerButton({ noteId, count: initial }: { noteId: number; count: number }) {
  const [count, setCount] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy} onClick={async () => { setBusy(true); setCount((await cheer({ noteId })).count); setBusy(false); }}>
      {count === 1 ? "1 cheer" : `${count} cheers`}
    </button>
  );
}
```

- `useState`, values derived from state and props, handlers, `useEffect`,
  `useMount`, `useEvent`, `useRef` and `sharedState` come from `"first/client"`.
- Calling an imported action posts to its endpoint with the REST nonce, as the
  visitor.
- The component returns one element. React context, third-party React
  components, npm imports and `dangerouslySetInnerHTML` are refused at the line.

See [rendering.md §4.1](spec/rendering.md#41-client-components) for the full
mapping and [`examples/full-site`](../examples/full-site) for a site that uses one.

## Publish on Spacefast

`first/app/` is ordinary app source. `first sources` captures the pages,
components, stylesheets and SVGs with the rest of the app, and the host's
`first compile-sources` compiles them into the app plugin, with no Node and
no separate render step. The compiled manifest lists every page in
`pagePaths` and every handler in `routes`, so the host can hand those URLs to
WordPress.

## From the old `pages/` renderer

The separate `pages/` renderer (`@spacefast/first-pages`, `first-pages build`
and `first/pages.json`) is gone. A project that still has `pages/` beside
`first.config.ts` fails to build with the move as the fix, and a host refuses a
capture that carries old-renderer pages. To port:

| Before | Now |
|---|---|
| `pages/<path>/page.tsx` | `first/app/<path>/page.tsx` |
| `load({ content })` returning queries | `await db.query.<kind>…` in the page; reads run as the visitor |
| `collectionPage("notes")` | `url: "/notes/:slug"` on the kind and `first/app/notes/[slug]/page.tsx`, which receives `item` |
| `<Show when={x}>`, `orElse(x, d)`, `count(list)` | `{x && …}`, `x ?? d`, `list.length` |
| `<RichText value>` | `<Content value>` from `"first/app"` |
| `<Island>` with a hand-written store | a `"use client"` component |
| `link("/x")` | `<Link href="/x">` from `"first/app"` |
| `generateMetadata` | `export const metadata = (props) => ({ … })` |
