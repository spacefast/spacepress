# Pages (optional)

A TypedPress app can render its own front end from `tp/app/`: React-style TSX
that the compiler turns into PHP, rendered by WordPress on each request. It is
one way, TSX to WordPress. It is optional: without `tp/app/`, WordPress
renders the site with its theme, and nothing here loads.

## `tp/app/`

```text
tp/app/
├── layout.tsx                 # wraps every page: export const metadata, default component
├── page.tsx                   # /
├── not-found.tsx              # the 404 for URLs no route serves, and for notFound()
├── login.tsx                  # wp-login.php's sign-in page, in the sign-in block template
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
| `layout.tsx` | Wraps every page below it, outermost first. May export `guard` and `template` ([Block templates](#block-templates)). |
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
// tp/app/notes/[slug]/page.tsx
import { db } from "typedpress";
import { Content, notFound, type PageProps, type RouteRequest } from "typedpress/app";

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
- Declare page access once. For example, `export const guard = "admin"` on
  `page.tsx` protects that page. On `layout.tsx` it protects the whole section.
  A page inherits every enclosing layout's rule. A signed-out visitor who opens
  a protected URL goes to sign-in. A signed-in visitor without the role gets 403.
  On a page with HTTP methods, a single `guard` applies to the page and its methods.
  Use `guard = { page: "subscriber", handlers: "admin" }` for different permissions,
  or `guard = { handlers: "admin" }` for a public page with a protected method.
  A separate `route.ts` declares its own `guard` or a webhook `signature`.
  To restrict the underlying records in the WordPress API, set their read permissions too.
  Independently published posts can still appear in the WordPress posts sitemap.
  Standalone plugins built with schema format 5 need the matching runtime.
- Write `<Link href="/staff" prefetch>Staff</Link>`. The compiler records when a
  destination requires a session. Guests go straight to sign-in and return to
  the destination afterward. Signed-in visitors get normal navigation and
  hover prefetch. A callback that might allow guests runs at the destination.
  On a prebuilt page the ordinary destination link works for every visitor.
  For a local destination whose sign-in requirement is known only to the caller,
  `requireAuth` opts into the shortcut on a server-rendered page.
- `<Pagination page={search.page} pages={n} />` renders numbered links to the
  other pages of a listing as a `<nav>`: each is this URL with only `page` (or
  `param`) changed, page 1 drops it, the current page is `aria-current` and not
  a link, and Previous and Next appear only where there is a page to go to.
  Twelve pages show as `1 … 4 5 6 7 8 … 12`. The links are `<Link>`s: plain
  links without JavaScript, router navigation with it.
- `<Content value>` renders a post body through `the_content`. `<Html value>`
  places a literal as written and runs anything else through `wp_kses_post`.

`typedpress build` writes `tp/_generated/routes.d.ts`. With it, `<Link href>` is
checked against the app's routes and `PageProps<"notes/[slug]">` types
`params`. Point TypeScript at TypedPress's JSX types:

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "typedpress" } }
```

## Forms

`<form action={subscribe}>` posts to an action imported from your server code,
and works without JavaScript:

```tsx
import { useFormState } from "typedpress/app";
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
  (`/__tp/api/v1/actions/<name>`), with a hidden `_tp_return` (the page's
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
  into the router region, so client components and scroll stay. An input whose
  server HTML has a `value` (a `defaultValue`, or one refilled from `values`)
  is reset to what the server rendered; don't count on typed text staying. The
  URL bar ends on the page without `?_flash`, and coming back to the same page
  adds no history entry.
- While the post is in flight the form has `aria-busy="true"` and its submit
  buttons (with `form="id"` ones outside it) are disabled; style it with
  `form[aria-busy="true"]`. A second submit then sends nothing.
- A post is never sent twice. If no page comes back (a 500, a dropped
  connection), the form is enabled again and shows a message in an alert
  (`.tp-form-error`). The browser posts the form itself only when the router
  script can't load. A form outside the root layout's region, one with
  `target`, `enctype` or a submit button with `formtarget` or `formenctype`,
  posts as without JavaScript. An answer that comes back to a page without a
  router region loads that page with a full navigation. A page the action
  comes back to that is now a 404 (after a delete, say) is shown in place, as
  without JavaScript.
- After the swap, the page's first `role="status"` element (your success
  message) is announced to screen readers, or the page title if there is none.
- A page with a form stays cacheable for signed-out visitors: it carries no
  nonce. A page rendered for a signed-in user carries the REST nonce; without
  it, the action runs signed out. A post with another site's `Origin` is
  refused.
- A `"use client"` component calls its action from `onSubmit` instead;
  `method` and `encType` on a form with an action are build errors.

## The sign-in page

WordPress's wp-login.php is the site's one sign-in page: wp-admin, a layout's `guard` and TypedPress
Identity all send people there. `tp/app/login.tsx` renders it with the app's own markup,
inside the sign-in block template (`tp-login`) and its stylesheets. Without the file,
WordPress's own page shows until the owner edits that template (see [Block
templates](#block-templates)).

```tsx
// tp/app/login.tsx
import { LoginForm, type LoginProps } from "typedpress/app";

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
  - TypedPress Identity's attempt limits;
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
  Anywhere other than `login.tsx` it is a sign-in form that comes back to its page. When
  plugins add fields to the form (a captcha, a nonce), that page is `private, no-store`.
- **Plugins on the page.** `login_head`, `login_footer`, `login_form` and the `login_message`
  notice work on `login.tsx`'s page as on WordPress's own, so captcha and anti-bot plugins apply.
- **Exports.** `login.tsx` exports `default` and `metadata` only. It has no URL of its own and no
  `guard`.
- **Caching and errors.** The page is `private, no-store` and `noindex`. If it throws, WordPress's
  own page shows and the error is logged, so nobody is locked out.

See [the decision](decisions/2026-11-15-one-sign-in-page.md).

## Block templates

Every `tp/app/` page renders inside the active block theme's templates. The page is the
content, and WordPress renders the rest: the theme's header and footer template parts, its global
styles, and whatever the owner changed in the Site Editor. The page's HTML is the `tp/page`
block ("Page content"), which a template places where the page goes.

TypedPress registers these templates with `register_block_template()`. They are listed in the Site
Editor, and an owner can edit them and reset them there:

| Template | What it holds | Used by |
|---|---|---|
| `tp-page` ("App page") | The theme's `header` part, the page, the theme's `footer` part. | Every page, unless a file picks another. |
| `tp-blank` ("App page without header and footer") | The page alone. | `export const template = "blank"`, and layouts that place `<TemplatePart>`. |
| `tp-login` ("Sign in") | The header part, `login.tsx`, the footer part. With no `login.tsx`, the `tp/login-form` block. | wp-login.php's sign-in view. |
| `404` | The theme's own 404 template. With `not-found.tsx`, TypedPress's default content is the header part, the page and the footer part. | A URL nothing serves, and `notFound()`. |

**Choosing a template.** A page or a layout may export `template`. The page's own export wins,
then the nearest layout's:

```tsx
// tp/app/(marketing)/layout.tsx
export const template = "blank";      // no theme header or footer: this layout draws its own
// tp/app/landing/page.tsx
export const template = "landing";    // a template the theme or the Site Editor provides
```

- `"theme"` (the default) is `tp-page`, and `"blank"` is `tp-blank`.
- Any other slug names a template the theme, a plugin or the owner made. A template without
  the Page content block can't show a page: the page renders in `tp-page` instead and the log
  says so.

**Layouts.** Layouts nest by folder and run only for the routes under them, as in Astro. Under
`tp-page`, the theme's header and footer are the site's chrome, so the root `app/layout.tsx`
does not render. Its `metadata` (the title template, the description) and its `guard` still
apply. The root layout renders in three cases:

- it exports `template` itself (`"theme"` keeps the theme's parts and renders it inside them);
- the route renders in another template (`"blank"`, or a slug);
- the active theme is a classic theme, where TypedPress prints the whole document as before.

Nested layouts always render. A route group's outermost layout (`app/(site)/layout.tsx`) is a
root layout too. `typedpress check` and `typedpress build` print a hint for a root layout that
renders markup around `{children}` and exports no `template`.

**`<TemplatePart>`.** A layout that wants the theme's parts in its own arrangement places them
itself:

```tsx
// tp/app/studio/layout.tsx
import { TemplatePart, type LayoutProps } from "typedpress/app";

export default function Studio({ children }: LayoutProps) {
  return (
    <div className="studio">
      <TemplatePart slug="header" tagName="header" />
      {children}
      <footer>Studio footer</footer>
    </div>
  );
}
```

`<TemplatePart slug tagName? className? />` renders `core/template-part`, so it shows the owner's
edits to the part. A layout that imports it renders in `tp-blank` unless it exports a
`template`.

**What stays the same.**

- Data reads, access rules, guards, caching and purges are the router's, whatever the template.
  The template adds the theme's markup and nothing else.
- WordPress writes the `<title>` from the page's `metadata` (through `pre_get_document_title`).
  TypedPress adds the description, canonical and social tags to `wp_head`.
- `<Link>` navigation swaps the page's router region, which sits inside the template. The theme's
  header and footer stay on the screen. A link to a page that renders in another template loads
  the whole page, so the chrome changes with it (`data-tp-template` on the body and the link).
- Saving, trashing or deleting a template, a template part, Global Styles or a navigation menu
  removes the prebuilt pages and announces a whole-host purge (`/*`) to the page cache. A saved
  template that is trashed or a draft doesn't render; the theme's or TypedPress's answers.
- A page whose template renders a Login form block is never shared: it is `private, no-store`
  when a plugin adds per-request fields to the form.
- Forms, `<Live>` regions and client components render inside the page, as before.

**The 404 and sign-in pages.** Both are templates an owner edits in the Site Editor. The owner can
add text around the Page content block, or replace it. For the sign-in page, the replacement is
the **Login form** block (`tp/login-form`): it renders the same form as `<LoginForm />`, posts
to wp-login.php and shows its errors. That lets an owner rebuild the sign-in page without code.
Once the owner has saved a `tp-login` template, wp-login.php renders it even when the app has
no `login.tsx`. Without `login.tsx`, the Page content block shows nothing on the sign-in page, so
a saved template that has no Login form block renders TypedPress's default content instead and
the log says so. Nobody is left without a form.

See [the decision](decisions/2026-11-16-pages-in-block-templates.md).

## Comments

```tsx
import { Comments, type PageProps } from "typedpress/app";

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
import { integer, text } from "typedpress";
import { Search, SearchResults, type PageProps } from "typedpress/app";

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
import { notes } from "typedpress:db";
import { Live } from "typedpress/app";

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
  updates on the poll only. Anything that changes without a TypedPress write (the
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
// tp/app/layout.tsx
import "./site.css";
// tp/app/notes/[slug]/page.tsx
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
- Every file is copied into the app plugin under `tp/app/assets/`, named by a
  hash of its bytes, with a year's cache. A changed file gets a new URL.
- These are refused at the line, with the fix: `@import` (import each file from
  TSX), a relative `url(...)` (put the file in `public/` and write
  `url(/name.png)`), `:global`, `:local` and `composes` in a module, and an SVG
  imported by a `"use client"` component (pass the URL as a prop). Other files,
  binary images and fonts among them, go in `public/`, by their URL.

For Tailwind and npm-backed browser scripts, use the
[`@typedpress/frontend` build](../packages/frontend/README.md). It writes
hashed browser assets and metadata that a route or layout can select.

## Scripts

```tsx
// tp/app/layout.tsx
export const metadata = { scripts: ["/app.js", "https://cdn.example.com/widget.js"] };
```

- `scripts` in `metadata` lists the script modules a page loads: a path on this
  site, which is a file in `public/` (`/app.js` is `public/app.js`), or an
  `https://` URL. Each layout's and the page's all load, once each, as
  `<script type="module">`, through WordPress's script modules.
- A `<script>` element in TSX is a build error. A page can render a custom
  element (`<my-widget data-id={id}></my-widget>`) that such a module defines.
- For state and handlers in your own components, write a
  [client component](#client-components) instead: it needs no script file.
- TypedPress does not bundle: a module in `public/` is served as written, so it
  imports other files by URL, not npm packages by name.

## Styles from WordPress

A page inherits the active WordPress theme's colors, fonts, typography and root
spacing by default. Do not reset `body` to an app palette or font to get started.
Changes made in the Site Editor apply to app pages too.

A page prints WordPress's global styles in its head, as a block theme's own
templates do: every `theme.json` preset as a CSS variable
(`--wp--preset--color--<slug>`, `--wp--preset--font-size--<slug>`,
`--wp--preset--font-family--<slug>`, `--wp--preset--spacing--<slug>`), the site
owner's Global Styles over the theme's values, then the Site Editor's
Additional CSS. The site icon prints too. Write CSS against the variables and a
change in TypedPress Admin's Styles screen or the Site Editor reaches your pages
without a deploy:

```css
/* tp/app/site.css */
.card {
	background: var(--tp--color--background);
	color: var(--tp--color--foreground);
	padding: var(--tp--spacing--block);
}
```

The app's head also exposes semantic variables for the current theme. Their
values come from WordPress's merged theme and owner settings on each request,
so they work with an installed theme whose preset names differ from the project.

| Variable | Value from WordPress |
| --- | --- |
| `--tp--color--background`, `--tp--color--foreground` | Body background and text color |
| `--tp--color--link` | Link color, or the body's text color when none is set |
| `--tp--font-family--body`, `--tp--font-size--body`, `--tp--line-height--body` | Body typography |
| `--tp--spacing--block` | Block gap, the vertical gap when it has separate axes |
| `--tp--spacing--page` | Root left padding |
| `--tp--width--content`, `--tp--width--wide` | Theme content and wide widths |

These variables do not restyle the body. Leave body typography inherited unless
a component needs an explicit value. The site's browser colors and inherited
typography remain the fallback when a theme specifies none.

The values start from code. The active theme's `theme.json` (TypedPress's
`typedpress-default` when no installed theme is active) is the base, and
`tp/theme.json` in the project is merged over it: a theme.json document
with `version`, `settings` and `styles` only. This file is an explicit choice to
give the site app-specific theme defaults. Without it, the installed theme is
used as-is. A component can also choose custom scoped CSS without changing the
site's default design.

```json
{
	"version": 3,
	"settings": {
		"color": { "palette": [{ "slug": "primary", "color": "#0a7", "name": "Primary" }] }
	}
}
```

The app plugin ships it, and WordPress merges it in the theme's place: the
owner's Global Styles still override it, and resetting them returns to it.

To keep what was designed on a site, pull it into the project:

```sh
typedpress styles pull            # the dev site: what you set in Styles on `typedpress dev`
typedpress styles pull --site @prod
typedpress styles pull --check    # exit 1 when the site's styles differ from tp/theme.json
```

It writes the project's file with the site's Global Styles merged over it to
`tp/theme.json`. Commit it; the next deploy starts from it. `typedpress dev`
never pulls on its own.

### Tailwind

`typedpress build` always writes `tp/_generated/theme.css`, including when the
project has no `tp/theme.json`. It contains Tailwind v4 tokens for the runtime
roles above, plus the presets of `typedpress-default` and `tp/theme.json`.

```css
@theme inline {
  --color-wp-background: var(--tp--color--background);
  --color-wp-foreground: var(--tp--color--foreground);
  --color-wp-link: var(--tp--color--link);
  --font-wp-body: var(--tp--font-family--body);
  --text-wp-body: var(--tp--font-size--body);
  --spacing-wp-block: var(--tp--spacing--block);
  --container-wp-content: var(--tp--width--content);
  --color-primary: var(--wp--preset--color--primary);
  --font-system: var(--wp--preset--font-family--system);
  --spacing-wp-40: var(--wp--preset--spacing--40);
}
```

TypedPress doesn't run Tailwind. A project that uses it runs Tailwind's CLI and
imports its output, a plain stylesheet, from a layout:

```css
/* tailwind.css, the CLI's input: theme and utilities, without Preflight. */
@import "tailwindcss/theme.css" layer(theme);
@import "./tp/_generated/theme.css";
@import "tailwindcss/utilities.css";
@source "./tp";
```

```sh
npx @tailwindcss/cli -i tailwind.css -o tp/app/tailwind.css --watch
```

```tsx
// tp/app/layout.tsx
import "./tailwind.css";
```

Use `bg-wp-background text-wp-foreground`, `text-wp-link`, `font-wp-body`,
`text-wp-body leading-wp-body`, `gap-wp-block`, `p-wp-page` and
`max-w-wp-content` or `max-w-wp-wide`. They follow the active theme and owner
edits without rebuilding Tailwind. Omit typography classes to inherit the
surrounding text styles. Skipping Tailwind's Preflight preserves WordPress's
heading, body and block defaults. Utilities are imported without a CSS layer so
an explicitly applied utility can override WordPress's unlayered style rules.

`bg-primary` reads `--wp--preset--color--primary`, so it follows that named
preset's current value. A preset added on the site has its variable at once and
a token after `typedpress styles pull`. The `wp-` semantic names above are
reserved; use another preset slug to name a custom utility. Spacing tokens are `spacing-wp-<slug>` so
WordPress's numbered sizes don't replace Tailwind's own scale. The decision is
in [styles from WordPress](decisions/2026-11-15-styles-from-wordpress.md).

## On WordPress

The router answers on `template_redirect` and renders the page in a block template (see [Block
templates](#block-templates)). wp-admin, login,
`/wp-json`, feeds, robots and TypedPress's own paths never reach it. When
`tp/app/` exists, a URL no route serves renders `not-found.tsx`. URLs
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
- A route with a page or layout `guard` stores its Page private, so search, feeds,
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
// tp/components/CheerButton.tsx
"use client";
import { useState } from "typedpress/client";
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
  `useMount`, `useEvent`, `useRef` and `sharedState` come from `"typedpress/client"`.
- `useLive(kind, query, { enabled })` is a list read the page keeps current, as
  `{ data, error, loading }`. The server answers it in the first render as the
  visitor (`TypedPress\Live\Module::evaluate`, with its token), and the page
  subscribes to the same read through the app's typed client (`@typedpress/client`),
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
| A whole site as static files, with no WordPress serving it | `defineConfig({ output: "static" })`, then `typedpress export` |
| Static files from a WordPress that editors use somewhere else | the same, with `typedpress export --site https://cms.example.com` |

A prebuilt page is what a signed-out visitor sees, rendered by the page's own
compiled code. So it can't depend on the request. These are build errors at
the page, each with its fix:

- a `guard` protecting the page read, including one inherited from a layout (a handler-only rule is allowed);
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
// tp/app/tags/[tag]/page.tsx
import type { PageProps, StaticParams } from "typedpress/app";

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
  and writes its HTML and Markdown to `wp-content/cache/typedpress-prebuilt/`.
- **How they are served.** The app answers from the file before WordPress parses the request, with
  the same `Cache-Control` as a cacheable render and the header `X-TypedPress-Prebuilt: 1`.
- **What still renders per request.** A signed-in visitor, a request with a query string, and a URL
  whose file isn't written yet.
- **After a write.** A write that changes what a prebuilt page shows deletes that page's files at
  once and schedules its rebuild. Until the rebuild runs, the page renders per request, so nobody
  sees the old content. Other pages keep their files.
- **The rest of the site.** Markdown twins, `llms.txt` and the sitemap are unchanged.
- **Hosts that can't reach their own address.** The rebuild fetches the page from the site's own
  address. A host where that fails sets the `tp_prebuild_url` filter.

### A static site (`typedpress export`)

```sh
typedpress export                                       # writes tp/dist/static/
typedpress export --site-url https://docs.example.com   # also writes sitemap.xml and canonical links
typedpress export --base /docs                          # for a site served below /docs/
```

The project must say `output: "static"`, where every page is prebuilt.
`prerender = false` is a build error there.

- **Where the content comes from.** Without `--site`, `typedpress export` starts a throwaway WordPress on
  SQLite (the one `typedpress dev` uses) with the build installed and `tp/content/` loaded, renders
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

### WordPress as the CMS (`typedpress export --site`)

Editors work on a hosted WordPress running the app. `typedpress export --site https://cms.example.com`
renders that site's published content with this checkout's pages.

- **Credentials.** It signs in as an editor the way `typedpress sync` does: the credential
  `typedpress login` stored, or `TP_APP_PASSWORD` (`user:application-password`) or `TP_TOKEN` in CI.
- **The site must run this checkout's build.** Otherwise the export stops and says to deploy first.
- **Rebuilding on publish.** Add the hosted site's `webhooks` config to call a CI job on publish
  (`events: ["*"]`). The job runs `typedpress export --site …` and uploads `tp/dist/static/`.
- **Client components** call public actions on the hosted site, across origins.
- **Comments and sign-in** happen on the hosted site.
- **Guarded pages** can't be exported: a static file is the same for everyone.

## Publish on Spacefast

`tp/app/` is ordinary app source. `typedpress sources` captures the pages,
components, stylesheets and SVGs with the rest of the app, and the host's
`typedpress compile-sources` compiles them into the app plugin, with no Node and
no separate render step. The compiled manifest lists every page in
`pagePaths` and every handler in `routes`, so the host can hand those URLs to
WordPress.

## From the old `pages/` renderer

The separate `pages/` renderer (`@typedpress/pages`, `tp-pages build`
and `tp/pages.json`) is gone. A project that still has `pages/` beside
`typedpress.config.ts` fails to build with the move as the fix, and a host refuses a
capture that carries old-renderer pages. To port:

| Before | Now |
|---|---|
| `pages/<path>/page.tsx` | `tp/app/<path>/page.tsx` |
| `load({ content })` returning queries | `await db.query.<kind>…` in the page; reads run as the visitor |
| `collectionPage("notes")` | `url: "/notes/:slug"` on the kind and `tp/app/notes/[slug]/page.tsx`, which receives `item` |
| `<Show when={x}>`, `orElse(x, d)`, `count(list)` | `{x && …}`, `x ?? d`, `list.length` |
| `<RichText value>` | `<Content value>` from `"typedpress/app"` |
| `<Island>` with a hand-written store | a `"use client"` component |
| `link("/x")` | `<Link href="/x">` from `"typedpress/app"` |
| `generateMetadata` | `export const metadata = (props) => ({ … })` |
