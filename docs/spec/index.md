# Zero framework spec

Written 2026-11-08. Design only;
nothing is implemented. Baseline: spacefast/zero `origin/main` de46201a and
monorepo main (Cast live updates #5152).

## The product in one paragraph

You add `zero.config.ts` and a `zero/` folder to any project. Exported kinds
say what your data is, exported actions and jobs what your app does, and `app/`
(optional) which pages exist. One file can hold all of it; `schema.ts` and
`server/` are conventions, not requirements. Zero
compiles it ahead of time into a WordPress plugin plus prebuilt files. At
request time, only PHP runs, and as little of it as possible. You get WordPress
admin and login, an editor for every collection, and every operation as an
agent tool. With no `app/`, WordPress renders the front end as usual. With
`app/`, Zero renders it. You can also put Astro, Next.js or TanStack Start in
front, with a typed client and cache purges that just work.

## Files

| File | Owns | Workstream |
|---|---|---|
| [spec.md](spec.md) | layout, built-in WordPress kinds (users, comments, posts, pages, media, menus, settings) and how to extend them, your own kinds, URLs, queries, server code, jobs and schedules, front-end modes, config, opinionated WordPress, build output, 0.8 mapping | schema and layout |
| [rendering.md](rendering.md) | routing compared with Next/TanStack/Vite frameworks, pages, everything interactive on the Interactivity API, forms, navigation, live data over Cast, markdown, caching on Batcache + edge with URL purges | rendering |
| [external-frontends.md](external-frontends.md) | Astro, Next.js, TanStack Start, preview, cache tags, webhooks, agents and MCP | frontends |
| [tsx-to-php.md](tsx-to-php.md) | compiler spike: JSX → component IR → PHP renderer and Interactivity store, with parity tests | compiler |
| [coexistence.md](coexistence.md) | how Zero 0.8 and v2 run side by side while this is built: one generation per Space, rules every workstream keeps, the suites that hold them | all |
| [build-plan.md](build-plan.md) | the twelve workstreams from today's `main` to this spec: what exists, what to build and delete, order | all |

## Decisions, 2026-11-08

1. Pages render with PHP at request time, **as long as caching is excellent**.
   Prebuild everything possible into `dist/`, and do minimal work per request.
   This replaces ruling 2 of 2026-11-01 (build-time block markup).
2. One cutover for all schema changes, from 0.8 and from today's v2 API.
3. `pages/` → `app/`, with HTTP routes as `route.ts`.
4. Zero lives in a `zero/` folder next to the user's existing app, with
   `_generated/` and `dist/` inside. `zero.config.ts` is always at the project
   root and imports only from `zero/`.
5. All in on the Interactivity API: every interactive behavior compiles to it.
6. Live updates use Cast (existing work). Co-editing is out of scope.
7. Every collection and taxonomy can define its URL pattern. With no `app/`,
   WordPress renders. Adding a page takes over its URL.
8. Zero is opinionated about the WordPress it runs on. It can require any
   plugins it wants and disable any WordPress feature.
9. Users and comments are WordPress's own, built in and extended, never duplicated.
10. Caching uses WP Cloud's Batcache and edge cache with URL purges. A frontend
    hosted elsewhere owns its own cache.

## Principles

1. One concept, one declaration. A kind, action or job is declared once and
   named by its export. Only `app/`, `components/`, `wp-hooks/`, `content/` and
   `public/` are folder conventions Zero reads.
2. Infer, with one named override for each inference.
3. Prebuild everything that doesn't depend on the request. At request time do
   a lookup, the visitor-dependent part, and nothing else.
4. Compile to the best WordPress core primitive. Never make the author write
   WordPress concepts that the compiler can derive.
5. Agents are first-class: every operation is an Ability, every page has a markdown twin.
6. Same behavior as JavaScript, or a build error.

## Where each idea comes from

| Idea | Taken from | Not taken |
|---|---|---|
| Table per export, required by default, implicit id/timestamps, types without annotations, a `convex/`-style folder in your app | Convex | no FKs or cascades |
| Schema checked against live data at deploy, `--drop` counts, AGENTS.md | Lakebed (the origin of Zero 0.8's API) | mandatory indexes, hand-written ownership checks |
| Implicit post fields, URL patterns, taxonomies, bylines, single live Astro loader | EmDash | DB as schema source, runtime DDL |
| `app/` conventions, `"use client"`, server actions imported into components, `metadata` | Next.js App Router | RSC wire format, JS server |
| `.md` pages, content loaders with digests and cache hints | Astro | |
| `queryOptions` factories | TanStack Start | |
| Infrastructure derived from code, export = handle, markdown on `Accept` | Vercel | |
| Hooks on the collection | Payload | opt-out MCP exposure |
| Post types, taxonomies, roles, Abilities, Action Scheduler, Interactivity API, HTML API | WordPress | WP-Cron as scheduler, experimental full-page navigation |

## Zero concept → WordPress primitive

| Zero | Compiles to |
|---|---|
| `collection()` | `register_post_type` + SCF field group + `register_post_meta` |
| `table()` | SQL table + a `wp/v2/<table>` controller shaped like core's post routes |
| `taxonomy()` / `terms()` | `register_taxonomy` + `register_term_meta` |
| `global()` | `register_setting` with `show_in_rest` |
| `users()` | `wp_users` + usermeta projection |
| `menu()` | `register_nav_menu` + `wp_navigation` |
| `url` patterns | rewrite rules + the kind's link filter (`post_link`, `page_link`, `post_type_link`, `term_link`) + automatic 301s |
| `job()`, `every`, `cron` | Action Scheduler async / recurring / cron actions |
| `action()` | `wp_register_ability`, served by core's Abilities route, the MCP Adapter and the facade |
| HTTP API | core `/wp/v2` routes enforce Zero's rules; `/__zero/api/v1` maps them to clean shapes for clients and agents |
| `app/**/page.tsx` | compiled PHP renderer behind one `template_redirect` gate |
| `"use client"` | Interactivity API store module + `data-wp-*` directives |
| live updates | `zero_realtime_changes` → control plane → Cast room |
| agent tools | Abilities API + MCP Adapter |

## Open questions

1. **Edge path purge: answered.** The edge-cache purge action already takes
   `purge_uris`; see [rendering.md](rendering.md) §6.4.
2. **Order.** See [build-plan.md](build-plan.md): the authoring cutover, the
   compiler spike and the opinionated WordPress setup start in parallel.
