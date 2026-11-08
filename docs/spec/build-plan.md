# Build plan

What it takes to get from spacefast/zero `main` (de46201a, 2026-11-08) to the
spec in this folder. Each workstream lists what already exists, what gets
built, what gets deleted, and how we'll know it's done. Sizes: **S** is days,
**M** about a week, **L** two to three weeks, **XL** over a month, all with
agents doing the writing.

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
  11. Opinionated WordPress (any time)   12. Docs, examples, 0.8 migration (last, continuous)
```

Start in parallel now: 1, 5 and 11. Then 2, 3 and 4 after 1. Then 6, 9 and 10.
Then 7 and 8.

## 1. Authoring surface cutover (L)

**Exists:** `collection()`/`table()`, Drizzle builders, `defineConfig`
registries, `defineRelations`, the `hooks` key, the config evaluator in Rust
(`src/eval.rs`, `src/extract.rs`), `zero.gen.ts`.

**Build:**
- The `zero/` root, plus `zero.config.ts` at the project root with the import
  fence (`Z1210`).
- Load every `.ts` under `zero/` and register exports by name (`Z1221` on duplicates).
- Required by default and `.optional()`.
- `ref()` with reverse relations and `onDelete` defaults; `.many()` join tables.
- `taxonomy()` with `terms()`; `global()`; `files()`.
- `.on()` hooks plus `afterPublish`; the implicit `author`; `"author"` / `"org"` access values.
- Inferred title, content and labels.
- Index inference from compiled queries, with `zero check --json` reasons.
- `_generated/db.d.ts` and the `zero:db` import.
- One query API (`list`, `paginate`, `get`, `count`, `create`, `update`,
  `delete`, `.system`) replacing `db.query`/`db.insert`.
- `action()` input types from the handler signature; `job()` with `every`/`cron`.

**Delete:**
- the registries, `defineRelations` and `userProjection`;
- `.notNull()`, `.references()`, `id()`, `$default`, `$onUpdate` and `real()`;
- `db.*` and `jobs.x.enqueue`;
- `zero.gen.ts` and the generated `zero/client/` source.

**Done when:**
- `examples/blog`, `pantry` and `full-site` are rewritten.
- Their behavior suites pass.
- The authoring rewrite produces no data migration.
- The two-collection hook type test is in the TS suite.

## 2. Core REST and Abilities instead of `/zero/v1` (L)

**Exists:**
- `runtime/Zero/Wp/Rest.php` serves `/wp-json/zero/v1/*` through a catch-all route.
- `CoreAccess.php` already applies Zero's rules to core `/wp/v2/zero_*`:
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
- **Typed client:** rebuilt over `/wp/v2` and `/wp-abilities/v1`.
- **`zero pull`:** reads the REST index.

**Delete:**
- `Rest.php`'s `/zero/v1` catch-all and its problem-document envelope;
- `/_schema`;
- the revisions routes (core `/wp/v2/<type>/<id>/revisions` covers them);
- `/globals/*`;
- the `/media` routes;
- `/actions/*`.

**Done when:** every route test in `tests/` runs against the core route and the
access suite proves the same denials there:
- field masks;
- draft visibility;
- filters that can't probe hidden fields.

## 3. Built-in WordPress kinds (L)

**Exists:**
- `WpUserStore` and `WpPostStore`;
- `userProjection`;
- zero-identity (sign-in, guests, upgrade, organizations);
- SCF field groups.

**Build:**
- `wp.users`, `wp.comments`, `wp.posts`, `wp.pages`, `wp.media`,
  `wp.categories`, `wp.tags`, `wp.menus` and `wp.settings`, each with `.extend()`.
- `wp.comments.type()`.
- Users options: `signIn`, `guests`, `mfa`, `roles` (`add_role`) and `organizations` (the `orgs` kind).
- `comments` options on kinds: guests, moderation, threading, auto-close.
- `Z1220` for an export that shadows a built-in.

**Done when:** EmDash `blog` runs on `wp.posts` instead of a `zero_posts`
type, with comments, categories, tags and menus all core.

## 4. Deploy-time schema check (M)

**Exists:** the migration snapshot and numbered SQL, `-- zero-adopt`, and the migrator ledger.

**Build:**
- The ledger moves to `_generated/`.
- Deploy compares the planned change with live row counts:
  - required-field and drop refusals, with counts and fixes;
  - `--drop kind=N`;
  - `.was()` renames.
- The Spacefast publish path passes `--drop` through `sf publish`.

**Done when:** each refusal is covered by a test against real MySQL, and an additive change applies with no prompt.

## 5. TSX → PHP compiler spike (XL, the main risk)

**Exists:**
- OXC parsing, the TS subset lowered to PHP with JS semantics, the classes and stdlib work;
- `packages/pages` (a build-time Node renderer with placeholders);
- the "one component source, two compilers" design in `docs/design-pages-and-agents.md` §4.2–4.3.
- Missing: JSX (refused in `src/lower.rs`).

**Build:**
- JSX lowering to a component IR.
- A PHP renderer that writes an escaping HTML buffer.
- Async server components (blocking calls).
- The Interactivity output:
  - context, getters, directives and actions;
  - derived values compiled to both JS and PHP.
- Node-vs-PHP HTML parity tests.

**Delete after it lands:**
- `packages/pages`'s placeholder renderer and `zero-pages build`;
- `zero/pages.json`;
- `load()`, `<Show>`, `orElse()`, `count()` and `<Island>`.

**Done when:**
- `examples/full-site` pages, including one `"use client"` counter, compile and pass parity.
- The decision file `docs/decisions/2026-11-08-tsx-to-php.md` is written first.

## 6. `app/` routing, URL patterns, front-end modes (L)

**Exists:**
- Page routing for `pages/` (hidden Page records, route IDs);
- `HttpRoutes.php` (`routes`);
- `template_redirect` handling.

**Build:**
- **`app/` conventions:** `page`, `layout`, `not-found`, `error`, `route`,
  `[x]`, `[...x]`, `[[...x]]`, `(group)` and `_private`.
- **Pages:** page+handler in one file, `guard`, typed `search`, `_generated/routes.d.ts` for links.
- **Kind URLs:**
  - `url` patterns compile to rewrite rules and `post_type_link`/`term_link`;
  - automatic 301s;
  - an `app/` page that matches a pattern takes over its URL;
  - otherwise the theme renders it.
- **Front-end modes:** none, `app/`, `false` and a URL, behind one `template_redirect` gate.
- **Static pages:** prerendered into `dist/`.

**Done when:** the browser suite covers every mode's URLs, admin, login and REST staying up, and a slug change redirecting.

## 7. Interactivity (L, after 5)

**Build:**
- **Built-in components:** `useState`, derived values, `sharedState`,
  `useEffect`→`wp-watch`, `useMount`, `useEvent` and `useRef`; forms (no-JS
  POST plus a store); `<Link>` with the router region.
- **Live data:** `<Live>` and `useLive` on the existing Cast live updates
  (monorepo #5152, zero #128).
- **Zero's own components:** `<Comments>`, `<SignIn>`, `<Search>`, `<Pagination>` and `<Menu>`.

**Done when:** the browser tests in rendering.md §8 pass.

## 8. Caching and URL purges (M, plus a check first)

**Exists (monorepo runtime):**
- durable per-host purge records in `runtime/engine/shared/purge.php`, delivered to the edge-cache gateway;
- static files served before WordPress.

**First:** read the platform's Edge_Cache adapter (`class-edge-cache-atomic.php`) for its path-purge parameters and limits, and check Batcache's key and bypass cookies.

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
- a lost delivery is retried by housekeeping.

## 9. Markdown and llms.txt (S, after 6)

**Exists:** `Markdown::fromBlocks`.

**Build:** `.md` suffix and `Accept: text/markdown`, `Vary`, `<link rel="alternate">`, `?format=md` on core item routes, `/llms.txt`, and a `Content-Signal` header.

## 10. Framework adapters (L, after 2)

**Build:**
- **Packages:** `@zero/astro` (build-time and live loaders), `@zero/next`
  (fetch with cache tags, a revalidate and draft handler) and `@zero/tanstack`
  (`queryOptions`, a TanStack DB collection over the change feed).
- **Preview:** a single preview contract across all three.
- **Webhooks:** carry tags and URLs.

**Done when:** the EmDash `blog` Astro template runs on `@zero/astro` with no
bridge code, a Next.js 16 example picks up a wp-admin edit with no redeploy,
and a TanStack list updates live.

## 11. Opinionated WordPress (M)

**Exists:** plugin pinning (`plugins.lock.json`), the SCF and Action Scheduler bundles, `zero-identity`.

**Build:** Zero's release installs and pins Secure Custom Fields, Action
Scheduler, the MCP Adapter, Akismet, Two Factor and (with `locales`) Polylang.
It also hardens WordPress:
- turns off XML-RPC, pings, emoji scripts, file editors, plugin and theme installs, core auto-updates and the Customizer;
- disables comments everywhere except kinds that turn them on;
- turns on pretty permalinks, the Space timezone and the object cache;
- ships a minimal default block theme.

On Spacefast, the box image and Spacefast Access do the parts that belong to the host.

## 12. Docs, examples, 0.8 migration (continuous, finishes last)

**Build:**
- **Docs:** rewrite `docs/config-api.md`, `docs/pages.md`, the README and the site to match the spec.
- **Examples:** port every example.
- **0.8 migration:** `zero migrate app --from zero-0.8` emits this layout
  (the census decides which 0.8 features get converted; anything else means
  rewriting it on v2).
- **Monorepo:** `sf zero`, MCP and the Spacefast publish path follow the new layout.

## Rough total

Twelve workstreams. With 3–4 agent workstreams in parallel, the critical path
is 1 → 2/3 → 6 → 8, plus 5 → 7 for interactivity. That's about 6–8 weeks to
the whole spec. A first useful cut, about 3 weeks, is 1 + 2 + 3 + 4 + 11: the
new authoring surface on core REST with WordPress rendering, which is already a
complete backend with admin, API and agent tools.
