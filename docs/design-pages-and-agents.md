# Zero pages, components, layouts, sync, publish and agents

Status: the locked design for Zero's next layer. It records the owner's
rulings of 2026-11-01 verbatim (§2), reconciles the research reports that
preceded it where they disagree with those rulings (§5), and fixes the order
of pull requests (§8). Nothing in it is implemented yet; every API named
under `zero/pages`, `zero/agents`, `@spacefast/zero-blocks/universal` and
`Zero\Pages\*` / `Zero\Agents\*` is new. Where a WordPress or Data Machine
behaviour is cited, it was verified against WordPress 7.1 / core source
`7c9c8b62`, Data Machine 0.200.4 at `b07be213`, and Agents API at
`952db6cb` (the revision Data Machine's lockfile resolves).

Conventions: "error" means the build fails with `file:line:col` and nothing
is written. "WP" is WordPress 7.1, the pinned platform. "Blocks" is the
`@spacefast/zero-blocks` package. "DM" is Data Machine. "Decision" marks a
choice this document makes; "Ruling" marks one the owner made.

## 0. Decisions in one screen

| Area | Decision |
|---|---|
| Pages | `pages/**/page.tsx` beside `zero.config.ts`, discovered by `zero build`; `layout.tsx` nests by directory; `(group)` adds no segment; `[param]` binds one segment. No `pages/` directory means no routes, no theme, no new dependency. |
| Page identity | Every static code page owns a WordPress Page record (`post_type: page`), keyed by a Zero route id in post meta. Collection pages (`collectionPage()`) use the row's own post. Table-backed collections cannot have a `collectionPage` in v1. |
| Rendering | TSX → checked IR → three outputs: static Gutenberg block markup (the pinned core serializer), block bindings for scalar slots (`zero/page-field` source), generated dynamic blocks with PHP for structure that depends on the request (conditionals, loops, derived values, loaders). The page body is `post_content`; the layout chain is the template. |
| Component contract | One TSX source compiles for React (normal `react/jsx-runtime`) and for WordPress (IR). Universal components are pure functions of serializable props using `@spacefast/zero-blocks/universal` primitives. Hooks, effects, events, context, browser globals: error when reachable from a WordPress page. |
| Document | A Zero canvas selected through `template_include`, calling `wp_head()`, `wp_body_open()`, `wp_footer()`, with body and assets prepared before the head. Theme output is an explicit mode: `pages/theme.config.ts` present → layouts compile to a block theme. |
| Head / SEO | `export const metadata` or `generateMetadata()`; resolved before output; one emitter per field family. Explicit fields win through the active SEO plugin's filters (Yoast, Rank Math, The SEO Framework); unspecified fields stay plugin-owned; core plus a small Zero emitter when no plugin owns the head. |
| CSS | `import "./x.css"` is global, `*.module.css` is scoped with a generated class map and types; content-hashed files, a per-route manifest, `wp_enqueue_style` on `wp_enqueue_scripts`. Tokens in `styles/tokens.ts` emit CSS variables and, in theme mode, `theme.json` presets. |
| Public collections | `collectionPage(c)` is the only way a collection becomes viewable: it flips the CPT to `publicly_queryable` with a rewrite slug. Its read rule must be `"anyone"` or a filter; the filter is applied to every front-end `WP_Query` over the type. Role or function read rules refuse `collectionPage`. |
| Editing | One owner per surface, chosen by file: `page.tsx` is code-owned (editor read-only, publish rewrites it); `page.md` / `page.blocks.html` is content-owned (editor edits it, `zero sync` carries it). Layout and template are always code-owned. |
| Sync | Optional. On: content pages and synced collections round-trip through the existing UID / base / three-way-merge engine, with raw block markup as the body format. Off: Zero refuses dashboard and REST edits to its managed records through `map_meta_cap`. |
| Build / publish | `zero build` writes `.zero/wp-content`. `zero publish --site` pushes a signed release to `POST /zero/v1/publish`, owned by `zero-runtime`, which stages it under the app plugin and flips a pointer. Hosts whose production code is read-only (VIP, Pantheon) get the honest split: `--content-only` ships records; code goes through the host pipeline. |
| Agents | Data Machine is the runtime. `defineConfig({ agents })` compiles to a manifest; a versioned Zero adapter (`Dm02004`) provisions DM agents, pipelines, flows and tool projections through DM's own abilities. Zero owns schema, abilities, action-level `approval`, the manifest and `zero doctor`. No Zero run ledger. |
| Rename | The exposure flag on collections and actions is renamed `abilities` (default `true`). The word `agents` is the top-level `defineConfig` key for AI agents and nothing else. |
| Blocks boundary | `zero.config.ts` never names a page. Blocks never reads `zero.config.ts`. `zero build` invokes Blocks' serializer as a build tool only when `pages/` exists; backend-only builds have no Blocks dependency. |
| Queue | One Action Scheduler backend, two logical job domains (Zero jobs, DM runs). One qualified AS version and runner policy; `zero doctor` reports the loaded class source. |

## 1. Why

Zero compiles a config into a WordPress backend with a typed client. The
owner wants the same project to carry its front end when the author wants
that: a single `/about` page with a layout, a full site, a couple of routes
over a collection, or nothing at all behind an Astro or TanStack Start app.
Zero Blocks (phase 1 shipped, phase 2 paused) proved the TSX → Gutenberg
path and found three gaps a page system has to close: a template alone is not
a route (someone creates the post row), a `public: false` collection is
invisible to the front end, and CSS and head metadata have no home in block
markup. The seven research reports in the design-lock folder cover modern
page conventions, TSX → PHP, the WordPress seams, agents, sync and
components. This document is the decision.

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
`islands/` and `styles/` is optional; `zero.config.ts` alone is still a
whole Zero app.

```text
journal/
├── zero.config.ts                 # data, access, actions, jobs, agents (§4.10)
├── zero.gen.ts                    # generated; unchanged
├── tsconfig.json                  # jsx: react-jsx; include pages, components, islands
├── agents/
│   └── editor.md                  # instructions bundled into the agent manifest
├── pages/
│   ├── layout.tsx                 # root layout: chrome + metadata defaults
│   ├── page.tsx                   # /
│   ├── not-found.tsx              # Zero's 404 body for claimed routes
│   ├── theme.config.ts            # optional: present → layouts compile to a block theme (§4.6)
│   ├── about/
│   │   └── page.tsx               # /about, code-owned Page record
│   ├── pricing/
│   │   └── page.md                # /pricing, content-owned Page record (editor + sync)
│   └── posts/
│       ├── layout.tsx             # wraps /posts and /posts/[slug]
│       ├── page.tsx               # /posts, load() over the collection
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
        ├── plugins/zero-runtime/
        ├── plugins/zero-identity/
        ├── plugins/zero-app-journal/
        │   ├── zero-app-journal.php
        │   ├── build/pages/routes.php        # route table, Page reconciler, canvas selection
        │   ├── build/pages/manifest.json     # routes → templates, post_content, CSS, modules
        │   ├── build/pages/templates/*.html  # layout chains (block markup)
        │   ├── build/pages/content/*.html    # code-owned page bodies (block markup)
        │   ├── build/pages/register.php      # binding sources, block registrations
        │   ├── build/pages/canvas.php        # the document
        │   ├── build/blocks/<region>/        # block.json, render.php, index.js, index.asset.php
        │   ├── build/assets/*.css|*.js       # hashed
        │   └── build/agents/manifest.php     # §4.10
        ├── plugins/zero-admin/               # only with admin: true
        └── themes/journal/                   # only with pages/theme.config.ts
            ├── style.css
            ├── theme.json
            ├── templates/*.html
            └── parts/*.html
```

`zero.config.ts` is data only. It gains `agents` (§4.10) and loses nothing a
page needs: pages import collections from it; it never imports pages.

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
`pages/posts/[slug]/page.tsx`) is legal: static wins, and the compiler adds a
reserved-slug check on the collection so a row cannot take `featured`.

**Route id.** Each route has an id equal to its normalized URL path with the
leading slash removed and `/` turned into `.` (`about`, `posts.index`,
`posts.show`; the root is `index`). Renaming a directory is a new route and
retires the old one (§4.7). An author who wants to rename the URL without a
new identity sets `export const route = { id: "about" }` in `page.tsx`; the
id is then pinned and the URL may move.

**Request lifecycle.** WordPress parses the request and runs its main query
unchanged. For a static page the Page record's own permalink is the route,
so no rewrite rule is needed. For a `collectionPage` the CPT is registered
viewable with `rewrite: { slug: <directory>, with_front: false }`, and the
row's permalink is the route. Zero hooks `template_include` and, when the
queried object is a Zero-managed Page or a Zero collection post with a
matching route, returns `build/pages/canvas.php`. Everything else falls
through to the active theme. `template_redirect` is used only for access
decisions (a denied row → 404 before any output).

**Loaders.** `export async function load(ctx)` runs once per request before
metadata and rendering. `ctx.params`, `ctx.url`, `ctx.viewer` and
`ctx.content.query.<collection>.findMany|findFirst` are available;
`ctx.content` is a read-only, viewer-bound query API. The trusted `db` from
`"zero"` is refused in page modules with a diagnostic pointing at
`ctx.content`. A null viewer is never passed; an anonymous visitor is
`Viewer(null)`, which `Db` already distinguishes from the trusted null. The
loader's return value is the page's props and is memoized in
`Zero\Pages\Request` for bindings and regions to read.

`collectionPage(posts, { by: "slug" })` is the loader for an item route: the
compiler resolves the row from the main query's post (the CPT is viewable, so
WordPress already found it), re-reads it through `ctx.content` so field
access and the read rule apply, and passes `item` and `href`. `by` must name
the collection's `slug()` column or its primary key; a non-unique column is
an error. One `collectionPage` per collection; a second is an error.

**Example.**

```tsx
// pages/posts/page.tsx
import { posts } from "../../zero.config";
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
that has a `collectionPage`, computed from the route and the row's `by`
column through `get_permalink`, so listings and item pages cannot disagree.

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
`TemplatePart`, `Navigation`, `QueryLoop`. Each primitive's React output
carries the classes the pinned core block's `save()` emits
(`wp-block-group`, `wp-block-heading`, …) so the DOM matches under the shared
token stylesheet. Contextual primitives require a React host adapter that
supplies their data (a `PostContent` outside WordPress needs `html` passed
in); without one they are a React build error.

**Refused in a universal component, with `file:line:col`:** hooks, context,
refs, effects, event-handler props, portals, Suspense, async components,
`style` objects (use CSS modules), browser globals, `Date.now()`/`Math.random()`
at render, npm imports without a supported lowering, dynamic tag names, raw
HTML strings outside `RichText`. These are the semantics PHP cannot reproduce
without lying; the owner's bar is match or refuse. A component that needs
them is React-only and can still be used from a WordPress page only through
an explicit island (§4.5) or not at all.

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

`PostContent` compiles to `core/post-content`; `RichText value={item.body}`
compiles to a region that runs the stored HTML through `do_blocks` and
`wp_kses_post` under the current post context. `Navigation`, `TemplatePart`,
`QueryLoop inherit` compile to their core blocks unchanged. `QueryLoop` with
an explicit Zero collection requires that collection to have a
`collectionPage` (so it is viewable) and compiles to `core/query` with
`postType: zero_<name>`.

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

export const page = collectionPage(posts, { by: "slug" });
type Props = CollectionPageProps<typeof page>;

export function generateMetadata({ item, href }: Props): Metadata {
  return { title: item.title, description: item.excerpt ?? "", canonical: href, openGraph: { type: "article" } };
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
files come from the serializer):

```html
<!-- build/pages/templates/posts.show.html : root layout → posts layout → page -->
<!-- wp:template-part {"slug":"zero-header","theme":"zero-app-journal"} /-->
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
<!-- wp:template-part {"slug":"zero-footer","theme":"zero-app-journal"} /-->
```

The page body is one region (`r0`) because `<article className={styles.article}>`
has no core block (a classed `<article>` would become a Group and lose the
module class on the element the author styled), and because `RichText` is
request-time. Inside the region the `PostCard` subtree is static block markup
with two bindings and one nested region for the conditional excerpt:

```html
<!-- build/blocks/journal-posts-show-r0/body.html -->
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
<?php // build/blocks/journal-posts-show-r0/render.php
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
<?php // build/blocks/journal-posts-show-r1/render.php  (the conditional excerpt)
$page = \Zero\Pages\Request::current('posts.show');
if ($page === null) { return; }
$excerpt = $page->item->p['excerpt'] ?? '';
if (\Zero\Js::truthy(\Zero\Js::strictNotEqual($excerpt, ''))) {
    echo \Zero\Pages\Blocks::render(__DIR__ . '/branch-0.html', ['excerpt' => $excerpt]);
}
```

```php
<?php // build/pages/register.php (excerpt)
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
attribute) tuple the manifest does not list. Static Page records write their
compiled body (`build/pages/content/<route>.html`) into `post_content` at
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
before any output.

Emission has one owner per field family:

| Active SEO plugin | Title | Description, canonical, robots | Open Graph / Twitter | JSON-LD |
|---|---|---|---|---|
| none | `pre_get_document_title` (complete title) | `wp_robots` filter; Zero emits description and canonical on `wp_head` at priority 1; core `rel_canonical` removed for Zero routes only | Zero emits on `wp_head` | Zero emits one graph |
| Yoast SEO | `wpseo_title` | `wpseo_metadesc`, `wpseo_canonical`, `wpseo_robots_array` | `wpseo_opengraph_*`, `wpseo_twitter_*` | `wpseo_schema_graph_pieces` |
| Rank Math | `rank_math/frontend/title` | `/description`, `/canonical`, `/robots` | `rank_math/opengraph/facebook/*`, `/twitter/*` | `rank_math/json_ld` |
| The SEO Framework | `the_seo_framework_pre_get_document_title` | `the_seo_framework_meta_render_data`, `_robots_meta_array` | `the_seo_framework_meta_render_data` | `the_seo_framework_schema_graph_data` |

Explicit Zero fields win their field through the plugin's filter, scoped to
the current Zero route; fields the page did not set remain the plugin's. An
unrecognized SEO plugin gets no adapter: Zero emits nothing that would
duplicate a head tag and `zero doctor` reports the gap. Static metadata also
writes the Page record's `post_title` at publish so menus, the admin list and
the plugin's own analysis see the right title. Yoast's content analysis reads
`post_content`; for a code page that is the compiled body (§4.7), which is
what the visitor sees minus the regions. This limit is documented, not hidden.

Sitemaps: Page records and viewable collection posts are picked up by core's
`WP_Sitemaps_Posts` and by each plugin's own provider without Zero code.

### 4.5 CSS, assets and islands

**Decision.** `import "./global.css"` is a global stylesheet dependency.
`import styles from "./x.module.css"` is a build-time class map (`post_abc123_article`)
with a generated `.d.ts` so `styles.artcile` is a type error; the same map
feeds the React build and the PHP region above. Neither import executes in
PHP. `styles/tokens.ts` exports a typed object; the build emits
`:root { --zero-color-primary: … }` and, in theme mode, the matching
`theme.json` presets so `Group` on WordPress and `Group` in React share one
token sheet. Tailwind is a later opt-in build transform, not v1.

The build writes content-hashed files to `build/assets/`, records per route
the union of the layout chain's and page's CSS and modules in
`manifest.json`, and the canvas enqueues them with namespaced handles on
`wp_enqueue_scripts`, `null` version, before `wp_head()` runs. Body and
regions are rendered to a buffer first so blocks can enqueue their own
assets, the ordering core's `template-canvas.php` uses. Theme global styles
stay active; the canvas does not strip them.

**Islands.** `islands/<Name>.tsx` is a universal component that emits
`data-wp-interactive`, `data-wp-context` and other `data-wp-*` attributes;
`islands/<Name>.client.ts` is its browser module using
`@wordpress/interactivity`. Importing the island from a page registers the
module through `wp_register_script_module` / `wp_enqueue_script_module` with
the `@wordpress/interactivity` dependency, and the region's PHP runs
`wp_interactivity_process_directives()` on the island's HTML so server and
client state agree. Client modules are bundled separately and never enter the
PHP compiler. React or Preact client islands are refused in v1 (§6).

### 4.6 Layouts → themes

**Decision.** `layout.tsx` is authored as in Next or TanStack Start:
`export default function Layout({ children })`. The compiler fills `children`
with the nested subtree. Two output modes, chosen by one file:

- **Plugin canvas (default).** Each route's layout chain compiles to
  `build/pages/templates/<route>.html`; shared chrome the author marks with
  `<TemplatePart slug="header">` compiles to `build/pages/parts/header.html`
  registered through `register_block_template()` under the
  `zero-app-<name>//` namespace so the Site Editor can see (and customize)
  them on a block theme. `canvas.php` renders the route template with
  `do_blocks` inside `<!doctype html>` … `wp_head()` … `wp_body_open()` …
  `wp_footer()`. The active theme stays installed and its `functions.php`
  runs; only its template markup is bypassed for Zero routes.
- **Theme output.** When `pages/theme.config.ts` exists (Blocks'
  `defineTheme`: header plus typed `theme.json`), the same layout chains
  become `templates/*.html` named by the hierarchy (`page-<slug>.html` per
  static route, `single-zero_posts.html` per collection route,
  `index.html` required), parts become `parts/*.html`, tokens become
  `theme.json` presets, and the output is a real installable theme. Dynamic
  behaviour (regions, bindings, routes) stays in the app plugin, so the theme
  is data and survives without PHP of its own, and the plugin survives a
  theme switch. The theme declares the app plugin in its `readme.txt`;
  `zero doctor` reports a theme active without its plugin.

Site Editor customizations of a registered template or theme file shadow it
as `wp_template` posts until the user resets, per WordPress's own model. A
publish never overwrites a customization; `zero doctor` lists customized
templates as drift. Code-owned templates are not locked: locking is a
curation tool, not an authorization boundary.

The paused `p3/blocks-theme` branch supplies the theme builder, hierarchy
table, `theme.json` schema validation and the Site Editor proof harness; PR 7
(§8) lands it under this contract instead of the filename-hierarchy authoring
model it was built for.

### 4.7 Editing and Page records

**Decision (ruling 1).** The app plugin owns a **route reconciler** that runs
on activation, on publish, and from `zero doctor --fix`. For each static
route it ensures one `page` post exists with meta `_zero_route = <route id>`
and `_zero_app = <app>`, `post_name` = the last path segment, `post_parent`
= the parent route's Page (so `/posts/featured` is a child of `/posts`),
`post_status = publish`, `post_title` from static metadata, and
`post_content` = the compiled body for `page.tsx` or the file body for
`page.md` / `page.blocks.html`. It records the body digest in
`_zero_content_digest`.

- **Collisions.** An existing Page at the same path that is not Zero-managed
  is a reconcile error: the route stays unserved, publish reports it, and the
  operator either renames the route or runs `zero pages adopt <route>` to
  claim the record (the existing content is kept for a `page.md` route and
  replaced for a `page.tsx` route, with the old revision preserved). A
  collision with a collection rewrite slug or a reserved WordPress path is a
  build error.
- **Retirement.** A route that disappears from the build has its Page moved
  to trash with `_zero_retired_at`; publish prints the list. Trash, not
  delete, so an accidental rename is recoverable.
- **Reset.** `zero pages reset <route>` rewrites the record from the build and
  clears customizations of its template.
- **What editors see.** Pages appear in the Pages list with a "Code" or
  "Content" badge. A code-owned Page opens in the block editor read-only
  (the compiled body is visible; regions show their labelled placeholders)
  with a notice: "Managed by `pages/about/page.tsx`. Edit the file and run
  `zero publish`." `map_meta_cap` returns `do_not_allow` for `edit_post`,
  `delete_post` and `publish_post` on code-owned records, which also closes
  core REST, quick edit, autosave and XML-RPC. Trusted PHP (`wp_insert_post`)
  and direct SQL are not blocked; the plugin cannot be that boundary, and
  says so.
- **Content-owned pages** (`page.md`, `page.blocks.html`) are editable when
  sync is enabled for pages (§4.8) and locked the same way when it is not
  (ruling 3).
- **Collection rows** keep today's behaviour: editors edit them in wp-admin
  and Zero Admin; the item route's template is code-owned.

A code-owned body written to `post_content` and then changed out of band
(a privileged plugin, SQL) fails the digest check on the next publish; publish
refuses to overwrite it without `--force` and shows the diff.

### 4.8 Sync

**Decision (ruling 3).** `zero sync` extends the existing engine (UIDs,
per-site base, field-wise three-way merge, server body merge, stale-write
rejection, conflict files, `resolve`) to pages. Nothing is replaced.

- **Body format.** Raw serialized block markup, in `page.blocks.html` with
  YAML front matter (`uid`, `title`, `slug`, `status`, metadata fields).
  Markdown (`page.md`) stays the opt-in prose format through the existing
  `Markdown::fromBlocks` gate: a body the converter cannot represent is a
  `422 not_representable` and the file is left alone, never flattened. Pulls
  take the stored `post_content`, never `the_content()` output; a dynamic
  block comes back as its self-closing reference.
- **Identity.** The Page record's `_zero_uid` (minted by the existing
  `Uid` runtime) in front matter; `_zero_route` ties it to the route. A
  renamed file keeps its UID. Two files with one UID is an error, as today.
- **Scope.** Pages sync when `pages/` contains a content-owned page; the
  compiler adds a `pages` sync group next to collection groups. Code-owned
  pages, templates and regions are never synced: TSX has no inverse in block
  markup and this design does not pretend otherwise.
- **Two-sided block edits** go through the existing line merger only when
  `BlockMarkupMergeValidator` accepts the result and block boundaries are
  unchanged; otherwise a conflict file.
- **Media bytes** do not sync in v1 (unchanged from phase 2).
- **Sync off.** When the project declares no sync (no `sync` on any
  collection and no content-owned page), the reconciler marks every managed
  record file-owned and the `map_meta_cap` lock of §4.7 applies to content
  pages too. Turning sync on establishes a base first; turning it off refuses
  while unexported edits exist (`zero sync --check` exits 2).

### 4.9 Build and publish, with hosting constraints

**Decision (ruling 4).** `zero build` is unchanged in shape: it writes
`.zero/wp-content/` with the platform plugins, `zero-runtime`,
`zero-identity`, `zero-app-<name>`, optionally `zero-admin` and the theme.
With `pages/` present it additionally runs the Blocks serializer (Node ≥ 22,
pinned core packages) as a build tool; a missing or mismatched toolchain is a
build diagnostic, not a fallback.

`zero publish [dir] --site <url> --app-password <user:pass>` builds, then:

1. **Probe.** `GET /zero/v1/publish/capabilities` (owned by `zero-runtime`)
   returns whether the app plugin directory is writable (an actual
   write-and-unlink in a staging subdirectory, not a guess from `ABSPATH`),
   `wp_is_file_mod_allowed('zero_publish')`, free space, PHP/WP versions, the
   installed runtime version and the current release digest.
2. **Upload.** `POST /zero/v1/publish` with a zip of the app plugin (and the
   theme when present), a manifest (file list with SHA-256, release digest,
   expected current release, idempotency key) and the compiled Page bodies.
   Requires HTTPS, an application password, and the `zero_publish`
   capability (granted to administrators by the runtime; nothing lower).
3. **Stage and flip.** The endpoint validates every path against the
   server-chosen target (`plugins/zero-app-<name>/releases/<digest>/`),
   rejects traversal, symlinks, absolute paths, oversized entries and
   unexpected files, extracts into the new release directory, then rewrites
   `releases/current` (a one-line pointer file, written then renamed) and
   invalidates opcache for the previous release. The app plugin's main file
   includes `releases/current`'s tree. The previous release is kept for
   `zero publish --rollback`. A repeat with the same idempotency key returns
   the stored receipt; a mismatched expected-current is a 409.
4. **Reconcile.** Runs migrations, the route reconciler (§4.7), the agents
   reconciler (§4.10), and prints the receipt.

The runtime plugin publishes its own upgrades through the same endpoint with
the same staging; activation of the new runtime happens on the next request
after the pointer flip. The very first install of the platform plugins on a
site is not through this endpoint (nothing is there to receive it): it is
`wp plugin install` of the built zips, the host's deploy pipeline, or
Spacefast.

**Hosting constraints, honestly.** Report 06 established that production
code is not writable on WordPress VIP (read-only application container) or
Pantheon Test/Live (code directories not writable), while WP Cloud defaults
to `php_fs_permissions=rw` with `ro` and `loggedin` modes. So:

| Host | `zero publish` (code) | `zero publish --content-only` | Code path |
|---|---|---|---|
| WP Cloud `rw`, generic VPS, Playground, `zero dev` | works: stage + flip | works | the endpoint |
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

**Rename.** The boolean `agents` option on collections and actions, which
controls registration as WordPress Abilities (and so MCP exposure), is
renamed **`abilities`** (default `true`). Its old name collides with the new
top-level key and describes the mechanism wrongly. No shim: unreleased.

**Config API.**

```ts
// zero.config.ts (excerpt)
import { defineConfig, action, agent, integer, db, HttpError } from "zero";

export const discard = action({
  access: "author",
  input: { itemId: integer().notNull() },
  idempotent: true,
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
  schema: { items },
  actions: { expiringSoon, discard },
  agents: {
    pantryHelper: agent({
      label: "Pantry helper",
      principal: { user: "pantry-bot" },          // an existing, non-admin WP user
      access: "editor",                            // who may start runs and read status
      model: { provider: "openai", model: "gpt-4.1-mini" },
      instructions: "./agents/pantry.md",
      tools: [expiringSoon, discard],              // references, not copies
      memory: { scope: "agent", modelWrites: false },
      pipelines: { expiryReview: { steps: [{ type: "ai", label: "Review expiring food" }] } },
      flows: {
        morning: {
          pipeline: "expiryReview",
          prompt: "Use expiringSoon with days=3. Summarize what to use first.",
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
reconcile. `principal` is either `{ user }` (one shared DM agent owned by
that user; its memory is shared service state) or `{ caller: true }` (one DM
agent per authenticated WP user, created on first start; no schedules).
`timezone` accepts `"UTC"` only in v1 because DM's routine bridge passes no
timezone. `instructions` is a build input: bundled, digested, path must be
inside the project.

**Generated registration.** The app plugin gets `Requires Plugins: data-machine`
only when `agents` is non-empty, and `build/agents/manifest.php`: a
declarative array (app, agent key, slug `zero-<app>-<key>-<site>`,
`site_scope`, principal, access, `agent_config` with `default_provider`,
`default_model`, `mode_models` and `tool_policy`, `ability_tools` aliases →
ability ids, pipelines as DM `workflow` objects with `step_type: "ai"`, flows
with `scheduling_config: { interval: "cron", cron_expression }`, approvals,
and the runtime lock: adapter `dm-0.200.4`, DM source ref, Agents API ref,
artifact SHA-256). The bundled adapter `Zero\Agents\Adapters\Dm02004` is the
only code that names a DM class, ability or filter.

**What the adapter calls, and when** (all verified in DM 0.200.4):

| Phase | Call |
|---|---|
| Early bootstrap, agent entry paths only | `datamachine_request_full_runtime('zero:<app>')` before `plugins_loaded:20` |
| Provision (from publish/doctor `--fix`, under an operator identity, after a DB-backed reconciliation lock) | `wp_get_ability('datamachine/create-agent')->execute([...])` with `config`, explicit `owner_id` and `site_scope`; `datamachine/create-pipeline` with `workflow.steps[].step_type = "ai"` and `flow_config` (creates the first flow; the adapter records the returned `pipeline_id`, `flow_id`, `flow_step_ids` before the next call); `datamachine/create-flow` for additional flows; `datamachine/update-flow` to set `scheduling_config` last, after the mapping is committed |
| Update | `datamachine/get-agent` then `update-agent` (`agent_config`, preserving fields Zero does not own), `update-pipeline-step`, `configure-flow-steps`, `update-flow` with recorded ids |
| Start | Zero authorizes `access`, then `datamachine/run-flow` with the mapped `flow_id`, `respect_paused: true`, inside `PermissionHelper::run_as_system()` for that one dispatch. `run-flow` is annotated non-idempotent; Zero keeps a short dispatch receipt keyed by its operation key and reconciles before any retry |
| Tool scope | `datamachine_engine_snapshot` filter sets `job.ability_tools`, `job.mode_models` and a sealed Zero scope for owned flows; `datamachine_resolved_tools` (priority 100) intersects to the allowlist. Tool descriptions and schemas come from the registered Zero abilities through DM's `AbilityToolSource`; no second schema |
| Approvals | `PendingActionHelper::stage()` from Zero's canonical invocation path when an action with `approval` is called under an agent (or any path); a handler registered through `datamachine_pending_action_handlers` with `can_resolve` (human only, derived from the authenticated request, agent contexts denied) and `apply` (restore the stored owner and DM context, recheck access, policy, expiry and the target fingerprint, `PendingActionAuthorizationReceipt::consume` immediately before the canonical mutation). Resolution through `ResolvePendingActionAbility::execute` from Zero's review endpoint. `resolve_pending_action` and every DM management ability are excluded from the agent's tools |
| Memory | DM's default `AgentMemory` store; `modelWrites: false` means no memory-write tool is projected |
| Admin | `datamachine_admin_pages` for discovery; Zero Admin shows an Agents entry with readiness, owned resources, DM deep links for operators who have DM's capabilities, and the review cards |

**Execution identity.** DM's AI step sets the WP current user to the DM
agent's owner. That is why `principal` maps to an owner and why a shared
agent cannot execute as the caller; `{ caller: true }` exists for that case.
The initiator, the owner and the approving human are recorded separately in
DM job and pending-action metadata; approval never elevates the principal.

**The approval continuation gap, stated.** Stock DM 0.200.4 stages, claims
and applies pending actions durably, and resumes runtime-tool continuations
for chat sessions. It does not establish that a paused **pipeline** AI step
resumes with the original tool-call id and remaining cursor after a human
decision. Zero requires a versioned capability, `ZeroApprovalBridgeV1`
(checkpoint the assistant turn, tool-call ids and cursor in the DM job before
releasing the worker; on decision, persist the terminal tool result under the
original id and schedule DM's fenced resume), delivered as a tested DM
integration patch or upstream change. Until `zero doctor` sees it,
approval-dependent flows are reported unready and refuse to start; read-only
agents run. The model is never asked to reissue an approved mutation.

**Version pinning.** The platform pins DM core 0.200.4 (`b07be213`, exact
artifact SHA-256, built with `composer install` from its committed lock)
as a locked WordPress plugin like SCF and the MCP adapter. Business and
Socials are not installed. DM bundles Agents API `952db6cb` and Action
Scheduler 3.9.3; Zero pins AS 4.2.0. **Decision:** one qualified AS version
and runner policy for the combined platform, starting from 4.2.0, accepted
only after co-install tests under both plugin load orders; DM's global queue
tuning cooperates through a narrow tested opt-in, not two competing runners.
This is the one-queue answer (report 07 §B6): two logical job domains, one
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
| Provider | provider and model configured; finite turn budget; no secret printed |
| Delivery | loaded AS class version and runner policy qualified; one routine per owned schedule; a disposable canary job on both domains |
| Reconciliation | manifest digest matches owned DM resources; drift and orphaned owned schedules listed; nothing of anyone else's is touched |

## 5. Conflicts reconciled

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
`adopt` and `reset` as the operator's tools, trash as retirement, and a
read-only editor view with a `map_meta_cap` lock. Reason: canonical URLs,
menus, `wp_get_canonical_url`, sitemaps and every SEO plugin resolve against
a queried post; a virtual route would need Jetpack-preview-style query
surgery for each of them.

**"Blocks never touches `zero.config.ts`" vs pages beside it.** Decision:
pages are a Zero core feature discovered by file convention. `zero.config.ts`
never registers a page; pages import collections from it. Blocks never reads
`zero.config.ts`; `zero build` hands it an IR and receives serialized markup.
Zero core's Rust compiler and PHP runtime never import Blocks' code; the one
coupling is a build-tool invocation that exists only when `pages/` does. The
Blocks ruling's "never depends on it" is narrowed to "backend-only builds
never depend on it", and this narrowing is listed in §9 for the owner.
Reason: a second serializer in Rust would be wrong the day core changes a
class name (blocks-notes §1); a page system without the serializer cannot
produce valid block markup.

**`public: false` collections and the access gap.** Decision:
`collectionPage(c)` implies viewability and is the only thing that does. It
flips the CPT to `publicly_queryable: true` with a rewrite slug equal to the
route directory, `has_archive: false`, `exclude_from_search` unchanged
(opt-in via `collectionPage(c, { search: true })`). Report 04's gap, that
theme and core queries bypass Zero's per-record rules because the front-end
guard returns outside wp-admin, is closed in the same PR: Zero's read rule is
applied to every `WP_Query` over a viewable Zero type through
`pre_get_posts` / `posts_where`, which the existing compiler can do for
`"anyone"` and for filter rules (they already compile to SQL). A read rule
that is a role or a non-filter function cannot be applied to a theme query,
so `collectionPage` on such a collection is a build error with the fix named.
Collections without a `collectionPage` stay `public: false`, and a
`QueryLoop` naming one is an error (the silent fallback to core `post` is
exactly what Blocks withdrew its helper over).

**Report 05's "one queue" vs Data Machine's job engine.** Decision: report
07 §B6. Both already deliver through Action Scheduler; the requirement is one
physical backend and one qualified runner, not one ledger. Zero jobs stay
Zero jobs; DM runs stay DM runs; neither wraps the other.

**The word "agents".** Decision: rename the exposure flag to `abilities`;
`agents` is only the top-level definition key. Reason: the flag's effect is
Ability registration, and the collision would make `agents: false` mean two
things on one screen.

## 6. Refused in v1

- Catch-all and optional segments, `template.tsx`, parallel and intercepting
  routes, client-side routing.
- React hooks, context, effects, events, portals, Suspense, async components,
  `style` objects, browser globals and unlowered npm imports in any component
  reachable from a WordPress page.
- React or Preact client islands and hydration of PHP output. Islands are
  WordPress Interactivity API only.
- Static HTML export, ISR, build-time prerendering of collection rows.
- `collectionPage` over table-backed (`editor: false`) collections, over
  collections whose read rule is a role or a non-filter function, and a second
  `collectionPage` for one collection.
- Decompiling block markup to TSX; syncing code-owned pages or templates.
- Media byte sync.
- Tailwind and other CSS transforms; CSS-in-JS.
- In-browser (wasm) `zero build` of pages: the serializer needs Node. The
  browser builder keeps `zero check` of the page subset and builds
  backend-only projects.
- A Zero-owned agent runtime, transcript store or run ledger; agent
  timezones other than UTC; Data Machine Business and Socials as platform
  plugins; a model-callable approval resolver; code execution sandboxes.
- Any `eval` of generated PHP from the database, or storing executable code
  in uploads, as a publish fallback.

## 7. Testing

One behaviour, one owner, lowest seam that can break it. Compiler
diagnostics and IR decisions are proven in `tests/compiler.rs` fixtures
(`tests/fixtures/pages/*`). Serialization validity stays in Blocks' unit
tests. Rendering, bindings, regions, routes, Page reconciliation, head
output, asset order and the `map_meta_cap` lock are proven on the
WordPress-on-SQLite in-process site (`tests/php/wp.php`), one fixture
project, one suite per seam. Node/PHP differential rendering runs the region
corpus under both. The Site Editor validity proof and the theme install proof
stay in Blocks' Docker job, path-filtered. Agents: DM provisioning, tool
scope, approval staging and human resolution, and the AS co-install, in a
credential-free WordPress-on-SQLite suite with the real pinned DM artifact;
provider calls behind an explicit credential gate. Publish: the endpoint
against the in-process site with a real zip, including traversal, symlink,
expected-current and idempotency refusals. No source-grep anywhere.

## 8. Rollout

Stacked PRs in this order. Each is green on `ci.yml`, `blocks.yml` and
`site.yml` on its own; every new behaviour is reachable only when `pages/`
or `agents` exists, so the existing suites are untouched until a PR
deliberately extends them.

| PR | Contents | Proof |
|---|---|---|
| 0 | this document | review |
| 1 | rename `agents` → `abilities` on collections and actions: extractor, `schema.php`, `config-api.md`, types, generated client docs, tests | existing abilities/MCP suites pass under the new name; a fixture using `agents:` on a collection is an error naming `abilities` |
| 2 | collection viewability: `collectionPage` prerequisite flag in `schema.php`, CPT registration with rewrite, read rule applied to front-end `WP_Query`, reserved-slug check, refusal of role/function rules | `tests/php/wp.php` suite: a published row has a permalink and renders; a draft row and a filtered-out row 404 through a theme query and through `core/query`; a role rule is a build error |
| 3 | compiler: JSX admission for `pages/`, `components/`, `islands/`; discovery, layouts, groups, params, route ids, collision diagnostics; the IR with provenance; `zero check` over pages; `zero/pages` and `@spacefast/zero-blocks/universal` types | `tests/compiler.rs` fixtures for every diagnostic in §4.1–4.3; a backend-only project builds byte-identically to before |
| 4 | Blocks: `serialize-ir` entry (stdin IR → markup + diagnostics) and the `universal` React entry with the class contract | Blocks unit tests: each primitive's React output equals the pinned `save()` classes; IR round trip |
| 5 | static pages end to end: serializer invocation from `zero build`, `build/pages/*`, canvas, route table, Page reconciler with `adopt`/`reset`/trash, `map_meta_cap` lock, read-only editor notice | WordPress suite: `/about` renders through the canvas with `wp_head` once; Pages list shows the record; REST `PUT` is 403; rename retires; collision is reported |
| 6 | bindings, regions, loaders, `collectionPage`, `RichText`, `PostContent`, `QueryLoop`, the `zero/page-field` and `zero/region-field` sources, generated blocks with editor placeholders; Node/PHP differential corpus | WordPress suite: a row change shows without rebuild; a denied row never leaks through a binding; `{0 && …}` renders `0` on both sides; the editor reports no invalid block |
| 7 | head/SEO: metadata merge, resolution before output, core emitter, the three plugin adapters, `post_title` sync | WordPress suite with no plugin and with each plugin's pinned artifact: exactly one title, canonical, robots, OG set |
| 8 | CSS and assets: modules, class maps and types, tokens, hashed files, manifest, enqueue order; Interactivity islands | WordPress suite: stylesheet links precede `wp_head` scripts; a module is registered with its dependency; `wp_interactivity_process_directives` output matches the client store's initial state |
| 9 | theme output: `pages/theme.config.ts`, layouts → `templates/`, `parts/`, `theme.json` presets from tokens; lands the reusable parts of `p3/blocks-theme` | Blocks Docker job: install from zip, Site Editor validity for every template and part; plugin canvas and theme render the same body |
| 10 | sync for content pages: `.blocks.html` front matter format, `pages` sync group, validator-gated merge, sync-off lock transitions | `tests/sync.rs` and `tests/php/sync_test.php`: pull, push, conflict, not-representable, lock on and off |
| 11 | `zero publish`: capabilities probe, endpoint, staging, pointer flip, rollback, `--content-only`, receipt; CLI output | publish suite against the in-process site: happy path, every refusal in §4.9, read-only probe → content-only |
| 12 | agents without approvals: `agent()`, `abilities()` references, manifest, `Dm02004` adapter (provision, update, start, tool scope, memory, schedules), DM platform pin, AS qualification, `zero doctor` section | DM suite: provisioning idempotent across two runs; tool set equals the allowlist; a Zero job and a DM flow deliver under both load orders; doctor table |
| 13 | approvals: action `approval` in the canonical invocation path, pending-action handler, human review endpoint and cards, `ZeroApprovalBridgeV1` gate and the bridge itself | DM suite: direct REST and agent call both stage; agent cannot resolve; human accept applies once across a worker restart; changed target fingerprint invalidates; unready without the bridge |
| 14 | examples (`examples/journal` with pages, `examples/pantry` with an agent), README section, `docs/pages.md`, `docs/agents.md` | examples build without diagnostics and byte-equal twice |

PRs 1 and 2 are independent of the rest and can merge first. PRs 3 and 4 can
proceed in parallel. 5–8 are sequential. 9 and 10 depend on 5. 11 depends
on 5. 12 depends on 1 only; 13 on 12.

## 9. Open questions

Each with the recommended answer this document assumes.

1. **Narrowing the Blocks isolation ruling.** `zero build` invokes Blocks'
   serializer when `pages/` exists (§5). Recommended: accept; the
   alternative is a second serializer in Rust that cannot promise editor
   validity.
2. **Publicly viewable collections without a page.** Someone may want a
   viewable CPT for a hand-written theme template without a `collectionPage`.
   Recommended: no separate `public` option in v1; `collectionPage` is the one
   switch. Add `public: true` later if a real project needs it.
3. **Compiled body in `post_content` for code pages.** Gives SEO analysis and
   the read-only editor something to show, at the cost of a digest check on
   publish. Alternative: leave `post_content` empty. Recommended: compiled
   body.
4. **`pages/theme.config.ts` as the theme switch** versus a `theme` key in
   `defineConfig`. Recommended: the file; it keeps `zero.config.ts` data-only
   and reuses Blocks' `defineTheme`.
5. **`post_name` of nested routes.** WordPress gives child Pages hierarchical
   permalinks (`/posts/featured`) through `post_parent`. The listing route
   `/posts` is then the parent Page of `/posts/featured` while `/posts/<slug>`
   rows are a CPT with the `posts` rewrite slug; both resolve, Page first by
   rewrite order. Recommended: accept, with the reserved-slug check.
6. **The approval continuation bridge** is a Data Machine integration patch
   until upstream accepts it. Recommended: ship read-only agents first (PR
   12), hold approvals (PR 13) behind the capability gate, and open the
   upstream conversation at PR 12.
7. **Action Scheduler version.** Qualify 4.2.0 as the active runner and ask DM
   to tolerate it, or step Zero down to 3.9.3 for the agents platform.
   Recommended: 4.2.0, measured in PR 12.
8. **Islands in v1 at all.** Recommended: yes, Interactivity-only, because a
   menu toggle on a marketing page is the first thing a full-site author
   asks for; it is one bundler entry and one `wp_enqueue_script_module`.
9. **The agents' `access` and DM admin capabilities.** Zero's `access:
   "editor"` does not grant DM's admin pages. Recommended: keep them
   separate; Zero Admin's review cards are the editor-facing surface.
