# Zero pages, components, layouts, sync, publish and agents

Status: broader implementation proposal under the owner's binding rulings (§2).
An optional [Pages subset](pages.md) now implements TSX routes, layouts,
viewer-bound rendering and islands in a separate package. The remaining
pages/agents/publish contracts here are proposals. Their collection,
class and S3 foundations have shipped, as recorded in
[authoring direction](authoring-direction.md). Revision `af6ee887` passed
independent design review; that does not qualify this future runtime.
The owner's 2026-11-02 direction now requires explicit collections and tables
with relations between both. [Authoring direction](authoring-direction.md)
records that target config, optional file layout and TypeScript expansion.
It supersedes the content-inference choice in this document's conditional #55
examples. Other owner decisions, including the Blocks isolation exception,
remain listed in §10. Dependent implementation waits for them.

New names under `zero/pages`, `zero/agents`,
`@spacefast/zero-blocks/universal`, `Zero\Pages` and `Zero\Agents` describe
contracts to implement, not existing APIs. WordPress, Data Machine and SEO
claims were inspected at the exact revisions in §11. That inspection is
source evidence, not a passing runtime qualification.

"Ruling" means an owner instruction. "Selected" means this proposal's
implementation choice. "Owner-open" means no approval is inferred. Examples
use #55's historical proposed config syntax conditionally (§5); that PR is
closed as superseded and its remaining API changes were not adopted. Build errors carry
`file:line:column` and leave the previous output intact.

## 0. Decisions in one screen

| Area | Selected contract |
|---|---|
| Optional pages | `pages/**/page.tsx` beside config, nested `layout.tsx`, optional content-owned `page.md` and `page.blocks.html`. Backend-only produces no page or theme output and invokes no page serializer. DM is required only for declared agents or approvals. |
| Identity | Hidden code-owned WordPress Pages for static code routes. Content-owned Pages for optional content files. Collection item routes use the item's existing post. One injective route ID encoding (§4.1). |
| Rendering | Build-time Gutenberg markup, PHP dynamic regions and viewer-bound scalar bindings. Checked universal components can also compile for React. |
| Editing | TSX never editor-mutable. Hidden code Pages have a separate authorized Zero routes screen. Content-owned files and collection content can round-trip through optional sync. |
| Routing | Reconciled route-to-post map owns inbound rewrites, outbound permalinks and canonical redirects. Root Page is never another route's parent. |
| Head | Metadata resolves before output. Title calculation and the single title emitter have separate owners. Qualified SEO adapters preserve unspecified plugin values (§4.4). |
| Layouts | Plugin canvas by default. Optional block theme with unique route template slugs, stable theme identity and preserved Site Editor customizations. |
| Publish | Local build is separate from authenticated, signed publish. Durable DB operation ownership spans stage, activate and finalize. Host-acknowledged process drain precedes code/schema cutover; a spare DB connection cannot prove drain. Readiness lives in DB, not a release file. |
| Immutable hosts | Content-only endpoint plus host-owned code deploy, installed-digest acknowledgments and explicit finalize handshake. No executable PHP in the DB. |
| Agents | DM core owns runs, conversations, memory and approvals. Zero compiles manifests and adapts pinned DM abilities. No second agent loop or run ledger. |
| Approvals | DM required even without declared agents. Proposed `ZeroApprovalBridgeV1` supplies human review, atomic local application, unknown-outcome recovery and durable pipeline continuation. Missing bridge fails closed. |
| Naming | Existing exposure flag becomes `abilities`; top-level `agents` means AI agents. |
| Unapproved dependencies | #55 stays a proposal. Any config or core coupling to optional Blocks requires the owner's explicit exception. |
| Queue | One qualified Action Scheduler installation and runner policy for Zero jobs and DM runs, with separate existing logical owners. |

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

The journal project shape and config excerpt. Everything under `pages/`,
`components/`,
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
        ├── mu-plugins/zero-loader.php            # host-installed early admission gate
        ├── plugins/zero-runtime/                 # includes the publish endpoint (§4.9)
        ├── plugins/zero-identity/
        ├── plugins/zero-app-journal/
        │   ├── zero-app-journal.php              # stable bootstrap reads the DB release tuple (§4.9)
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
        │       ├── theme/                        # optional immutable theme payload (§4.6)
        │       └── agents/manifest.php           # §4.10
        ├── plugins/zero-admin/                   # only with admin: true
        └── themes/zero-journal/                  # stable stylesheet path; theme-mode only
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

**Route identity.** The canonical pattern has a leading `/`, no trailing
slash except `/`, NFC literal segments and named `[param]` segments. Groups
are removed. Refuse dot segments, empty segments, encoded separators and
literal brackets in segment names. Match decoded URL segments once, rejecting
malformed escapes. WordPress's configured trailing-slash policy formats the
public URL, not the identity.

Without an explicit ID, the route ID is `p:` followed by lowercase hex of
the UTF-8 canonical pattern. Thus `/` is `p:2f`, `/index` is
`p:2f696e646578`, `/a.b` is `p:2f612e62`, and `/a/b` is `p:2f612f62`.
There is no special `.index` or `.show` inference. An explicit
`export const route = { id: "posts.show" }` produces `u:posts.show`.
Explicit IDs match `[a-z][a-z0-9._-]{0,63}`; content files use `routeId` in
front matter. All IDs are unique within the app. A duplicate matching
pattern is still an error even with different IDs.
For this check parameter names do not distinguish `/posts/[id]` from
`/posts/[slug]`; their URL shapes collide. IDs are qualified by
site/blog and app everywhere they are persisted.

An explicit ID survives a URL move. Without one, a directory rename retires
the old route. Generated filenames, block names and theme slugs use a
checked manifest key `k` (lowercase SHA-256 of the length-prefixed app ID
and full route ID), never a lossy punctuation replacement. Detect a digest
collision at build time. The manifest maps `k` back to the full ID. Region
`n` has block name `zero/r<k>-<n>` and directory `blocks/r<k>-<n>/`.

**Request lifecycle.** The reconciler creates the route-to-post map before
readiness. Every static route has an explicit top rewrite to its mapped
`page_id`; the collection permastruct uses its route directory and existing
post. A static sibling wins over a dynamic pattern and reserves that slug
at every supported collection write entry, including core REST and SCF;
the reserved-slug validator cannot exist only in Zero CRUD. Flush rules
only when the ready route-map hash changes. Refuse plain-permalink
installations for page output in v1.

WordPress still performs the main query. At `template_redirect:0`, before
core canonical redirects, Zero
claims only its normalized route patterns. A matching readable managed
object selects that route. A missing, draft or access-denied item becomes
a real 404 with `nocache_headers()` and the Zero not-found body. An
unclaimed URL remains the active theme's responsibility. The default
`template_include` result for claimed routes is the plugin canvas; theme
mode follows §4.6. Canonical links and redirects use §4.7's route map,
including URLs the Page hierarchy cannot represent.

**Loaders.** `export async function load(ctx)` runs once per request before
metadata and rendering. `ctx.params`, `ctx.url`, `ctx.viewer` (with
`ctx.viewer.is(role)` as in #55's `ctx.is`) and
`ctx.content.query.<collection>.findMany|findFirst` are available;
`ctx.content` is a read-only, viewer-bound query API. The trusted `db` from
`"zero"` is refused in page modules with a diagnostic pointing at
`ctx.content`. This check follows the loader/render import graph; importing
a collection declaration does not execute its trusted hooks/actions. A null
viewer is never passed; an anonymous visitor is
`Viewer(null)`, which `Db` already distinguishes from the trusted null. The
loader's return value is the page's props and is memoized in
`Zero\Pages\Request` for bindings and regions to read.

**HTTP cache boundary.** V1 bypasses shared full-page caches for every managed
page, including anonymous pages. It sends `Cache-Control: private, no-store`
and `nocache_headers()` before output. Those headers alone are insufficient:
the host must bypass CDN/reverse-proxy caches and `advanced-cache.php` before
a hit can return HTML ahead of the MU loader. The bypass covers the complete
managed route namespace, aliases, canonical redirects and error responses,
regardless of authentication cookie or header. A custom viewer credential
must never depend on a cache plugin recognizing WordPress login cookies.
Enabling routes, changing route ownership or changing cache configuration
requires acknowledged purge of previously stored managed HTML at every
serving cache before readiness. An unqualified cache configuration keeps
page delivery unready; it does not fall back to a late PHP guard. Unrelated
theme routes retain their own cache policy. A managed theme's whole response
namespace is covered because layouts and metadata may use viewer data.

Shared public HTML caching is deferred until an adapter supplies dependency
tracking and acknowledged invalidation for content, access policy, route,
release and theme changes. Hashed static assets may be cached separately;
retain assets used by still-valid browser documents through the deployment's
retention window. Never apply the HTML bypass by deleting those assets.

`collectionPage(posts)` is the loader for an item route. The URL segment is
the collection's `slug()` column, which #55 makes `post_name`; `by` is not an
option because nothing else has a permalink. The compiler resolves the row
from the main query's post (the CPT is viewable, so WordPress found it),
re-reads it through `ctx.content` so the read rule and field access apply,
and passes `item` and `href`. V1 additionally excludes native password-bearing
managed items before any row reaches page loaders, bindings, excerpts or
metadata, even if WordPress found the published post. They receive the same
uncached not-found result. The query guard in §6 enforces this exclusion,
including cached result adapters; it does not silently clear an existing
`post_password`. Supported core REST, SCF, editor, sync and Zero write paths
refuse adding a password to a page-enabled managed item. Imported existing
passwords remain stored and make the affected item non-servable. Full native
password-cookie support is deferred until its request-specific authorization
can be preserved across every render/query seam. A collection without a `slug()` column cannot
have a `collectionPage`. One `collectionPage` per collection; a second is an
error.

**Example.**

```tsx
// pages/posts/page.tsx
import { PostCard } from "../../components/PostCard";
import type { Metadata, PageContext, PageProps } from "zero/pages";

export const route = { id: "posts.index" };
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
`RichText` (renders authorized, save-sanitized stored content) and the WordPress contextual
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
| A supported scalar slot whose value is a `loader-field` or a `derived` string/URL over loader fields: `Heading`/`Paragraph` content, `Button` text and `url`, `Image` `url`/`alt` (only attributes registered as bindable by the pin) | **Block binding.** `metadata.bindings.<attr> = { source: "zero/page-field", args: { route, field } }`. For a `derived` value the compiler emits a PHP accessor for the expression and registers the result as a named field of the route. | Pinned WordPress bindings replace only their supported attributes at render; the source reads only compiler-registered fields of the memoized request. |
| A conditional whose test depends on the request, a `.map` over loader rows, a `derived` value in a non-bindable position, a contextual primitive with request-dependent props | **PHP region**: a generated dynamic block `zero/r<k>-<n>` with `block.json` (`render: file:./render.php`, `supports.inserter: false`), `render.php` compiled by Zero's existing expression compiler, and a minimal `index.js` (`edit` shows a labelled placeholder, `save: () => null`). | Structure that changes per request is PHP by ruling 2. |

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
region that renders the row-authorized, password-excluded, save-sanitized body through
the qualified content pipeline under the current post context), never to `core/post-*`
blocks. `core/post-*` blocks are emitted only when the queried post is a
core type (a Zero Page record, or a core `post` inside an inherited
`QueryLoop`); their native `post_password_required()` behavior remains intact.
Applying `the_content` filters to raw stored text is not that password check.
`PostContent` targeting its own code-owned Page is refused
to prevent recursively rendering the stored compiled body. `Navigation`
and `QueryLoop inherit` compile to their core
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

export const route = { id: "posts.show" };
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

The manifest identifies this example as `u:posts.show`. Its artifact key
`k` determines `pages/templates/r<k>.html` and `blocks/r<k>-<n>/`; the
source ID never becomes a filename by replacing dots or slashes.

The outer `<article className={styles.article}>` maps to `core/group`
with `tagName: "article"` and the module class preserved. It is static
block structure. `PostCard` expands to a Group, Heading, Buttons and Button;
its title and URL use bindings, its conditional excerpt becomes a region,
and `RichText` becomes another region. The entire article does not become
raw PHP merely because it has a class or a dynamic descendant.

The serializer writes those static subtrees and region references at build
time. PHP evaluates only request-dependent structure, then renders the
precompiled block templates. Unsupported attributes fail instead of being
dropped. No handwritten substitute for a core block's `save()` markup is
part of this contract.

`zero/page-field` and `zero/region-field` callbacks accept only manifest-listed
(route ID, field, block, attribute) tuples in the current request scope.
Bindings follow the pinned block attribute's text, HTML or URL contract;
the adapter applies its required escaping exactly once. Arbitrary field
paths and cross-route reads return `null`. Store sanitization happens at the
write boundary; a blanket `wp_kses_post` after dynamic block rendering is
not a replacement for context escaping and would strip legitimate output.
Static Page records receive the compiled body in `post_content`; collection
routes use their existing content post and have no duplicate body record.

### 4.4 Head and SEO

A page or layout exports `metadata` or `generateMetadata(props)`, never
both. Fields are `title`, `description`, `canonical`, `robots`,
`openGraph`, `twitter`, `alternates` and `jsonLd`. The title accepts a string
or `{ default, template }`. Apply the nearest ancestor title template once.
Leaf descriptions replace, Open Graph merges by key, and image lists
replace. Canonical and `og:url` default to the route-map permalink under
`home_url()`, never the request Host header. Resolve loaders and metadata
before output. Editorial SEO values stay ordinary readable columns.

Title calculation and title emission are separate contracts. Zero owns
exactly one unconditional `<title>` callback on `wp_head` for its routes in
both canvas and theme modes. With no SEO provider it uses the resolved Zero
title or `wp_get_document_title()`. With a qualified provider it preserves
that provider's calculated default and overrides it only for an explicit
Zero title:

| Provider | Title calculation | Other field adapters |
|---|---|---|
| Yoast | provider presentation, `wpseo_title` | `wpseo_metadesc`, `wpseo_canonical`, `wpseo_robots_array`, Open Graph, Twitter and schema filters |
| Rank Math | provider-filtered document title, `rank_math/frontend/title` | frontend description, canonical and robots filters; Open Graph and `rank_math/json_ld` |
| The SEO Framework | provider-filtered document title, `the_seo_framework_pre_get_document_title` | `the_seo_framework_meta_render_data`, robots and schema graph filters |

After provider setup and final template selection, before head emission,
the route adapter removes core's `_wp_render_title_tag` and
`_block_template_render_title_tag`, removes only Yoast's title presenter,
and removes Rank Math's relocated `_wp_render_title_tag` callback and its
legacy title-rewrite output buffer for this route. TSF supplies title
filters, not a title element. Reconcile at the final `template_include`
stage and verify callback ownership before `wp_head` output. The adapter
returns a plain title from the provider calculation (normalizing
provider HTML entities), then the emitter escapes it once. TSF's
`set_document_title` already escapes; do not escape that string twice.
It must work under a classic theme
without `title-tag` support as well as core's block canvas.

For other families, the active qualified provider emits; explicit Zero
values pass through its field filters and unspecified values stay plugin-owned.
Without a provider, Zero emits description, canonical, Open Graph, Twitter
and JSON-LD, uses `wp_robots`, and removes core `rel_canonical` only for
claimed routes. Do not disable a provider's entire head to solve a title
collision. Multiple active SEO providers or an unsupported emitting provider
make pages unready until disabled or qualified with an explicit adapter.
There is no "emit nothing" fallback promising a valid head.

Code Page `post_title` is a static navigation label from metadata's default
or the route label. Per-request SEO titles never mutate the Page. Content
Page titles and collection titles stay content-owned. SEO analysis of a
code Page sees the stored static body and region references, not the fully
rendered request. Sitemaps, menus and provider canonical output must use the
same permalink map (§4.7); test inclusion per provider rather than infer it
from `public: true`.

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

`layout.tsx` takes `{ children }`; the compiler substitutes the nested
subtree. Default canvas output inlines the layout chain into
`pages/templates/r<k>.html`. It uses neither theme template registration nor
`core/template-part`, which would resolve against a different active theme.
The plugin canvas buffers the body before `wp_head`, then calls
`wp_body_open` and `wp_footer`. Active theme functions and global styles
still load. `<TemplatePart>` is refused in canvas mode.

Owner-open theme output uses `pages/theme.config.ts` and Blocks'
`defineTheme`. Each static route gets a unique custom template slug
`zero-r<k>`, emitted as `templates/zero-r<k>.html` and declared in
`theme.json.customTemplates` for `page`. The reconciler assigns that slug
through `_wp_page_template`. Core adds the assigned name before
`page-<slug>` in the hierarchy and resolves the block template. Therefore
`/company/team` and `/support/team` cannot both select `page-team.html`.
The collection's single route uses `single-zero_<key>.html`; only one item
route per collection is allowed. `index.html` is required; root and claimed
404 selection explicitly prepend their route template through
`frontpage_template_hierarchy` and `404_template_hierarchy`, ahead of generic
front-page and 404 candidates. Template parts use `parts/<slug>.html`.

Theme identity is the stable stylesheet `zero-<app>`, never a digest-named
stylesheet that would abandon customizations on each publish. Theme payloads
are immutable and paired with the app digest in the release manifest.
Writable hosts stage both payloads, then the exclusive finalizer switches a
server-created stable theme-directory link to the selected theme payload.
That link is outside the uploaded archive; uploaded symlinks remain refused.
The probe must qualify atomic link replacement and same-filesystem layout.
Hosts without it use the host deployment path rather than copy an active
theme file by file. Immutable hosts install the full theme at the stable
stylesheet path through their rollout. Directory filters alone are not
assumed to redirect every `WP_Theme` file lookup.

For an active managed theme, the admission fence covers all requests using
that theme, including ordinary WordPress routes and the Site Editor. A
crash between a theme-link change and DB selection leaves admissions closed;
recovery compares the real installed theme digest with the operation's
recorded pair. No request serves a mismatched app/theme pair. Clear theme
file-discovery, `theme.json`, object-cache and opcache entries at cutover.

First theme activation is explicit (`zero publish --activate-theme`),
authorized and recorded in the publish operation. While admissions are
closed, finalization installs/selects the paired theme and calls
`switch_theme('zero-<app>')` when the stylesheet changes. It checkpoints
`theme_boot_required` and returns a continuation without reopening. A
subsequent finalize request loads the selected theme from the start, runs
WordPress's deferred `after_switch_theme` work and verifies `template`,
`stylesheet` and the request's loaded theme digest against the release
tuple before ready. The same bootstrap boundary applies after a theme-link
change under an unchanged stylesheet. An include or `switch_theme` call
cannot unload the old theme's PHP in its current request. An
ordinary publish refuses an unexpected active theme; it never silently
activates or overwrites one. Canvas mode leaves the theme alone.

Site Editor customizations stay under the stable stylesheet and shadow
theme files according to WordPress's model. Publish never overwrites their
`wp_template`, `wp_template_part` or global-style posts. `zero doctor`
reports drift; region references in customizations must remain available or
publish refuses retirement until the customization is reset. Rollback
restores the recorded app/theme pair and prior theme options under the same
admission barrier, calls `switch_theme` when needed, invalidates caches and
rechecks readiness. It is refused after an incompatible schema migration
(§4.9). The paused Blocks theme work supplies the builder and Site Editor
proof, not a second routing convention.

### 4.7 Editing and Page records

The route reconciler runs during closed-admission finalization and explicit
`zero doctor --fix`, never as an uncoordinated frontend repair. A unique
(site/blog, app, full route ID) mapping owns one static Page. Persist the
mapping in a Zero control table with a unique key, plus `_zero_app` and
`_zero_route` post meta for discovery. Post meta alone has no uniqueness
constraint. Collection routes map to existing item posts.

Code Pages store compiled `post_content`, its digest, a static navigation
`post_title` and `post_status = publish`. A content file seeds its Page once;
later title, body and status changes belong to sync, not publish. Route path
and template assignment remain code/file-owned for both. Check and report
unexpected body drift before replacing code content; an explicit force
operation preserves a revision and records the overwritten digest.

**Hierarchy and canonical URLs.** Set `post_parent` only to a managed Page
for the exact immediate parent path, excluding `/`. If it does not exist,
use `0`, not the nearest surviving ancestor. Core may suffix an internal
slug for uniqueness when two orphan routes end in `team`; public URLs still
come from the route map, not that storage slug. The root Page is the front
page, never a container for `/about` or `/company/team`. Store its own
non-publicly-significant slug without allowing that slug into child URLs.

Explicit rewrites handle every claimed static URL. For managed Pages the
`page_link` filter returns the stored canonical path under `home_url()` and
WordPress's slash policy; `get_canonical_url` and route-scoped
`redirect_canonical` agree. `get_permalink`, menu links, core and provider
sitemaps must therefore return `/company/team/` even if the row's natural
hierarchical URI is `/team/`. A natural URI that resolves to this managed
Page redirects to its canonical path, unless that path belongs to another
route or ordinary Page; it never steals that owner's URL. Pinned-ID URL
moves record old canonical paths as redirects only after collision checks.
Aliases never redirect a valid different object. No missing ancestor Pages
are manufactured.

`pages/page.tsx` claims `/` by setting `show_on_front = page` and
`page_on_front` to the root record. Existing non-Zero front-page ownership,
an ordinary Page at a claimed path, reserved WordPress paths and conflicting
CPT permastructs cause reconciliation failure before ready. The operator
renames the route or explicitly adopts a record with a preserved revision.
Removed static routes move their records to trash with retirement metadata.
`zero pages reset <id>` is an authorized reconciler operation. A URL move
with an explicit ID preserves the record and its navigation references.

**Hidden means outside the editing workspace.** Code Pages are absent from
the normal Pages list, its search and counts, editor pickers and Zero Admin
content lists. Core REST `context=edit` lists and search omit them. Hide
them at those scoped query/response boundaries, not by making the public
post private or filtering every Page query. Frontend queries, public REST
read contexts, navigation references and sitemaps retain their public
identity. A Zero routes screen lists source paths and diagnostics under a
separate view authorization; its links are generated by Zero, not
`get_edit_post_link`, whose filter never runs when `edit_post` is denied.
Existing menu references work; a route picker in that screen can supply
public Page IDs and URLs without exposing a mutable code Page editor.

`map_meta_cap` denies core `edit_post` and `delete_post` on code Pages;
route-specific REST, autosave, revision restore, XML-RPC and admin write
paths also deny changes. Direct navigation to `post.php` fails. There is no
Zero CRUD endpoint for these Pages. The defense at `wp_insert_post_data`
returns the stored owned fields for unauthorized updates (and reports the
refusal at API boundaries); this array filter cannot return `WP_Error`.
Only a private, request-local reconciler authorization can change owned
fields, never a public input flag. Trusted PHP that bypasses core APIs and
direct SQL are outside this boundary and are detected by digest checks.

Content-owned Pages enter the normal editor only when `pages.sync` is on;
otherwise the same write lock applies after seeding. Collection item bodies
and fields stay content-owned under their ordinary access rules; their
TSX template is always code-owned. Collection sync policy is in §4.8.

### 4.8 Sync

**Decision (ruling 3).** `zero sync` extends the existing engine (UIDs,
per-site base, field-wise three-way merge, server body merge, stale-write
rejection, conflict files, `resolve`) to pages. Nothing is replaced.

- **The switch.** `defineConfig({ pages: { sync: true } })` turns on sync
  for content-owned pages; default `false`. Collections keep #55's per
  collection `sync: "pattern"`. "Sync off" for the whole project means no
  collection declares `sync` and `pages.sync` is false or absent.
- **Body format.** Raw serialized block markup, in `page.blocks.html` with
  YAML front matter (`uid`, optional `routeId`, `title`, `status`, metadata fields).
  Markdown (`page.md`) stays the opt-in prose format through the existing
  `Markdown::fromBlocks` gate: a body the converter cannot represent is a
  `422 not_representable` and the file is left alone, never flattened. Pulls
  take the stored `post_content`, never `the_content()` output; a dynamic
  block comes back as its self-closing reference.
- **Identity.** The Page record's `_zero_uid` (minted by the existing `Uid`
  runtime) in front matter; `_zero_route` ties it to the route. A renamed
  file keeps its UID and an explicit route ID when identity must survive.
  Directory paths own Page URLs; core slug/parent edits are locked, not
  silently interpreted as file renames. Collection slugs remain ordinary
  synced fields under their reserved-slug guard. Two files with one UID
  or route ID are an error.
- **Scope.** Code-owned pages, templates and regions are never synced: TSX
  has no inverse in block markup and this design does not pretend otherwise.
- **Two-sided block edits** go through the existing line merger only when
  `BlockMarkupMergeValidator` accepts the result and block boundaries are
  unchanged; otherwise a conflict file.
- **Media bytes** do not sync in v1 (unchanged from phase 2).
- **Sync off.** With `pages.sync` off, content-owned Pages seed once and
  use §4.7's write lock. Collections with no sync history remain ordinarily
  editable. Removing a collection's sync declaration requires a clean
  export (`zero sync --check` exits 2 for unexported edits); its previously
  managed rows retain their management provenance and lock until an
  authorized ownership-release operation. This does not lock unrelated rows
  or collections. All core and Zero write entries enforce the lock; Zero
  CRUD returns `409 managed_record`. An authenticated sync validates its
  base before receiving private write authorization. Turning page sync on
  establishes a base first; turning it off refuses unexported edits.

### 4.9 Build and publish, with hosting constraints

`zero build` writes `.zero/wp-content/` locally. It never contacts or
mutates a site. With pages enabled it needs the pinned Node serializer;
missing tools fail the build. Backend-only builds invoke no page tool.
Platform plugins and the stable release bootstrap are installed and
upgraded by the host platform path, not self-replaced by this publish
endpoint. An app release contains immutable app code, page assets and an
optional theme payload, plus a digest manifest.

The stable bootstrap reads an authoritative, uncached DB tuple per site/app:
active app digest, theme digest and mode, schema generation, readiness and
admission epoch. There is no mutable PHP include pointer or `.ready` file
inside an immutable release. A request loads only the exact locally
installed tuple. Missing files or an incompatible runtime ABI fail closed.
A host-installed must-use loader establishes admission before ordinary
plugins can load app code. Normal plugin load order is not the barrier.
Stable publish/status/recovery routes skip ordinary generated-code boot and
never first take a consumer fence that they would need to upgrade. Only the
host-admitted finalizer loads the selected release after acknowledged drain.
A control request may install/switch a pending theme while the prior theme
is still loaded, but it runs no app migration or domain callback until a
fresh bootstrap attests the selected theme digest. A tuple mismatch never
opens ordinary serving.
If the early loader is absent, app readiness fails. The loader checks
admission for generated plugins in a stable app-key order before booting them.
It may conservatively return site maintenance when any required app is
closed; URL matching is not permission to boot an unready plugin. All
requests using a managed theme are covered too.
Release readiness covers safe code/schema/theme admission. Feature readiness
is separate: a missing approval bridge disables approval-bearing actions and
flows, and an unsupported SEO provider disables page delivery. Neither can
silently bypass its guard or disable an unrelated qualified read-only agent.
Only stable control-schema code can answer status/recovery while release
readiness is closed.

**Authentication and signing.** HTTPS and a WP application password identify
the publisher; `zero_publish` authorizes the operation. During an explicit
initial enrollment that capability binds a publisher public key to the
site/app. The CLI uses that enrolled key to sign an RFC 8785 canonical JSON manifest
with Ed25519. The manifest binds site/blog ID, app ID, expected active
digest, new digests, protocol version, idempotency key and file SHA-256s. Verification rejects wrong-site,
wrong-app or changed bytes. A signature does not bypass WP authorization.
Enrollment/rotation is administrator-only and auditable. Secrets are never
printed. Digests alone prove integrity, not publisher identity.

**Persistence across requests.** A control-schema operation row records the
signed payload hash, stage, expected/new tuple, owner-token hash, monotonic
lease generation, expiry, step receipts and errors. A unique operation key
returns stored receipts only for the identical authenticated payload.
Creation, renewal, takeover and each transition use a short transaction
with compare-and-swap on state, owner and generation. A second active
operation for the app is refused. Every HTTP step validates the persisted
ownership; no MySQL `GET_LOCK` is expected to survive HTTP connections.

Extraction writes to a server-selected staging directory unique to the
operation and generation. A stale extractor cannot change another
operation's files. Only an ownership-checked transition promotes a fully
verified immutable digest directory; active state changes only in DB.
Expired ownership permits takeover of known incomplete work, not replay of
an uncertain external effect or concurrent migration. Finalization runs as
one host-supervised mutation process under the operation's generation and
closed-state drain receipt. A lease expiry, lost DB connection or vanished
lock is never proof that this process stopped. Before takeover, the host
must terminate the old mutation process and its children, close their DB
sessions, and acknowledge that exit. Only then may CAS advance ownership
and admit the replacement process. All target mutations validate the current
generation, including theme-link replacement; this supplements actual
process exclusion rather than replacing it. The finalizer disables automatic
DB reconnect/query replay and stops on connection loss. A supervisor that
cannot prove exit leaves the operation closed for operator recovery.

The protocol has a probe followed by three idempotent mutation steps.
A step may return a durable continuation instead of keeping an HTTP request
open; the CLI resumes the same operation key:

1. **Probe** reports runtime ABI, DB state, installed digests, allowed file
   modification and host mode. On a writable candidate it performs a bounded
   staging write-and-unlink to check permissions. Read-only mode uses host
   declarations and installed-file verification without trying to write a
   release readiness marker.
2. **Stage** authenticates, verifies the signature and expected active tuple,
   stores the operation, extracts and verifies all bytes. Reject traversal,
   symlinks, absolute paths, unlisted or oversized entries. Nothing changes
   the active tuple or runs uploaded PHP. The endpoint cannot stage its own
   stable bootstrap or platform-plugin upgrade.
3. **Activate** closes admissions durably, drains existing consumers under
   the barrier below, then CAS-selects the new app/theme tuple as unready.
   Staged code is not booted before the drain. Subsequent ordinary consumers
   remain closed. A separate finalize request boots the selected release
   under private migration authorization; old code is never replaced in its
   current PHP request.
4. **Finalize** verifies the installed tuple, completes theme activation
   across a fresh bootstrap when required (§4.6), then applies journaled
   migrations, reconciles Page records and DM resources,
   verifies bodies, rewrites, template references and readiness, then commits
   ready/open with a new admission epoch and the receipt. Migration and
   reconcile steps have durable checkpoints; DDL may not be transactional,
   so a crash resumes only a proven idempotent/incomplete step. An uncertain
   step stops for reconciliation rather than running again blindly.

**All consumers share the barrier.** The stable bootstrap checks uncached
open/ready and generation before loading generated code. The host admits
the invocation into the currently open process generation. Zero REST,
core REST collection reads and writes, SCF,
wp-admin editors, frontend queries, abilities, cron, Action Scheduler, DM
tools, sync and CLI/WP-CLI all enter here. Static provider code stays
registered for control/status, but no app callback or collection storage
access runs while unready. A blocked web/admin operation gets a 503 with
`Retry-After`; workers release/defer rather than mark the work successful.
Only the stable recovery screen and the private finalizer bypass admissions.

**Host-acknowledged drain is required for code/schema cutover.** A shared
InnoDB lock on a spare connection is not a consumer-lifetime fence: losing
that connection releases the lock while PHP and its ordinary DB connection
can continue. Neither a pre-query liveness check nor a heartbeat closes
that race; WordPress reconnect/query replay makes it worse. V1 therefore
does not offer a DB-lock-only migration path on MySQL or SQLite.

After durable admission closure, the host blocks new web, CLI and background
app execution across every serving and worker node, including requests that
read the previous open state. The web boundary runs before any CDN, proxy or
`advanced-cache.php` response; a warm HTML hit cannot serve a closed release.
It stops automatic respawn of the old process
generation, lets invocations finish within a bounded drain budget, then
terminates the remaining processes and descendants and closes their app DB
sessions. The host acknowledgment binds site/app, operation generation,
admission epoch, complete node/worker set and exited process generation.
An alive, suspended, disconnected or unreachable old consumer prevents the
acknowledgment. A topology change invalidates it until every new node is
closed and included. The supervisor continues exclusion throughout migration;
it cannot reopen ingress or old workers merely because its control connection
drops. No DDL or new app bootstrap starts before the acknowledgment is
verified. Timeout or lost host authority keeps admissions closed. A DB lock
may coordinate short control transactions; it never substitutes for this
process/connection termination proof.

The local development supervisor supplies the same protocol for local PHP,
WP-CLI and workers. Single-host SQLite uses `BEGIN IMMEDIATE` for control
CAS, not as proof that unrelated PHP has exited. Multi-host SQLite is
unsupported. Hosts without a qualified supervisor may stage immutable bytes
and perform supported content-only operations, but code/schema activation
refuses with a located host-capability diagnostic.

An already-running long job must finish or checkpoint and exit before the
host acknowledges drain. A checkpoint persists work, releases app objects
and transactions, and exits its process generation; resumption enters a new
invocation through the selected generation. A checkpoint inside still-running
old PHP does not qualify. Persisted AS/DM payloads include a handler
contract version: after cutover compatible work resumes under new code;
incompatible work is held/cancelled explicitly, never delivered to a changed
handler. Registrations alone cannot solve in-flight work. Trusted raw SQL
or plugins that bypass the supported entry boundary are not isolated by a
PHP guard. The host must include their schema-consuming processes in the
drain or refuse code/schema activation; it may conservatively drain the
whole site's PHP and workers.

**Recovery.** Same-key retries return durable state. Stale expected-current
is a 409, competing ownership a 423. A dead finalizer leaves admissions
closed. Retry resumes its recorded steps under a new generation only after
the host proves the former mutation process and DB sessions have exited.
Rollback is allowed only when the recorded schema and outstanding-work contracts
remain compatible with the previous app/theme pair; otherwise refuse and
require forward repair. Never "warn and run old code" after a destructive
migration. Restore theme options and validate the whole pair before ready.

**Immutable hosts.** VIP, Pantheon Test/Live and WP Cloud read-only mode
use host-owned code deployment and `--content-only`. The host first invokes
the close-and-drain phase of activate and receives its durable closed-state
receipt. Only then may it replace a stable theme path or platform code.
Additive immutable app artifacts can be staged earlier. The host installs
the exact signed app/theme artifact on every serving/worker node, reports
the installed digests and resumes activate/finalize with its rollout
acknowledgment. Activate selects the new tuple only after that acknowledgment.
During the rollout admissions stay closed; a node that lacks the selected
digest serves no app work. Readiness is committed in DB
only after the host confirms all required nodes and drain. No production
filesystem write is needed for readiness. The host also installs the stable
theme path and platform upgrades.

`--content-only` never changes code or schema. It checks the ready installed
digest and schema, uses ordinary admitted transactions, then applies
authenticated Page reconciliation or content sync with base/digest checks. It cannot overwrite
editor-owned content merely because the build contains an older copy.
Region references must exist in the installed release. Writable WP Cloud,
generic VPS and local development use stage/activate/finalize with the same
qualified supervisor drain, not an HTTP-only lock fallback. The probe decides
from actual capabilities. The CLI receipt states which code and content steps
completed. Generated PHP never goes into DB or
uploads and is never `eval`ed.

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
when `agents` is non-empty **or any action declares `approval`**, and
`agents/manifest.php`: a declarative
array (app, agent key, deterministic collision-checked site-qualified slug, `site_scope`,
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

**Adapter lifecycle.** These existing DM calls are the integration points,
not evidence that the proposed bridge already exists:

| Phase | Contract |
|---|---|
| Bootstrap | For agents **or approvals**, request full runtime before `plugins_loaded:20` on reconcile, dispatch, schedules, review and all action entry paths. Detection includes the current manifest and persisted owned-resource mappings, including retired resources after the last declaration is removed. Cover direct REST, abilities, MCP and admin. An approval-only app still installs DM, its SQL pending-action store, the adapter and bridge. |
| Provision | Under an operator and a DB-backed reconcile lock, call `datamachine/create-agent` with explicit `agent_slug`, `owner_id`, `site_scope` and config. Persist the returned numeric `agent_id`. Pass that exact ID to `datamachine/create-pipeline`, its seeded flow and each additional `datamachine/create-flow`. A missing ID must not fall back to the provisioning operator's current agent. Create flows with manual scheduling. |
| Verify and schedule | Read back every agent, pipeline and flow. Verify site scope, agent owner, pipeline `agent_id`, flow `agent_id`, pipeline/step IDs and the Zero resource key before recording the mapping and enabling schedules with `update-flow`. Ownership drift fails readiness; never adopt another agent's rows. |
| Update | Read mapped resources first, then `update-agent`, `update-pipeline-step`, `configure-flow-steps`, `update-flow`. Preserve fields outside Zero's declared ownership. A crash after a non-idempotent create is reconciled through the deterministic owned key before retry; an ambiguous match stops. |
| Retire | Diff desired keys against all persisted owned mappings under the publish barrier. Verify ownership, disable/pause removed flows, remove their recurring and one-time schedules through the pinned DM scheduler, and verify readback before readiness. Retain tombstones, history and memory; do not delete unrelated DM resources or infer ownership from a display name. Unresolved owned orphans fail readiness. |
| Start | Authorize Zero `access` and dispatch `datamachine/run-flow` with the mapped ID and `respect_paused: true` under `PermissionHelper::run_as_system()` for that call only. DM's dispatch is non-idempotent. A DM-owned durable dispatch receipt must store intent and the resulting DM job ID; this requires a qualified adapter/DM integration capability rather than a presumed `run-flow` option. An uncertain result is held for DM reconciliation, never retried on timeout alone. No Zero run table is introduced. |
| Tools | `datamachine_engine_snapshot` supplies `job.ability_tools`, `job.mode_models` and a sealed scope only for verified, currently declared owned flows. Retired or stale-generation owned flows fail closed before dispatch, not by falling back to native DM tools. `datamachine_resolved_tools` intersects to the allowlist. Schemas come from registered abilities via DM's `AbilityToolSource`. Exclude management, resolution and memory-write tools when not explicitly permitted. |
| Memory and admin | Use DM `AgentMemory` with the qualified private store described below. `datamachine_admin_pages` supplies operator discovery; Zero Admin supplies readiness, resource links and human review cards under Zero authorization. DM admin capabilities are not granted by an agent's `access`. |

DM's AI step sets the WP current user to the DM agent's owner. The fixed
non-admin service principal owns its shared memory. The initiating human,
service owner and approving reviewer remain separate in DM metadata; approval
never turns the service user into the reviewer. Per-caller principals are
out of scope for v1.

**Removal is a durable transition.** Persist the site/app/resource key, DM
agent/pipeline/flow IDs, ownership proof, manifest generation and retirement
state in the adapter's resource mapping. This is resource identity, not a
second run ledger. It survives removing a flow, an entire agent or the final
top-level `agents` declaration. Before reopening readiness, reconcile every
previously owned mapping against the selected manifest. Disable removed
flows and unschedule both recurring and one-time delivery; cancellation is
not proved by deleting only a Zero declaration. Retries resume the same
retirement checkpoint and verify DM state before recording completion.

Queued occurrences and direct native DM starts must pass a qualified
owned-flow generation/membership check before model or tool execution.
Historical ownership with a retired key is a denial, never native fallback.
Already-running work drains under §4.9 and cannot re-enter the removed
flow. Human-waiting runs lose approval applicability and are cancelled or
held through DM's durable state without resuming the original tool. Unknown
external outcomes remain held for reconciliation, never replayed; the
tombstone blocks new starts regardless. Keep runs, transcripts and memory
for authorized operator history. Do not delete them to make doctor green.
If the pinned integration cannot enforce these transitions at all dispatch
and resume paths, removal cannot become ready. Unrelated native DM work
keeps its behavior; only positively verified Zero-owned IDs are affected.

**Memory privacy is readiness.** DM's default disk path under public WP
uploads is not qualified merely because it is writable and persistent.
Select a host-configured DM `AgentMemory` store outside every document root
and public upload/CDN namespace, with storage permissions restricted to the
service and an authorized DM access path. It must remain persistent and
shared across all agent workers. This preserves DM's memory engine; Zero
does not add another store protocol. A web-server rule or `.htaccess` file
alone is not proof that another origin, server or CDN honors it.

Qualification writes a unique nonsecret canary through the actual selected
DM store and verifies anonymous denial at the serving origin and every
applicable upload/CDN mapping, including known default disk locations.
Verify the same store configuration on each worker and clean up the canary.
The readiness attestation binds the storage configuration and delivery
topology; changing either invalidates it. Doctor inspects that configuration
and qualification, and reports a private-storage failure without printing
memory contents. An unknown path mapping, public response or absent private
store makes agents unready. Never serve memory through a static URL and
rely on PHP authorization that the file server bypasses.

**Approval is canonical, including without agents.** Every entry to an
approval-bearing action stages through `PendingActionHelper::stage()` instead of executing.
The normalized input, original principal, target identity/version fingerprint,
policy digest, code/handler version and expiry are stored in DM. No Zero
approval table is added. If DM, SQL claims, full runtime or the qualified
bridge is unavailable, invocation returns an explicit unready error and
performs no mutation. `idempotent: true` alone does not make an approval safe.

DM's native pending-action scope is creator-bound by default; its public
Agents API ability also has a permission gate. The facade
`ResolvePendingActionAbility::execute()` calls the resolver function, so
Zero must authorize its own internal dispatch rather than assume that calling
the facade re-runs a public ability permission callback. Zero's review
endpoint authenticates a human with cookie and nonce, checks `approval.by`,
and creates a request-local signed reviewer context bound to the action ID,
decision, policy version and expiry. It calls the facade under narrowly
scoped `run_as_system()` with explicit `resolver: "user:<id>"` and
`operator_wide: true` in internal context. This admits the operator scope;
it is not itself approval authorization. The Zero handler's `can_resolve`
requires that signed context, rechecks the actual human and rejects an acting
DM agent. DM's native route/tool cannot supply it. Never accept an inbound
caller-supplied resolver, operator flag or reviewer signature as authority.

**Required `ZeroApprovalBridgeV1`, not stock DM behavior.** The bridge is a
versioned DM integration patch or upstream change. It extends DM's canonical
resolver/store, not a parallel Zero approval engine, and must supply:

1. **Atomic local application.** On one transactional DB connection, lock
   the pending action and the target row/version, recheck principal access,
   reviewer policy, expiry, handler version and target fingerprint, consume
   the exact authorization receipt, execute the local mutation and persist
   its terminal DM result in the same commit. All writes to that target use
   the same row lock/version CAS, including core REST/admin and SCF/meta-only
   edits, not just `db.update`. A target with an uncovered write entry is
   unready for approvals. WordPress post/meta writes and DM tables
   must share that transaction; nontransactional tables fail readiness.
   WP hooks that emit external effects are deferred until commit. Approval
   actions with unclassifiable hook effects are refused until adapted.
2. **Crash recovery.** A local crash before commit rolls back consumption,
   effect and result together; retry may reclaim only that proven rollback.
   A crash after commit returns the stored result without reapplying.
   An abandoned unconsumed claim can be reset only after proving no active
   executor owns it. Never reset a consumed `applying` record on lease expiry.
3. **External effects.** Before sending, store the stable DM action-derived
   idempotency key, request digest and target/provider preconditions in DM's
   record. The provider must support a qualified idempotency/result lookup
   contract. After timeout/crash, reconcile by that key and persist the
   observed result. If the outcome cannot be proved, keep the action held
   with `resolution_metadata.outcome = "outcome_unknown"`, block replay and
   require operator reconciliation or a new proposal after observation.
   Do not label it failed and let the model repeat the mutation. Actions
   without a safe external contract cannot opt into approved execution.
4. **Continuation.** Checkpoint the DM pipeline AI turn, tool-call IDs and
   cursor durably before releasing its worker. Commit the decision/tool
   result before dispatching notifications or DM's fenced resume. Resume
   under the original tool-call ID after restart; do not ask the model to
   reissue a mutation. Rejection and expiration also yield terminal results.

Stock DM's `claim_for_resolution` uses SQL CAS, and
`PendingActionAuthorizationReceipt::consume` gives at-most-once consumption.
Its own store explicitly says a crash after consumption requires operator
reconciliation; `complete_claim` accepts accepted/rejected/failed, not a new
`outcome_unknown` status. The bridge must retain the consumed action and
write the metadata above through a supported store extension, then resolve
only after outcome proof. Its transaction must encompass DM completion and
defer DM's current resolution callbacks until commit. Wrapping only Zero's
handler would leave the stock effect/result gap open.

Until this capability is installed and qualified, **every approval-bearing
action and approval-dependent flow is unready**, even in an app with no
agents. Agents that do not require approvals can run through the qualified
adapter. No continuation, atomicity or external exactly-once claim is made
for the unpatched baseline.

**Version pinning.** The platform pins DM core 0.200.4 (`b07be213f70904f379d2c18204d3b36a003ba41f`, exact
artifact SHA-256, built with `composer install` from its committed lock) as a
locked WordPress plugin like SCF and the MCP adapter. Business and Socials
are not installed. DM bundles Agents API
`952db6cb2b3ef49ab2e539993788d3e04bb6e783` and Action Scheduler
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
| Agents API | loaded Agents API class source matches the lock; a second copy is a failure |
| ABI | `datamachine/create-agent`, `create-pipeline`, `update-flow`, `run-flow` registered; `PendingActionHelper::stage` and `PendingActionAuthorizationReceipt::consume` exist; `ZeroApprovalBridgeV1` qualified or all approval-bearing actions and flows marked unready |
| Persistence | DM tables current; SQL pending-action claims available; actual DM memory store writable, persistent, shared and private; origin/upload/CDN canary denial qualified for the current storage and host topology |
| Principal and tools | service user exists and is not an administrator; agent owner and `site_scope` match; pipeline and every flow have the mapped numeric `agent_id`; resolved tool set equals the allowlist plus vetted plumbing; no management or self-resolution tool |
| Prompts | the step's `system_prompt` digest equals the bundled instructions digest; each flow's `user_message` equals its declared prompt |
| Provider | provider and model configured; finite turn budget; no secret printed |
| Delivery | loaded AS class version and runner policy qualified; one routine per owned schedule; a disposable canary job on both domains |
| Reconciliation | manifest digest matches owned DM resources; removed owned flows disabled and unscheduled with durable tombstones; stale dispatch/resume denied; unresolved owned orphans fail readiness; nothing of anyone else's is touched |

## 5. Relation to the config API redesign (#55)

**2026-11-02 update.** The owner requires separate `collection()` and `table()`
declarations and relations within and across both registries. Storage must not
be inferred from fields. The initial implementation preserves the current
typed foreign-key/`defineRelations` graph and access semantics; it does not
adopt every #55 simplification at once. The target is in
[authoring direction](authoring-direction.md). The larger syntax examples
below retain #55-only proposed names until their individual changes land;
they are not executable current-main examples.

[PR #55](https://github.com/spacefast/zero/pull/55) and its
`docs/design-config-api.md` are a proposal for owner review. They are not an
accepted API merely because examples here use them. #55 already describes
WordPress-only defaults; do not dismiss its whole §4.12 as obsolete. That
section mixes single-target cleanup with substantive auth, ownership and
access changes, whose adoption still needs review against current main.

The following classification means "selected in this proposal" when it says
adopted; it never means owner-approved or already implemented:

| #55 area | Disposition here |
|---|---|
| `collection(columns, opts)`, inferred content, `body`, hooks beside columns, `collections` key | Inferred content is superseded: explicit `collection()`/`table()` and separate registries are required. Hook placement and other changes are separate from the first storage cutover. |
| `ref`, `user`, inferred relations, `Row`/`Insert`, system fields, builder simplifications, media MIME patterns | Conditional future vocabulary. The first storage cutover keeps the existing typed foreign-key/`defineRelations` machinery across both kinds, rather than adding a second graph. Other system fields and defaults remain separate decisions. |
| Access `write`, operation overrides, `ctx.is`, field access, user ownership | Adopted as the proposed shape. `write` covers create/update/delete; field `write` covers create/update. Pages add the public-query constraints in §6, not a second access language. #55's self-create and role/status choices remain open. |
| `agents?: false` exposure spelling and q6 | Superseded by the binding `abilities` rename, with existing exposure defaults preserved. Top-level `agents` is AI configuration. |
| Private content CPT by default | Retained. Selected addition: `collectionPage(c)` declares the single item route and viewability, requiring a content collection, native slug and public-query-safe access. Tables remain unroutable. |
| Plain SEO columns | Retained. Page metadata reads ordinary columns; no SEO builder in config. |
| Sync and inferred UID | Retained as the proposed per-collection model. Pages add an optional sync group; TSX/templates have no inverse sync. |
| `global`, buckets/files, locales, optional action input, `admin`, `build --explain` | Compatible proposal material, not approved by this document. Pages add route IDs and ownership to explain output. |
| Auth/password side channel, automatic email/role, user ownership and §4.12 deletions | Outside this design's decision. Still subject to #55 review; the WordPress-only cut alone does not accept or void them. |
| `api` removal and other #55 questions | Owner-open. No page or agent contract depends on removing `api`; an operation disabled by the accepted config stays disabled in ability projection too. |
| New config switches | Proposed `pages?: { sync?: boolean }`, `agents?: Record<string, Agent>`, action `approval?`. **Any pages/config/Blocks coupling waits for §10 q1.** |

The journal's `authors` collection has `userId: user()` and posts reference
`authors`, not a directly synchronized reference to `wp_users`. Its page
item type is `Row<typeof posts>` with a route-derived `href`.
`principal: { login }` names an existing service user; it does not overload
the `user()` column.

Examples are a proposed final syntax, not executable examples on main. If
#55 is declined or revised, rewrite them against the accepted API **before**
implementing dependent work. Coordinate shared extractor/type changes with
#55's stack instead of introducing temporary aliases. The `abilities`
rename itself is binding and can be adapted to whichever API is accepted.

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

**Report 02's virtual routes versus hidden Pages.** The ruling wins.
§4.7 gives static routes real public identity without exposing code Pages
in the editing workspace. Outbound permalinks and canonical redirects are
part of that identity, not consequences assumed from an inbound rewrite.
Collection items retain their own posts.

**Optional Blocks versus build/config integration.** The current ruling
says Zero core never depends on Blocks and Blocks does not touch config.
This proposal recommends an external serializer invoked only for page
builds, shared universal exports, a pages sync config switch, and a
page-derived viewability manifest. Even build-only dependency or indirect
config integration may narrow that ruling. **No exception is approved.**
The owner must approve the precise integration boundary before dependent
PRs start. Merely keeping backend-only builds independent does not grant
that exception. Do not implement a second guessed core serializer to evade
the decision.

**Private collections and public queries.** `collectionPage(c)` alone
selects viewability in this proposal. Register `public: true`,
`publicly_queryable: true`, a rewrite slug from the route directory,
`has_archive: false` and default `exclude_from_search: true`. Optional
`collectionPage(c, { search: true })` opts into search. Collections without
an item route retain their existing private registration.

Viewability requires a read policy the compiler can lower completely to
viewer-bound SQL: public read, a SQL filter or supported `self` ownership.
A function may branch on `ctx.is()` only if every branch lowers to a
boolean/filter with the same viewer semantics. A bare role or arbitrary
non-filter function is refused. Title and body fields may have no stricter
read policy than the row, because native blocks and plugins read those
post fields directly. Other fields still use the ordinary Zero/SCF access
guards; direct trusted PHP meta access is outside the boundary.

The existing front-end query bypass closes in the same change as
viewability. `pre_get_posts` inspects **every** potentially affected query,
including `get_posts()` (whose default is `suppress_filters: true`),
ID-only queries, explicit arrays, `any` and implicit post types. It forces
`suppress_filters = false` for affected queries so the mandatory SQL guard
actually runs. `posts_where` adds a per-type disjunction, not one managed
type's rule applied to an entire mixed query:

```text
existing WHERE AND (
  post_type NOT IN (managed public types)
  OR (post_type = type_A AND visible_status_A AND post_password = '' AND read_rule_A(viewer))
  OR (post_type = type_B AND visible_status_B AND post_password = '' AND read_rule_B(viewer))
)
```

Keep the original query's status, search and taxonomy constraints too.
Unrelated post types retain their behavior. No generic `is_admin()` bypass:
admin queries use their authenticated viewer and the schema-readiness gate.
Result/short-circuit adapters must reauthorize cached `posts_pre_query`
objects, including the native password exclusion; a cache keyed without
viewer/policy generation cannot supply managed rows. Count and sitemap queries must apply the same predicate,
not filter rows after pagination. Unknown query optimizations fail closed
for managed types until adapted. Raw SQL and trusted plugins removing Zero's
filters are not a supported security boundary. Explicit `QueryLoop` over
Zero collections remains refused; use viewer-bound `load()` and `.map`.
This result-cache contract does not authorize shared HTML caching; §4.1's
early host/drop-in bypass applies even if query authorization is correct.

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

Extend the nearest existing owner at the lowest seam that can fail. Never
read implementation source and assert strings. Use real pinned WordPress,
DM, SEO plugins and serializer artifacts. The following are acceptance
obligations for implementation PRs, not tests run for this document:

| Owner | New behavior to prove |
|---|---|
| Existing compiler fixtures | Route ID injectivity (`/` vs `/index`, dots vs slashes, groups and explicit IDs); source-located refusals, static Group class preservation, IR provenance, transitive universal checks and backend-only output independence. |
| Blocks serializer and React owners | Pinned `createBlock`/`serialize` round trip, no dropped attributes, matching React classes. Site Editor validity stays in its existing browser proof; PHP parsing alone cannot prove validity. |
| Existing WP route/query owner | Root excluded from parent chain; orphan and duplicate-leaf routes; inbound route, `get_permalink`, canonical redirect, menu and sitemap agreement. `get_posts` with suppression, a mixed/any/ID-only query and denied status/row prove the guard. Existing password-bearing managed items expose no protected fields through loaders, listings, cached results or metadata, and supported writes refuse adding passwords without clearing stored ones. Hidden Pages absent from editor list/count/search, direct editor and REST writes denied, separately authorized route diagnostics. |
| Existing render/head owner | Anonymous viewer vs trusted DB, field masking through bindings, live row changes, JS/PHP region differential corpus. Warm shared HTML cache bypass holds for an authenticated viewer using a non-WP credential and the next anonymous request; access/route changes purge old stored HTML before readiness. Native core content retains its password gate. Exactly one title in canvas and theme under classic themes with/without title support, and each pinned SEO provider; preserve unspecified provider title and canonical values. |
| Existing theme/browser owner | Unique assigned templates for both `/company/team` and `/support/team`; valid templates/parts; stable stylesheet customizations survive update; dangling region references stop publish; first activation and rollback keep options and app/theme payload consistent. |
| Existing sync owner | Seed-once, file/DB push/pull, conflict and not-representable outcomes, UID/route identity, locked code, and sync on/off transitions with an established base. |
| Publish integration owner | Real archive and HTTP requests on different connections/processes; ownership expiry/takeover, same-key receipts, stale generation and actual permission probes. Pause an old core REST/SCF read and worker, kill only their spare fence connections, and prove no DDL begins while either old process/app DB session survives. Lose the finalizer DB connection and prove takeover waits for supervised process/session exit. Exercise crash before/after tuple/theme change, finalizer retry, incompatible rollback refusal and queued handler-version mismatch. |
| Host deploy contract owner | Read-only code filesystem, DB-only readiness, closed ingress/respawn, acknowledged process and DB-session termination across the complete serving/worker topology, installed-digest acknowledgments, no work on a stale/new node and content-only refusal for an unmatched release. A cache hit cannot bypass closed admissions or managed-page no-store; unqualified cache/drain configurations refuse readiness. |
| DM adapter/approval owner | Explicit returned `agent_id` on pipeline and all flows, read-back ownership before schedules, crash-safe reconcile, exact tool projection and prompts. Remove a scheduled flow and the final agent declaration: no recurrence, stale queued start or human-waiting resume can execute; history/memory and unrelated native flows survive. Actual DM memory-store canary is denied anonymously at origin and upload/CDN mappings. Approval-only app requires DM/full bootstrap. Concurrent target update invalidates approval; crash before/after local commit applies once; consumed ambiguous external effect is held without replay; pipeline continuation survives restart under original tool ID. Model/self-resolution denied; another authorized human may review. |
| Platform queue owner | Real AS and DM co-install under both plugin load orders; qualify loaded class source, runner policy and one successful canary in each existing job domain. |

Use the existing WordPress-on-SQLite development owner for cheap functional
proof. MySQL fencing, transaction isolation, DDL recovery and multiple PHP
workers require the real MySQL integration owner too; SQLite cannot certify
those semantics. Provider calls remain credential-gated. Add no sibling suite
that repeats a lower seam's proof. No source grep, fake provider assertions,
`.only`, `.skip` or fixed-sleep synchronization.

## 9. Rollout

This is a dependency order, not authorization to implement. First obtain
§10's owner rulings and align accepted #55 changes. Inventory existing test
owners before touching them. Each PR extends the applicable checks and
updates documentation without preserving obsolete names through negative
API tests.

| Unit | Contract and prerequisite |
|---|---|
| A. Design | This proposal, owner decisions and pinned artifact/ABI matrix. No implementation is in this change. |
| B. Shared config | Binding `abilities` rename in accepted config syntax, types, extractor, manifests and docs. Coordinate with #55 rather than assume its whole stack approved. |
| C. Release foundation | Stable bootstrap, durable ownership/receipts, host-supervised process drain, DB readiness, schema/work-version admission, early HTML-cache bypass and host handshake. This precedes exposing page/agent deploys, not a final maintenance patch. |
| D. Page compiler | Discovery, exact IDs, JSX/IR and diagnostics. Serializer/universal integration starts only after the explicit Blocks exception. Backend-only stays independent. |
| E. Routes and rendering | Public-query policy guard lands with viewability; Page reconciler, canonical map, hidden editing boundary, canvas, static serialization, bindings, loaders and PHP regions. Depends on C and D. |
| F. Head and assets | One title emitter, qualified SEO adapters, metadata, CSS/modules/tokens and optional Interactivity. Depends on E and the scope decision. |
| G. Theme mode | Approved theme switch syntax, unique templates, paired staging, activation/rollback, stable customization identity and browser proof. Depends on C–F and the accepted theme-switch spelling. |
| H. Sync | Content Page sync, seed ownership and lock transitions in existing sync engine; depends on E and approved pages switch. |
| I. Agent adapter | Pinned DM core/Agents API, AS qualification, private memory, manifest, explicit ownership, prompt/tool mapping, schedule retirement and doctor. Depends on B and C; not on page output. |
| J. Approvals | DM bridge and its transaction/recovery contract, then canonical `approval`, human cards and continuation. DM dependency applies without agents too. Cannot ship enabled on stock DM; depends on C and I's adapter, not on declaring an agent. |
| K. Authoring examples | Accepted-syntax journal/pantry examples, public guides and deterministic repeated builds after relevant units qualify. |

Units may proceed independently once their prerequisites qualify.

## 10. Open owner decisions

These are not approved by their recommendations. §2's rulings remain binding;
the implementation choices elsewhere are a coherent proposed default, not
additional owner rulings.
These choices concern the future optional pages and Data Machine subsystem;
they do not block current backend compiler, native development or example work.

1. **Blocks/config boundary.** Approve or reject the precise exception for
   page-only serializer invocation, universal exports, page-derived
   viewability and `pages.sync` in config. Recommended: approve that bounded
   integration with backend-only independence. Until ruled, all dependent
   work waits. Calling it build-only does not make it approved.
2. **Remaining authoring choices.** #55 is closed as superseded. Explicit
   collections/tables and their shared relation graph have shipped; unrelated
   auth, ownership and syntax changes from that historical proposal remain
   unselected. Start from the accepted config API and decide any additional
   changes in their own implementation scope. This document adopts no
   auth/ownership deletion on the owner's behalf.
3. **Authoring choices and islands.** Confirm the proposed stored compiled
   body for code Pages, the `pages/theme.config.ts` spelling and the config
   sync-switch location under q1. Optional layouts/themes and shared
   components are already required; their inclusion is not reopened here.
   Interactivity-only islands are an additional v1 scope recommendation.
   These storage/spelling choices are selected defaults, not owner rulings.
4. **Viewability outside pages.** Recommended: no separate public-CPT switch
   in v1; `collectionPage` is the single declaration. A future standalone
   switch would need exactly the same public-query policy guard.
5. **DM bridge delivery.** Approve a versioned integration patch versus an
   upstream-only dependency for `ZeroApprovalBridgeV1`. Recommended: qualify
   a pinned patch and offer it upstream; ship agents without approval
   dependencies first. Without the bridge, approval-bearing actions stay
   disabled on every entry path, including approval-only apps.
6. **Action Scheduler qualification.** Recommended candidate: Zero's 4.2.0
   with a cooperative DM runner policy. Accept only after real co-install
   proof in both load orders; no version is declared qualified here. If it
   fails, select another tested pair rather than install two runners.

Fixed service-user principals, UTC-only schedules, separate Zero/DM admin
permissions, explicit rewrites and hidden code Pages are selected v1
contracts above. The hidden Page boundary, hybrid renderer, optional sync,
build/publish separation, immutable-host split and DM runtime ownership
are binding and are not reopened as questions.

## 11. Pinned source evidence

These revisions were inspected for this proposal. Implementation must record
built artifact hashes, patched DM/bridge hashes and qualification results;
source inspection does not certify an artifact. Public source links below
name the APIs whose behavior constrains the design.

| Pin | Source and consequence |
|---|---|
| WordPress `7c9c8b624927f0d966fc28546712ddc01090a92b` | [`get_posts`](https://github.com/WordPress/wordpress-develop/blob/7c9c8b624927f0d966fc28546712ddc01090a92b/src/wp-includes/post.php#L2666) defaults to suppressed filters; [`WP_Query`](https://github.com/WordPress/wordpress-develop/blob/7c9c8b624927f0d966fc28546712ddc01090a92b/src/wp-includes/class-wp-query.php#L2783) gates `posts_where`. `pre_get_posts` runs earlier even when SQL filters are suppressed. |
| Same WP pin | [`get_page_uri`](https://github.com/WordPress/wordpress-develop/blob/7c9c8b624927f0d966fc28546712ddc01090a92b/src/wp-includes/post.php#L6697) concatenates ancestor slugs; [`get_page_link`](https://github.com/WordPress/wordpress-develop/blob/7c9c8b624927f0d966fc28546712ddc01090a92b/src/wp-includes/link-template.php#L397) exposes `page_link`; [`wp_get_canonical_url`](https://github.com/WordPress/wordpress-develop/blob/7c9c8b624927f0d966fc28546712ddc01090a92b/src/wp-includes/link-template.php#L4101) starts from the permalink. Rewrites alone do not supply canonical identity. |
| Same WP pin | [`get_page_template`](https://github.com/WordPress/wordpress-develop/blob/7c9c8b624927f0d966fc28546712ddc01090a92b/src/wp-includes/template.php#L471) considers assigned template first; [`block-template.php`](https://github.com/WordPress/wordpress-develop/blob/7c9c8b624927f0d966fc28546712ddc01090a92b/src/wp-includes/block-template.php#L131) installs an unconditional title emitter; [`_wp_render_title_tag`](https://github.com/WordPress/wordpress-develop/blob/7c9c8b624927f0d966fc28546712ddc01090a92b/src/wp-includes/general-template.php#L1557) requires theme title support. |
| Same WP pin | [`get_edit_post_link`](https://github.com/WordPress/wordpress-develop/blob/7c9c8b624927f0d966fc28546712ddc01090a92b/src/wp-includes/link-template.php#L1481) checks capability before its link filter. Denied code Pages need a separately authorized route screen. |
| Same WP pin | [`wpdb`](https://github.com/WordPress/wordpress-develop/blob/7c9c8b624927f0d966fc28546712ddc01090a92b/src/wp-includes/class-wpdb.php#L2156) can reconnect and replay queries. Losing a spare lock connection does not terminate a schema consumer; code/schema cutover requires host-acknowledged process/session drain. |
| Same WP pin | [`wp-settings.php`](https://github.com/WordPress/wordpress-develop/blob/7c9c8b624927f0d966fc28546712ddc01090a92b/src/wp-settings.php#L98) loads `advanced-cache.php` before MU plugins. [`get_the_content`](https://github.com/WordPress/wordpress-develop/blob/7c9c8b624927f0d966fc28546712ddc01090a92b/src/wp-includes/post-template.php#L325) and native post-data bindings enforce `post_password_required()`; raw content filters do not replace it. |
| Batcache `ed0e6b2d9bcbab3924c49a6c3247646fb87a0957` | [`advanced-cache.php`](https://github.com/Automattic/batcache/blob/ed0e6b2d9bcbab3924c49a6c3247646fb87a0957/advanced-cache.php#L620) can send cached HTML and exit before the page loader. Managed-page readiness requires a qualified early bypass, not only response headers. |
| Data Machine `b07be213f70904f379d2c18204d3b36a003ba41f`, 0.200.4 baseline | [`composer.lock`](https://github.com/Extra-Chill/data-machine/blob/b07be213f70904f379d2c18204d3b36a003ba41f/plugins/data-machine/composer.lock) resolves Agents API's exact development revision; [`data-machine.php`](https://github.com/Extra-Chill/data-machine/blob/b07be213f70904f379d2c18204d3b36a003ba41f/plugins/data-machine/data-machine.php#L148) provides early full-runtime request. Core only, no Business or Socials requirement. |
| Same DM pin | [`CreatePipelineAbility`](https://github.com/Extra-Chill/data-machine/blob/b07be213f70904f379d2c18204d3b36a003ba41f/plugins/data-machine/inc/Abilities/Pipeline/CreatePipelineAbility.php#L140) falls back to execution context if `agent_id` is absent, and propagates explicit ownership to its first flow. Zero must pass and verify the returned agent's ID. |
| Same DM pin | [`DirectoryManager`](https://github.com/Extra-Chill/data-machine/blob/b07be213f70904f379d2c18204d3b36a003ba41f/plugins/data-machine/inc/Core/FilesRepository/DirectoryManager.php#L234) places default agent identity storage under WP uploads; that path is not private by virtue of WP authorization. Qualify the actual DM memory store and origin/upload/CDN denial. |
| Same DM pin | [`FlowRoutines`](https://github.com/Extra-Chill/data-machine/blob/b07be213f70904f379d2c18204d3b36a003ba41f/plugins/data-machine/inc/Engine/Scheduling/FlowRoutines.php#L348) can unschedule and disable stored recurrence. Removing a Zero manifest key does not invoke retirement or prevent stale queued/native starts on its own. |
| Same DM pin | [`PendingActionStore`](https://github.com/Extra-Chill/data-machine/blob/b07be213f70904f379d2c18204d3b36a003ba41f/plugins/data-machine/inc/Engine/AI/Actions/PendingActionStore.php#L418) documents at-most-once consumption and forbids automatic crash retry. [`PendingActionScope`](https://github.com/Extra-Chill/data-machine/blob/b07be213f70904f379d2c18204d3b36a003ba41f/plugins/data-machine/inc/Engine/AI/Actions/PendingActionScope.php#L122) binds callers; [`ResolvePendingActionAbility`](https://github.com/Extra-Chill/data-machine/blob/b07be213f70904f379d2c18204d3b36a003ba41f/plugins/data-machine/inc/Engine/AI/Actions/ResolvePendingActionAbility.php#L134) delegates to Agents API. These are integration seams, not the proposed atomic bridge. |
| Agents API `952db6cb2b3ef49ab2e539993788d3e04bb6e783` | [`register-pending-action-abilities.php`](https://github.com/Automattic/agents-api/blob/952db6cb2b3ef49ab2e539993788d3e04bb6e783/src/Approvals/register-pending-action-abilities.php) registers canonical approval abilities, host store/resolver filters and the public permission callback. Pin this development revision, not a plugin version label or a second copy. |
| Rank Math `50fc59587112316ad754ca3c9a26e1282795d49d` | [`Head`](https://github.com/rankmath/seo-by-rank-math/blob/50fc59587112316ad754ca3c9a26e1282795d49d/includes/frontend/class-head.php#L67) moves core's conditional title emitter to `rank_math/head` and optionally rewrites legacy title output. |
| The SEO Framework `9c3977a95191b96b6a2932a9eb981d8480009b59` | [`init-front.php`](https://github.com/sybrew/the-seo-framework/blob/9c3977a95191b96b6a2932a9eb981d8480009b59/bootstrap/init-front.php#L64) sets up title filters; [`Title`](https://github.com/sybrew/the-seo-framework/blob/9c3977a95191b96b6a2932a9eb981d8480009b59/inc/classes/front/title.class.php#L62) filters document-title calculation. Filtering is not element emission. |
| Yoast `fd2d6de0b895a60f10e9e8fb9e59892d25bd7f63` | [`Title_Presenter`](https://github.com/Yoast/wordpress-seo/blob/fd2d6de0b895a60f10e9e8fb9e59892d25bd7f63/src/presenters/title-presenter.php) emits the title; the frontend presenter list permits removing that family alone. |

Blocks research used `@wordpress/blocks` 15.24.0,
`@wordpress/block-library` 10.2.0 and SCF 6.9.7. Preserve exact dependency
locks and rerun their editor proof against the chosen WP artifact rather
than treating the report's platform label as a new runtime pin. DM's bundled
AS provenance is 3.9.3 (`c58cdbab17651303d406cd3b22cf9d75c71c986c`);
Zero's 4.2.0 is a qualification candidate, not proof of compatibility.
