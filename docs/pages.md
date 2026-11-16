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
├── login.tsx                  # wp-login.php's sign-in page, in the root layout
├── error.tsx                  # a render error (logged; the page shows only this)
├── about/page.tsx             # /about
├── colophon/page.md           # /colophon: a WordPress Page an editor can change
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
| `page.md` | A route whose content is a WordPress Page (see [Markdown pages](#markdown-pages)). |
| `route.ts` | HTTP handlers only (`GET`, `POST`, …), for a URL with no page. |
| `layout.tsx` | Wraps every page below it, outermost first. May export `guard`. |
| `not-found.tsx` | At the root only. |
| `login.tsx` | At the root only: renders wp-login.php's sign-in page (see [The sign-in page](#the-sign-in-page)). |
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
  the sign-in page (wp-login.php, or your `login.tsx`); a signed-in one gets a 403.
- `<Link href>` is an `<a>` that, once JavaScript runs, swaps only the router
  region (`@wordpress/interactivity-router`). `<Link prefetch>` prefetches on hover.
- `<Pagination page={search.page} pages={n} />` renders numbered links to the
  other pages of a listing as a `<nav>`: each is this URL with only `page` (or
  `param`) changed, page 1 drops it, the current page is `aria-current` and not
  a link, and Previous and Next appear only where there is a page to go to.
  Twelve pages show as `1 … 4 5 6 7 8 … 12`. The links are `<Link>`s: plain
  links without JavaScript, router navigation with it.
- `<Content value>` renders a post body through `the_content`. `<Html value>`
  places a literal as written and runs anything else through `wp_kses_post`.

`first build` writes `first/_generated/routes.d.ts`. With it, `<Link href>` is
checked against the app's routes and `PageProps<"notes/[slug]">` types
`params`. Point TypeScript at First's JSX types:

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "first" } }
```

## Forms

`<form action={subscribe}>` posts to an action imported from your server code,
and works without JavaScript:

```tsx
import { useFormState } from "first/app";
import { subscribe } from "../server";

export default function Page() {
  const state = useFormState(subscribe);
  return (
    <form action={subscribe}>
      {state.error ? <p>{state.error.message}</p> : null}
      {state.result ? <p>Subscribed {state.result.email}</p> : null}
      <input name="email" type="email" defaultValue={state.values.email ?? ""} />
      <button>Subscribe</button>
    </form>
  );
}
```

- The form posts form-encoded to the action's endpoint
  (`/__first/api/v1/actions/<name>`), with a hidden `_first_return` (the page's
  path and query). The action runs as the visitor, exactly as a JSON call runs
  it, and the answer is `303 See Other` back to that page.
- Fields read as the action's input types them: `integer()` and `number()` from
  their digits, `boolean()` from a checkbox (unchecked is `false`), select and
  reference lists from repeated names, an empty field as absent. A value that
  doesn't parse reaches the action's validation, which names the field. Uploads
  are refused (415); use the media API.
- What came back is a flash: a cookie sealed with the site's key, named by
  `?_flash=<id>` on the redirect, read once and deleted, gone after two
  minutes. Nothing is stored on the server. The marked URL is never served
  from or stored in a shared cache.
- `useFormState(action)` reads it: `{ pending, error, result, values }`.
  `error.fields` maps the field an input error is about to its message;
  `values` refills the form and never holds a password field. `pending` is
  always `false`: the page is rendered on the server, before or after the post.
- With JavaScript, the same post goes through `fetch` and the page updates in
  place, as a `<Link>` click does: the page the action comes back to is swapped
  into the router region, so client components, typed text, focus and scroll
  stay. The URL bar ends on the page without `?_flash`, and coming back to the
  same page adds no history entry. While the post is in flight the form has
  `aria-busy="true"` and its submit buttons are disabled; style it with
  `form[aria-busy="true"]`. If the request can't be sent, the browser posts the
  form itself. A form outside the root layout's region, one with
  `target` or a submit button with `formtarget`, posts as without JavaScript.
- A page with a form stays cacheable for signed-out visitors: it carries no
  nonce. A page rendered for a signed-in user carries the REST nonce; without
  it, the action runs signed out. A post with another site's `Origin` is
  refused.
- A `"use client"` component calls its action from `onSubmit` instead;
  `method` and `encType` on a form with an action are build errors.

## The sign-in page

WordPress's wp-login.php is the site's one sign-in page: wp-admin, a layout's `guard` and First
Identity all send people there. `first/app/login.tsx` renders it with the app's own markup,
inside the root layout and its stylesheets. Without the file, WordPress's own page shows.

```tsx
// first/app/login.tsx
import { LoginForm, type LoginProps } from "first/app";

export const metadata = { title: "Sign in" };

export default function Login({ messages, errors, registerUrl }: LoginProps) {
  return (
    <section className="signin">
      <h1>Sign in to Field Notes</h1>
      {messages.map((m) => <p className="notice">{m}</p>)}
      {errors.length > 0 ? <p role="alert">{errors.join(" ")}</p> : null}
      <LoginForm submitLabel="Sign in" notices={false} />
      {registerUrl ? <a href={registerUrl}>Create an account</a> : null}
    </section>
  );
}
```

- **WordPress still runs the sign-in.** The form posts to wp-login.php, so these all apply as
  they do to WordPress's own form:
  - the password check and every `authenticate` filter;
  - the hardening that answers an unknown user and a wrong password alike;
  - First Identity's attempt limits;
  - the second factor (Two Factor, including an Identity authenticator).
- **What renders it.** wp-login.php's sign-in view: the first visit, a failed attempt,
  `?loggedout=true`, "check your email" and `reauth`.
- **What keeps WordPress's screens.** Lost password, password reset, registration, the second
  factor step, logging out and the sign-in inside wp-admin.
- **What the page receives (`LoginProps`).**
  - `errors` and `messages`: plain text, WordPress's wording after its filters.
  - `login`: the login to fill in again after a wrong password.
  - `remember` and `redirectTo`.
  - `action`: wp-login.php.
  - `lostPasswordUrl`, and `registerUrl` (null unless anyone may register).
- **`<LoginForm />`.** It renders the fields wp-login.php reads (`log`, `pwd`, `rememberme`,
  `redirect_to`), plus what plugins add to the form, all with WordPress's ids, so CSS can target
  them. Its props:
  - `className` and `submitLabel`;
  - `notices={false}`: leaves the errors and messages to your page;
  - `links={false}`: drops "Lost your password?" and "Register".
  Anywhere other than `login.tsx` it is a sign-in form that comes back to its page.
- **Exports.** `login.tsx` exports `default` and `metadata` only. It has no URL of its own and no
  `guard`.
- **Caching and errors.** The page is `private, no-store` and `noindex`. If it throws, WordPress's
  own page shows and the error is logged, so nobody is locked out.

See [the decision](decisions/2026-11-15-one-sign-in-page.md).

## Comments

```tsx
import { Comments, type PageProps } from "first/app";

export default function Note({ item }: PageProps<"notes/[slug]">) {
  return <article><h1>{item.title}</h1><Comments for={item} /></article>;
}
```

`<Comments for={item} />` renders the item's thread as the visitor may read it
(approved comments, plus their own held ones) and a form that works without
JavaScript. The item's kind must turn `comments` on; otherwise the build stops
at the prop. Who may comment, moderation and reply depth belong to the kind, not
the component, and are enforced wherever a comment is created: the form, the
API and core's comment form all give the same answer. `comments: true` is
signed-in users only, first-time moderation, and replies three levels deep (a
deeper reply is refused); `comments: { guests, moderation, threaded,
closeAfterDays }` changes any of them ([Comments](config-api.md#comments)). See
[the decision](decisions/2026-11-14-comments.md).

## Search

```tsx
import { integer, text } from "first";
import { Search, SearchResults, type PageProps } from "first/app";

export const search = { q: text().optional(), page: integer().default(1) };

export default function Find({ search }: PageProps) {
  return <main><Search /><SearchResults kind="notes" q={search.q} page={search.page} /></main>;
}
```

`<Search>` is a search form that works without JavaScript: a `GET` of this page
(or `action`, a path on this site) with the query in `q`, never WordPress's own
`s`. The input takes at most 200 characters.

`<SearchResults q>` lists the rows that match, as the visitor may read them:
- a draft, or a match only in a field the visitor may not read, never shows and
  isn't counted;
- each result is its title, linked to its kind's URL, so `kind` must be a kind
  with a `url` (the build says so at the prop otherwise; for anything else,
  render the rows yourself with `kind.list({ search })`);
- one kind pages with `page`, the same parameter as `<Pagination>`, and its
  links keep `q`;
- with no `kind`, every searchable kind with a URL: up to `perPage` (10) rows
  each, under the kind's name, with a link to the rest at `?q=…&kind=<name>`.
  A `kind=` the search doesn't cover finds nothing;
- an empty `q` (or only spaces) renders nothing and reads nothing; a `q` longer
  than 200 characters, typed into the URL, shows a short message.

Matching is by word prefix (`gard` finds "gardens"), and the first 8 words of a
query count. On MySQL and MariaDB, words shorter than the server's minimum
(3 characters on InnoDB) and its stopwords don't match.

A page that searched (a non-empty `q`) is the visitor's alone: `private,
no-store`, `noindex` (header and meta tag), and never recorded for page-cache
purges, since every distinct query would be one more cached URL listing the
kind. The bare form page is cached like any other. See
[the decision](decisions/2026-11-14-search.md).

## Live regions

```tsx
import { notes } from "first:db";
import { Live } from "first/app";

export default async function Home() {
  const all = await notes.list({ orderBy: { id: "asc" } });
  return <Live id="notes"><ul>{all.map((n) => <li key={n.id}>{n.title}</li>)}</ul></Live>;
}
```

`<Live id="…">` marks part of a server page the browser keeps current. When
something the page read for it changes, the region is rendered again on the
server, as the visitor, and the page updates in place through the
Interactivity router. Client components and form fields in the page keep their
state. `id` is a literal (lowercase letters, digits, dashes) and unique on the
page.

- **When it updates.** Each region subscribes with the kinds its page read. With
  a realtime transport it updates on the next change notice for one of them,
  or after a write the visitor makes through the typed client. Without one it
  updates on the next poll, 2 to 30 seconds apart. `<Comments>` inside a region
  updates when a comment's approval changes. A region whose page read nothing
  updates on the poll only. Anything that changes without a First write (the
  clock, another plugin's SQL) shows within five minutes.
- **What it costs.** A page with a live region makes one uncached request to
  WordPress when it loads, then one per poll while the tab is visible (or on a
  notice), per open tab. That holds even when the page itself came from a page
  cache, and that first request is what brings a cached copy current. A tab
  opened in the background, or prerendered, costs nothing until it is shown;
  a page restored with the browser's back button asks once. An unchanged region
  usually costs no render (the change counters answer). A region that reads
  something the counters can't follow, such as a comment thread, renders once
  per poll. Think about this before putting `<Live>` on a busy cached page.
- At most four regions render per request; a page with more fills the rest on
  the next request.

See [the decision](decisions/2026-11-14-live-regions.md).

## Markdown pages

```md
---
title: Colophon
description: How this site is made.
---

Set in a system font, served by **WordPress**.
```

A `page.md` is a real WordPress Page. The file is its first version: the first
request after a build stores the Markdown as blocks in a Page, with the front
matter as its title, excerpt and status. From then on an editor changes it in
wp-admin, in the block editor, and the route shows what they saved.

- It renders inside the `layout.tsx` files above it, and a layout's `guard`
  protects it, like a `page.tsx`. Its `<title>` and description come from the
  stored Page, so an editor's change to either shows.
- Front matter: `title`, `description`, `status` (`published` or `draft`),
  `canonical`, `robots: { index, follow }` and `id` (keeps the Page when the
  file moves to another URL). Without `title`, the first
  `# Heading` is the title. Any other key is a build error at its line: fields
  of your own belong to a kind with `sync`, where they have a type.
- A later version of the file replaces the Page only while nobody edited the
  Page on the site. An edited Page keeps the site's version, and the log names
  the file. Removing the file leaves the Page in WordPress; nothing is deleted.
  The exception is taking a page away from visitors: a file that newly says
  `status: draft`, or moves under a `guard`, unpublishes an edited Page too,
  and leaves its text alone.
- The route's path is the Page's address. WordPress's own address for it
  redirects there, and the editor's Preview button shows unsaved changes on the route.
- A draft is a 404 for visitors and shows to people who can edit it. A Page
  under a `guard` is stored private, so WordPress's REST API, search, sitemap
  and feeds never list it. A password set in wp-admin locks the body for every
  visitor.
- It has a Markdown twin at `/colophon.md` and a line in `/llms.txt` when
  anyone may read it, and none otherwise.
- A `page.md` is one page with one URL, so it can't sit below `[slug]`. For
  many Markdown files, sync a folder into a kind and render it from a `page.tsx`.

The ruling and its alternatives are in
[the decision](decisions/2026-11-13-content-pages.md).

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

### WordPress identity

Each `page.tsx` route without parameters is also a **hidden, code-owned
WordPress Page**, so the rest of WordPress sees the page as one of its own.

- Menus, SEO plugins and `get_permalink()` see a normal published Page whose
  link and canonical URL are the route's URL. `/` is the front page
  (`page_on_front`), unless the site already chose a front page of its own.
- The Page keeps its ID across builds, so a menu item that points at it keeps
  working. Its title is the page's literal `metadata.title`, else its folder
  name.
- The route ID is the folder path (`notes/featured`). A page that sets its own
  keeps its Page when the file moves: `export const route = { id: "notes.featured" }`
  in a `page.tsx`, or `id: notes.featured` in a `page.md`'s front matter. The old
  URL then redirects to the new one. Two pages with one ID are a build error
  at the second.
- A route under a layout `guard` stores its Page private, so search, feeds,
  the REST API and the sitemap never list it.
- Code Pages are absent from the wp-admin Pages list, its counts and REST
  `context=edit` lists. `edit_post` and `delete_post` are denied on them, and a
  write that bypasses capabilities keeps the stored fields.
- WordPress's own addresses for the Page (its slug, `?page_id=`) redirect to
  the route.
- A route that goes away moves its Page to the trash; nothing is deleted. A URL
  that another published Page already owns is not taken over: the route still
  renders, without a Page, and the log says so.

A `page.md` route owns a real Page that editors change ([Markdown
pages](#markdown-pages)); a route with parameters has no Page.

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
- `useLive(kind, query, { enabled })` is a list read the page keeps current, as
  `{ data, error, loading }`. The server answers it in the first render as the
  visitor (`First\Live\Module::evaluate`, with its token), and the page
  subscribes to the same read through the app's typed client (`@first/client`),
  so another visitor's write shows with no reload: within the client's poll (2
  to 30 seconds) without a push transport, at once with one. The query reads
  props and literals, which both sides have; a query that follows state is a
  build error for now. There is no `seed` option: the server's answer is the
  seed. The names match the generated client's React `useQuery`, for external
  React frontends.
- Calling an imported action posts to its endpoint with the REST nonce, as the
  visitor.
- A list over state or props, `items.map((item) => <li key={item.id}>…</li>)`,
  and a conditional over elements, `{open && <p>…</p>}` or
  `{empty ? <em>…</em> : <b>…</b>}`, re-render in the browser from a
  `<template>`. Each item and each branch is one element; each item has a `key`.
- The component returns one element. React context, third-party React
  components, npm imports and `dangerouslySetInnerHTML` are refused at the line.

See [rendering.md §4.1](spec/rendering.md#41-client-components) for the full
mapping and [`examples/full-site`](../examples/full-site) for a site that uses one.

## Static output

Pages render on WordPress per request by default. Two settings prebuild them
instead, in [Astro](https://docs.astro.build/en/guides/on-demand-rendering/)'s
words. The design and measurements are in
[the decision record](decisions/2026-11-13-static-output.md).

| You want | Write |
|---|---|
| Some pages prebuilt, the rest rendered per request, on one WordPress | `export const prerender = true` in those pages |
| A whole site as static files, with no WordPress serving it | `defineConfig({ output: "static" })`, then `first export` |
| Static files from a WordPress that editors use somewhere else | the same, with `first export --site https://cms.example.com` |

A prebuilt page is what a signed-out visitor sees, rendered by the page's own
compiled code. So it can't depend on the request. These are build errors at
the page, each with its fix:

- a layout `guard` above the page;
- `export const search`;
- a dynamic segment the build can't list;
- calling `is_user_logged_in`, `current_user_can` or `get_current_user_id`.

### Which URLs a dynamic page has

A page whose folders serve a kind's `url` (`notes/[slug]` for
`url: "/notes/:slug"`) is built once per item a signed-out visitor may read.
Drafts and rows an access rule hides are never built.

Any other dynamic page lists its URLs with `staticParams`, Astro's
`getStaticPaths`:

```tsx
// first/app/tags/[tag]/page.tsx
import type { PageProps, StaticParams } from "first/app";

export const prerender = true;

export async function staticParams(): Promise<StaticParams<"tags/[tag]">> {
  return ["field", "lab notes"].map((tag) => ({ tag }));
}

export default function Tag({ params }: PageProps<"tags/[tag]">) {
  return <h1>{params.tag}</h1>;
}
```

`staticParams` runs as a signed-out visitor, so it can read the database.

### Prebuilt pages on WordPress (`prerender = true`)

- **When the files are made.** After a deploy, an Action Scheduler action renders each prebuilt URL
  and writes its HTML and Markdown to `wp-content/cache/first-prebuilt/`.
- **How they are served.** The app answers from the file before WordPress parses the request, with
  the same `Cache-Control` as a cacheable render and the header `X-First-Prebuilt: 1`.
- **What still renders per request.** A signed-in visitor, a request with a query string, and a URL
  whose file isn't written yet.
- **After a write.** A write that changes what a prebuilt page shows deletes that page's files at
  once and schedules its rebuild. Until the rebuild runs, the page renders per request, so nobody
  sees the old content. Other pages keep their files.
- **The rest of the site.** Markdown twins, `llms.txt` and the sitemap are unchanged.
- **Hosts that can't reach their own address.** The rebuild fetches the page from the site's own
  address. A host where that fails sets the `first_prebuild_url` filter.

### A static site (`first export`)

```sh
first export                                       # writes first/dist/static/
first export --site-url https://docs.example.com   # also writes sitemap.xml and canonical links
first export --base /docs                          # for a site served below /docs/
```

The project must say `output: "static"`, where every page is prebuilt.
`prerender = false` is a build error there.

- **Where the content comes from.** Without `--site`, `first export` starts a throwaway WordPress on
  SQLite (the one `first dev` uses) with the build installed and `first/content/` loaded, renders
  every page, and removes the site.
- **The URL layout.** It is the one GitHub Pages, Netlify, Cloudflare Pages and most static servers
  answer.

| URL | File |
|---|---|
| `/` | `index.html`, with `index.md` |
| `/docs/intro` | `docs/intro.html`, with `docs/intro.md` |
| an unknown URL | `404.html` |
| `/llms.txt`, `/robots.txt`, `/sitemap.xml` | the files of those names; `sitemap.xml` only with `--site-url` |
| a moved item's old URL | a line in `_redirects`, and a page that redirects in the browser |
| stylesheets, images, fonts, the Interactivity API and router modules, client component stores | the path WordPress serves them from (`wp-content/…`, `wp-includes/…`) |

**What a static page can't do.** The export refuses each of these with the page and the fix:

- **A client component that calls an action.** There is no server. With `--site`, a public action
  (`access: "anyone"`) is called on the hosted site instead.
- **A link to a URL the export doesn't contain.** For example a page left out, or WordPress's
  sign-in or comment form. With `--site`, sign-in, comment and `wp-admin` links go to the hosted
  site.
- **A page that redirects, or that `staticParams` lists but that renders a 404.**

### WordPress as the CMS (`first export --site`)

Editors work on a hosted WordPress running the app. `first export --site https://cms.example.com`
renders that site's published content with this checkout's pages.

- **Credentials.** It needs an editor's credential in `FIRST_APP_PASSWORD` (`user:application-password`)
  or `FIRST_TOKEN`, the same as `first sync`.
- **The site must run this checkout's build.** Otherwise the export stops and says to deploy first.
- **Rebuilding on publish.** Add the hosted site's `webhooks` config to call a CI job on publish
  (`events: ["*"]`). The job runs `first export --site …` and uploads `first/dist/static/`.
- **Client components** call public actions on the hosted site, across origins.
- **Comments and sign-in** happen on the hosted site.
- **Guarded pages** can't be exported: a static file is the same for everyone.

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
