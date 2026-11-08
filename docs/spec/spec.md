# Zero: the complete authoring surface

Canonical spec, 2026-11-08, third revision. Rendering, interactivity and
caching are in [rendering.md](rendering.md). External frontends are in
[external-frontends.md](external-frontends.md). The compiler spike is in
[tsx-to-php.md](tsx-to-php.md). This is one cutover from Zero 0.8 and
from today's v2 API, with no aliases.

## 1. Layout

```text
my-project/                  # the project root: your app, if you have one
├── zero.config.ts           # always here; imports only from ./zero/** and npm packages
├── package.json
├── src/                     # e.g. Next.js, Astro, TanStack Start (optional; Zero never reads it)
└── zero/                    # the Zero root
    ├── schema.ts            # convention: data (§2). Any file name works (§1.1)
    ├── server/              # convention: actions and jobs (§4)
    ├── app/                 # pages and HTTP routes (rendering.md)
    ├── components/          # imported by app/; "use client" files are interactive
    ├── wp-hooks/            # WordPress actions/filters, one per hook name
    ├── content/             # markdown/JSON synced into kinds
    ├── public/              # static files, served as-is
    ├── _generated/          # written by Zero, committed: db.d.ts, routes.d.ts, client, schema ledger, plugins.lock.json
    └── dist/                # written by `zero build`, gitignored: the deployable output (§7)
```

- `zero dev`, `zero build` and `sf publish` start from the directory that holds
  `zero.config.ts`. The Zero root is always `./zero`.
- `zero.config.ts` resolves relative imports only inside `./zero/`. Anything
  else, such as `../src/lib/x`, is build error `Z1210`. Package imports
  (`"zero"`, Zero plugin packages) are allowed. That exception is my call;
  the rule otherwise couldn't load `defineConfig`.
- Code in `zero/` imports nothing from outside `zero/` except npm packages.
  The app may import `zero/_generated/client`.

### 1.1 No required file names

Zero loads `zero.config.ts` and every `.ts` file under `zero/`, except the
folders that have their own meaning (`app/`, `components/`, `wp-hooks/`,
`content/`, `public/`, `_generated/`, `dist/`). Every exported kind, action and
job in those files is registered under its export name. File names and folders
are up to you:

- **One file:** a whole backend can live in `zero/index.ts`, with kinds,
  hooks, actions and jobs side by side.
- **The convention** `zero init` writes and the docs use: `schema.ts` for
  kinds and `server/*.ts` for actions and jobs. When a project grows, split
  `schema.ts` into `schema/*.ts`.
- **Moving code never changes the API.** Names come from exports, not paths,
  so moving `like` from `index.ts` to `server/posts.ts` keeps
  `zero.like()`, its endpoint and its Ability.
- Export names are unique across the app: two exports named `like`, or an
  action named like a kind, fail the build (`Z1221`) and name both files.
  Rename one, or set `action({ name: "posts.like" }, …)`.
- An export that isn't a kind, action or job is ignored, so helper modules need
  no special place.
- `app/`, `components/`, `wp-hooks/`, `content/` and `public/` are the only
  folders whose names Zero reads.

```ts
// zero/index.ts: a complete app in one file
import { wp, table, ref, action, job } from "zero";

export const posts = wp.posts.extend({}, { url: "/blog/:slug", comments: true });
export const likes = table({ post: ref(posts).onDelete("cascade") }, { access: { create: "subscriber", read: "anyone" } });

export const like = action({ access: "subscriber" }, async ({ post }: { post: number }) => {
  await likes.create({ post });
  return likes.count({ where: { post } });
});

export const digest = job(async () => { /* … */ }, { every: "1d" });
```

## 2. Schema

### 2.1 WordPress kinds are built in

Every Zero site has these kinds without declaring anything. They are the real
WordPress objects, so the theme, plugins, wp-admin, REST and Zero all see the
same rows.

| Kind | WordPress | Always-present fields |
|---|---|---|
| `users` | `wp_users` + usermeta + Zero Identity | `id`, `email`, `name`, `username`, `roles`, `avatar`, `url`, `locale`, `createdAt` |
| `comments` | `wp_comments` + comment meta | `id`, `on` (the item), `parent`, `author` (user or null), `authorName`, `authorEmail`, `content`, `status`, `type`, `createdAt` |
| `posts` | core `post` type | collection fields (§2.3) + `categories`, `tags`, `excerpt`, `featuredImage`, `sticky` |
| `pages` | core `page` type | collection fields + `parent`, `order`, `template` |
| `media` | attachments | `id`, `url`, `alt`, `caption`, `mime`, `width`, `height`, `sizes`, `author`, `createdAt` |
| `categories`, `tags` | core taxonomies | taxonomy fields (§2.3) |
| `menus` | nav menus + `wp_navigation` | `location`, `items` (`label`, `url`, `item`, `children`) |
| `settings` | core options | `title`, `tagline`, `timezone`, `locale`, `icon`, `logo`, `frontPage` |

Every kind, built-in or yours, is imported from one place:
`import { posts, users, comments } from "zero:db"`. The types live in
`_generated/db.d.ts`. Inside `schema.ts`, the base built-ins are on `wp`:

```ts
import { wp, collection, table, taxonomy, text, select, integer, ref, media } from "zero";

// Extend a built-in by exporting its name. Fields become meta; options compile to WordPress settings.
export const users = wp.users.extend({
  plan: select(["free", "pro"]).default("free"),
  bio: text({ multiline: true }).optional(),
}, {
  signIn: ["email", "passkey", "google"],        // Zero Identity methods; Spacefast Access adds its own on Spacefast
  guests: true,                                  // anonymous visitors get a guest user on first write
  roles: { member: "subscriber", moderator: { from: "author", can: ["moderateComments"] } },
});

export const comments = wp.comments.extend({
  rating: integer().min(1).max(5).optional(),
});

export const posts = wp.posts.extend({
  cover: media({ accept: "image" }).optional(),
  byline: ref(authors).optional(),
}, { url: "/blog/:year/:slug", comments: { guests: true, moderation: "first-time" } });

// New kinds for what WordPress doesn't have.
export const authors = collection({ name: text().max(80), avatar: media().optional() }, { url: "/authors/:slug" });
export const topics = taxonomy({ color: text().optional() }, { hierarchical: true, url: "/topics/:slug", on: [posts] });
export const reviews = wp.comments.type("review", { rating: integer().min(1).max(5) }, { on: [products] });
export const likes = table({ post: ref(posts).onDelete("cascade") }).index(["post", "author"], { unique: true });
```

An export named after a built-in must be that built-in's `.extend()`. Anything
else fails the build (`Z1220`), so there is never a second users table or a
`zero_posts` beside core `post`.

### 2.2 Users

- **One identity.** `users` is WordPress's own users table, so wp-admin,
  plugins, Zero Identity, Spacefast Access and the typed client all share one
  `id`. There are no projections and no copies.
- **Sign-in** (`signIn`): methods are `email` (code), `password`, `passkey`,
  `google`, and any OIDC provider (`{ oidc: { issuer, clientId: env(…) } }`).
  `mfa: "off" | "optional" | "admins" | "required"` (default `"admins"`).
  On Spacefast, Spacefast Access adds Sign in with Spacefast and WordPress.com.
  It is additive and needs no config.
- **Guests** (`guests: true`): the first rejected write creates a guest user.
  Signing in later upgrades that same user id in place (Zero Identity's
  behavior), so nothing has to move.
- **Roles**: the core ladder is `subscriber < contributor < author < editor < admin`.
  `roles` adds custom roles (`add_role`), each built from an existing one,
  optionally with extra capabilities. Every access rule accepts these names.
- **Organizations** (`organizations: true`): exposes Zero Identity
  organizations as the `orgs` kind (`name`, `members`, member `role`). Any kind
  can declare `org: ref(orgs)`, and the `"org"` access value then means "rows
  in an org I belong to".
- **Who owns a row:** every kind with rows has an implicit `author` (a user
  ref) set to the caller on create, and editors can change it. On posts and
  pages it is `post_author`, on comments `user_id`, and on tables a column.
  The `"author"` access value means "rows I authored". This replaces
  `owner()`, `userId()` and hand-written ownership checks.
- **Reads and writes:** `users.me()`, `users.get(id)`, `users.list(...)` (editors and up),
  `users.update("me", { bio })`. `email` is readable only by the user and admins.
  Identity operations (sessions, passkeys, MFA, emails, export, delete) are in
  the client: `zero.auth.*`.

### 2.3 Comments

- **On by kind:** `comments: true | { guests?, moderation?, threaded?, closeAfterDays?, types? }`
  on any collection or built-in post kind. Defaults: signed-in users only,
  `moderation: "first-time"`, threaded to depth 3, never closed.
  This compiles to post type `comments` support plus per-type discussion
  settings, which Zero enforces in its write path.
- **One kind for all threads:** `comments` covers every commentable kind. `on`
  is the item and `parent` the reply. Filter with `comments.list({ where: { on: post.id, status: "approved" } })`.
- **Comment types** for other threaded data: `wp.comments.type("review", fields, { on, access })`
  is a separate kind stored as `comment_type = "review"` with meta fields. It
  appears in wp-admin under its own screen and is excluded from normal comment counts.
- **Moderation and spam:** statuses `pending`, `approved`, `spam` and `trash`.
  Akismet is always installed (§6) and checks every create. Editors and
  users with the `moderateComments` capability change status.
- **Access defaults:** anyone reads `approved`; the comment's author also sees
  their own `pending`; create follows the item's `comments` options, and the
  item must be readable and open; update/delete by the author within 15 minutes or `moderateComments`.
- **Rendering:** `<Comments for={item} />` from `zero/app` renders the thread and an
  interactive form (rendering.md). In WordPress-rendered mode, the core
  comment blocks work unchanged.

### 2.4 Your kinds

| Builder | Stores | Default access |
|---|---|---|
| `collection(fields, opts?)` | custom post type: block editor, revisions, statuses | anyone reads published; `author`+ creates; author or `editor` updates/deletes |
| `table(fields, opts?)` | SQL table | `editor` for everything; add `access: { create: "subscriber", read: "author", write: "author" }` for user-owned rows |
| `taxonomy(fields?, opts)` | taxonomy + term meta, attached to kinds in `on` | anyone reads; `editor` writes |
| `global(fields, opts?)` | `register_setting` group | anyone reads; `admin` writes |
| `files(opts)` | private file bucket | the uploader and `editor` read |

Fields every kind gets:

| Kind | Fields |
|---|---|
| every kind with rows | `id`, `author`, `createdAt`, `updatedAt` |
| collection, `posts`, `pages` | `slug`, `status` (`draft`, `pending`, `scheduled`, `published`, `private`), `publishedAt`, `url`, `terms` (by taxonomy name) |
| taxonomy, `categories`, `tags` | `name`, `slug`, `description`, `parent` (hierarchical), `count`, `url` |

### 2.5 Fields

| Builder | Type |
|---|---|
| `text({ multiline? })` | `string` |
| `richText()` | `string` (block markup on post kinds) |
| `number()` / `integer()` | `number` |
| `boolean()` | `boolean` |
| `date()` / `timestamp()` | `string` (`YYYY-MM-DD` / ISO-8601 UTC) |
| `select(["a", "b"])` | `"a" \| "b"` |
| `email()` / `url()` | `string` |
| `json<T>()` | `T` |
| `media({ accept? })` | ref to `media` |
| `file(bucket)` | `FileRef` with a signed `url` |
| `ref(kind)` | target id; the row with `with` |
| `terms(taxonomy)` | the terms of that taxonomy (taxonomies also attach through their own `on`) |
| `group(fields)` / `repeater(fields)` / `blocks({ layout: fields })` | object / object[] / union |

- Fields are **required** unless `.optional()` or `.default(v)`. On post kinds, a
  draft may be incomplete; required fields are checked at publish.
- `.many()` makes a list (`select`, `media`, `file`, `ref`). A many-ref gets a
  join table that Zero owns.
- Constraints: `.unique()`, `.min()`, `.max()`, `.pattern()`, `.validate((v, ctx) => true | "message")`.
- `.access({ read?, write? })` hides or locks a field. A hidden field is absent
  from results and can't be filtered or sorted on.
- `.ui({ label, help, placeholder, width })` and `.showIf({ field: value })` affect the editor only.
- `.shared()` keeps one value across translations; other fields are per locale when `locales` is set.
- `.was("old")` declares a rename.
- `ref(x).onDelete("cascade" | "restrict" | "setNull")`: default `restrict` when required, `setNull` when optional.
- `.title()` and `.content()` override the inferred title and body. Otherwise
  the title is the `title` field or the first `text()`, and the body is the only
  `richText()`. If two fields qualify, the build fails and names both.

### 2.6 Kind options

| Option | Kinds | Default |
|---|---|---|
| `url` | post kinds, taxonomies | `posts` `/:slug`-style WordPress permalinks; `pages` `/:path`; your kinds none (§2.7) |
| `access` | all | the defaults above. Values: `"anyone"`, a role, `"author"`, `"org"`, a filter object, or `(ctx) => boolean \| filter` |
| `comments` | post kinds | `false` for your collections; `true` for `posts` (core default) |
| `search` | all with rows | text, richText and title fields |
| `hierarchical` | collections, taxonomies | `false` |
| `sync` | collections, tables | none; `"content/posts/*.md"` |
| `abilities` | all | tools for signed-in agents; `{ public: true }` for anonymous |
| `label`, `icon` | all | from the name |
| `storageName`, `was` | all with rows | snake_case name; rename |

### 2.7 URLs

`url` is one pattern, used both to parse incoming URLs and to build outgoing
links, so the two never disagree. Placeholders: `:slug`, `:id`,
`:year`/`:month`/`:day`, any scalar field, a ref's slug (`:byline.slug`), the
first term (`:topics.slug`), and `:path` for hierarchical kinds.

- It compiles to rewrite rules, `post_type_link`/`term_link`, the `url` field,
  and an automatic 301 when the pattern or a slug changes.
- **Who renders it:** an `app/` route whose path matches the pattern renders
  with Zero. Without one, WordPress renders through the template hierarchy. So
  a URL alone gives WordPress rendering, and adding a page takes it over.

### 2.8 Hooks

```ts
.on({ beforeCreate(data, ctx) {}, afterCreate(row, ctx) {},
      beforeUpdate(patch, existing, ctx) {}, afterUpdate(row, previous, ctx) {},
      beforeDelete(row, ctx) {}, afterDelete(row, ctx) {},
      afterPublish(row, ctx) {} })                 // post kinds
```

- Works on built-ins too: `wp.users.extend(...).on({ afterCreate })`,
  `wp.comments.extend(...).on({ beforeCreate })`.
- A throw rolls back the request. `HttpError(status, code, message)` picks the response.
- Hooks may use kinds declared later in the file (checked with TypeScript 6.0.3 `--strict`).

### 2.9 Indexes and schema changes

- **Indexes** are inferred from refs, `.unique()`, `author`, and every
  `where`/`orderBy` key the compiler sees. Add compound ones with
  `.index(fields, { unique? })`. `zero check --json` lists each index and why it exists.
- **No migration files.** Zero generates the SQL and keeps a ledger in
  `_generated/`. Deploy checks each change against live data:
  - Additive changes apply.
  - A new required field on rows that lack it fails with the count and the fix.
  - Dropping a field or kind that holds data requires the count, e.g. `--drop likes=1204`.
  - Renames use `.was()`. Changes only go forward.

## 3. Queries: one API everywhere

The same calls work in hooks, server code, pages, client components and the
typed client, always as the current visitor:

```ts
await posts.list({ where: { categories: { slug: "news" } }, orderBy: { publishedAt: "desc" }, limit: 10, with: { byline: true } });
await posts.paginate({ where, limit: 20, cursor });          // { rows, cursor }
await posts.get(42);  await posts.get({ slug: "hello" });  await posts.count({ where });
await posts.list({ search: "zero" });
await comments.create({ on: post.id, content: "Nice", parent: 7 });
await users.me();  await settings.get();  await menus.get("primary");
```

- Access rules and field masks always apply.
- Jobs and signed webhooks run as the system.
- `posts.system.*` is the explicit trusted escape hatch.
- `"php/wordpress"` gives raw WordPress functions.

## 3a. HTTP: WordPress's own endpoints, no Zero namespace

Zero adds no `/wp-json/zero/v1` API. Each kind is served by the core REST
route WordPress already has for it. Zero's job is to make those routes enforce
Zero's rules, as `runtime/Zero/Wp/CoreAccess.php` already does for collections:
- access rules and field masks;
- required fields and validation;
- hooks.

The typed client, external frontends, agents, the block editor and other
plugins then all use one API.

| Kind | Endpoint | What Zero adds |
|---|---|---|
| `posts`, `pages`, your collections | `/wp/v2/posts`, `/wp/v2/pages`, `/wp/v2/<type>` (`show_in_rest`) | fields as `meta` (registered with `register_post_meta`, `show_in_rest`); access through `map_meta_cap` plus read filtering; `where`/`with`/`search` as query params |
| `media` | `/wp/v2/media` | access on private media |
| your taxonomies, `categories`, `tags` | `/wp/v2/<taxonomy>` | term meta |
| `comments`, comment types | `/wp/v2/comments` (`?type=review`) | the kind's `comments` options decide who may post. Anonymous posting goes through core's `rest_allow_anonymous_comments` filter, only for kinds with `guests: true`. Akismet runs on every create |
| `users` | `/wp/v2/users`, `/wp/v2/users/me` | extended fields as user meta; `email` stays hidden from everyone except the user and admins |
| `menus` | `/wp/v2/menu-items`, `/wp/v2/menu-locations` | public read for public locations (`rest_menu_read_access`) |
| `settings`, `global()` | `/wp/v2/settings` for admins | public fields readable through the read-only Ability below, since core gates the settings route on `manage_options` |
| `table()` | `/wp/v2/<table>` | **the one new controller**: core has no route for custom tables, so Zero registers a `WP_REST_Controller` under `wp/v2`, shaped like the post routes (`GET`/`POST` collection, `GET`/`POST`/`DELETE` item, `_links`, `X-WP-Total`) |
| `action()` | `/wp-abilities/v1/abilities/<app>/<name>/run` | Abilities API, core since 6.9 (below) |
| `app/**/route.ts` | your own path, outside `/wp-json` | front-controller route (rendering.md) |
| sign-in | `/wp-json/zero-identity/v1/*` (existing) and OIDC | |

**Actions are Abilities.** `export const like = action(...)` registers the
Ability `<app>/like`. Core's run route serves it: `GET` for actions marked
`readonly`, `POST` for writes, and `DELETE` for destructive, idempotent ones.
Input and output schemas come from the TypeScript signature. Access is the
Ability's `permission_callback`. MCP gets the same Ability through the MCP
Adapter. One mismatch to note: core's abilities list route needs a signed-in
user (`current_user_can('read')`), and the run route defers to the ability's
own permission check. A public action (`access: "anyone"`) can therefore run
anonymously, while discovering abilities still needs a sign-in. That's
acceptable, because the typed client knows the names at build time.

**The query vocabulary over HTTP:**
- `where`, `orderBy`, `with` and `search` are added as query parameters on the
  core list routes. Core's own parameters (`per_page`, `page`, `search`,
  `orderby`, `_embed`, `_fields`) keep working.
- Responses keep core's shape: `X-WP-Total` and `X-WP-TotalPages` headers, and `_links`.
- Errors are core's `WP_Error` JSON (`code`, `message`, `data.status`), not
  Zero's own problem documents.
- One shape for everything clients and plugins see.

**Markdown:** `?format=md` on any core item route returns the markdown twin.

**Spec for clients:** `zero pull` reads the core REST index (`/wp-json`, which
already describes every route's arguments and schema) plus the Abilities list.
No `/zero/v1/spec` route.

## 4. Server code

```ts
// zero/server/posts.ts (any file under zero/ works) → zero.feature(), notifySubscribers.enqueue(...)
import { action, job } from "zero";
import { posts } from "zero:db";

export const feature = action({ access: "editor" }, async ({ id }: { id: number }) => posts.update(id, { sticky: true }));
export const notifySubscribers = job(async ({ postId }: { postId: number }) => { /* … */ }, { retries: 3 });
export const digest = job(async () => { /* … */ }, { every: "1d" });     // or { cron: "0 3 * * *" }
```

- **`action`** takes its types from the handler signature. Options: `access`
  (default `editor`), `idempotent`, `readonly`, `signature`, `abilities`,
  `name`. Each action is an Ability `<app>/<name>`, run through core's
  `/wp-abilities/v1/abilities/<app>/<name>/run` (§3a), and a typed client method
  `zero.<name>()`. The name is the export name (§1.1). A `signature` action
  (an inbound webhook) is an `app/**/route.ts` instead, since its caller signs
  the raw body.
  It can also be called from a form (rendering.md).
- **`job`** runs on Action Scheduler after the request commits. A plain call
  becomes an async action. `every` compiles to a recurring action and `cron`
  to a cron action; both are unique and re-registered on
  `action_scheduler_ensure_recurring_actions`.
- Handlers get the globals `fetch`, `crypto`, `process.env`, `mail`, `once` and `HttpError`.

## 5. Front-end modes

| Setup | Public URLs |
|---|---|
| no `app/` (default) | WordPress renders with the block theme: post and term URLs, home, archives, search, comments |
| `app/` exists | Zero owns the front end. `app/` routes render; kind URLs without a page fall back to the theme template; everything else gets `app/not-found.tsx` |
| `frontend: false` | backend only: no public HTML |
| `frontend: "https://…"` | an external site renders (04). Front-end URLs, permalinks, previews and feeds point there |

In every mode, wp-admin, login, Zero sign-in, `/wp-json`, Action Scheduler,
media, the markdown versions of pages and `llms.txt` keep working.

## 6. Config and the opinionated WordPress

```ts
// zero.config.ts (project root)
import { defineConfig, env } from "zero";
import seo from "zero-plugin-seo";

export default defineConfig({
  name: "blog",
  frontend: undefined,
  plugins: { "woocommerce": "10.2.0" },
  use: [seo()],
  locales: { default: "en", all: ["en", "de"] },
  images: { sizes: { card: { width: 600, height: 400, fit: "cover" } } },
  uploads: { backend: "s3", bucket: env("UPLOAD_BUCKET") },
  webhooks: [{ url: env("FRONTEND_HOOK_URL"), secret: env("FRONTEND_HOOK_SECRET") }],
});
```

Zero's release pins the WordPress it runs on. Users cannot remove any of the following.

- **Always installed:**
  - Secure Custom Fields, Action Scheduler, MCP Adapter, Akismet;
  - Two Factor (enforced per `mfa`);
  - Zero's own plugins;
  - Polylang when `locales` is set.
- **Always disabled:**
  - XML-RPC, pingbacks and trackbacks, emoji scripts;
  - the file editors, and installing or updating plugins and themes from wp-admin;
  - core auto-updates;
  - the Customizer;
  - comments on kinds without `comments`;
  - the theme front end when `app/` or `frontend` takes over.
- **Always configured:** pretty permalinks, the Space's timezone, the object
  cache, Batcache and edge cache (rendering.md), and a block theme (Zero's
  minimal default when none is chosen).

## 7. Build output (`zero/dist/`)

`zero build` prebuilds everything that doesn't depend on the request:

| Output | At request time |
|---|---|
| Compiled PHP for kinds, hooks, actions, jobs and pages | OPcache'd files in the build store; no parsing or reflection |
| Route table, URL patterns, post types, taxonomies, field groups and roles as PHP arrays | Registered from arrays; no JSON or database reads |
| Pages with no request data, prerendered to HTML plus `.md` | Files served by the engine before WordPress boots |
| Interactive component stores, CSS and assets, content-hashed | Immutable files, cached for a year |
| `llms.txt` and the sitemap skeleton | Files |
| `_generated/db.d.ts`, `routes.d.ts`, `openapi.json`, `spec.json` | Used by clients only |

Client bundling uses Rolldown. It is Rust, built on the same OXC family as
Zero's parser, and powers Vite. That keeps the build free of Node, so it can
run on a box or in wasm. Check its crate API before depending on it.

## 8. Deleted from the current v2 API

- **`defineConfig` keys:** `collections`, `tables`, `users`, `relations`,
  `globals`, `hooks`, `actions`, `jobs` and `routes`.
- **Field builders and modifiers:** `defineRelations`, `userProjection`,
  `owner()`, `.notNull()`, `.references()`, `id()`, `$default`, `$onUpdate`,
  `$type` outside `json`, `real()`.
- **Collection options:** `label`, `title` and `content`.
- **Server and client APIs:**
  - `jobs.x.enqueue`;
  - `db.query`, `db.insert`, `db.update` and `db.delete`;
  - review of `zero/migrations/*.sql`;
  - the generated `zero/client/` source.
- **Pages:** the `zero_<name>` post types for kinds WordPress already has,
  `@spacefast/zero-pages`, `zero/pages.json`, `load()`, `<Show>`, `orElse()`,
  `count()`, `collectionPage()` and `<Island>`.

## 9. Zero 0.8 and Lakebed → this

| 0.8 | Now |
|---|---|
| `table({...})` inside `capsule({ schema })` | `export const x = table({...})` |
| `string()`, `number()`, `boolean()` | `text()`, `number()`, `boolean()` |
| `id("tasks")` | `ref(tasks)` |
| `userId()` and owner filters | the implicit `author` and `access: "author"` |
| `.optional()`, `.default()` | unchanged |
| `.index("by_x", [...])` | inferred, or `.index([...])` |
| `query` / `mutation` | `action`, or direct `x.list` / `x.create` under access rules |
| `endpoint({ method, path })` | `app/**/route.ts` |
| `ctx.db.x.withIndex(...).collect()` | `x.list({ where })` |
| `ctx.auth.requireIdentity()` | `access: "subscriber"`, or a guest-enabled rule, plus `ctx.user` |
| `auth.onGuestUpgrade` | not needed: the upgrade keeps the user id |
| `ctx.invalidate(...)` | automatic (change notices) |
