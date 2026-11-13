# Build plan

What it takes to get from spacefast/zero `main` (de46201a, 2026-11-08) to the
spec in this folder. Each workstream lists what already exists, what gets
built, what gets deleted, and how we'll know it's done. There are no time
estimates. Agents write the code, so the limits are ordering, review and how
many workstreams run at once.

## Order

```text
            ┌──────────────────────────────┐
            │ 1. Authoring surface cutover │──┬──────────────────────────────┐
            └──────────────────────────────┘  │                              │
                 │                            ▼                              ▼
                 │              ┌──────────────────────────┐   ┌────────────────────────┐
                 │              │ 2. Core REST, Abilities  │   │ 3. Built-in WP kinds   │
                 │              └──────────────────────────┘   └────────────────────────┘
                 ▼                            │                              │
  ┌────────────────────────────┐              ▼                              ▼
  │ 4. Deploy-time schema check│   ┌──────────────────────────────────────────────────┐
  └────────────────────────────┘   │ 6. app/ routing, URL patterns, front-end modes   │
                                   └──────────────────────────────────────────────────┘
  ┌────────────────────────────┐                 │                 │
  │ 5. TSX → PHP compiler spike│────────────────►│                 ▼
  └────────────────────────────┘                 ▼        ┌────────────────────┐
                                    ┌───────────────────┐ │ 8. Caching + purge │
                                    │ 7. Interactivity  │ └────────────────────┘
                                    └───────────────────┘
  9. Markdown + llms.txt (after 6)   10. Framework adapters (after 2)
  11. Opinionated WordPress (any time)   12. Docs and examples (continuous)
```

Start in parallel now: 1, 2, 4, 5, 11 and the URL-purge half of 8. 2 and 4
work on the runtime and migrator side and rebase onto 1's authoring surface as
it lands. Then 3 after 1. Then 6, 9 and 10. Then 7 and the rest of 8.

A 0.8 app migrates to v2 on its next publish when the converter and the
publish checks refuse nothing ([coexistence.md](coexistence.md)). The converter
tracks `main`: each workstream that changes what it emits updates it in the same
PR.
[coexistence.md](coexistence.md) lists the rules and the suites that hold them.

## 1. Authoring surface cutover

**Exists:** `collection()`/`table()`, Drizzle builders, `defineConfig`
registries, `defineRelations`, the `hooks` key, the config evaluator in Rust
(`src/eval.rs`, `src/extract.rs`), `first.gen.ts`.

**Build:**
- The `first/` root, plus `first.config.ts` at the project root with the import
  fence (`F1210`).
- Load every `.ts` under `first/` and register exports by name (`F1221` on duplicates).
- Required by default and `.optional()`.
- `ref()` with reverse relations and `onDelete` defaults; `.many()` join tables.
- `taxonomy()` with `terms()`; `global()`; `files()`.
- `.on()` hooks plus `afterPublish`; the implicit `author`; `"author"` / `"org"` access values.
- Inferred title, content and labels.
- Index inference from compiled queries, with `first check --json` reasons.
- `_generated/db.d.ts` and the `first:db` import.
- One query API (`list`, `paginate`, `get`, `count`, `create`, `update`,
  `delete`, `.system`) replacing `db.query`/`db.insert`.
- `action()` input types from the handler signature; `job()` with `every`/`cron`.

**Delete:**
- the registries, `defineRelations` and `userProjection`;
- `.notNull()`, `.references()`, `id()`, `$default`, `$onUpdate` and `real()`;
- `db.*` and `jobs.x.enqueue`;
- `first.gen.ts` and the generated `first/client/` source.

**Done when:**
- `examples/blog`, `pantry` and `full-site` are rewritten.
- Their behavior suites pass.
- The authoring rewrite produces no data migration.
- The two-collection hook type test is in the TS suite.

## 2. Core REST underneath, `/__first/api/v1` facade on top

**Exists:**
- `runtime/First/Wp/Rest.php` serves `/wp-json/first/v1/*` through a catch-all
  route, as a second implementation with its own queries and writes.
- `CoreAccess.php` already applies First's rules to core `/wp/v2/first_*`:
  - capabilities through `map_meta_cap`;
  - read filtering and field stripping;
  - the wp-admin lists.
- `EditorSave.php` checks saves before they commit.
- Abilities are registered for collections.

**Build:**
- **Post kinds:**
  - `register_post_meta` for every field (`show_in_rest`, schema);
  - `where`/`orderBy`/`with`/`search` query args on core list routes;
  - `?format=md`.
- **Taxonomies:** term meta.
- **Comments:** comment meta, the anonymous-comments filter scoped per kind, comment types.
- **Users:** user meta.
- **Menus:** read access for public locations.
- **Tables:** a `wp/v2/<table>` `WP_REST_Controller`. It is the only new route.
- **Actions:** each one as an Ability (`readonly`/`destructive`/`idempotent`
  annotations from options), with input and output schemas from the TS
  signature, through core's run route.
- **Errors:** move to core's `WP_Error` JSON.
- **Facade:** `/__first/api/v1/<kind>`, `/me`, `/actions/<name>` and `/` (the
  schema). Each request is dispatched to the core route with `rest_do_request`,
  and the facade only maps input and output: First row shapes, `{ data, cursor }`,
  problem documents, and `?format=md`.
- **Typed client and adapters** on the facade; `first pull` reads `GET /__first/api/v1`.

**Delete:**
- `Rest.php`'s own query and write path under `/first/v1`, replaced by the
  facade, which only maps and dispatches;
- the revisions, `/media` and `/globals/*` implementations (core routes cover them).

**Done when:** every route test in `tests/` passes against both the facade and
the core route. The access suite proves the same denials on both:
- field masks;
- draft visibility;
- filters that can't probe hidden fields.

## 3. Built-in WordPress kinds

**Exists:**
- `WpUserStore` and `WpPostStore`;
- `userProjection`;
- first-identity (sign-in, guests, upgrade, organizations);
- SCF field groups.

**Build:**
- `wp.users`, `wp.comments`, `wp.posts`, `wp.pages`, `wp.media`,
  `wp.categories`, `wp.tags`, `wp.menus` and `wp.settings`, each with `.extend()`.
- `wp.comments.type()`.
- Users options: `signIn`, `guests`, `mfa`, `roles` (`add_role`) and `organizations` (the `orgs` kind).
- `comments` options on kinds: guests, moderation, threading, auto-close.
- `F1220` for an export that shadows a built-in.

**Done when:** EmDash `blog` runs on `wp.posts` instead of a `first_posts`
type, with comments, categories, tags and menus all core.

## 4. Deploy-time schema check

**Exists:** the migration snapshot and numbered SQL, `-- first-adopt`, and the migrator ledger.

**Build:**
- The ledger moves to `_generated/`.
- Deploy compares the planned change with live row counts:
  - required-field and drop refusals, with counts and fixes;
  - `--drop=kind=N`;
  - `.was()` renames.
- The Spacefast publish path passes `--drop` through `sf publish`.

**Done when:** each refusal is covered by a test against real MySQL, and an additive change applies with no prompt.

## 5. TSX → PHP compiler spike

**Exists (inventory of c3c85dcd, 2026-11-08):** about half of the target is built.

| Capability | Status |
|---|---|
| Expressions → PHP with JS semantics | **done**: `src/lower.rs`, `src/compile.rs`, `runtime/First/Js*.php` (29 files) |
| Node-vs-PHP parity harness | **done for values** (`tests/differential/`, `tests/compiler.rs:800`); no HTML cases yet |
| Request-time escaping, island SSR (`wp_interactivity_process_directives`), routes, assets, `the_content` | **done**: `runtime/pages/Renderer.php`, `Plugin.php`, `Routes.php` |
| Block serialization | **done**: `packages/blocks` (152 tests) |
| esbuild bundling of browser modules | **done**: `packages/pages/build.ts` |
| JSX parsing | OXC parses TSX already (`config_migrate/app/pages.rs:64`); the compiler refuses it at `src/lower.rs:1441` and `src/loader.rs:292` |
| `&&`, `?:`, `.length`, method calls on request data | **missing**: the placeholder proxy (`packages/pages/symbolic.ts`) can't express them by design |
| Component IR, `"use client"` → store + directives, derived values in JS and PHP | **missing** |

**Approach:** JSX → IR → PHP in the Rust compiler, because expression lowering
needs the types it already has, and boxes have no JavaScript. Node at build time
does only what it's already good at: esbuild for `"use client"` store modules,
the Node half of the HTML parity tests (`renderToStaticMarkup`), and block
serialization if a page wants block output.

**Build:**
- Replace the JSX refusal with IR nodes for elements, fragments, expression
  containers and component calls.
- A PHP renderer that writes an escaping HTML buffer, with a `First\Html` child
  helper on React rules: `null`/`false` render nothing, `0` renders `"0"`,
  arrays concatenate.
- Async server components (blocking calls).
- The Interactivity output:
  - context, getters, directives and actions;
  - derived values compiled to both JS and PHP.
- Node-vs-PHP HTML parity tests.

**Deleted** (the full-site cutover): `packages/pages` with `first-pages build`, the
`runtime/pages` renderer, `first/pages.json` and its capture checks (`src/pages.rs`),
and `load()`, `<Show>`, `orElse()`, `count()` and `<Island>`. A capture that
still carries `pages/` or `first/pages.json` is refused, on both bundle formats.
`docs/design-pages-and-agents.md` §4.3's block-region output model is replaced
too.

Monorepo `legacy/zero-0.8` keeps its Preact island code until live 0.8 Spaces move; nothing is reused from it.

**Done when:**
- `examples/full-site` pages, including one `"use client"` counter, compile and pass parity.
- The decision file `docs/decisions/2026-11-08-tsx-to-php.md` is written first.

## 6. `app/` routing, URL patterns, front-end modes

**Exists:**
- Page routing for `pages/` (hidden Page records, route IDs);
- `route.ts` handlers in `first/app/` (`AppRouter.php`);
- `template_redirect` handling.

**Build:**
- **`app/` conventions:** `page`, `layout`, `not-found`, `error`, `route`,
  `[x]`, `[...x]`, `[[...x]]`, `(group)` and `_private`.
- **Pages:** page+handler in one file, `guard`, typed `search`, `_generated/routes.d.ts` for links.
- **Kind URLs:**
  - `url` patterns compile to rewrite rules and the kind's link filter (`post_link` for posts, `page_link`/`_get_page_link` for pages, `post_type_link` for collections, `term_link` for terms);
  - automatic 301s;
  - an `app/` page that matches a pattern takes over its URL;
  - otherwise the theme renders it.
- **Front-end modes:** none, `app/`, `false` and a URL, behind one `template_redirect` gate.
- **Static pages:** prerendered into `dist/`.

**Done when:** the browser suite covers every mode's URLs, admin, login and REST staying up, and a slug change redirecting.

## 7. Interactivity

**Build:**
- **Built-in components:** `useState`, derived values, `sharedState`,
  `useEffect`→`wp-watch`, `useMount`, `useEvent` and `useRef`; forms (no-JS
  POST plus a store); `<Link>` with the router region.
- **Live data:** `<Live>` and `useLive` on the existing Cast live updates
  (monorepo #5152, zero #128).
- **First's own components:** `<Comments>`, `<SignIn>`, `<Search>`, `<Pagination>` and `<Menu>`.

**Done when:** the browser tests in rendering.md §8 pass.

## 8. Caching and URL purges

**Exists (monorepo runtime):**
- durable per-host purge records in `runtime/engine/shared/purge.php`, delivered to the edge-cache gateway;
- static files served before WordPress;
- `batcache_cancel()` on WordPress lanes (`runtime/engine/runtime/content-page.php`).

**Checked 2026-11-08 (wpcom source a1adf0d2f93, no WP Cloud calls):**
- URL purges exist: the purge action takes a `purge_uris` array, checks each
  URL's host belongs to the site, keeps query strings, and purges the whole
  domain only when none is given (`atomic.api/includes/edge-cache.php:261-362`,
  `wp-content/lib/edge-cache.php:851`). No URL-count limit is enforced; manual
  wp-admin purges are rate-limited, ours are not.
- Batcache stores a URL on its second hit within two minutes, reads only
  `max-age` from `Cache-Control`, and drops tracking params (`utm_*`, `fbclid`, …)
  from its key (`.config/batcache-config.php`).
- So per-URL purge needs no WP Cloud change: send `purge_uris` from the existing records.

**Build:**
- **Per-route cache policy:**
  - the compiler decides prebuilt, shared or private;
  - Batcache and edge headers;
  - bypass for signed-in visitors and previews.
- **Purge planning:**
  - each page records what it read (a URL → reads index kept in the object
    cache, with a database copy);
  - each write turns into a list of URLs to purge, through the existing durable records;
  - a whole-host purge above a threshold.

**Done when:**
- a cache hit follows the first request;
- an edit purges exactly the affected URLs plus their `.md` versions;
- `Accept: text/markdown` on a cached HTML URL returns markdown and leaves the cached HTML untouched, and the next browser request still gets HTML;
- a lost delivery is retried by housekeeping.

## 9. Markdown and llms.txt

**Exists:** `Markdown::fromBlocks`.

**Build:** `.md` suffix and `Accept: text/markdown`, `Vary`, `<link rel="alternate">`, `?format=md` on core item routes, `/llms.txt`, and a `Content-Signal` header.

## 10. Framework adapters

**Build:**
- **Packages:** `@first/astro` (build-time and live loaders), `@first/next`
  (fetch with cache tags, a revalidate and draft handler) and `@first/tanstack`
  (`queryOptions`, a TanStack DB collection over the change feed).
- **Preview:** a single preview contract across all three.
- **Webhooks:** carry tags and URLs.

**Done when:** the EmDash `blog` Astro template runs on `@first/astro` with no
bridge code, a Next.js 16 example picks up a wp-admin edit with no redeploy,
and a TanStack list updates live.

## 11. Opinionated WordPress

**Exists:** plugin pinning (`plugins.lock.json`), the SCF and Action Scheduler bundles, `first-identity`.

**Build:** First's release installs and pins Secure Custom Fields, Action
Scheduler, the MCP Adapter, Two Factor and (with `locales`) Polylang. Spam
checks use the Akismet a site has through Jetpack, when it has a key.
It also hardens WordPress:
- turns off XML-RPC, pings, emoji scripts, file editors, plugin and theme installs, core auto-updates and the Customizer;
- disables comments everywhere except kinds that turn them on;
- refuses edits made on the site to the schema First generates (the schema lock);
- turns on pretty permalinks, the Space timezone and the object cache;
- ships a minimal default block theme.

On Spacefast, the box image and Spacefast Access do the parts that belong to the host.

## 12. Docs and examples

**Build:**
- **Docs:** rewrite `docs/config-api.md`, `docs/pages.md`, the README and the site to match the spec.
- **Examples:** port every example.
- **0.8 migration:** `first migrate app --from zero-0.8` emits this layout, and a
  0.8 publish from the CLI, local MCP or a source build runs it. The census
  decides which 0.8 features get converted; anything else is a located refusal
  with a fix, and that publish stays on 0.8.
- **Monorepo:** `sf first`, MCP and the Spacefast publish path follow the new layout.

## How fast

Nothing here is gated by typing speed. What sets the pace:

- **Order.** 1 comes before 2, 3 and 4. 5 comes before 7. 6 comes before 8 and 9.
- **The edge purge check** (8) and the compiler spike (5) are the two unknowns.
  Both can start today.
- **Review.** Each workstream lands as stacked PRs with behavior tests. Every
  agent PR is reviewed before merge, because reviews have found blocking bugs in
  "verified" green agent PRs before.
- **Parallelism.** One agent per workstream, never two on the same files or tests.
- **0.8 migration keeps working.** No workstream merges while it breaks the
  converter or a rule in [coexistence.md](coexistence.md).

First useful cut: 1 + 2 + 3 + 4 + 11. That gives the new authoring surface on
core REST with the facade and WordPress rendering: a complete backend with
admin, API and agent tools. Pages (5, 6, 7) and caching (8) follow.
