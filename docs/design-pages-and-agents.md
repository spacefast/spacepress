# Zero pages, components, layouts, sync, publish and agents

Status: the locked design for Zero's next layer. It records the owner's
rulings of 2026-11-01 verbatim (§2), states how it relates to the config API
redesign in PR #55 (§5), reconciles the research reports that preceded it
where they disagree with the rulings (§6), and fixes the order of pull
requests (§9). Nothing in it is implemented yet; every API named under
`zero/pages`, `zero/agents`, `@spacefast/zero-blocks/universal` and
`Zero\Pages\*` / `Zero\Agents\*` is new. Where a WordPress or Data Machine
behaviour is cited, it was checked against WordPress 7.1 / core source
`7c9c8b62`, Data Machine 0.200.4 at `b07be213`, and Agents API at
`952db6cb` (the revision Data Machine's lockfile resolves).

Two of its decisions wait on the owner: narrowing the Blocks isolation
ruling (§10 q1) and adopting #55's config API (§10 q2). The rollout (§9)
does not start PRs that depend on either until the owner has ruled.

Conventions: "error" means the build fails with `file:line:col` and nothing
is written. "WP" is WordPress 7.1, the pinned platform. "Blocks" is the
`@spacefast/zero-blocks` package. "DM" is Data Machine. "Decision" marks a
choice this document makes; "Ruling" marks one the owner made. Examples are
written in #55's config API (§5.3).

## 0. Decisions in one screen

| Area | Decision |
|---|---|
| Pages | `pages/**/page.tsx` beside `zero.config.ts`, discovered by `zero build`; `layout.tsx` nests by directory; `(group)` adds no segment; `[param]` binds one segment. No `pages/` directory means no routes, no theme, no new dependency. |
| Page identity | Every static code page owns a WordPress Page record (`post_type: page`), keyed by a Zero route id in post meta. Collection pages (`collectionPage()`) use the row's own post. Table collections cannot have a `collectionPage` in v1. |
| Rendering | TSX → checked IR → three outputs: static Gutenberg block markup (the pinned core serializer), block bindings for scalar slots (`zero/page-field` source), generated dynamic blocks with PHP for structure that depends on the request (conditionals, loops, derived values, loaders). The page body is `post_content`; the layout chain is the template. |
| Component contract | One TSX source compiles for React (normal `react/jsx-runtime`) and for WordPress (IR). Universal components are pure functions of serializable props using `@spacefast/zero-blocks/universal` primitives. Hooks, effects, events, context, browser globals: error when reachable from a WordPress page. |
| Document | A Zero canvas selected through `template_include`, calling `wp_head()`, `wp_body_open()`, `wp_footer()`, with body and assets prepared before the head, and printing exactly one `<title>`. Theme output is an explicit mode: `pages/theme.config.ts` present → layouts compile to a block theme. |
| Templates | Canvas mode: templates are code-owned files rendered by the plugin; the Site Editor does not see them. Theme mode: templates and parts are theme files under WordPress's own customization model; a publish never overwrites a customization. |
| Head / SEO | `export const metadata` or `generateMetadata()`; resolved before output; one emitter per field family. Explicit fields win through the active SEO plugin's filters (Yoast, Rank Math, The SEO Framework); unspecified fields stay plugin-owned; core plus a small Zero emitter when no plugin owns the head. SEO values an editor should change are ordinary columns the page reads. |
| CSS | `import "./x.css"` is global, `*.module.css` is scoped with a generated class map and types; content-hashed files, a per-route manifest, `wp_enqueue_style` on `wp_enqueue_scripts`. Tokens in `styles/tokens.ts` emit CSS variables and, in theme mode, `theme.json` presets. |
| Public collections | `collectionPage(c)` is the only way a collection becomes viewable: it registers the CPT `public: true` with a rewrite slug. The collection must be a content collection whose read rule is `"anyone"` or a filter and whose title and body carry no stricter field rule; the filter is applied to every front-end `WP_Query` over the type. |
| Editing | One owner per surface, chosen by file: `page.tsx` is code-owned (a read-only screen in wp-admin, publish rewrites it); `page.md` / `page.blocks.html` is content-owned (seeded once by publish, then owned by the editor and `zero sync`). Layouts and templates are code-owned. |
| Sync | Optional, switched by `defineConfig({ pages: { sync } })` for pages and `sync:` per collection. On: round-trip through the existing UID / base / three-way-merge engine, raw block markup as the body format. Off: Zero refuses dashboard, REST and Zero-API edits to its managed records. |
| Build / publish | `zero build` writes `.zero/wp-content`. `zero publish --site` pushes a digest-verified release to `zero-runtime`'s publish endpoint, which stages it beside the current release; a second request activates it and a third, running on the new code, migrates and reconciles. Hosts whose production code is read-only (VIP, Pantheon) get the honest split: `--content-only` ships records; code goes through the host pipeline. |
| Agents | Data Machine is the runtime. `defineConfig({ agents })` compiles to a manifest; a versioned Zero adapter (`Dm02004`) provisions DM agents, pipelines, flows and tool projections through DM's own abilities. Zero owns schema, abilities, action-level `approval`, the manifest and `zero doctor`. No Zero run ledger. |
| Rename | The exposure flag on collections, globals, actions and jobs (`agents` today, kept as `agents?: false` in #55) is renamed `abilities`. The word `agents` is the top-level `defineConfig` key for AI agents and nothing else. |
| Config API | This design builds on #55's API (`collection({ cols }, opts)`, `ref()`, `user()`, `collections:`, hooks beside columns, `Row<T>`), adds `pages?` and `agents?` to `defineConfig`, `approval?` to `action()`, and supersedes #55's `agents?` flag. Contingent on the owner approving #55 (§10 q2). |
| Blocks boundary | `zero.config.ts` never names a page. Blocks never reads `zero.config.ts`. `zero build` invokes Blocks' serializer as a build tool only when `pages/` exists; backend-only builds have no Blocks dependency. Contingent on the owner narrowing the Blocks ruling (§10 q1). |
| Queue | One Action Scheduler backend, two logical job domains (Zero jobs, DM runs). One qualified AS version and runner policy; `zero doctor` reports the loaded class source. |

## 1. Why

Zero compiles a config into a WordPress backend with a typed client. The
owner wants the same project to carry its front end when the author wants
that: a single `/about` page with a layout, a full site, a couple of routes
over a collection, or nothing at all behind an Astro or TanStack Start app.
Zero Blocks (phase 1 shipped, phase 2 paused) proved the TSX → Gutenberg
path and found three gaps a page system has to close: a template alone is
not a route (someone creates the post row), a `public: false` collection is
invisible to the front end, and CSS and head metadata have no home in block
markup. The seven research reports in the design-lock folder cover modern
page conventions, TSX → PHP, the WordPress seams, agents, sync and
components; PR #55 redesigns the config surface they all sit on. This
document is the decision across all of them.

## 2. Owner rulings

Given 2026-11-01. Speech-to-text slips are corrected in brackets. These are
binding; the rest of the document is read under them.

1. Code pages get **hidden WordPress Page records**. Zero creates and owns
   them, so SEO plugins, menus and canonical URLs work.
2. Rendering is a **combination**: pages compile at **build time to Gutenberg
   block markup + PHP**. "anything dynamic in there that's important from
   WordPress at render time should render with PHP", "using normal WordPress
   stuff as possible".
3. **`zero sync`** is an **optional subsystem** that syncs "back-and-forth"
   (files ↔ DB). "zero deployments can block from things to be edited in DB
   when the user's not gonna do a sync".
4. **`zero build`** builds. **`zero publish`** publishes "to an endpoint
   essentially that's built as a WordPress plugin, like the main plugin, and
   it will just push up everything … and gets saved into the file system".
   This is "our own entirely different mechanism".
5. "it's not required for you to have WordPress rendered pages". "you can
   share components between React, like standard React, and WordPress
   rendered pages". Every shape is fine: a single about page with a layout; a
   full site; a couple of routes; backend-only behind static frontends
   (Astro, Vite, TanStack Start).
6. **Agents: Data Machine is the runtime.** (The owner overruled report 05's
   Zero-owned-runtime recommendation.)
7. Blocks: "we want everything": keep the blocks compiling, with "optional
   layouts that essentially become themes"; layouts authored "like you do in
   TanStack Start or Next"; "still … do WordPress rendering when needed";
   "in the future … zero as an island in Astro, but that's not something
   we're doing today".
8. Earlier, still binding: WordPress-only; Zero Blocks is an optional add-on,
   and Zero core never depends on it; "we want to not follow the wordpress
   stuff if not needed"; compiled code must match JavaScript or refuse;
   "Current behavior doesn't matter … what matters is JS turns into PHP
   properly".

## 3. Project layout

The journal example, complete. Everything under `pages/`, `components/`,
`islands/`, `styles/` and `agents/` is optional; `zero.config.ts` alone is
still a whole Zero app.

```text
journal/
├── zero.config.ts                 # data, access, hooks, actions, jobs, pages switches, agents
├── zero.gen.ts                    # generated; unchanged
├── tsconfig.json                  # jsx: react-jsx; include pages, components, islands
├── agents/
│   └── editor.md                  # instructions → the DM pipeline step's system prompt (§4.10)
├── pages/
│   ├── layout.tsx                 # root layout: chrome + metadata defaults
│   ├── page.tsx                   # /  (front page; §4.7)
│   ├── not-found.tsx              # Zero's 404 body for claimed routes
│   ├── theme.config.ts            # optional: present → layouts compile to a block theme (§4.6)
│   ├── about/
│   │   └── page.tsx               # /about, code-owned Page record
│   ├── pricing/
│   │   └── page.md                # /pricing, content-owned Page record (editor + sync)
│   ├── company/
│   │   └── team/
│   │       └── page.tsx           # /company/team; no /company page, explicit rewrite (§4.7)
│   └── posts/
│       ├── layout.tsx             # wraps /posts and /posts/[slug]
│       ├── page.tsx               # /posts, load() over the collection
│       ├── featured/
│       │   └── page.tsx           # /posts/featured, static beside dynamic (§4.1)
│       └── [slug]/
│           ├── page.tsx           # /posts/:slug, collectionPage(posts)
│           └── post.module.css
├── components/
│   ├── PostCard.tsx               # universal: React and WordPress
│   └── SiteNav.tsx
├── islands/
│   ├── Counter.tsx                # server half: emits data-wp-* directives
│   └── Counter.client.ts          # browser half: @wordpress/interactivity store
├── styles/
│   ├── tokens.ts                  # colors, spacing, type scale → CSS vars + theme.json presets
│   └── global.css
├── content/
│   └── posts/*.md                 # collection sync (existing feature)
└── .zero/
    ├── sync-base.json             # committed
    └── wp-content/                # build output, ignored
        ├── plugins/zero-runtime/                 # includes the publish endpoint (§4.9)
        ├── plugins/zero-identity/
        ├── plugins/zero-app-journal/
        │   ├── zero-app-journal.php              # includes releases/current/ (§4.9)
        │   └── releases/<digest>/
        │       ├── app/                          # today's generated plugin tree
        │       ├── pages/routes.php              # route table, rewrites, Page reconciler, canvas selection
        │       ├── pages/manifest.json           # routes → templates, bodies, CSS, modules, fields
        │       ├── pages/templates/*.html        # one flat block-markup template per route
        │       ├── pages/content/*.html          # code-owned page bodies (block markup)
        │       ├── pages/register.php            # binding sources, block registrations
        │       ├── pages/canvas.php              # the document
        │       ├── blocks/<region>/              # block.json, render.php, body.html, index.js, index.asset.php
        │       ├── assets/*.css|*.js             # hashed
        │       └── agents/manifest.php           # §4.10
        ├── plugins/zero-admin/                   # only with admin: true
        └── themes/journal/                       # only with pages/theme.config.ts
            ├── style.css
            ├── theme.json
            ├── templates/*.html
            └── parts/*.html
```

`zero.config.ts` is data and switches. It gains `pages?` (switches for the
subsystem, §4.8) and `agents?` (§4.10). It never names a route; pages
import collections from it, never the reverse.

```ts
// zero.config.ts (the journal)
import {
  collection, text, richText, slug, boolean, media, group, ref, user,
  action, job, jobs, db, HttpError, defineConfig, type Row,
} from "zero";

export const authors = collection({
  name: text().notNull().max(80),
  avatar: media({ accept: "image/*" }),
  userId: user(),
}, { title: "name", access: { write: "admin" } });

export const posts = collection({
  title: text().notNull().max(120),
  slug: slug(),
  body: richText(),
  excerpt: text({ multiline: true }).max(240),
  cover: media({ accept: "image/*" }),
  authorId: ref("authors"),
  // Editorial SEO values are data; pages/posts/[slug]/page.tsx reads them (§4.4).
  seo: group({ noindex: boolean().default(false), metaTitle: text().max(70).showIf({ noindex: false }) }),
}, {
  sync: "content/posts/*.md",
  access: { read: (ctx) => ctx.is("author") ? true : { status: "published" }, create: "author", update: "author", delete: "editor" },
  hooks: {
    async afterUpdate(row, previous) {
      if (row.status === "published" && previous.status !== "published") {
        await jobs.notifyReaders.enqueue({ postId: row.id }, { key: `publish-${row.id}` });
      }
    },
  },
});

export default defineConfig({
  name: "journal",
  collections: { authors, posts },
  jobs: { notifyReaders: job({ input: { postId: ref("posts").notNull() }, retries: 3, async handler() { /* … */ } }) },
  pages: { sync: true },          // content-owned pages are editable and round-trip (§4.8)
  admin: true,
});
```

## 4. Subsystems

### 4.1 Pages and routing

**Decision.** Discover `pages/**/page.tsx`, `page.md` and `page.blocks.html`.
Only those three file names create routes; anything else under `pages/` is a
colocated component, style or test. `layout.tsx` wraps every descendant in
filesystem order. `(name)` directories group without a URL segment.
`[param]` binds one segment and is legal only in a directory whose `page.tsx`
exports `collectionPage()`. `not-found.tsx` at the root supplies the body for
a claimed route whose row is missing or unreadable. Catch-all segments,
`template.tsx`, parallel and intercepting routes are refused in v1.

Two normalized paths that collide (including across groups) are an error. A
static route beside a dynamic one (`pages/posts/featured/page.tsx` next to
`pages/posts/[slug]/page.tsx`) is legal: the static route gets an explicit
top-priority rewrite rule (§4.7) because WordPress places CPT permastruct
rules ahead of Page rules, and the compiler adds a reserved-slug check on the
collection so no row can take `featured`.

**Route id.** Each route has an id equal to its normalized URL path with the
leading slash removed and `/` turned into `.` (`about`, `posts.index`,
`posts.show`; the root is `index`). Renaming a directory is a new route and
retires the old one (§4.7). An author who wants to rename the URL without a
new identity sets `export const route = { id: "about" }` in `page.tsx`; the
id is then pinned and the URL may move.

**Request lifecycle.** WordPress parses the request and runs its main query
unchanged. The app plugin registers, from the reconciled route map, an
explicit rewrite rule (`add_rewrite_rule(..., 'index.php?page_id=<id>', 'top')`)
for every static route whose URL WordPress would not derive from the Page
hierarchy on its own: the front page, routes with missing ancestors, and
static routes under a collection directory. Other static pages resolve by
their Page permalink. For a `collectionPage` the CPT is registered viewable
with `rewrite: { slug: <directory>, with_front: false }`, and the row's
permalink is the route. Rules are flushed on activation and when the route
hash in `manifest.json` changes.

On `template_redirect` the route matcher runs: it compares the request path
to the claimed patterns. If a pattern matches and the main query holds a
Zero-managed Page or a readable Zero collection post for that route, the
request is a Zero page. If a pattern matches and the query holds no such
object (missing row, draft, filtered out by the read rule), Zero sends
`status_header(404)`, `nocache_headers()` and renders `not-found.tsx` in the
canvas; the theme's 404 is not used for claimed URLs. If no pattern matches,
Zero does nothing and the active theme serves the request. `template_include`
returns `canvas.php` for Zero pages only.

**Loaders.** `export async function load(ctx)` runs once per request before
metadata and rendering. `ctx.params`, `ctx.url`, `ctx.viewer` (with
`ctx.viewer.is(role)` as in #55's `ctx.is`) and
`ctx.content.query.<collection>.findMany|findFirst` are available;
`ctx.content` is a read-only, viewer-bound query API. The trusted `db` from
`"zero"` is refused in page modules with a diagnostic pointing at
`ctx.content`. A null viewer is never passed; an anonymous visitor is
`Viewer(null)`, which `Db` already distinguishes from the trusted null. The
loader's return value is the page's props and is memoized in
`Zero\Pages\Request` for bindings and regions to read.

`collectionPage(posts)` is the loader for an item route. The URL segment is
the collection's `slug()` column, which #55 makes `post_name`; `by` is not an
option because nothing else has a permalink. The compiler resolves the row
from the main query's post (the CPT is viewable, so WordPress found it),
re-reads it through `ctx.content` so the read rule and field access apply,
and passes `item` and `href`. A collection without a `slug()` column cannot
have a `collectionPage`. One `collectionPage` per collection; a second is an
error.

**Example.**

```tsx
// pages/posts/page.tsx
import { PostCard } from "../../components/PostCard";
import type { Metadata, PageContext, PageProps } from "zero/pages";

export const metadata = { title: "Posts" } satisfies Metadata;

export async function load({ content, url }: PageContext) {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const items = await content.query.posts.findMany({
    where: { status: "published" },
    orderBy: { publishedAt: "desc", id: "desc" },
    limit: 20,
    offset: (page - 1) * 20,
  });
  return { items, page };
}

export default function PostsPage({ items, page }: PageProps<typeof load>) {
  return (
    <>
      <h1>Posts</h1>
      {items.map((post) => (
        <PostCard key={post.id} title={post.title} excerpt={post.excerpt ?? ""} href={post.href} />
      ))}
      {page > 1 ? <a href={`/posts?page=${page - 1}`}>Newer</a> : null}
    </>
  );
}
```

`post.href` is a derived column the compiler adds to rows of a collection
that has a `collectionPage`, computed through `get_permalink`, so listings
and item pages cannot disagree.

### 4.2 The component contract: React and WordPress

**Decision.** One component source, two compilers. The React build uses the
automatic JSX runtime and nothing Zero-specific. The WordPress build reads the
same source before any transform and lowers it to the IR (§4.3). A component
is **universal** when it is a synchronous, deterministic function of
serializable props and children that uses only: intrinsic HTML tags the
Blocks mapping table accepts, primitives from
`@spacefast/zero-blocks/universal`, other universal components, fragments,
conditionals (`? :`, `&&`, `||`, `??`, `if`), `.map` over arrays, template
strings and the pure helpers Zero's subset already compiles. The check is
transitive through imports and branches; a filename or comment cannot claim
it.

`@spacefast/zero-blocks/universal` exports real React implementations of
`Group`, `Heading`, `Paragraph`, `Image`, `Buttons`, `Button`, `Columns`,
`Column`, `List`, `ListItem`, `Separator`, `Spacer`, `Cover`, `Quote`,
`RichText` (renders trusted stored HTML) and the WordPress contextual
primitives `PostContent`, `PostTitle`, `PostDate`, `PostFeaturedImage`,
`Navigation`, `QueryLoop`. Each primitive's React output carries the classes
the pinned core block's `save()` emits (`wp-block-group`,
`wp-block-heading`, …) so the DOM matches under the shared token stylesheet.
Contextual primitives require a React host adapter that supplies their data
(a `PostContent` outside WordPress needs `html` passed in); without one they
are a React build error.

**Refused in a universal component, with `file:line:col`:** hooks, context,
refs, effects, event-handler props, portals, Suspense, async components,
`style` objects (use CSS modules), browser globals, `Date.now()`/`Math.random()`
at render, npm imports without a supported lowering, dynamic tag names, raw
HTML strings outside `RichText`. These are the semantics PHP cannot reproduce
without lying; the owner's bar is match or refuse. A component that needs
them is React-only and can be used from a WordPress page only through an
explicit island (§4.5) or not at all.

**Example.**

```tsx
// components/PostCard.tsx
import { Group, Heading, Paragraph, Buttons, Button } from "@spacefast/zero-blocks/universal";
import styles from "./PostCard.module.css";

export type PostCardProps = { title: string; excerpt: string; href: string };

export function PostCard({ title, excerpt, href }: PostCardProps) {
  return (
    <Group tagName="article" className={styles.card}>
      <Heading level={2}>{title}</Heading>
      {excerpt !== "" ? <Paragraph>{excerpt}</Paragraph> : null}
      <Buttons>
        <Button href={href}>Read post</Button>
      </Buttons>
    </Group>
  );
}
```

In an Astro, Vite or TanStack Start app this is an ordinary import; data
comes from the generated client. Zero does not ship a React router, a data
layer or hydration for those hosts; "Zero as an Astro island" is future work
by ruling 7.

### 4.3 The rendering pipeline: IR → blocks, bindings, PHP

**Decision.** This is report 07 §A1 made concrete. The Rust compiler admits
JSX for the `pages/`, `components/` and `islands/` graphs (the config loader
keeps refusing it), lowers each page's tree to an IR whose nodes carry source
location, value type, escaping kind and **provenance**: `literal`,
`route-param`, `loader-field` (a field of the memoized loader result or
`item`), `derived` (an expression over the above), `request-scoped`
(viewer, URL). From provenance the compiler chooses one of three outputs per
node:

| Node | Output | Rule |
|---|---|---|
| Literal element, literal text and attributes, universal primitive with literal props | **Static block markup.** The subtree is serialized once at build time by Blocks' pinned core serializer (`createBlock` + `serialize`, reparsed for validity). | Everything is static until proven otherwise. |
| A supported scalar slot whose value is a `loader-field` or a `derived` string/URL over loader fields: `Heading`/`Paragraph` content, `Button` text and `url`, `Image` `url`/`alt`, a link `href` | **Block binding.** `metadata.bindings.<attr> = { source: "zero/page-field", args: { route, field } }`. For a `derived` value the compiler emits a PHP accessor for the expression and registers the result as a named field of the route. | WordPress 6.5+ bindings replace supported attributes at render; the source reads only compiler-registered fields of the memoized request. |
| A conditional whose test depends on the request, a `.map` over loader rows, a `derived` value in a non-bindable position, a contextual primitive with request-dependent props | **PHP region**: a generated dynamic block `zero/<app>-<route>-r<n>` with `block.json` (`render: file:./render.php`, `supports.inserter: false`), `render.php` compiled by Zero's existing expression compiler, and a minimal `index.js` (`edit` shows a labelled placeholder, `save: () => null`). | Structure that changes per request is PHP by ruling 2. |

Inside a PHP region the compiler keeps block markup as the output language:
each branch of a conditional and the body of a loop is a serialized block
template (built at build time by the same serializer) whose own scalar slots
bind to `zero/region-field`, a source that reads the region's current scope
(the loop item, the branch's locals). `render.php` evaluates the condition
or iterates the array with Zero's JS semantics (`Js::truthy`, `Js::map`,
dense arrays per `docs/design-js-references.md`), sets the scope, and calls
`do_blocks($template)`. Rendering therefore never concatenates HTML by hand
for core-block-shaped nodes, and WordPress's own block filters, styles and
`render_block` hooks see every block. Plain intrinsic tags inside a region
that map to no core block (`<time>`, `<span>` with text) are emitted through
`core/html` for static parts and through a context-escaped `HtmlBuffer`
(`text()`, `attribute()`) for dynamic text, as report 03 §7 specified.

**Contextual primitives and field access.** On a Zero collection route the
queried post is a Zero row whose columns carry Zero's read and field rules,
which `core/post-content`, `core/post-title` and friends do not know. So on
such a route `PostTitle`, `PostContent`, `PostDate` and `PostFeaturedImage`
compile to bindings and regions over the viewer-bound `item` (title → a
binding on `item.title`; `PostContent` and `RichText value={item.body}` → a
region that runs the already-authorized body through `do_blocks` and
`wp_kses_post` under the current post context), never to `core/post-*`
blocks. `core/post-*` blocks are emitted only when the queried post is a
core type (a Zero Page record, or a core `post` inside an inherited
`QueryLoop`). `Navigation` and `QueryLoop inherit` compile to their core
blocks unchanged. `QueryLoop` with an explicit Zero collection is refused in
v1: a listing over Zero rows is `load()` plus `.map`, which is a region and
therefore viewer-bound. Theme and plugin queries from outside Zero's pages
are covered by the row filter in §6.

**What the match-JS rule means here.** Expressions inside pages are compiled
by the same compiler as hooks and actions; nothing is approximated into
Interactivity directives or Twig truthiness. `{0 && <b/>}` renders `0`.
Differential tests run each page's regions under Node and PHP and compare
rendered DOM (entity spellings normalized, whitespace and attribute values
preserved).

**Build output for `pages/posts/[slug]/page.tsx`.** Source:

```tsx
import { collectionPage, RichText, type CollectionPageProps, type Metadata } from "zero/pages";
import { posts } from "../../../zero.config";
import { PostCard } from "../../../components/PostCard";
import styles from "./post.module.css";

export const page = collectionPage(posts);
type Props = CollectionPageProps<typeof page>;

export function generateMetadata({ item, href }: Props): Metadata {
  return {
    title: item.seo.metaTitle ?? item.title,
    description: item.excerpt ?? "",
    canonical: href,
    robots: item.seo.noindex ? { index: false } : undefined,
    openGraph: { type: "article" },
  };
}

export default function PostPage({ item, href }: Props) {
  return (
    <article className={styles.article}>
      <PostCard title={item.title} excerpt={item.excerpt ?? ""} href={href} />
      <RichText value={item.body} />
    </article>
  );
}
```

Output (indentation and default attributes normalized for reading; the real
files come from the serializer). The route template is one flat document:
the root layout's header and footer are inlined, because in canvas mode
`core/template-part` would resolve only against the active theme (§4.6).

```html
<!-- releases/<digest>/pages/templates/posts.show.html : root layout → posts layout → page -->
<!-- wp:group {"tagName":"header","className":"site-header"} -->
<header class="wp-block-group site-header">
  <!-- wp:zero/journal-layout-nav /-->
</header>
<!-- /wp:group -->
<!-- wp:group {"tagName":"main"} -->
<main class="wp-block-group">
  <!-- wp:group {"tagName":"section","ariaLabel":"Journal posts"} -->
  <section class="wp-block-group" aria-label="Journal posts">
    <!-- wp:paragraph --><p>From the team</p><!-- /wp:paragraph -->
    <!-- wp:zero/journal-posts-show-r0 /-->
  </section>
  <!-- /wp:group -->
</main>
<!-- /wp:group -->
<!-- wp:group {"tagName":"footer"} -->
<footer class="wp-block-group"><!-- wp:paragraph --><p>Made with Zero.</p><!-- /wp:paragraph --></footer>
<!-- /wp:group -->
```

The page body is one region (`r0`) because `<article className={styles.article}>`
has no core block (a classed `<article>` would become a Group and lose the
module class on the element the author styled), and because `RichText` is
request-time. Inside the region the `PostCard` subtree is static block markup
with two bindings and one nested region for the conditional excerpt:

```html
<!-- releases/<digest>/blocks/journal-posts-show-r0/body.html -->
<!-- wp:group {"tagName":"article","className":"post-card-x7f2"} -->
<article class="wp-block-group post-card-x7f2">
  <!-- wp:heading {"metadata":{"bindings":{"content":{"source":"zero/page-field","args":{"route":"posts.show","field":"item.title"}}}}} -->
  <h2 class="wp-block-heading"></h2>
  <!-- /wp:heading -->
  <!-- wp:zero/journal-posts-show-r1 /-->
  <!-- wp:buttons -->
  <div class="wp-block-buttons">
    <!-- wp:button {"metadata":{"bindings":{"url":{"source":"zero/page-field","args":{"route":"posts.show","field":"href"}}}}} -->
    <div class="wp-block-button"><a class="wp-block-button__link wp-element-button">Read post</a></div>
    <!-- /wp:button -->
  </div>
  <!-- /wp:buttons -->
</article>
<!-- /wp:group -->
```

```php
<?php // releases/<digest>/blocks/journal-posts-show-r0/render.php
$page = \Zero\Pages\Request::current('posts.show');
if ($page === null) { return; }
$out = new \Zero\Pages\HtmlBuffer();
$out->literal('<article class="');
$out->attribute(\Zero\Pages\Assets::cls('posts.show', 'article'));   // post_abc123_article
$out->literal('">');
$out->child(\Zero\Pages\Blocks::render(__DIR__ . '/body.html'));      // do_blocks of the template above
$out->child(\Zero\Pages\RichText::render($page->item->p['body'] ?? '', $page->post));
$out->literal('</article>');
echo $out->finish();
```

```php
<?php // releases/<digest>/blocks/journal-posts-show-r1/render.php  (the conditional excerpt)
$page = \Zero\Pages\Request::current('posts.show');
if ($page === null) { return; }
$excerpt = $page->item->p['excerpt'] ?? '';
if (\Zero\Js::truthy(\Zero\Js::strictNotEqual($excerpt, ''))) {
    echo \Zero\Pages\Blocks::render(__DIR__ . '/branch-0.html', ['excerpt' => $excerpt]);
}
```

```php
<?php // releases/<digest>/pages/register.php (excerpt)
add_action('init', static function (): void {
    register_block_bindings_source('zero/page-field', [
        'label' => 'Zero page field',
        'get_value_callback' => [\Zero\Pages\Bindings::class, 'pageField'],   // reads only registered fields
    ]);
    register_block_bindings_source('zero/region-field', [
        'label' => 'Zero region field',
        'get_value_callback' => [\Zero\Pages\Bindings::class, 'regionField'],
    ]);
    foreach (glob(__DIR__ . '/../blocks/*/block.json') as $block) {
        register_block_type(dirname($block));
    }
    \Zero\Pages\Routes::register(require __DIR__ . '/manifest.php');
});
```

`Bindings::pageField` returns `esc_html` text for content attributes and
`esc_url` for `url` attributes, and `null` for any (route, field, block,
attribute) tuple the manifest does not list. Static Page records receive
their compiled body (`pages/content/<route>.html`) in `post_content` at
publish (§4.7); collection routes have no content file because the row is
the post.

### 4.4 Head and SEO

**Decision.** A page or layout exports `metadata` (static) or
`generateMetadata(props)` (per request), never both. Fields: `title`
(string or `{ default, template }`), `description`, `canonical`, `robots`,
`openGraph { title, description, type, images }`, `twitter`, `alternates`,
`jsonLd`. Merge: leaf title with the nearest ancestor template applied once;
leaf description replaces; Open Graph merges by key, `images` replaces;
canonical and `og:url` default to the route's permalink from the site URL,
never from the Host header. The result is resolved in the route controller
before any output. SEO values an editor should control are ordinary columns
(the `seo` group in §3) that `generateMetadata` reads; there is no SEO
builder in the config.

Emission has one owner per field family:

| Active SEO plugin | Title | Description, canonical, robots | Open Graph / Twitter | JSON-LD |
|---|---|---|---|---|
| none | the canvas prints `<title>` itself from `wp_get_document_title()` with `pre_get_document_title` supplying the complete title, and removes `_wp_render_title_tag` for Zero routes (as core's `template-canvas.php` does), so exactly one title appears whether or not the active theme declares `title-tag` | `wp_robots` filter; Zero emits description and canonical on `wp_head` at priority 1; core `rel_canonical` removed for Zero routes only | Zero emits on `wp_head` | Zero emits one graph |
| Yoast SEO | `wpseo_title`; the canvas prints no title (Yoast's presenter does) | `wpseo_metadesc`, `wpseo_canonical`, `wpseo_robots_array` | `wpseo_opengraph_*`, `wpseo_twitter_*` | `wpseo_schema_graph_pieces` |
| Rank Math | `rank_math/frontend/title`; the canvas prints no title | `/description`, `/canonical`, `/robots` | `rank_math/opengraph/facebook/*`, `/twitter/*` | `rank_math/json_ld` |
| The SEO Framework | `the_seo_framework_pre_get_document_title`; the canvas prints no title | `the_seo_framework_meta_render_data`, `_robots_meta_array` | `the_seo_framework_meta_render_data` | `the_seo_framework_schema_graph_data` |

Explicit Zero fields win their field through the plugin's filter, scoped to
the current Zero route; fields the page did not set remain the plugin's. An
unrecognized SEO plugin gets no adapter: Zero emits nothing that would
duplicate a head tag, prints no title, and `zero doctor` reports the gap.
Static metadata also writes the Page record's `post_title` at publish so
menus, the admin list and the plugin's own analysis see the right title.
Yoast's content analysis reads `post_content`; for a code page that is the
compiled body (§4.7), which is what the visitor sees minus the regions. This
limit is documented, not hidden.

Sitemaps: Page records and `collectionPage` posts are `public: true` post
types, so core's `WP_Sitemaps_Posts` includes them; each plugin's own
provider is verified individually in PR 7's proof.

### 4.5 CSS, assets and islands

**Decision.** `import "./global.css"` is a global stylesheet dependency.
`import styles from "./x.module.css"` is a build-time class map (`post_abc123_article`)
with a generated `.d.ts` so `styles.artcile` is a type error; the same map
feeds the React build and the PHP region above. Neither import executes in
PHP. `styles/tokens.ts` exports a typed object; the build emits
`:root { --zero-color-primary: … }` and, in theme mode, the matching
`theme.json` presets so `Group` on WordPress and `Group` in React share one
token sheet. Tailwind is a later opt-in build transform, not v1.

The build writes content-hashed files to `assets/`, records per route the
union of the layout chain's and page's CSS and modules in `manifest.json`,
and the canvas enqueues them with namespaced handles on `wp_enqueue_scripts`,
`null` version, before `wp_head()` runs. Body and regions are rendered to a
buffer first so blocks can enqueue their own assets, the ordering core's
`template-canvas.php` uses. Theme global styles stay active; the canvas does
not strip them.

**Islands.** `islands/<Name>.tsx` is a universal component that emits
`data-wp-interactive`, `data-wp-context` and other `data-wp-*` attributes;
`islands/<Name>.client.ts` is its browser module using
`@wordpress/interactivity`. Importing the island from a page registers the
module through `wp_register_script_module` / `wp_enqueue_script_module` with
the `@wordpress/interactivity` dependency, and the region's PHP runs
`wp_interactivity_process_directives()` on the island's HTML so server and
client state agree. Client modules are bundled separately and never enter the
PHP compiler. React or Preact client islands are refused in v1 (§7).

### 4.6 Layouts → themes

**Decision.** `layout.tsx` is authored as in Next or TanStack Start:
`export default function Layout({ children })`. The compiler fills `children`
with the nested subtree. Two output modes, chosen by one file, with different
ownership models:

- **Plugin canvas (default).** Each route's layout chain compiles to one
  flat `pages/templates/<route>.html`; shared chrome is deduplicated as a
  file at build time and inlined at serialization. The plugin does not
  register these with `register_block_template()` and emits no
  `core/template-part`: the former would invite Site Editor customizations
  that the canvas, rendering from files, would not honour, and the latter
  resolves a part only against the active theme's stylesheet. Templates in
  canvas mode are therefore code-owned, invisible to the Site Editor, and
  rendered by `canvas.php` through `do_blocks` inside `<!doctype html>` …
  `<title>` … `wp_head()` … `wp_body_open()` … `wp_footer()`. The active
  theme stays installed and its `functions.php` runs; only its template
  markup is bypassed for Zero routes. A `<TemplatePart slug>` in a layout is
  a build error in canvas mode with the fix named (theme mode).
- **Theme output.** When `pages/theme.config.ts` exists (Blocks'
  `defineTheme`: header plus typed `theme.json`), the layout chains become
  `templates/*.html` named by the hierarchy (`page-<slug>.html` per static
  route, `single-zero_posts.html` per collection route, `index.html`
  required), `<TemplatePart slug>` becomes `parts/<slug>.html` and
  `core/template-part`, tokens become `theme.json` presets, and the output is
  a real installable theme. Regions, bindings and routes stay in the app
  plugin, so the theme is data and the plugin survives a theme switch. The
  theme declares the app plugin in its `readme.txt`; `zero doctor` reports a
  theme active without its plugin. In theme mode WordPress's own model
  applies: a Site Editor customization shadows the file as a `wp_template`
  post until the user resets; a publish never overwrites a customization,
  and `zero doctor` lists customized templates as drift. In theme mode the
  canvas is not used; core's block template canvas renders the theme.

The paused `p3/blocks-theme` branch supplies the theme builder, hierarchy
table, `theme.json` schema validation and the Site Editor proof harness; PR 9
(§9) lands it under this contract instead of the filename-hierarchy authoring
model it was built for.

### 4.7 Editing and Page records

**Decision (ruling 1).** The app plugin owns a **route reconciler** that runs
at publish finalization (§4.9), on activation, and from `zero doctor --fix`.
For each static route it ensures one `page` post exists with meta
`_zero_route = <route id>` and `_zero_app = <app>`, `post_name` = the last
path segment, `post_parent` = the nearest ancestor route's Page (or `0`),
and for code-owned routes `post_status = publish`, `post_title` from static
metadata and `post_content` = the compiled body, recording the body digest in
`_zero_content_digest`. For content-owned routes (`page.md`,
`page.blocks.html`) the reconciler **creates** the record from the file on
first contact (status and title from front matter) and never updates it
afterwards; later changes in either direction belong to `zero sync` (§4.8),
which has the base and digest protocol for them.

- **Front page.** `pages/page.tsx` is `/`. The reconciler sets
  `show_on_front = page` and `page_on_front` to its record and marks both
  options Zero-owned. A site whose front page is already a non-Zero Page is a
  reconcile error (below), resolved by `adopt`.
- **Missing ancestors.** `pages/company/team/page.tsx` with no
  `pages/company/page.tsx` is legal. The record's `post_parent` is the
  nearest existing ancestor route's Page (here `/`), and the route gets an
  explicit top rewrite rule for `^company/team/?$`, because the Page
  hierarchy alone would give it `/team`. The same rule mechanism serves the
  front page and static routes under a collection directory (§4.1).
- **Collisions.** An existing Page at the same path that is not Zero-managed
  is a reconcile error: the route stays unserved, publish reports it, and
  the operator either renames the route or runs `zero pages adopt <route>`
  to claim the record (the existing content is kept for a content-owned
  route and replaced for a code-owned route, with the old revision
  preserved). A collision with a collection rewrite slug or a reserved
  WordPress path is a build error.
- **Retirement.** A route that disappears from the build has its Page moved
  to trash with `_zero_retired_at`; publish prints the list. Trash, not
  delete, so an accidental rename is recoverable.
- **Reset.** `zero pages reset <route>` rewrites a code-owned record from
  the build.
- **What editors see.** Pages appear in the Pages list with a "Code" or
  "Content" badge. For a code-owned Page, `get_edit_post_link` is filtered
  to a Zero-owned read-only screen (`admin.php?page=zero-page&route=about`)
  that shows the compiled body in a non-editable block preview, the regions
  as labelled placeholders, and the notice "Managed by
  `pages/about/page.tsx`. Edit the file and run `zero publish`." The core
  edit screen is not used because the lock below denies `edit_post`, and
  `post.php` refuses to open without it.
- **The lock.** `map_meta_cap` returns `do_not_allow` for `edit_post`,
  `delete_post` and `publish_post` on code-owned records, which closes
  wp-admin, core REST, quick edit, autosave and XML-RPC. Zero exposes no
  `/zero/v1` route over `page`, so its own CRUD path cannot reach these
  records. As a last guard, `wp_insert_post_data` rejects a body or status
  change to a locked record unless the request carries the publish or sync
  receipt. Direct SQL is not blocked; the plugin cannot be that boundary,
  and says so.
- **Content-owned pages** are editable when `pages.sync` is on (§4.8) and
  locked the same way when it is off (ruling 3), after the one-time seed.
- **Collection rows** keep today's behaviour: editors edit them in wp-admin
  and Zero Admin; the item route's template is code-owned.

A code-owned body changed out of band (a privileged plugin, SQL) fails the
digest check at finalization; publish refuses to overwrite it without
`--force` and shows the diff.

### 4.8 Sync

**Decision (ruling 3).** `zero sync` extends the existing engine (UIDs,
per-site base, field-wise three-way merge, server body merge, stale-write
rejection, conflict files, `resolve`) to pages. Nothing is replaced.

- **The switch.** `defineConfig({ pages: { sync: true } })` turns on sync
  for content-owned pages; default `false`. Collections keep #55's per
  collection `sync: "pattern"`. "Sync off" for the whole project means no
  collection declares `sync` and `pages.sync` is false or absent.
- **Body format.** Raw serialized block markup, in `page.blocks.html` with
  YAML front matter (`uid`, `title`, `slug`, `status`, metadata fields).
  Markdown (`page.md`) stays the opt-in prose format through the existing
  `Markdown::fromBlocks` gate: a body the converter cannot represent is a
  `422 not_representable` and the file is left alone, never flattened. Pulls
  take the stored `post_content`, never `the_content()` output; a dynamic
  block comes back as its self-closing reference.
- **Identity.** The Page record's `_zero_uid` (minted by the existing `Uid`
  runtime) in front matter; `_zero_route` ties it to the route. A renamed
  file keeps its UID. Two files with one UID is an error, as today.
- **Scope.** Code-owned pages, templates and regions are never synced: TSX
  has no inverse in block markup and this design does not pretend otherwise.
- **Two-sided block edits** go through the existing line merger only when
  `BlockMarkupMergeValidator` accepts the result and block boundaries are
  unchanged; otherwise a conflict file.
- **Media bytes** do not sync in v1 (unchanged from phase 2).
- **Sync off.** With `pages.sync` off, content-owned records are seeded once
  and then locked exactly as code-owned ones (§4.7): `map_meta_cap` for
  core paths, and for synced collections Zero's own CRUD path additionally
  refuses writes to a managed row with `409 managed_record` unless the
  request carries the sync receipt. Turning sync on establishes a base
  first; turning it off refuses while unexported edits exist
  (`zero sync --check` exits 2).

### 4.9 Build and publish, with hosting constraints

**Decision (ruling 4).** `zero build` is unchanged in shape: it writes
`.zero/wp-content/` with the platform plugins, `zero-runtime`,
`zero-identity`, `zero-app-<name>` (now laid out as `releases/<digest>/`
plus a one-line `releases/current` pointer the main file includes),
optionally `zero-admin` and the theme. With `pages/` present it additionally
runs the Blocks serializer (Node ≥ 22, pinned core packages) as a build
tool; a missing or mismatched toolchain is a build diagnostic, not a
fallback.

`zero publish [dir] --site <url> --app-password <user:pass>` builds, then
makes three requests to `zero-runtime`'s publish endpoint. The split exists
because PHP code loaded in a request cannot be replaced within that request:

1. **Probe.** `GET /zero/v1/publish/capabilities` returns whether the app
   plugin directory is writable (an actual write-and-unlink in a staging
   subdirectory, not a guess from `ABSPATH`),
   `wp_is_file_mod_allowed('zero_publish')`, free space, PHP/WP versions,
   the installed runtime version, the current release digest and whether a
   publish lock is held.
2. **Stage.** `POST /zero/v1/publish/stage` with a zip of the app plugin
   (and the theme when present) and a manifest (file list with SHA-256,
   release digest, expected current release, idempotency key). Requires
   HTTPS, an application password and the `zero_publish` capability
   (granted to administrators by the runtime; nothing lower). The endpoint
   takes `GET_LOCK('zero_publish_<app>')` for the whole publish, validates
   every path against the server-chosen target
   (`plugins/zero-app-<name>/releases/<digest>/`), rejects traversal,
   symlinks, absolute paths, oversized entries and unexpected files,
   verifies every file's digest after extraction, and leaves the release
   staged. The digests detect corruption; the application password is what
   authenticates the publisher.
3. **Activate.** `POST /zero/v1/publish/activate` (old code) checks the
   expected current release and the lock, writes `releases/current` to the
   new digest (write, then `rename`), invalidates opcache for the old tree,
   and returns. From the next request the app plugin boots the new release.
   Until finalization writes `.ready`, the new release boots in maintenance
   for Zero routes and the app's API (503 with `Retry-After`; wp-admin and
   the publish endpoint excluded), so no request runs new code against an
   unmigrated schema.
4. **Finalize.** `POST /zero/v1/publish/finalize` (new code) runs the
   migrations, the route reconciler (§4.7), the agents reconciler (§4.10),
   the code-owned body writes with the digest check, writes `.ready`, and
   releases the lock. The CLI prints the receipt.

A repeat of any step with the same idempotency key returns the stored
receipt; a mismatched expected-current is a 409; a second publisher while the
lock is held is a 423. If finalization fails, `.ready` is absent, Zero
routes stay in maintenance and the CLI prints the two recoveries:
`zero publish --retry-finalize` and `zero publish --rollback`, which points
`current` back at the previous release (kept for that purpose). Rollback
does not reverse migrations: Zero's migrations are forward-only, as today's
plugin upgrades are, and the CLI says so before rolling back a release whose
finalization ran migrations. The runtime plugin publishes its own upgrades
through the same endpoint and the same three steps. The very first install
of the platform plugins on a site is not through this endpoint (nothing is
there to receive it): it is `wp plugin install` of the built zips, the
host's deploy pipeline, or Spacefast.

**Hosting constraints, honestly.** Report 06 established that production
code is not writable on WordPress VIP (read-only application container) or
Pantheon Test/Live (code directories not writable), while WP Cloud defaults
to `php_fs_permissions=rw` with `ro` and `loggedin` modes. So:

| Host | `zero publish` (code) | `zero publish --content-only` | Code path |
|---|---|---|---|
| WP Cloud `rw`, generic VPS, Playground, `zero dev` | works: stage, activate, finalize | works | the endpoint |
| WP Cloud `ro` / `loggedin` | probe reports not writable; refused with the reason | works | switch the site to `rw` for the publish, or the host's own deploy |
| WordPress VIP | refused with the reason | works | the VIP code pipeline (Git) |
| Pantheon Test / Live | refused with the reason | works | Pantheon's code workflow (Git/SFTP on Dev) |

`--content-only` ships Page records, their bodies, metadata-derived
`post_title`, and the synced collection content, and verifies that the
installed release digest matches the build the bodies came from; a mismatch
is refused because a body may reference a region the installed code does not
have. Generated PHP is never stored in the database or `eval`ed as a
workaround. The CLI prints which half it did.

### 4.10 Agents on Data Machine

**Decision (ruling 6).** `defineConfig({ agents })` declares agents;
Data Machine executes them. Zero's part is a compile-time manifest, a
versioned adapter, action-level approval policy enforced in Zero's canonical
invocation path, and `zero doctor`. There is no Zero run ledger, no Zero
transcript store, no second agent loop.

**Rename.** The boolean `agents` option on collections, globals, actions and
jobs, which controls registration as WordPress Abilities (and so MCP
exposure), is renamed **`abilities`** (defaults unchanged: `true`, `false`
on jobs). Its old name collides with the new top-level key and describes the
mechanism wrongly. No shim: unreleased. This supersedes #55's open question
6, which proposed keeping the flag under its old name (§5).

**Config API.**

```ts
// zero.config.ts (the pantry, excerpt)
import { collection, text, integer, date, action, agent, db, HttpError, defineConfig } from "zero";

export const items = collection({
  name: text().notNull(),
  quantity: integer().default(1),
  expiresOn: date(),
}, { access: { read: "author", write: "author", delete: "editor" } });

export const expiringSoon = action({
  access: "author",
  input: { days: integer().default(3) },
  async handler({ days }) {
    const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    return db.query.items.findMany({ where: { expiresOn: { lte: cutoff }, quantity: { gt: 0 } }, orderBy: { expiresOn: "asc" } });
  },
});

export const discard = action({
  access: "author",
  input: { itemId: integer().notNull() },
  idempotent: true,
  // Every entry path (REST, ability, MCP, agent) stages a proposal instead of running.
  approval: { by: "editor", target: { collection: "items", id: "itemId" }, expiresIn: "24h" },
  async handler({ itemId }) {
    const item = await db.query.items.findFirst({ where: { id: itemId } });
    if (!item) throw new HttpError(404, "not_found", "Item not found");
    const [updated] = await db.update(items).set({ quantity: 0 }).where({ id: itemId }).returning();
    return { item: updated };
  },
});

export default defineConfig({
  name: "pantry",
  collections: { items },
  actions: { expiringSoon, discard },
  admin: true,
  agents: {
    pantryHelper: agent({
      label: "Pantry helper",
      principal: { login: "pantry-bot" },           // an existing, non-admin WP user
      access: "editor",                              // who may start runs and read status
      model: { provider: "openai", model: "gpt-4.1-mini" },
      instructions: "./agents/pantry.md",            // → the AI step's system_prompt
      tools: [expiringSoon, discard],                // references, not copies
      memory: { scope: "agent", modelWrites: false },
      pipelines: { expiryReview: { steps: [{ type: "ai", label: "Review expiring food" }] } },
      flows: {
        morning: {
          pipeline: "expiryReview",
          prompt: "Use expiringSoon with days=3. Summarize what to use first.",   // → the flow step's user_message
          schedule: { cron: "0 8 * * *", timezone: "UTC" },
        },
      },
    }),
  },
});
```

`approval` on an action is an application-wide invariant: REST, the
generated ability, MCP and the agent all stage a proposal instead of
executing. `tools` must reference declared actions or collections of this
app, or `ability("plugin/name")` for a foreign ability validated at
reconcile. `principal` is `{ login }`: one shared DM agent owned by that WP
user, whose memory is shared service state. A per-caller principal is
refused in v1 (§7): DM's agent slug carries no user identity, self-service
creation has its own permission and a one-agent limit for non-admins, and
the mapping needs its own design. `timezone` accepts `"UTC"` only in v1
because DM's routine bridge passes no timezone. `instructions` is a build
input: bundled, digested, path must be inside the project; its content is
what DM executes (below). The word `principal` is used rather than `user` so
it cannot be read as #55's `user()` column.

**Generated registration.** The app plugin gets `Requires Plugins: data-machine`
only when `agents` is non-empty, and `agents/manifest.php`: a declarative
array (app, agent key, slug `zero-<app>-<key>-<site>`, `site_scope`,
principal, access, `agent_config` with `default_provider`, `default_model`,
`mode_models` and `tool_policy`, `ability_tools` aliases → ability ids,
pipelines as DM `workflow` objects, flows with `scheduling_config`,
approvals, and the runtime lock: adapter `dm-0.200.4`, DM source ref, Agents
API ref, artifact SHA-256). The bundled adapter
`Zero\Agents\Adapters\Dm02004` is the only code that names a DM class,
ability or filter.

**Where the prompts go.** `instructions` is the bundled file's content and
becomes the pipeline AI step's `system_prompt` in the `workflow.steps[]`
object (`step_type: "ai"`, `agent_modes: ["pipeline"]`). A flow's `prompt`
becomes that flow's step `user_message`, which DM's flow config factory
converts into the step's prompt queue; DM re-runs the configured prompt on
every scheduled occurrence. On update the adapter writes the step's
`system_prompt` through `datamachine/update-pipeline-step` and the flow's
`user_message` through `datamachine/configure-flow-steps`; both fields are
Zero-owned and reconciled, other step and flow fields are left as DM holds
them.

**What the adapter calls, and when** (all verified in DM 0.200.4):

| Phase | Call |
|---|---|
| Early bootstrap, agent entry paths only | `datamachine_request_full_runtime('zero:<app>')` before `plugins_loaded:20` |
| Provision (from publish finalization or doctor `--fix`, under an operator identity, after a DB-backed reconciliation lock) | `wp_get_ability('datamachine/create-agent')->execute([...])` with `config`, explicit `owner_id` and `site_scope`; `datamachine/create-pipeline` with `workflow.steps[]` (`step_type`, `system_prompt`, `user_message`) and `flow_config` with `interval: "manual"` (creates the first flow; the adapter records the returned `pipeline_id`, `flow_id`, `flow_step_ids` before the next call); `datamachine/create-flow` for additional flows; `datamachine/update-flow` to set `scheduling_config` last, after the mapping is committed |
| Update | `datamachine/get-agent` then `update-agent` (`agent_config`, preserving fields Zero does not own), `update-pipeline-step`, `configure-flow-steps`, `update-flow` with recorded ids |
| Start | Zero authorizes `access`, then `datamachine/run-flow` with the mapped `flow_id`, `respect_paused: true`, inside `PermissionHelper::run_as_system()` for that one dispatch. `run-flow` is annotated non-idempotent; Zero keeps a short dispatch receipt keyed by its operation key and reconciles before any retry |
| Tool scope | `datamachine_engine_snapshot` filter sets `job.ability_tools`, `job.mode_models` and a sealed Zero scope for owned flows; `datamachine_resolved_tools` (priority 100) intersects to the allowlist. Tool descriptions and schemas come from the registered Zero abilities through DM's `AbilityToolSource`; no second schema |
| Approvals, stage | `PendingActionHelper::stage()` from Zero's canonical invocation path when an action with `approval` is called on any path; `apply_input` is the normalized input plus target fingerprint, `authorization.target` the row identity, `ttl` from `expiresIn` |
| Approvals, resolve | DM's `ResolvePendingActionAbility` checks `PendingActionScope::can_access_payload()` (creator-bound by default) and the Agents API permission gate before any kind handler runs, so an editor who is not the proposal's creator cannot resolve through DM's own route. Zero's review endpoint therefore authenticates the human (cookie + nonce), checks Zero's `approval.by` policy, then dispatches `ResolvePendingActionAbility::execute` under `run_as_system()` with `resolver: "user:<reviewer id>"` and a Zero-signed `context.zero_reviewer` carrying the reviewer id and the pending action id. The handler registered through `datamachine_pending_action_handlers` implements `can_resolve` as: a valid Zero reviewer context for this action id, whose user satisfies `approval.by`, and no DM agent principal in context; anything else is denied, including DM's native resolver route and tool. `resolve_pending_action` and every DM management ability are excluded from the agent's tools. This dispatch shape is part of `ZeroApprovalBridgeV1` and is proven in PR 13 |
| Approvals, apply | `apply` restores the stored owner and DM context, rechecks access, current policy, expiry and the target fingerprint, calls `PendingActionAuthorizationReceipt::consume` immediately before the canonical mutation, and runs the action under a one-use internal approval capability that is not a public flag |
| Memory | DM's default `AgentMemory` store; `modelWrites: false` means no memory-write tool is projected |
| Admin | `datamachine_admin_pages` for discovery; Zero Admin shows an Agents entry with readiness, owned resources, DM deep links for operators who have DM's capabilities, and the review cards |

**Execution identity.** DM's AI step sets the WP current user to the DM
agent's owner. That is why `principal` maps to an owner. The initiator, the
owner and the approving human are recorded separately in DM job and
pending-action metadata; approval never elevates the principal.

**The approval continuation gap, stated.** Stock DM 0.200.4 stages, claims
and applies pending actions durably, and resumes runtime-tool continuations
for chat sessions. It does not establish that a paused **pipeline** AI step
resumes with the original tool-call id and remaining cursor after a human
decision, and its default resolution scope does not admit a reviewer other
than the creator. Zero requires a versioned capability,
`ZeroApprovalBridgeV1`: the reviewer dispatch above; checkpointing the
assistant turn, tool-call ids and cursor in the DM job before releasing the
worker; on decision, persisting the terminal tool result under the original
id and scheduling DM's fenced resume. It is delivered as a tested DM
integration patch or upstream change. Until `zero doctor` sees it,
approval-dependent flows are reported unready and refuse to start; read-only
agents run. The model is never asked to reissue an approved mutation.

**Version pinning.** The platform pins DM core 0.200.4 (`b07be213`, exact
artifact SHA-256, built with `composer install` from its committed lock) as a
locked WordPress plugin like SCF and the MCP adapter. Business and Socials
are not installed. DM bundles Agents API `952db6cb` and Action Scheduler
3.9.3; Zero pins AS 4.2.0. **Decision:** one qualified AS version and runner
policy for the combined platform, starting from 4.2.0, accepted only after
co-install tests under both plugin load orders; DM's global queue tuning
cooperates through a narrow tested opt-in, not two competing runners. This
is the one-queue answer (report 07 §B6): two logical job domains, one
physical backend, no Zero job that wraps a DM run and no DM flow that
duplicates a Zero cron.

**`zero doctor`** gains an agents section, inspecting the running site, never
source strings:

| Check | Evidence |
|---|---|
| Platform | DM active at the qualified artifact; WP 7.1 / PHP 8.2; vendor autoload and built admin assets present |
| Substrate | loaded Agents API class source matches the lock; a second copy is a failure |
| ABI | `datamachine/create-agent`, `create-pipeline`, `update-flow`, `run-flow` registered; `PendingActionHelper::stage` and `PendingActionAuthorizationReceipt::consume` exist; `ZeroApprovalBridgeV1` present or approval flows marked unready |
| Persistence | DM tables current; SQL pending-action claims available; memory store writable, persistent and shared across workers |
| Principal and tools | service user exists and is not an administrator; agent owner and `site_scope` match; resolved tool set equals the allowlist plus vetted plumbing; no management or self-resolution tool |
| Prompts | the step's `system_prompt` digest equals the bundled instructions digest; each flow's `user_message` equals its declared prompt |
| Provider | provider and model configured; finite turn budget; no secret printed |
| Delivery | loaded AS class version and runner policy qualified; one routine per owned schedule; a disposable canary job on both domains |
| Reconciliation | manifest digest matches owned DM resources; drift and orphaned owned schedules listed; nothing of anyone else's is touched |

## 5. Relation to the config API redesign (#55)

PR #55 (`docs/design-config-api.md`, Sol-clean after 24 rounds, not yet
ruled on by the owner) redesigns the surface this document builds on. The
two cannot diverge, so this section resolves every point where they touch,
records the status of each #55 proposal, and fixes which API the examples
use. #55 predates the WordPress-only cut; everything it says about the
standalone target (its §4.12 list, `target`, `ctx.target`, the standalone
job worker and identity) is void, and the cut has already removed those.
It also predates rulings 1–7, so it says nothing about pages or agents.

### 5.1 Conflicts, resolved

| Touch point | #55 | This document | Resolution |
|---|---|---|---|
| The exposure flag | keeps `agents?: false` on `collection()`, `global()`, `action()`, `job()`; its open question 6 asks whether to keep it at all | renames it `abilities` | **`abilities`**, defaults unchanged. Supersedes #55 q6: the flag stays (removing it would expose every ability under MCP) and is renamed because `agents` now means AI agents (§4.10). |
| Viewability | no option; "a content collection is a WordPress post type" registered private, `/wp/v2/zero_<key>` only | `collectionPage(c)` in `pages/` flips the CPT to `public: true` with a rewrite slug | **`collectionPage` is the one switch**, and it lives in `pages/`, not in `collection()` options; `schema.php` carries the resulting `viewable` flag so the runtime registers the CPT correctly. No `public` collection option in v1 (§10 q4). |
| Which collections can have a page | `content` is inferred from the columns; `slug()` is `post_name` | `collectionPage` needs a content collection with a `slug()` column | Adopted as #55 defines them: a table (`content: false`) or a collection without `slug()` refuses `collectionPage`; `by` is not an option. |
| `body` | `body` replaces `content` as the rich-text designation | `RichText value={item.body}`, `PostContent` | Adopted; the primitives read the collection's `body` column. |
| Access rules | `read`/`write`/`create`/`update`/`delete`, `ctx.is(role)`, `"self"` on `user()` columns, roles normalized from capabilities | `collectionPage` requires a read rule that is `"anyone"` or a filter; page loaders get `ctx.viewer.is()` | Adopted. A `"self"` read rule is a filter over `user()` and is accepted by `collectionPage` (it compiles to SQL); a bare role is refused (§6). |
| Field access | `.access({ read, write })` on columns | title and body of a viewable collection may carry no field rule stricter than the read rule | Adopted #55's shape; this document adds the one constraint, as a build error. |
| Hooks beside the columns | `collection(cols, { hooks })`; `defineConfig.hooks` goes | page loaders are separate from hooks | No conflict; the journal example writes hooks beside columns. |
| SEO and metadata | its site example keeps `seo: group({ noindex, metaTitle })` as plain data | `metadata` / `generateMetadata` in page modules read those columns | **Metadata lives in pages; SEO values an editor controls are ordinary columns.** No SEO builder, no collection option. |
| `defineConfig` keys | `{ name?, collections, globals?, actions?, jobs?, files?, media?, locales?, localeFallback?, webhooks?, plugins?, admin? }` | adds `pages?: { sync?: boolean }` and `agents?: Record<string, Agent>` | **Both added.** `pages` holds switches and never names a route; `agents` is the AI-agents key. `admin?` is used unchanged. |
| `action()` | `{ input?, access?, idempotent?, signature?, agents?, handler }` | adds `approval?` | **Added**; `agents?` becomes `abilities?`. |
| `user()` and `"self"` | `user()` is a column; `"self"` means ownership | agents have a `principal` | The agent field is named `principal: { login }`, not `user`, so one word keeps one meaning. |
| `sync` | per collection `sync: "pattern"`; `uid` inferred | adds `pages.sync` and the `pages` sync group | Adopted; pages are a sync group beside collections, with their own UID meta on Page records. |
| `Row<T>` / `Insert<T>` | replace `InferSelectModel` | `CollectionPageProps<typeof page>` derives `item` from the collection | Adopted; `item` is `Row<typeof posts>` plus `href`. |
| Table names, lowercase content keys, 15-character limit | the key is the table and post type name | the rewrite slug is the route directory, independent of the key | No conflict; the post type stays `zero_<key>`, the URL is the directory. |
| "WordPress is the vocabulary" | status, roles, SCF types, media, title, slug | "don't follow the WordPress stuff if not needed" | The line: WordPress vocabulary for data, access, media and admin (#55); not for routing, rendering and styling, where `pages/`, layouts, CSS modules and metadata exports are Zero's own (§4). |

### 5.2 Status of each #55 proposal

| #55 proposal | Status |
|---|---|
| Columns: `select([...])`, structured builders without the `fields` key, `json<T>()`, `.default(fn)`, `.onUpdate()`, `.nullable()`, implied NOT NULL, implied `.max(191)`, `media` MIME patterns | adopted |
| System columns `id`, `createdAt`, `updatedAt`; `timestamps: false`; `.primaryKey()` | adopted |
| `ref()`, `user()`, inferred relations, `many()`, `defineRelations` removed | adopted |
| `collection(cols, opts)` without a name; `content` inferred; `body`; hooks inside; `uid` inferred; `api` removed; `collections` key | adopted |
| Access: `write`, `ctx.is()`, `"self"` on `user()`, `"owner"` → `"self"`, auth defaults | adopted |
| Auth collection: system `email` and `role`, pending-password side channel, `suspendedAt`/`guest` removed | adopted (no interaction with this design) |
| `global(fields)`, `bucket()`, `file("key")`, `locales` array, optional `input`, `Row`/`Insert` | adopted |
| `zero build --explain` | adopted; pages add their route table and ownership per route to its output |
| `agents?: false` kept under that name (q6) | **superseded**: renamed `abilities` |
| `admin?: true` | adopted unchanged |
| §4.12 standalone removals | void (already done by the WordPress-only cut) |
| Open questions 1–5, 7–12 (infer `content`; `authorId`/`author` pair; timestamps everywhere; table-name casing; `"self"` on `create`; `revisions` on tables; branded ids; hooks placement; `api`; `pending`/`private`; `contributor`) | **still open**, the owner's. This design depends on none of them except that `content` is inferable (q1) and `api` is gone (q10), which it assumes; see §10 q3. |

### 5.3 Examples

**Decision.** Every example in this document is written in #55's API:
`collection({ cols }, opts)`, `ref()`, `user()`, `select()`, hooks beside
the columns, `collections:` in `defineConfig`, `Row<T>`. The reason is the
one the owner gave for #55 itself: one consistent, smaller API, and no
second surface to migrate the moment pages land. The dependency is
explicit: PR 1 (`abilities`) and PR 12 (agents) touch the same extractor
sites as #55's PR 4 and 6, so #55's stack merges first or the two are
rebased onto each other (§9). If the owner rejects #55, the examples here
are rewritten in today's API in PR 0's follow-up and nothing else in this
design changes; the decisions are independent of the spelling.

## 6. Conflicts between the reports and the rulings, reconciled

**Report 03 (PHP render functions) vs ruling 2 (block markup + PHP).**
Decision: ruling 2, through report 07 §A1's IR. §4.3 defines the split:
literal subtrees → static block markup; scalar slots over loader fields →
bindings; request-dependent structure → generated dynamic blocks whose PHP
chooses or iterates serialized block templates. Report 03's `HtmlBuffer`
survives as the escaping layer for tags that map to no core block and for
dynamic text inside regions, and its differential Node/PHP proof is kept.
Reason: WordPress's own filters, styles and editor see blocks; a pure PHP
renderer would hide every page from them, which contradicts "using normal
WordPress stuff as possible".

**Report 02 (pages need no WP records) vs ruling 1 (hidden Page records).**
Decision: ruling 1; §4.7 is the design. Identity is `_zero_route` meta plus
the route id, provisioned by a reconciler, with collisions as errors,
`adopt` and `reset` as the operator's tools, trash as retirement, explicit
top rewrite rules where the Page hierarchy cannot express the URL, and a
read-only screen with a `map_meta_cap` lock. Reason: canonical URLs, menus,
`wp_get_canonical_url`, sitemaps and every SEO plugin resolve against a
queried post; a virtual route would need Jetpack-preview-style query surgery
for each of them.

**"Blocks never touches `zero.config.ts`" vs pages beside it.** Decision:
pages are a Zero core feature discovered by file convention. `zero.config.ts`
never registers a page; pages import collections from it. Blocks never reads
`zero.config.ts`; `zero build` hands it an IR and receives serialized markup.
Zero core's Rust compiler and PHP runtime never import Blocks' code; the one
coupling is a build-tool invocation that exists only when `pages/` does.
This narrows the Blocks ruling's "never depends on it" to "backend-only
builds never depend on it". **That narrowing is the owner's to make**, not
this document's: it is §10 q1, and PRs 4 and 5 do not start until it is
ruled. Reason for recommending it: a second serializer in Rust would be wrong
the day core changes a class name (blocks-notes §1), and a page system
without the serializer cannot produce valid block markup.

**`public: false` collections and the access gap.** Decision:
`collectionPage(c)` implies viewability and is the only thing that does. It
registers the CPT `public: true` (so `is_post_type_viewable`, core sitemaps
and `show_in_nav_menus` follow) with `rewrite: { slug: <directory> }`,
`has_archive: false`, `exclude_from_search: true` unless
`collectionPage(c, { search: true })`. Report 04's gap, that theme and core
queries bypass Zero's per-record rules because the front-end guard returns
outside wp-admin, is closed in the same PR at two levels. Rows: Zero's read
rule is applied to every `WP_Query` over a viewable Zero type through
`pre_get_posts` / `posts_where`, which the existing compiler can do for
`"anyone"` and for filter rules (they already compile to SQL); a read rule
that is a bare role or a non-filter function cannot be applied to a theme
query, so `collectionPage` on such a collection is a build error with the
fix named. Fields: the collection's title and body may carry no field rule
stricter than the read rule (a build error otherwise), because
`core/post-title` and `core/post-content` in a theme or an inherited loop
read `post_title` and `post_content` directly; other columns live in meta
and SCF, which core blocks do not render without a binding, and Zero's own
primitives on a Zero route go through the viewer-bound item (§4.3).
Collections without a `collectionPage` stay `public: false`, and a
`QueryLoop` naming a Zero collection is refused in v1 (the silent fallback
to core `post` is exactly what Blocks withdrew its helper over).

**Report 05's "one queue" vs Data Machine's job engine.** Decision: report
07 §B6. Both already deliver through Action Scheduler; the requirement is one
physical backend and one qualified runner, not one ledger. Zero jobs stay
Zero jobs; DM runs stay DM runs; neither wraps the other.

**The word "agents".** Decision: rename the exposure flag to `abilities`;
`agents` is only the top-level definition key. Reason: the flag's effect is
Ability registration, and the collision would make `agents: false` mean two
things on one screen.

## 7. Refused in v1

- Catch-all and optional segments, `template.tsx`, parallel and intercepting
  routes, client-side routing.
- React hooks, context, effects, events, portals, Suspense, async components,
  `style` objects, browser globals and unlowered npm imports in any component
  reachable from a WordPress page.
- React or Preact client islands and hydration of PHP output. Islands are
  WordPress Interactivity API only.
- Static HTML export, ISR, build-time prerendering of collection rows.
- `collectionPage` over tables, over collections without a `slug()` column,
  over collections whose read rule is a bare role or a non-filter function,
  over collections whose title or body carries a stricter field rule, and a
  second `collectionPage` for one collection. `QueryLoop` over a Zero
  collection.
- `<TemplatePart>` in canvas mode; Site Editor customization of canvas-mode
  templates.
- Decompiling block markup to TSX; syncing code-owned pages or templates.
- Media byte sync.
- Tailwind and other CSS transforms; CSS-in-JS.
- In-browser (wasm) `zero build` of pages: the serializer needs Node. The
  browser builder keeps `zero check` of the page subset and builds
  backend-only projects.
- A Zero-owned agent runtime, transcript store or run ledger; per-caller
  agent principals; agent timezones other than UTC; Data Machine Business
  and Socials as platform plugins; a model-callable approval resolver; code
  execution sandboxes.
- Any `eval` of generated PHP from the database, or storing executable code
  in uploads, as a publish fallback.

## 8. Testing

One behaviour, one owner, lowest seam that can break it. Compiler
diagnostics and IR decisions are proven in `tests/compiler.rs` fixtures
(`tests/fixtures/pages/*`). Serialization validity stays in Blocks' unit
tests. Rendering, bindings, regions, routes, rewrites, Page reconciliation,
head output, asset order and the `map_meta_cap` lock are proven on the
WordPress-on-SQLite in-process site (`tests/php/wp.php`), one fixture
project, one suite per seam. Node/PHP differential rendering runs the region
corpus under both. The Site Editor validity proof and the theme install proof
stay in Blocks' Docker job, path-filtered. Agents: DM provisioning, prompt
mapping, tool scope, approval staging and human resolution, and the AS
co-install, in a credential-free WordPress-on-SQLite suite with the real
pinned DM artifact; provider calls behind an explicit credential gate.
Publish: the three-step endpoint against the in-process site with a real
zip, including traversal, symlink, expected-current, lock and idempotency
refusals, a failed finalization left in maintenance, and rollback. No
source-grep anywhere.

## 9. Rollout

Stacked PRs in this order. Each is green on `ci.yml`, `blocks.yml` and
`site.yml` on its own; every new behaviour is reachable only when `pages/`
or `agents` exists, so the existing suites are untouched until a PR
deliberately extends them. #55's own stack (its §7.1) is a prerequisite for
PRs 1, 2, 12 and 13 and for the examples; if #55 is rejected, those PRs are
written against today's API and PR 0 gets a follow-up rewriting the
examples (§5.3). PRs 4 and 5 wait on §10 q1.

| PR | Contents | Proof |
|---|---|---|
| 0 | this document | review |
| 1 | rename `agents` → `abilities` on collections, globals, actions and jobs: extractor, `schema.php`, `config-api.md`, types, generated client docs, tests | existing abilities/MCP suites pass under the new name; a fixture using `agents:` on a collection is an error naming `abilities` |
| 2 | collection viewability: the `viewable` flag in `schema.php`, CPT registration `public: true` with rewrite, read rule applied to front-end `WP_Query`, title/body field-rule check, reserved-slug check, refusal of role/function rules | `tests/php/wp.php` suite: a published row has a permalink and renders; a draft row and a filtered-out row 404 through a theme query and through `core/query`; a role rule and a stricter body field rule are build errors; the row appears in the core sitemap |
| 3 | compiler: JSX admission for `pages/`, `components/`, `islands/`; discovery, layouts, groups, params, route ids, collision diagnostics; the IR with provenance; `zero check` over pages; `zero/pages` and `@spacefast/zero-blocks/universal` types; `defineConfig.pages` | `tests/compiler.rs` fixtures for every diagnostic in §4.1–4.3; a backend-only project builds byte-identically to before |
| 4 | Blocks: `serialize-ir` entry (stdin IR → markup + diagnostics) and the `universal` React entry with the class contract | Blocks unit tests: each primitive's React output equals the pinned `save()` classes; IR round trip |
| 5 | static pages end to end: serializer invocation from `zero build`, the `releases/` layout, `pages/*`, canvas with its own `<title>`, route matcher, explicit rewrites, front page options, Page reconciler with `adopt`/`reset`/trash, `map_meta_cap` lock, `wp_insert_post_data` guard, read-only screen | WordPress suite: `/about`, `/`, `/company/team` and `/posts/featured` render through the canvas with one `wp_head` and one title under a theme without `title-tag`; a claimed URL with no record is Zero's 404; Pages list links to the read-only screen; REST `PUT` is 403; rename retires; collision is reported |
| 6 | bindings, regions, loaders, `collectionPage`, `RichText`, `PostContent` and friends over the viewer-bound item, the `zero/page-field` and `zero/region-field` sources, generated blocks with editor placeholders; Node/PHP differential corpus | WordPress suite: a row change shows without rebuild; a denied row never leaks through a binding; `{0 && …}` renders `0` on both sides; the editor reports no invalid block |
| 7 | head/SEO: metadata merge, resolution before output, core emitter, the three plugin adapters, `post_title` sync | WordPress suite with no plugin and with each plugin's pinned artifact: exactly one title, canonical, robots, OG set; sitemap entries per provider |
| 8 | CSS and assets: modules, class maps and types, tokens, hashed files, manifest, enqueue order; Interactivity islands | WordPress suite: stylesheet links precede `wp_head` scripts; a module is registered with its dependency; `wp_interactivity_process_directives` output matches the client store's initial state |
| 9 | theme output: `pages/theme.config.ts`, layouts → `templates/`, `parts/`, `theme.json` presets from tokens; lands the reusable parts of `p3/blocks-theme`; `<TemplatePart>` | Blocks Docker job: install from zip, Site Editor validity for every template and part; a customized template survives a publish and is listed by doctor; plugin canvas and theme render the same body |
| 10 | sync for content pages: `.blocks.html` front matter format, `pages` sync group, seed-once reconciler rule, validator-gated merge, `pages.sync` on/off transitions, `409 managed_record` | `tests/sync.rs` and `tests/php/sync_test.php`: pull, push, conflict, not-representable, seed then lock, lock then unlock with base |
| 11 | `zero publish`: capabilities probe, stage/activate/finalize, lock, maintenance until `.ready`, rollback, `--content-only`, receipt; CLI output | publish suite against the in-process site: happy path, every refusal in §4.9, a killed finalization leaves maintenance and `--retry-finalize` completes, read-only probe → content-only |
| 12 | agents without approvals: `agent()`, `ability()` references, manifest, prompt mapping, `Dm02004` adapter (provision, update, start, tool scope, memory, schedules), DM platform pin, AS qualification, `zero doctor` section | DM suite: provisioning idempotent across two runs; `system_prompt` and `user_message` equal the declared files; tool set equals the allowlist; a Zero job and a DM flow deliver under both load orders; doctor table |
| 13 | approvals: action `approval` in the canonical invocation path, pending-action handler, reviewer dispatch, human review endpoint and cards, `ZeroApprovalBridgeV1` gate and the bridge itself | DM suite: direct REST and agent call both stage; agent cannot resolve; an editor who is not the creator accepts through Zero's endpoint and DM's native route refuses them; accept applies once across a worker restart; changed target fingerprint invalidates; unready without the bridge |
| 14 | examples (`examples/journal` with pages, `examples/pantry` with an agent), README section, `docs/pages.md`, `docs/agents.md` | examples build without diagnostics and byte-equal twice |

PRs 1 and 2 are independent of the rest and can merge first. PRs 3 and 4 can
proceed in parallel. 5–8 are sequential. 9 and 10 depend on 5. 11 depends
on 5. 12 depends on 1 only; 13 on 12.

## 10. Open questions

Each with the recommended answer this document assumes.

1. **Narrowing the Blocks isolation ruling.** `zero build` invokes Blocks'
   serializer when `pages/` exists (§6). This changes a ruling and needs the
   owner's word; PRs 4 and 5 wait on it. Recommended: accept; the
   alternative is a second serializer in Rust that cannot promise editor
   validity.
2. **Adopt #55.** This document builds on #55's config API and writes its
   examples in it (§5.3). Recommended: approve #55 as a doc and land its
   stack before PRs 1, 2, 12 and 13; if rejected, the examples here are
   rewritten and the decisions stand.
3. **#55's own open questions.** Twelve remain the owner's (#55 §8). This
   design assumes only two of its proposed answers: `content` is inferred
   (q1) and `api` is dropped (q10). Recommended: rule on #55's list as a
   set; nothing here forces the other ten.
4. **Publicly viewable collections without a page.** Someone may want a
   viewable CPT for a hand-written theme template without a `collectionPage`.
   Recommended: no separate `public` option in v1; `collectionPage` is the
   one switch. Add `public: true` to `collection()` later if a real project
   needs it, with the same read-rule and field-rule constraints.
5. **Compiled body in `post_content` for code pages.** Gives SEO analysis and
   the read-only screen something to show, at the cost of a digest check on
   publish. Alternative: leave `post_content` empty. Recommended: compiled
   body.
6. **`pages/theme.config.ts` as the theme switch** versus a `theme` key in
   `defineConfig`. Recommended: the file; it keeps `zero.config.ts` to data
   and switches and reuses Blocks' `defineTheme`.
7. **`defineConfig.pages` as the home of the pages sync switch** versus a
   file under `pages/`. Recommended: the config key; it is a switch, not a
   route, and sync switches for collections already live in the config.
8. **Explicit top rewrite rules for static routes** the Page hierarchy cannot
   express (front page, missing ancestors, static under a collection
   directory). They are generated from the reconciled map at runtime and
   flushed on route-hash change. Alternative: refuse those shapes.
   Recommended: the rules.
9. **The approval continuation bridge** is a Data Machine integration patch
   until upstream accepts it. Recommended: ship read-only agents first (PR
   12), hold approvals (PR 13) behind the capability gate, and open the
   upstream conversation at PR 12.
10. **Action Scheduler version.** Qualify 4.2.0 as the active runner and ask
    DM to tolerate it, or step Zero down to 3.9.3 for the agents platform.
    Recommended: 4.2.0, measured in PR 12.
11. **Islands in v1 at all.** Recommended: yes, Interactivity-only, because a
    menu toggle on a marketing page is the first thing a full-site author
    asks for; it is one bundler entry and one `wp_enqueue_script_module`.
12. **Per-caller agent principals.** Refused in v1 (§7). Recommended: design
    them after PR 12 with DM's self-service limits measured, not assumed.
13. **The agents' `access` and DM admin capabilities.** Zero's `access:
    "editor"` does not grant DM's admin pages. Recommended: keep them
    separate; Zero Admin's review cards are the editor-facing surface.
