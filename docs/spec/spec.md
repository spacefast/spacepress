# First: the complete authoring surface

Canonical spec, 2026-11-08, third revision. Rendering, interactivity and
caching are in [rendering.md](rendering.md). External frontends are in
[external-frontends.md](external-frontends.md). The compiler spike is in
[tsx-to-php.md](tsx-to-php.md). This is one cutover from Zero 0.8 and
from today's v2 API, with no aliases.

## 1. Layout

```text
my-project/                  # the project root: your app, if you have one
├── first.config.ts           # always here; imports only from ./first/** and npm packages
├── package.json
├── src/                     # e.g. Next.js, Astro, TanStack Start (optional; First never reads it)
└── first/                    # the First root
    ├── schema.ts            # convention: data (§2). Any file name works (§1.1)
    ├── server/              # convention: actions and jobs (§4)
    ├── app/                 # pages and HTTP routes (rendering.md)
    ├── components/          # imported by app/; "use client" files are interactive
    ├── wp-hooks/            # WordPress actions/filters, one per hook name
    ├── content/             # markdown/JSON synced into kinds
    ├── public/              # static files, served as-is
    ├── _generated/          # written by First, committed: db.d.ts, routes.d.ts, client, schema ledger, plugins.lock.json
    └── dist/                # written by `first build`, gitignored: the deployable output (§7)
```

- `first dev`, `first build` and `sf publish` start from the directory that holds
  `first.config.ts`. The First root is always `./first`.
- `first.config.ts` resolves relative imports only inside `./first/`. Anything
  else, such as `../src/lib/x`, is build error `F1210`. Package imports
  (`"first"`, First plugin packages) are allowed. That exception is my call;
  the rule otherwise couldn't load `defineConfig`.
- Code in `first/` imports nothing from outside `first/` except npm packages.
  The app may import `first/_generated/client`.

### 1.1 No required file names

First loads `first.config.ts` and every `.ts` file under `first/`, except the
folders that have their own meaning (`app/`, `components/`, `wp-hooks/`,
`content/`, `public/`, `_generated/`, `dist/`). Every exported kind, action and
job in those files is registered under its export name. File names and folders
are up to you:

- **One file:** a whole backend can live in `first/index.ts`, with kinds,
  hooks, actions and jobs side by side.
- **The convention** `first init` writes and the docs use: `schema.ts` for
  kinds and `server/*.ts` for actions and jobs. When a project grows, split
  `schema.ts` into `schema/*.ts`.
- **Moving code never changes the API.** Names come from exports, not paths,
  so moving `like` from `index.ts` to `server/posts.ts` keeps
  `first.like()`, its endpoint and its Ability.
- Export names are unique across the app: two exports named `like`, or an
  action named like a kind, fail the build (`F1221`) and name both files.
  Rename one, or set `action({ name: "posts.like" }, …)`.
- An export that isn't a kind, action or job is ignored, so helper modules need
  no special place.
- `app/`, `components/`, `wp-hooks/`, `content/` and `public/` are the only
  folders whose names First reads.

```ts
// first/index.ts: a complete app in one file
import { wp, table, ref, action, job } from "first";

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

Every First site has these kinds without declaring anything. They are the real
WordPress objects, so the theme, plugins, wp-admin, REST and First all see the
same rows.

| Kind | WordPress | Always-present fields |
|---|---|---|
| `users` | `wp_users` + usermeta + First Identity | `id`, `email`, `name`, `username`, `roles`, `avatar`, `url`, `locale`, `createdAt` |
| `comments` | `wp_comments` + comment meta | `id`, `on` (the item), `parent`, `author` (user or null), `authorName`, `authorEmail`, `content`, `status`, `type`, `createdAt` |
| `posts` | core `post` type | collection fields (§2.3) + `categories`, `tags`, `excerpt`, `featuredImage`, `sticky` |
| `pages` | core `page` type | collection fields + `parent`, `order`, `template` |
| `media` | attachments | `id`, `url`, `alt`, `caption`, `mime`, `width`, `height`, `sizes`, `author`, `createdAt` |
| `categories`, `tags` | core taxonomies | taxonomy fields (§2.3) |
| `menus` | nav menus + `wp_navigation` | `location`, `items` (`label`, `url`, `item`, `children`) |
| `settings` | core options | `title`, `tagline`, `timezone`, `locale`, `icon`, `logo`, `frontPage` |

Every kind, built-in or yours, is imported from one place:
`import { posts, users, comments } from "first:db"`. The types live in
`_generated/db.d.ts`. Inside `schema.ts`, the base built-ins are on `wp`:

```ts
import { wp, collection, table, taxonomy, text, select, integer, ref, media } from "first";

// Extend a built-in by exporting its name. Fields become meta; options compile to WordPress settings.
export const users = wp.users.extend({
  plan: select(["free", "pro"]).default("free"),
  bio: text({ multiline: true }).optional(),
}, {
  signIn: ["email", "passkey", "google"],        // First Identity methods; Spacefast Access adds its own on Spacefast
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
else fails the build (`F1220`), so there is never a second users table or a
`first_posts` beside core `post`.

### 2.2 Users

- **One identity.** `users` is WordPress's own users table, so wp-admin,
  plugins, First Identity, Spacefast Access and the typed client all share one
  `id`. There are no projections and no copies.
- **Sign-in** (`signIn`): methods are `email` (code), `password`, `passkey`,
  `google`, and any OIDC provider (`{ oidc: { issuer, clientId: env(…) } }`).
  `mfa: "off" | "optional" | "admins" | "required"` (default `"admins"`).
  On Spacefast, Spacefast Access adds Sign in with Spacefast and WordPress.com.
  It is additive and needs no config.
- **Guests** (`guests: true`): the first rejected write creates a guest user.
  Signing in later upgrades that same user id in place (First Identity's
  behavior), so nothing has to move.
- **Roles**: the core ladder is `subscriber < contributor < author < editor < admin`.
  `roles` adds custom roles (`add_role`), each built from an existing one,
  optionally with extra capabilities. Every access rule accepts these names.
- **Organizations** (`organizations: true`): exposes First Identity
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
  the client: `first.auth.*`.

### 2.3 Comments

- **On by kind:** `comments: true | { guests?, moderation?, threaded?, closeAfterDays?, types? }`
  on any collection or built-in post kind. Defaults: signed-in users only,
  `moderation: "first-time"`, threaded to depth 3, never closed.
  This compiles to post type `comments` support plus per-type discussion
  settings, which First enforces in its write path.
- **One kind for all threads:** `comments` covers every commentable kind. `on`
  is the item and `parent` the reply. Filter with `comments.list({ where: { on: post.id, status: "approved" } })`.
- **Comment types** for other threaded data: `wp.comments.type("review", fields, { on, access })`
  is a separate kind stored as `comment_type = "review"` with meta fields. It
  appears in wp-admin under its own screen and is excluded from normal comment counts.
- **Moderation and spam:** statuses `pending`, `approved`, `spam` and `trash`.
  Akismet checks every create when the site has Akismet through Jetpack;
  otherwise spam checks are off (§6). Editors and
  users with the `moderateComments` capability change status.
- **Access defaults:** anyone reads `approved`; the comment's author also sees
  their own `pending`; create follows the item's `comments` options, and the
  item must be readable and open; update/delete by the author within 15 minutes or `moderateComments`.
- **Rendering:** `<Comments for={item} />` from `first/app` renders the thread and an
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

Storage is chosen only by the builder. `collection()` is always WordPress
posts and `table()` is always a SQL table; no option moves a kind from one to
the other. A new project has content only, and `first add db` adds example
tables, a note on migrations and typed client calls.

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
  join table that First owns.
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

- It compiles to rewrite rules, the core link filters for that kind, the `url` field,
  and an automatic 301 when the pattern or a slug changes.
- The link filters per kind, because core applies a different one to each
  (`wp-includes/link-template.php`):
  - `wp.posts`: `post_link`;
  - `wp.pages`: `page_link` and `_get_page_link`;
  - attachments: `attachment_link`;
  - your collections: `post_type_link`;
  - taxonomies, `categories` and `tags`: `term_link`.

  `item.url`, canonical URLs, feeds, sitemaps and every WordPress-generated
  link all come from these filters, so they follow the pattern.
- **Who renders it:** an `app/` route whose path matches the pattern renders
  with First. Without one, WordPress renders through the template hierarchy. So
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
  `.index(fields, { unique? })`. `first check --json` lists each index and why it exists.
- **No migration files.** First generates the SQL and keeps a ledger in
  `_generated/`. Deploy checks each change against live data:
  - Additive changes apply.
  - A new required field on rows that lack it fails with the count and the fix.
  - Dropping a field or kind that holds data requires the count, e.g. `--drop=likes=1204`.
  - Renames use `.was()`. Changes only go forward.

## 3. Queries: one API everywhere

The same calls work in hooks, server code, pages, client components and the
typed client, always as the current visitor:

```ts
await posts.list({ where: { categories: { slug: "news" } }, orderBy: { publishedAt: "desc" }, limit: 10, with: { byline: true } });
await posts.paginate({ where, limit: 20, cursor });          // { rows, cursor }
await posts.get(42);  await posts.get({ slug: "hello" });  await posts.count({ where });
await posts.list({ search: "first" });
await comments.create({ on: post.id, content: "Nice", parent: 7 });
await users.me();  await settings.get();  await menus.get("primary");
```

- Access rules and field masks always apply.
- Jobs and signed webhooks run as the system.
- `posts.system.*` is the explicit trusted escape hatch.
- `"php/wordpress"` gives raw WordPress functions.

## 3a. HTTP: core routes underneath, one clean facade on top

**One implementation.** Each kind is served by the core REST route WordPress
already has (`/wp/v2/posts`, `/wp/v2/comments`, `/wp/v2/users`, ...). First
makes those routes enforce First's rules, as `runtime/First/Wp/CoreAccess.php`
already does for collections:
- access rules and field masks;
- validation;
- hooks.

The block editor, wp-admin and other plugins keep working against them unchanged.

**One clean shape: `/__first/api/v1`.** It's a thin facade: every request is
dispatched internally to the core route with `rest_do_request()`, and only the
input and output are mapped. There is no second permission check, no second
query path and no second write path, so the facade can't disagree with core.
It exists because core's shapes are awkward for clients and agents:
`title.rendered`, fields under `meta`, `hold` for pending, `POST` for updates,
pagination in headers.

| Facade | Dispatched to | Mapping |
|---|---|---|
| `GET /__first/api/v1/posts?where=…&with=…&limit=…&cursor=…` | `GET /wp/v2/posts` | First rows (`title`, `body`, fields flat, `status: "pending"`), `{ data, cursor }` |
| `GET /__first/api/v1/posts/42` (`/posts/slug:hello`) | `GET /wp/v2/posts/42` | one row; `?format=md` gives markdown |
| `POST /__first/api/v1/posts`, `PATCH …/42`, `DELETE …/42` | `POST /wp/v2/posts[/42]`, `DELETE` | First input → core input (`meta`, `status`) |
| `/__first/api/v1/<kind>` for every kind (comments, users, media, your collections, taxonomies, tables) | the matching core route; tables use the one new `wp/v2/<table>` controller | same |
| `GET /__first/api/v1/me` | `GET /wp/v2/users/me` | the user row with extended fields |
| `GET/PATCH /__first/api/v1/settings`, `/__first/api/v1/<global>` | settings, or the read-only Ability for public fields | flat object |
| `POST /__first/api/v1/actions/<name>` (`GET` if `readonly`) | `/wp-abilities/v1/abilities/<app>/<name>/run` | `{ data }` |
| `GET /__first/api/v1` | `/wp-json` index + Abilities list | the app's schema: kinds, fields, actions (what `first pull` reads) |
| `GET /__first/api/v1/openapi.json` | the build's `_generated/openapi.json` (§7) | the API as an OpenAPI 3.1 document, with the site's address |

- **Errors:** RFC 9457 problem documents (`code`, `detail`, `pointer`), mapped
  from core's `WP_Error`.
- **Auth:** what core accepts: the cookie with `X-WP-Nonce`, application
  passwords, and First Identity bearer tokens.
- **Location:** the facade sits outside `/wp-json`, like `/__spacefast/`. It's
  served by First's front-controller route, before the theme loads, so it costs
  one internal REST dispatch.
- **Who uses which:**
  - the typed client, the framework adapters, `curl` and agents use the facade;
  - WordPress, plugins and the block editor use core routes.
  - Both are always on and always agree.
- `table()` still needs the one new core-shaped controller (`wp/v2/<table>`),
  because the facade only maps; it never stores.

**Actions are Abilities.** `export const like = action(...)` registers the
Ability `<app>/like`. Its input and output schemas come from the TypeScript
signature, and access is the Ability's `permission_callback`. Core's run route
and the MCP Adapter serve it as-is; the facade's `/actions/<name>` maps it.
Core's abilities list needs a sign-in. The run route uses the ability's own
check, so a public action runs anonymously.

**Markdown:** `?format=md` works on facade item routes and core item routes.

## 4. Server code

```ts
// first/server/posts.ts (any file under first/ works) → first.feature(), notifySubscribers.enqueue(...)
import { action, job } from "first";
import { posts } from "first:db";

export const feature = action({ access: "editor" }, async ({ id }: { id: number }) => posts.update(id, { sticky: true }));
export const notifySubscribers = job(async ({ postId }: { postId: number }) => { /* … */ }, { retries: 3 });
export const digest = job(async () => { /* … */ }, { every: "1d" });     // or { cron: "0 3 * * *" }
```

- **`action`** takes its types from the handler signature. Options: `access`
  (default `editor`), `idempotent`, `readonly`, `signature`, `abilities`,
  `name`. Each action is an Ability `<app>/<name>` (core's run route and MCP),
  `POST /__first/api/v1/actions/<name>` on the facade (§3a), and a typed client
  method `first.<name>()`. The name is the export name (§1.1). A `signature` action
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
| `app/` exists | First owns the front end. `app/` routes render; kind URLs without a page fall back to the theme template; everything else gets `app/not-found.tsx` |
| `frontend: false` | backend only: no public HTML |
| `frontend: "https://…"` | an external site renders (04). Front-end URLs, permalinks, previews and feeds point there |

In every mode, wp-admin, login, First sign-in, `/wp-json`, Action Scheduler,
media, the markdown versions of pages and `llms.txt` keep working.

## 6. Config and the opinionated WordPress

```ts
// first.config.ts (project root)
import { defineConfig, env } from "first";
import seo from "first-plugin-seo";

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

First's release pins the WordPress it runs on. Users cannot remove any of the following.

- **Always installed:**
  - Secure Custom Fields, Action Scheduler, MCP Adapter;
  - Two Factor (enforced per `mfa`);
  - First's own plugins;
  - Polylang when `locales` is set.
- **Always disabled:**
  - XML-RPC, pingbacks and trackbacks, emoji scripts;
  - the file editors, and installing or updating plugins and themes from wp-admin;
  - core auto-updates;
  - the Customizer;
  - comments on kinds without `comments`;
  - the theme front end when `app/` or `frontend` takes over.
- **Spam checks:** First uses the Akismet a site sets up through Jetpack. While it
  has a key (Jetpack's connection or `WPCOM_API_KEY`), Akismet checks every
  comment create. Without Akismet or a key, spam checks are off, the app
  still runs, and `first doctor` says so.
- **Always configured:** pretty permalinks, the Space's timezone, the object
  cache, Batcache and edge cache (rendering.md), and a block theme (First's
  minimal default when none is chosen).

## 7. Build output (`first/dist/`)

`first build` prebuilds everything that doesn't depend on the request:

| Output | At request time |
|---|---|
| Compiled PHP for kinds, hooks, actions, jobs and pages | OPcache'd files in the build store; no parsing or reflection |
| Route table, URL patterns, post types, taxonomies, field groups and roles as PHP arrays | Registered from arrays; no JSON or database reads |
| Pages with no request data, prerendered to HTML plus `.md` | Files served by the engine before WordPress boots |
| Interactive component stores, CSS and assets, content-hashed | Immutable files, cached for a year |
| `llms.txt` and the sitemap skeleton | Files |
| `_generated/db.d.ts`, `routes.d.ts`, `openapi.json`, `spec.json` | Used by clients; the site also serves `openapi.json` (§3a) |

Client bundling uses Rolldown. It is Rust, built on the same OXC family as
First's parser, and powers Vite. That keeps the build free of Node, so it can
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
  - review of `first/_generated/migrations/*.sql`;
  - the generated `first/client/` source.
- **Pages:** the `first_<name>` post types for kinds WordPress already has,
  `@spacefast/first-pages`, `first/pages.json`, `load()`, `<Show>`, `orElse()`,
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
