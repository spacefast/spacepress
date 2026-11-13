# first.config.ts API (v0)

`first build` reads `first.config.ts`, evaluates it at build time with First's own
Rust evaluator (no Node, no JS engine), and compiles hooks/actions to PHP.
Everything below is exported from the `"first"` module. Shapes follow Drizzle
ORM 1.0 (beta.22): column builders, relational-query `findMany`/`findFirst` with
object filters.

## Content and database

A First app has two halves. Each builder always stores in the same place, and
nothing else chooses storage: not a field, not an option.

| | Content | Database |
|---|---|---|
| Builders | `collection()`, `userProjection()`, `global()`, and the media library | `table()` |
| Stored as | WordPress's own objects: posts and post meta, users and user meta, attachments, options | one SQL table per kind, `wp_first_<name>` |
| Edited in | wp-admin and the WordPress editor; a collection has drafts and revisions | your app, through the API and the typed client (and the optional `admin: true` screens) |
| Other plugins | work on the same posts, users and media | don't know these tables |
| Field types | a collection's fields are post meta: text, cast to the field's type when read | typed columns (`BIGINT`, `DOUBLE`, `VARCHAR`, ...) |
| References | checked by First when it writes | a SQL foreign key between two tables; checked by First when the target is content |
| Filter or sort on a field | a collection: one join on `wp_postmeta` per field, and no index on the value | the column itself, with no join; indexed when it is `.unique()` or a `ref()` to another table (`first check --json` lists them) |
| Schema changes | no migration: a collection's fields are meta | a migration `first build` writes, checked against live rows at deploy |

Use a `collection()` for what people write and publish. Use a `table()` for
the data your app works on: rows it filters, sorts, counts or joins, rows with
no editor, and anything that needs a real foreign key or a unique column that
the database enforces. Both kinds share the field builders, access rules,
`ref()`, hooks, the API and the typed client, so one app can use both and a
table row can belong to a post.

A new project from `npm create @spacefast/first` is content only. `first add
db` adds the database half: an example `first/tables.ts`, typed client calls
for it and a note on migrations. It only creates files that are missing.

A collection can't be stored in a table. The earlier `editor: false` option is
gone and `collection()` refuses it at the option; write `table()` instead. A
site that deployed such a collection keeps its rows where they are: see
[Upgrading authoring](#upgrading-authoring).

| Read about | In |
|---|---|
| fields, options and access rules both halves share | [Columns](#columns), [Collections, tables and user projections](#collections-tables-and-user-projections) |
| the HTTP API, locales and sync, which work on both | [The `/__first/api/v1` API](#the-__firstapiv1-api), [Locales](#locales), [Sync](#sync) |
| globals, media and files, sign-in | [Content](#content) |
| relations, tables First didn't create, schema changes at deploy, transactions, queries | [Database](#database) |

## Project layout

`first.config.ts` sits at the project root. Your own modules live under `first/`
([spec §1](spec/spec.md#1-layout)):

```text
my-project/
├── first.config.ts     # imports only from ./first/** and npm packages
├── first/
│   ├── lib/fields.ts  # your modules, any names
│   ├── wp-hooks/      # WordPress actions and filters (see below)
│   ├── _generated/    # written by first build, committed
│   └── dist/          # written by first build, gitignored
```

A relative import from `first.config.ts` or from a module under `first/` must
resolve inside `first/`. Anything else, such as `import { x } from "./lib/x"`
at the root or `"../src/x"` from `first/`, fails with `F1210` and names the
file to move. Packages (`"first"`, `"php/wordpress"`, npm packages) are always
allowed, and an installed package's own relative imports are its business.

### Exports register by name

First loads every `.ts` file under `first/`, except `app/`, `components/`,
`wp-hooks/`, `content/`, `public/`, `_generated/` and `dist/`. Each exported
`collection()`, `table()`, `userProjection()`, `global()`, `action()` and
`job()` registers under its export name, so no file name is required and
`defineConfig` needs no registry for them:

```ts
// first/schema.ts
export const notes = table({ title: text() });

// first/server/likes.ts (any file name)
import { notes } from "first:db";
export const like = action({ input: { id: integer() }, async handler({ id }) { /* … */ } });
```

- Other exports are ignored, so helper modules need no special place.
- Export names are unique across the app. Two exports named `like`, an
  action named like an exported kind, or an export and a `defineConfig`
  registry entry under one name fail with `F1221`, naming both places.
- A kind, action or job must be a named export; `export default table(...)`
  is refused. Files named `*.test.ts` or `*.spec.ts` are left to your test
  runner.
- A value both exported and listed in a `defineConfig` registry is one
  registration.
- `import { notes } from "first:db"` gives a registered kind by name, from any
  module (including `first/wp-hooks/` files) and in any load order. It can't
  be re-exported, and plugin packages can't import it: a plugin takes the
  app's kinds as options. An unknown name is refused at the import with
  the closest one. Types come from `first/_generated/db.d.ts`.

### Querying a kind

A kind from `"first:db"` reads and writes as the visitor: the caller of the
action or route, or the reader of the page. Its access rules, draft
visibility and field masks apply, as on the API.

```ts
import { posts } from "first:db";

await posts.list({ where: { status: "published" }, orderBy: { publishedAt: "desc" }, limit: 10, with: { author: true } });
await posts.paginate({ limit: 20, cursor });   // { rows, cursor }; cursor is null on the last page
await posts.get(42);  await posts.get({ slug: "hello" });   // the row, or null
await posts.count({ where, search: "first" });
await posts.create({ title: "Hi" });  await posts.update(42, { title: "Hello" });  await posts.delete(42);
await posts.system.list();   // trusted: no access rules, every draft
```

- `search` finds the rows where every word of the text starts a word in the
  title, the content or a text field the visitor may read (`tea` finds
  "Teapots", not "steal"). It narrows the same read, so the rows, `count()` and
  the order are what the visitor gets without it, filtered: a draft, a row the
  read rule hides, or a word only in a field the visitor may not read is never
  found and never counted. It runs on a search index First keeps in step with
  every write ([decision](decisions/2026-11-13-search-index.md)).
- `paginate` takes `limit` (20 by default, at most 100) and the `cursor` the
  previous page returned.
- A kind the visitor may not read at all throws the API's 401 or 403. A row
  they can't read or change is `null` from `get`, and a 404 from `update` and
  `delete`.
- Jobs and signed webhooks have no visitor and run as the system.
  `<kind>.system.*` makes the same calls trusted anywhere.
- `db.query` and `db.insert/update/delete` stay trusted.

## WordPress plugins

Use a top-level package map in `defineConfig`:

```ts
plugins: { "classic-editor": "1.6.7" }
```

Values are exact WordPress.org versions or resource objects with `version`,
`pluginData`, optional `requires`, and a checksum (required for direct URLs).
See [plugin dependencies](wp-plugins.md) for resources, locks and assembly.

## Opinionated WordPress

While a First app is the active app, it runs WordPress the way spec.md §6
describes. The app plugin applies every switch below at runtime
(`runtime/First/Wp/Hardening.php`). Nothing is written to `wp-config.php`,
mu-plugins or the site's stored settings. Deactivate the app and WordPress
behaves as it ships again. A site with the runtime plugin but no active app
isn't changed either. None of these switches can be turned off in
`first.config.ts`.

| switch | effect |
|---|---|
| `xmlrpc` | `xmlrpc.php` answers 403 to every call, including `system.*` and `?rsd`; no EditURI link or `X-Pingback` header. One exception: while Jetpack's connection is loaded, its requests (`?for=jetpack`, on `xmlrpc.php` or Jetpack's `?jetpack=comms` endpoint) reach Jetpack's `jetpack.*` methods and nothing else, so a Jetpack connection (and the Akismet it sets up) keeps working. Jetpack's own `wp.getOptions` override isn't among them, and nothing of Jetpack's needs it: it serves core's password-based XML-RPC on plain `xmlrpc.php`, stock Jetpack already drops it from a signed `?for=jetpack` request, and connection checks, heartbeat and sync call only `jetpack.*` methods |
| `pings` | pingbacks and trackbacks closed in and out; outgoing pings never sent |
| `emoji` | no emoji detection script or styles on the front end, wp-admin or embeds; no emoji images in feeds or mail |
| `fileEditors` | the plugin and theme file editors are refused to everyone |
| `pluginAndThemeInstalls` | installing, uploading, updating and deleting plugins, themes and core are refused in wp-admin and REST; activation and translations stay |
| `autoUpdates` | no automatic core, plugin or theme updates |
| `customizer` | `customize` is refused, so `customize.php` and its links are gone |
| `comments` | comments closed on every post type except collections with `comments: true` |
| `authors` | the site's users aren't listed to the public: core's user routes, author archives, `?author=N`, the users sitemap and oEmbed's author fields (see [Authors](#authors)) |
| `schemaLock` | the app's schema is changed in `first.config.ts` and nowhere on the site (see [Schema lock](#schema-lock)) |
| `permalinks` | pretty permalinks (`/%postname%/`), with their rewrite rules kept apart from the site's own |
| `timezone` | the Space's timezone, when the host sets `FIRST_SITE_TIMEZONE` to an IANA name |
| `blockTheme` | a block theme always renders: the active theme while it's installed, otherwise First's minimal default (`first-default`) |

With `sealed: true` the only code that runs as a plugin is First's own plugins,
the platform pins, the `plugins` the config declares and `use` plugin packages:
other activations are refused and anything else loaded is reported. See
[sealed mode](sealed.md) for what that guarantees on a plain WordPress host and
on a host that mounts the build store.

`GET /__first/api/v1` lists the switches in `runtime.wp.hardening`. The object cache
is whatever the host's `object-cache.php` drop-in provides. A plugin can't
install a drop-in, so the host supplies it (on Spacefast, the box image does).

### Schema lock

`first.config.ts` in the project's repository is the only way to change what
First generates from it: its Secure Custom Fields field groups and options
pages, its post types, its registered meta, and its roles and capabilities.
First registers all of these in code on every request, so the site's database
holds no copy of them to edit. What a site could still do is store something
that takes their place or attaches to them. That is refused for every user,
administrators included, with a message that names `first.config.ts`:

```
Refused: the field list of first_notes belongs to the app's schema, which First
builds from first.config.ts. Change it there and deploy the app; it can't be
changed on the site.
```

| refused | where |
|---|---|
| a field group, field, post type, taxonomy or options page saved under one of First's names (`group_first_…`, `field_first_…`, a `first_…` post type or taxonomy, a global's options page), compared as WordPress stores the name: without letter case, accents or the characters it strips | SCF's screens in wp-admin, quick edit and duplicate, its import tool, its abilities over REST (`/wp-abilities/v1/…/run`) and MCP |
| a field group attached to a First kind's post type or a global's options page, at any depth of its fields; a taxonomy attached to a First kind | the same |
| one of First's options (a global's values) written from wp-admin's all-options screen (`options.php`) | wp-admin |

A wp-admin screen answers 403 with the message on a page. A REST call answers
403 with the code `first_schema_locked` and the same message. Over MCP the
refusal is the tool call's error result (`isError: true`) with the same message,
as the MCP Adapter reports every ability error.

These apply without a refusal screen, because the write that would carry them is
another plugin's or SCF's own, and stopping it whole would break more than it
protects:

- An SCF object already in the database that is First's (stored by WP-CLI, or
  while the app was inactive) is never loaded, so it can't register a post type
  or taxonomy over First's or change one of First's field groups. A field group
  stored in the database never applies to a First kind or a global's options
  page, whatever its location rules say.
- A value posted through a field First didn't register is not saved when it
  lands on a First kind's post, a global's options page, or the user meta and
  options First's own fields write. The rest of the save goes on.
- A write to WordPress's role definitions, from any plugin or from
  `options.php`, is saved without any change to a role First creates
  (`first_guest`) and without a capability of a First kind added to or taken
  from any role (`edit_others_first_notes`): the kind's access rules answer
  those capabilities for everyone. A write that isn't a set of roles at all
  keeps the roles as they are. The rest of the write stands, and the response
  carries a `First-Schema-Lock` header with the message; on a wp-admin settings
  screen it is also a settings notice.

First's meta is registered in code too. Its values are content, edited through
First's own validation on every route. Its keys are protected in every form the
database matches them by (letter case and accents), so wp-admin's Custom Fields
box can't add or change one.

Everything else stays open: content, media, users and their roles, settings,
other plugins' own settings and field groups, the site's own SCF field groups,
post types, taxonomies and options pages, and activating installed plugins. A
site's own object that is First's can still be moved to the trash or turned off.

WP-CLI is not refused. It is the operator's trusted channel, as it is for
`wp first insert`; what it stores that is First's is still never loaded. PHP
that runs on the site (another plugin, a theme's `functions.php`) can register
what it likes in code: the lock is about edits made on the site, not about code
that is deployed to it.

### Authors

WordPress ships with several ways for a visitor to enumerate a site's users,
each showing a login or the display name WordPress fills from it. While a First
app is active they are closed to visitors who aren't signed in:

| route | answer |
|---|---|
| `/wp/v2/users`, `/wp/v2/users/<id>`, the same through `?rest_route=`, `/batch/v1` or any letter case | 401 |
| a post's REST `_embed=author` | the embed holds that 401, not the user |
| `?author=<id>` (core redirects it to `/author/<login>/`), `?author_name=`, `/author/<login>/`, its feed and its `.md` twin | 404, no redirect |
| the users sitemap (`/wp-sitemap-users-1.xml`), and its entry in `/wp-sitemap.xml` | gone |
| a post's oEmbed `author_name` and `author_url` | the site's name and address, as core answers for a post with no author |
| `/__first/api/v1/users` | follows the core route (401) |

Signed-in users and credentials keep core's answers (the block editor's author
picker), and the users kind's read rule decides what First's API shows. A
scoped agent credential without `personal` sees what core shows anyone
([agents](agents.md)).

Authors are public, as WordPress ships them, when the app says so: either set

```ts
export default defineConfig({ publicAuthors: true });
```

or give the users kind a read rule that lets anyone read users
(`access: { read: "anyone" }`). `GET /__first/api/v1` reports which applies under
`runtime.wp.publicAuthors`.

A post's byline and its feed's `<dc:creator>` still show the author's display
name, which is what a site publishes on purpose. Set a display name that isn't
the login (WordPress's default) for users whose login should stay private.

## Mixed content and app data

```ts
import {
  collection, table, text, integer, ref, defineConfig,
} from "first";

// Native WordPress content with an editor and the integer id every kind has.
const posts = collection({ title: text() });
// App data in SQL, with a reference to the content.
const stock = table({
  post: ref(posts).optional().onDelete("cascade"),
  quantity: integer().default(0),
});

export default defineConfig({
  collections: { posts }, tables: { stock },
  hooks: { posts: { beforeCreate(data) { data.title = data.title.trim(); } } },
});
```

The generated client stays flat: `first.posts.create({ title: "Hello" })`,
`first.stock.create({ post: postId, quantity: 2 })`, then
`first.stock.list({ where: { post: { title: "Hello" } }, with: { post: true } })`,
and back the other way `first.posts.list({ with: { stock: true } })`.
See the [pantry](../examples/pantry/first.config.ts) for a table-only app and
[blog](../examples/blog/first.config.ts) for editorial content with related app data.

## Columns

The SQL column is the one a `table()` gets in the generated MySQL migration;
a `collection()` stores the same values
as post fields and meta.

Every kind has an integer `id` (BIGINT UNSIGNED AUTO_INCREMENT, the primary key);
an authored `id` field is refused.

Fields are **required** unless `.optional()`: a required field is NOT NULL and
must be given on create. `.default(value)` or `.defaultNow()` (timestamp/date)
makes it omittable on create; it stays NOT NULL. `.optional().default(value)` is
nullable with a default.

| builder | SQL | TS select type |
|---|---|---|
| `integer()` | BIGINT | `number` |
| `number()` | DOUBLE | `number` |
| `text()` | LONGTEXT (VARCHAR when unique or when `.max()` is 191 or less) | `string` |
| `select(["a", "b"])` | VARCHAR | `"a" \| "b"` |
| `select(["a", "b"]).many()` | LONGTEXT (JSON) | `("a" \| "b")[]` |
| `boolean()` | TINYINT(1) 0/1 | `boolean` |
| `timestamp()` | CHAR(24) (UTC ISO-8601 with ms); writes take epoch ms or ISO 8601 with `Z`/`±HH:MM` (a bare `YYYY-MM-DD` is UTC midnight) | `string` |
| `date()` | CHAR(10) `YYYY-MM-DD`, a real calendar day | `string` |
| `json<T>()` | LONGTEXT (JSON; an object keyed exactly `"0"`, `"1"`, ... reads back as a list, so a `.default()` can't contain one) | `T` (`unknown` without a type argument) |
| `text({ multiline: true })` | LONGTEXT | `string` (textarea in wp-admin) |
| `email()` / `url()` | VARCHAR or LONGTEXT as `text()`, validated | `string` |
| `slug({ source? })` | VARCHAR(200), unique, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, derived from `source` when omitted | `string` |
| `richText()` | LONGTEXT (HTML) | `string` |
| `media({ accept? })` | BIGINT media id | `number` (a media row with `with: { col: true }`) |
| `media().many()` | LONGTEXT (JSON ids) | `number[]` |
| `group({ ...fields })` | LONGTEXT (JSON) | `{ ...fields }` |
| `repeater({ ...fields })` | LONGTEXT (JSON) | `{ ...fields }[]` |
| `blocks({ a: { ...fields }, b: { ...fields } })` | LONGTEXT (JSON) | `({ layout: "a", ...a } \| { layout: "b", ...b })[]` |

Modifiers (each returns a new builder; builders are immutable so shared field
sets are safe): `.optional()`, `.default(value)` (a literal), `.defaultNow()`
(timestamp/date), `.$default(() => value)` / `.$defaultFn(...)` (runs in PHP on
insert), `.$onUpdate(() => value)` / `.$onUpdateFn(...)` (runs in PHP on
update; `() => new Date()` on a timestamp is recognized as "now"), `.many()`
(select and media), `.unique()`, `.onDelete("cascade" | "restrict" | "setNull")` and
`.reverse("name")` (on `ref()`, see [Relations](#relations)),
`.min(n)` / `.max(n)` (numbers: bounds; strings: length; lists: item count),
`.pattern(/re/)` (strings), `.validate((value, ctx) => true | "message")`
(compiled to PHP, runs on every write), `.was("old")` (a rename: the deploy
renames the stored column and keeps its values; see
[Schema changes at deploy](#schema-changes-at-deploy)).

The earlier forms are refused with a located error that names the replacement:
`.notNull()` (fields are required by default), `id()` and `.primaryKey()` (every
kind has an integer `id`; a text key is `code: text().unique().max(191)`),
`real()` (`number()`), `text({ enum })` and `select({ options })` (`select([...])`),
`multiple: true` (`.many()`), `{ fields }` and `{ layouts }` wrappers, and
`json().$type<T>()` (`json<T>()`), `.references()` and `defineRelations` (`ref(kind)`).

Phase-2 modifiers:

- `.access({ read?, create?, update? })`: who may see or write this field, with
  the same shorthands as collection access or `(ctx) => boolean` (`ctx` has
  `user`, `op`, `data`). A hidden field is absent from the row (not
  `null`), and filtering or ordering by it is refused (403). Omitted
  operations follow the collection. On WordPress it holds in wp-admin and
  core `/wp/v2` too (see [Access](#access)).
- `.ui({ label?, help?, placeholder?, width? })`: presentation metadata. Text
  properties are strings; width is an integer percentage from 1 to 100. A call
  replaces the whole UI descriptor, and returns a new builder. Native SCF uses
  label, plain-text help, width and placeholders on supported input controls;
  schema description preserves metadata for other consumers. It never changes
  stored field names, JSON pointers, validation or access. Nested fields support
  the same metadata. See the [SEO recipe](../examples/recipes/first/seo.ts).
- `.showIf({ sibling: value | { eq, ne, in, isNull, isNotNull } })`: editor
  visibility only, as SCF conditional logic on WordPress. Scalar siblings, ANDed,
  with a top-level `OR`. It never hides data from the API.
- `.localized()`: the field is translated per locale (text, richText, json,
  select, group, repeater, blocks). See [Locales](#locales).
- `file({ bucket })`: a column holding a private file's id. See [Files](#files).

Each modifier is checked against the column kind (design §1.2): `.max()` on a
boolean, `.pattern()` on a number, `.onDelete()` on text and so on fail the
build at the modifier. `.unique()` text needs `.max(≤191)` (MySQL index limit).
Sub-fields of `group`/`repeater`/`blocks` can't use `.unique()`,
`ref()`, `slug()`, `blocks()`, or `.$onUpdate()`, and nest at most 3 deep.

Column keys are the SQL column names.

## Collections, tables and user projections

`collection(fields, options?)` is editorial content: a WordPress custom post
type with the native editor, draft status and revisions. `table(fields,
options?)` is app/relational data in its own SQL table. Fields never choose
storage. Register each definition in its matching namespace:

```ts
const posts = collection({ title: text() });
const stock = table({ post: ref(posts).optional() });
export default defineConfig({ collections: { posts }, tables: { stock } });
```

Definitions need no exports. Backend-only config is sufficient; `first build`
emits `first/_generated/db.d.ts` to type `db.query` without importing authored definitions.
Every kind's primary key is the integer `id`.

The registry key is the logical name, used verbatim by `db.query`, hooks,
relations and the flat generated client (`first.shoppingList`). Physical names
and REST paths default to deterministic snake_case: `shoppingList` → `shopping_list`,
`HTTPLogs` → `http_logs`. A table uses `wp_first_shopping_list`; a collection
registers `first_shopping_list`. Duplicate logical or physical names across all
registries are rejected before artifacts are emitted. A definition may be
registered once.

| option | default | meaning |
|---|---|---|
| `storageName` | registry key in snake_case | explicit physical resource name without `wp_` / `first_` prefixes; retain existing storage on upgrade |
| `existingTable` | none | `table()` only; exact pre-existing SQL table name, with no added prefixes. The first migration checks columns and declared index/foreign-key names without creating or copying the table. |
| `was` | none | `table()` only; the name this table was stored under. The deploy renames it and keeps its rows. See [Schema changes at deploy](#schema-changes-at-deploy). |
| `label` | title-cased physical name | wp-admin menus, client docs |
| `drafts` | `true` for collections, `false` for tables | adds `status` and `publishedAt`; collections always have native drafts |
| `revisions` | `true` for collections, `false` for tables | collections always keep native revisions; tables may opt in |
| `comments` | `false` | collections only; WordPress comments on the post type. Comments are closed on every kind that doesn't set it ([opinionated WordPress](#opinionated-wordpress)) |
| `title` | a `title: text()` column | WordPress post title; must be a required `text()` for collections |
| `content` | a `content: richText()` column | WordPress post content |
| `access` | read `"anyone"`, writes `"editor"` | see below |
| `api` | all `true` | `{ list?, get?, create?, update?, delete? }` |
| `uid` | `false` (`true` with `sync`) | stable immutable `uid` on every row |
| `sync` | none | project-relative `*.md` or `*.json` pattern for `first sync` |
| `agents` | `true` | expose operations as WordPress abilities |
| `url` | none | collections only; the item URL, e.g. `"/blog/:slug"`. One pattern parses incoming URLs and builds links. The site's sitemap (`/wp-sitemap.xml`) lists the kind's items a signed-out visitor may read. It starts with a literal segment, not one WordPress or First serves (`wp-admin`, `wp-json`, `feed`, `category`, `page`, `__first`, ...). Placeholders: `:slug`, `:id`, `:year`/`:month`/`:day`/`:publishedAt`, a required field with no read rule, or `:field.slug` of a referenced collection anyone reads, each used once; it must contain `:slug` or `:id`. Two kinds' patterns can't match the same URL: `/blog/news/:slug` and `/blog/:topic/:id` both match `/blog/news/7` |

Collections need a title and physical names of at most 14 characters (WordPress
prefixes `first_`). Built-in route names are reserved (`media`, `files`,
`globals`, `actions`, `me`, `auth`, `services`, `search`). User projections retain
WordPress identity storage; see [Sign-in](#sign-in).

### Files that moved into `first/_generated/`

A checkout from before `first/_generated/` is refused until its committed
files move. Each refusal prints the `git mv` that fixes it.

| Before | Now | Left in place, it would be |
|---|---|---|
| `first/migrations/` | `first/_generated/migrations/` | read as a first build |
| `first/plugins.lock.json` | `first/_generated/plugins.lock.json` | ignored, and a new lock granting everything written |
| `first/wp-plugins.lock.json` | `first/_generated/wp-plugins.lock.json` | ignored, and its plugins resolved again |
| `first/abilities.json` | `first/_generated/abilities.json` | ignored, so its abilities are unknown |
| `first/client/` | `first/_generated/client/` | loaded as app code |
| `first.gen.ts` | `first/_generated/db.d.ts` | stale editor types |

A source bundle a host stored earlier is read on the new layout instead, and
is never refused.

### Upgrading authoring

Storage is chosen only by the builder: `collection()` is always WordPress
posts and `table()` is always a SQL table. A collection that asked for table
storage with `editor: false` is written as `table()`; `collection()` refuses
the option at its location. The rows of a site that deployed such a collection
stay in the table they are in. Bind the name as below and the change is a
rename of the declaration: `first build` writes no migration, so nothing is
moved or dropped.

Replace named builders with unnamed `collection()` or `table()` and register
under `collections` or `tables`. Keep the logical keys, existing physical storage
and committed migration snapshots. The snapshot format and runtime storage
model are unchanged: an authoring-only change must produce no migration.
For a persisted name that differs from the derived snake_case name, set
`storageName` to the exact name in `first/_generated/migrations/snapshot.json`. For example,
old `collection("stockItems", fields, { editor: false, revisions: true })`
becomes:

```ts
const stockItems = table(fields, { storageName: "stockItems", revisions: true });
export default defineConfig({ name: "my-app", tables: { stockItems } });
```

Keep the app `name`, logical keys, fields, relations, access and storage options
(including drafts, revisions, uid and sync) as before. Bind each resource whose
physical name differs, including reference targets. `storageName` accepts letters,
digits and underscores, starting with a letter; reserved names, duplicate logical
keys, duplicate physical names and collection post-type limits still apply.
The binding is permanent config, not a one-time rename instruction: retain it
on subsequent builds. It controls SQL tables, post types, routes and persisted
revision ownership; relations and client properties still use logical keys.

1. Keep the entire committed `first/_generated/migrations/` directory, including the v2
   `snapshot.json` and every numbered SQL file. Do not remove registrations as
   an intermediate step: that authors a destructive migration.
2. Change the builders/registries and add the physical bindings, then run
   `first build .`. This authoring-only transition must leave the snapshot and
   historical SQL unchanged and produce no new numbered SQL. Review with
   `git diff -- first/_generated/migrations` before deployment.
3. Deploy the generated `first/dist/wp-content` plugins together as an ordinary
   file-copy update to the existing site. The runtime keeps the app's migration
   ledger, rows, reference targets and revision identities; it has no data
   migration to apply. Verify existing reads, relations and revision history
   through the new client/runtime before making schema changes.

This also supports old logical aliases: use the original physical name as the
binding even if the registry key is different. Changing a binding does not move
or rename data. Snapshots contain physical names without old logical aliases.
A build that removes existing storage while adding new storage is refused as
an ambiguous replacement, even when both names are snake_case. Declare `was`
on the new table to rename it, or remove the old one in its own deploy.

### Access

`access: { read, create, update, delete }`, each one of `true`/`false`,
`"anyone"`, `"authenticated"` (signed in, guests included), a role (`"guest" <
"subscriber" < "author" < "editor" < "admin"`, that role or higher), `"self"`
(on a user projection: the signed-in user's own row), or
`(ctx) => boolean | filter` with `ctx = {
user, op, data? }`. Functions are compiled to PHP like hooks; they
can't use `db`. A returned filter is checked against the collection like any
literal filter and is ANDed into reads, updates and deletes; create rules
return a boolean. Actions take `access` too (default `"editor"`).

On WordPress these rules are the only gate, on every path into the data:
First's API, core `/wp/v2`, wp-admin (lists, the editor, quick edit,
revisions, autosaves, search) and abilities. A post type's capabilities
(`edit_first_posts`, `edit_others_first_posts`, ...) are answered from its rules
through `map_meta_cap`, and no role is granted them, so granting one by hand
changes nothing. Core reads apply the read rule and field access; core writes
and editor saves apply the create, update and field rules, and are authorized
on the saved data before they commit.

Core `/wp/v2/<post type>` speaks First's fields and queries too:

- Every field is registered post meta (`register_post_meta`, `show_in_rest`,
  with its JSON Schema) under its own name. `meta.seats` reads and writes the
  value as First does: a group or repeater is one value, a date is
  `YYYY-MM-DD`. Writes go through First's codec and rules, and a field hidden
  from the viewer is dropped from `meta` like everywhere else.
- List routes take First's query arguments next to core's own:
  `where` (JSON), `orderBy` (`-seats,title`), `with` (`author,comments` or
  JSON; each item gets the relations under `with`) and `search` (every text
  and richText field the viewer may read). They run as the viewer, so a filter
  or sort on a hidden field is the same 403 as on First's API. Core keeps
  pagination (`page`, `per_page`, `X-WP-Total`) and `_fields`.
- The users kind does the same on core `/wp/v2/users`: member fields are
  registered user meta under `meta`, shown only to a viewer whose read rule
  covers the member. A `meta` write runs First's update as the viewer (rules,
  validation, hooks) in one transaction with core's own user save, so a
  refusal keeps nothing. The list takes `where` and `orderBy`.
- A `table()` kind gets core-shaped `/wp/v2/<storage name>` (for example
  `/wp/v2/first_signups`): list, get, create, update (`POST`/`PUT`/`PATCH`) and
  delete, with `per_page`/`page`, `X-WP-Total`, `_fields`, a JSON Schema on
  `OPTIONS`, and `where`/`orderBy`/`with`. Every call is First's pipeline as
  the viewer, so it answers what First's API answers.

## The `/__first/api/v1` API

One clean HTTP shape for clients and agents, over the core routes above. Each
request is dispatched to the core route as the caller and only mapped, so it
answers exactly what core answers under First's rules.

| Request | Core route | Answer |
|---|---|---|
| `GET /__first/api/v1/<kind>?where=…&orderBy=…&with=…&search=…&limit=…&cursor=…` | `GET /wp/v2/<route>` | `{ data: rows, cursor }`; `cursor` is `null` on the last page |
| `GET /__first/api/v1/<kind>/<id>` (`/posts/slug:hello`) | `GET /wp/v2/<route>/<id>` | `{ data: row }`; `?format=md` answers `text/markdown` |
| `POST /__first/api/v1/<kind>`, `PATCH …/<id>`, `DELETE …/<id>` | `POST`, `POST`, `DELETE` | `{ data: row }` (201 on create) |
| `GET /__first/api/v1/me` | `GET /wp/v2/users/me` | `{ data: user }`, `null` when anonymous |
| `POST /__first/api/v1/actions/<name>` (`GET` with `?input=<json>` when `readonly`) | the action's Ability | `{ data }` |
| `GET /__first/api/v1/search?q=…[&kinds=a,b][&limit=n]` | | `{ data: { q, results: [{ kind, rows }] } }`: the same search on every kind, as the caller; a kind the caller may not read is left out |
| `GET /__first/api/v1` | | the app's kinds (with their core routes), fields, globals and actions |
| `GET /__first/api/v1/openapi.json` | | the API as an OpenAPI 3.1 document; public |

Rows are First rows: fields flat, `status` as `draft`, `pending`, `scheduled`,
`published` or `private`. Errors are RFC 9457 problem documents (`code`,
`detail`, `pointer`). Callers authenticate the way core accepts: the cookie
with `X-WP-Nonce`, an application password, or a First Identity bearer token.
The API is served before the theme loads; it never uses 0.8's `/__zero/config`,
`/__zero/run`, `/__zero/auth/*` or `/__zero/realtime/events`.

### The OpenAPI document

`first build` writes `first/_generated/openapi.json`: the app's API as an
OpenAPI 3.1 document. Commit it with the client. It comes from the same schema
as the typed client and the app's Abilities, so the three describe one field
one way:

- A kind has the components `Post`, `PostInsert`, `PostPatch` and `PostFilter`,
  named as the client's types are. The row, the create input and the patch are
  the JSON Schemas the kind's Abilities publish.
- Every operation the API serves is there: each kind's list, get, create,
  update and delete (less any its `api` flags switch off), revisions, `/me`,
  each global, each action (with `GET` when it is `readonly`), file buckets,
  sync, services, and WordPress's own `posts`, `pages`, `comments`, `media`,
  `categories`, `tags`, `menus` and `settings` where the app declares none of
  that name. An action with a `signature` is left out: it is a webhook for the
  one service that holds its secret, and `GET /__first/api/v1` leaves it out too.
- An operation's `operationId` names it by kind and operation (`posts.list`,
  `actions.greet`, `sync.notes.read`); where the typed client has a call for
  the request, it is that call's name. Its description says who may call it, and
  `x-first-access` carries the rule's short name (`anyone`, a role, `owner`,
  `self`, or `rule` for one written as a function). A field with its own
  access rule carries `x-first-access` too, and a field a caller may not read is
  absent from rows.
- Errors are the `Problem` component, served as `application/problem+json`.
  `securitySchemes` lists the three ways to sign in.

The running site serves the same document at
`GET /__first/api/v1/openapi.json`, with the site's own address in `servers`.
It needs no sign-in and is the same for everyone: it describes the app's kinds,
fields, globals and actions, as `GET /__first/api/v1` does, and never says who
may see which row.

```sh
curl https://example.test/__first/api/v1/openapi.json
```

## Locales

```ts
locales: { default: "en", all: ["en", "de"] },   // fallback: true by default
```

A collection with a `.localized()` field stores one row per locale. Every
other field is shared by a post's translations and kept equal across them,
except what each row generates for itself: `status`, `publishedAt`, `slug`,
`uid`, and columns filled by `defaultNow()`, `$default(...)` or `$onUpdate(...)`
(so `createdAt`/`updatedAt` are per translation). Each translation publishes
on its own. Create a translation with
`{ locale: "de", translationOf: <id> }`; rows carry `locale` and
`translations` (locale → id). Reads take `?locale=de`, which returns German
rows and, with `fallback`, the default-locale row of any group without one;
`locale=*` returns every row. On WordPress, Polylang owns languages and
translation groups, and the app plugin ships a `wpml-config.xml` saying which
fields translate.

## Sync

### A folder tree: a docs section

A hierarchical collection syncs a whole folder tree ([decision](decisions/2026-11-13-docs-kind.md)):

```ts
export const docs = collection(
  { title: text(), slug: slug({ source: "title" }), content: richText().optional() },
  { hierarchical: true, url: "/docs/:path", sync: "content/docs/**/*.md" },
);
```

```text
content/docs/
├── introduction.md        /docs/introduction
└── guides/
    ├── index.md           /docs/guides: the page the folder stands for
    ├── install.md         /docs/guides/install
    └── deploy/
        ├── index.md       /docs/guides/deploy
        └── space.md       /docs/guides/deploy/space
```

- `hierarchical: true` adds `parent` and `order`, stored as the post's own parent and menu order:
  the editor's page attributes edit them, and `:path` in the url is the parent chain.
- A file's name is its slug and its folder its parent; front matter never holds either. Put
  `order: 2` in front matter to sort; siblings with the same order sort by title.
- Slugs are unique in the kind, so two folders can't both hold an `install.md`.
- `first sync` moves a file when its page moves on the site, and turns a page that gains children
  into its folder's `index.md`.

A page reads the navigation from `"first/content"`, as the visitor:

```tsx
// first/app/docs/[...path]/page.tsx
import { docs } from "first:db";
import { Content, type PageProps } from "first/app";
import { nav, pager, headings } from "first/content";

export default async function Doc({ item }: PageProps<"docs/[...path]">) {
  const tree = await nav(docs, item);           // [{ id, title, href, current, open, children }]
  const { prev, next } = await pager(docs, item);
  const toc = headings(item);                   // [{ depth: 2 | 3, text, id }]
  return <article><h1>{item.title}</h1><Content value={item.content} /></article>;
}
```

The tree is the published items the visitor may read, siblings by order then title, four levels
deep. `headings()` gives the ids the page renders its headings with.

### Seeding and `first sync`

Every publish seeds synced files: missing records are created, trashed records stay deleted, and no records are removed.
Existing editable records keep their site content; the publish reports `first_seed_skipped_existing` for differing files, and `first sync` merges them.
For tables the file wins; files without a `uid` use a stable identity derived from the collection and basename, so republishes and later syncs match the same record.

```ts
{ sync: "content/posts/*.md" }
```

`first sync [--site <url>]`, with `FIRST_APP_PASSWORD=user:pass` (or `FIRST_TOKEN=<jwt>`) in the environment, keeps
`content/posts/<slug>.md` and the site in step: front matter for fields, the
body as Markdown for the `content` column. Both sides may change; it merges
per field, and writes `.first/conflicts/<uid>.md` when the same field changed on
both (`first sync resolve <uid>` applies your edit of it).
`--check` exits 2 when anything would change. The first sync with a site
matches records and deletes nothing. It commits the files it wrote unless
`--no-commit`. `first build` adds `.first/*` and `!.first/sync-base.json` to
`.gitignore`, because the sync base is committed.

What sync leaves out: `$onUpdate` columns, derived and hidden system columns,
and fields the viewer's field access hides. References to a `uid` collection are written as that
row's uid. When required references form a cycle that no order of writes can
satisfy, sync reports it and writes nothing.

## Content

Kinds stored as WordPress's own objects. A `collection()` is a custom post
type, a `userProjection()` is WordPress users, a `global()` is options, and
media is attachments. wp-admin, the editor, core `/wp/v2` and other plugins
all work on the same rows First does. The sections here are the content half;
[Collections, tables and user projections](#collections-tables-and-user-projections)
has the options a collection takes. Private file buckets are described here
beside media; their rows are First's own and their bytes are in the upload
backend.

### Globals

`global(name, fields, { label?, access?: { read?, update? } })`, registered in
`defineConfig({ globals: { name } })`. One record per global; fields use the
sub-field rules, and a required field needs a default. `GET`/`PATCH
/__first/api/v1/<name>`.

### Media and files

`media: { sizes: { card: { width: 600, height: 400, fit: "cover" } } }` makes
each named size for every uploaded image. `cover` crops around the image's
focal point (`PATCH /media/<id>` with `{ focal: { x, y } }`, editors only;
centre by default); `inside` scales to fit. Media rows carry
`sizes.<name>.url`.

<a id="files"></a>Private files live in logical file resources:

```ts
files: { decks: files("decks", { accept: ["application/pdf"], maxBytes: 20_000_000, access: { read: "owner", delete: "editor" } }) },
```

and a `file({ bucket: "decks" })` column holds one by id. Files never get a
public URL: `GET /files/<bucket>/<id>` returns the row with a signed `url`
valid for five minutes, and that link streams the bytes through PHP. `"owner"` means the uploader. Uploads outside
`accept` are refused (422 at `/file`); uploads over `maxBytes` get 413
`payload_too_large`.

Configure durable uploads once for the app:

```ts
uploads: {
  backend: "s3",
  bucket: env("UPLOAD_BUCKET"),
  region: "us-east-1",
  // endpoint: env("UPLOAD_ENDPOINT"), pathStyle: true, // compatible providers
  prefix: "my-app",
  credentials: {
    accessKeyId: env("UPLOAD_ACCESS_KEY_ID"),
    secretAccessKey: env("UPLOAD_SECRET_ACCESS_KEY"),
  },
},
```

This backend stores private files, media originals and generated sizes, including
standard WordPress editor uploads. `client.files.decks` and `file({ bucket: "decks" })`
keep naming the logical resource; `uploads.bucket` is the physical provider bucket.
Collections and tables can both reference files and media. Credentials resolve
only at runtime; the compiler requires `env()` references. An optional
`sessionToken: env("UPLOAD_SESSION_TOKEN")` supports temporary credentials.

`uploads: { backend: "local" }` selects the existing local development behavior
(also the default when omitted). S3 never falls back to durable local storage.
See [upload storage](uploads.md) for provider permissions, failure recovery,
existing-data cutover and the WordPress plugin boundary.

### Sign-in

Register one `userProjection(fields, options?)` under `users: { members }`.
It projects existing WordPress users and usermeta, preserving their IDs and
authentication; it creates no second user table or post type. It needs
`email: email().unique()`, gets a write-only `password` and an
admin-only `role`, and cannot have drafts, revisions, slugs or localization. Members sign in
through the typed client: `auth.signIn()` and `auth.handleCallback()` redirect
through the first-identity screens (register the frontend once with
`first identity app add --name=<name> --id=<app_id> --redirect=<url> --origin=<origin>`).
`GET /me` returns the user with their `member` row.

Anonymous visitors can write as guests (`createClient({ auth: { guests: true } })`):
the first rejected write starts a guest session, and `auth.upgrade()` keeps the
guest's rows when they sign up.

## Database

`table()` kinds: one SQL table each, with typed columns, foreign keys and
indexes. `first add db` writes a starting point into a project that has none.
[Collections, tables and user projections](#collections-tables-and-user-projections)
has the options a table takes, and [Columns](#columns) the SQL type of each
field.

Relations and the `db` query API below work on collections as well: a
content-only project uses them without `first add db`. They are here because
a relation between two tables is the one that becomes a SQL foreign key, and
`db` is how server code reads and writes rows.

### Relations

`ref(kind)` is a field holding the `id` of a row of another kind; `ref(() => kind)`
refers to one declared later or to itself. The field name is the stored column,
the relation name and the `with` key: `with: { post: true }` replaces the id with
the row under the same key, and `where: { post: { title: "Hello" } }` filters by
the target's fields (`where: { post: 7 }` still matches the id).

```ts
const authors = collection({ name: text() });
const posts = collection({
  title: text(),
  author: ref(authors),                                  // required: delete is restricted
  editor: ref(authors).optional().reverse("edited"),     // optional: delete sets null
});
```

The target gets a reverse many relation named after the referencing kind's key
(`first.authors.list({ with: { posts: true } })`), or `.reverse("name")` names it.
Two refs from one kind to the same target get no default reverse; both need
`.reverse()`, and the build error names them. A reverse named like a field of
the target is a build error. `.onDelete()` takes `"cascade"`, `"restrict"` or
`"setNull"`; the default is `"restrict"` on a required ref and `"setNull"` on an
optional one. `ref()` refers to `id` only: a kind that links by a natural key
stores the value as a plain field and queries by it.

One graph covers collection↔collection, table↔table and both directions across
storage kinds. Relation filters and `with` loads use the same runtime machinery
and target row/field access rules. Hidden target fields stay masked; relation
filters cannot probe them. Media and private file references work on both kinds.

### Tables First didn't create

An `existingTable` binding accepts an ASCII SQL identifier of at most 64 characters.
It is distinct from `storageName`, which still identifies the logical resource's
migration history. The binding is committed in the snapshot and cannot change
on later builds. Later column, index and foreign-key migrations use the exact
bound name. The existing columns must already have compatible storage; the first
check establishes column existence, not type equivalence. Adoption statements carry
`-- first-adopt` metadata that the WordPress migrator validates before recording the
step. Pending adoption checks run before any migration DDL or ledger writes.
Declared unique indexes, primary keys and foreign keys must already have the
compiler's names, columns, uniqueness and reference actions. Prefix-only unique
indexes are refused. Other existing indexes are retained and remain unmanaged.
This keeps later constraint removals consistent with the committed snapshot. Database
engine checks include these tables. Uninstall retains their rows like normal tables.
An [adopted application table](migrating-from-zero.md#application-source-migration)
keeps its TEXT/DOUBLE storage and string response IDs.

### Schema changes at deploy

`first check --json` lists each SQL index the deploy keeps, and why it exists,
under `indexes`: `{ table, name, unique, columns, reason }`. The reasons are
the primary key, `.unique()`, a reference (MySQL indexes a foreign key),
drafts (status and publish date) and locales (one row per locale in a
translation group). Post-backed kinds use WordPress's own indexes.

`first build` writes the SQL for each schema change to `first/_generated/migrations/`.
You don't edit or review it. The deploy (`wp first migrate`, the first request after
a file-copy update, or the host's initialization) checks every pending change against
the live rows before it runs any of them:

| Change | Result |
|---|---|
| New kind, new optional field, new field with `.default()`, new index | applies, nothing asked |
| A field becomes required with `.default(v)` | rows without a value get `v`, then it applies |
| A field becomes required, no default, and rows lack it | refused: `required_field_missing` with the count |
| A kind or field is removed and holds rows | refused: `drop_has_rows` with the count, until the deploy passes `--drop=name=rows` |
| A `table()` that holds rows is declared with `collection()` | refused: `drop_has_rows` with the count. Storage follows the builder, so the build plans the table's drop and moves no rows. To keep the rows, don't pass `--drop`: delete the new, undeployed migration file, restore `snapshot.json` from the last deployed build (`git checkout`), declare `table()` again and build; no migration is written. Building `table()` on top of the drop instead writes a second migration that recreates the table, and the drop before it is still refused |
| A `collection()` that holds posts is declared with `table()` | applies: the build creates an empty SQL table and warns. The posts stay in `wp_posts` and the app no longer reads them; nothing moves them |
| A field's type or length narrows (`.max(100)`, `.unique()`, text to integer, ...) and values wouldn't fit | refused: `value_does_not_fit` with the count; MySQL would truncate or convert them |
| `--drop=name=rows` doesn't match the live count | refused: `drop_count_mismatch` with the live count |
| A table the app didn't create (`existingTable`) loses, renames or retypes a field, or loses its kind | refused: `drop_adopted_table`, even when empty, until the deploy passes `--drop` |
| `.was("old")` on a `table()` field, `was: "old"` on a `table()` | renamed in place, rows kept |
| The database doesn't have a table or column the migrations expect | refused: `schema_out_of_step` |

A refusal changes nothing: no table, row or ledger entry. Every refusal in the
deploy is reported at once:

```sh
$ wp first migrate
{"error":{"status":409,"code":"schema_refused","refusals":[
  {"migration":"0006_update","code":"drop_has_rows","name":"likes","rows":1204,
   "message":"Dropping the kind likes would delete 1204 rows.",
   "fix":"Keep likes in the schema, rename it with .was() if it moved, or deploy with --drop=likes=1204 to delete them.",
   "table":"wp_first_likes","drop":"likes=1204"}],
 "drop":["likes=1204"]}}
$ wp first migrate --drop=likes=1204
```

`--drop` names a kind (`likes=1204`) or a field (`likes.emoji=17`, counting rows
that have a value, or for a narrowing the values that wouldn't fit), comma-separated,
after an equals sign (`--drop=…`). The count must match the live data, so a
confirmation can't delete rows that arrived after it was written. `drop` in the
refusal lists the arguments that accept today's counts. `first dev --allow-destructive`
passes them for you on the local site.

Several pending migrations are checked together, before any of them runs, under
the names each statement will see: a drop that follows a rename counts the rows
still under the old name. While a refusal stands, the site keeps serving WordPress,
First's routes answer 503, and wp-admin shows the refusal with its `wp first migrate
--drop=…` command; requests don't recount the rows until the build or the ledger
changes. A plugin activated into a refusal stays active, so the command can run.

Renames run once: after the deploy, `.was()` is inert and can stay or go. Only a
`table()`'s own fields take `.was()`: a collection's fields live in post meta,
and a field inside a group, repeater or blocks has no column of its own.

### Transactions

Tables and content share one database connection, so one transaction spans
table rows, posts and post meta.

- A request to the API, an action, an HTTP route, a job and an editor save
  of a collection each run in one transaction. A throw rolls back every write
  in it, to tables and to content alike.
- A job enqueued from a hook or an action runs after the request commits,
  never inside it.
- Handlers in `first/wp-hooks/` run wherever WordPress fires the hook. Outside
  a First write (a page view, cron, a save of a post type First doesn't own)
  there is no First transaction and each write commits on its own. When the
  hook fires during a First write, such as `save_post` while the API or the
  editor saves a collection, the handler's writes are in that transaction and
  roll back with it.

### Database API (hooks and actions only)

```ts
await db.query.items.findMany({ where, orderBy, limit, offset, columns, with });
await db.query.items.findFirst({ where, ... });
await db.insert(items).values(row | rows).returning?();
await db.update(items).set(patch).where(filter).returning?();
await db.delete(items).where(filter).returning?();
```

`where` is the Drizzle 1.0 object filter: `{ col: value }`, `{ col: { eq, ne,
gt, gte, lt, lte, in, notIn, like, ilike, notLike, notIlike, isNull,
isNotNull, OR, AND, NOT } }`, top-level `OR`/`AND`/`NOT`, relation keys
(`{ location: { kind: "fridge" } }` or `{ location: true }`). `orderBy` is
`{ col: "asc" | "desc" }`. Column, relation, and operator names in literal
filters are checked at build time.

List columns (`select([...]).many()`, `media().many()`) take `has`,
`isNull`/`isNotNull` and `eq: []`; JSON columns (`json`, `group`, `repeater`,
`blocks`) take `eq`/`ne` on the whole value and `isNull`/`isNotNull`, and
neither can be ordered by. On editor collections `group`/`repeater`/`blocks`
can't be compared at all (their WordPress meta is spread over many rows).
These are build errors with the same message the runtime returns.
`with: { cover: true }` on a media column puts the media row in place of the id.

`await` on these calls compiles to plain blocking PHP calls.

## defineConfig

`defineConfig({ name?, collections?, tables?, users?, globals?, hooks?, actions?,
jobs?, webhooks?, media?, files?, locales?, plugins?, use?, admin?, frontend?, runtimeSchema? })`. `name` (a slug,
default: the project directory) names the WordPress plugin `first-app-<name>`.
`admin: true` ships the optional admin screens as a fourth plugin,
`first-admin`; by default the build emits none. `frontend` says who renders the
public site: leave it out for the theme (or `first/app` when it exists), `false`
for backend only, or an external site's `https://` address (`http://` only on
localhost) so links, previews and feeds point there.

### Runtime schema changes

`runtimeSchema: true` lets the running site change its content schema without a build (spec §2.10,
[decision record](decisions/2026-11-13-runtime-schema.md)). It is off by default, and with it off
nothing below exists.

A change set is `{ "format": 1, "changes": [ … ] }`. Each change is one of:

| `op` | Keys | What it does |
|---|---|---|
| `addField` | `kind`, `field`, `definition` | a field on a collection |
| `addGlobalField` | `global`, `field`, `definition` | a field on a global |
| `addCollection` | `kind`, `definition` | a new collection: `{ label?, access?, fields }`, with `title` a required text field and `content`, when present, the rich text body |
| `addGlobal` | `global`, `definition` | a new global: `{ label?, access?, fields }` |
| `setLabel` | `kind` or `global`, `label` | the label shown for a kind; `null` takes the runtime label off |
| `setFieldUi` | `kind` or `global`, `field`, `ui` | a field's `label`, `help`, `placeholder` and `width`; `null` takes it off |
| `removeField` | `kind` or `global`, `field` | hides a field a runtime change added |
| `removeCollection`, `removeGlobal` | `kind` / `global` | hides a kind a runtime change added |

- **A field definition** is the field as `schema.php` stores it: `type` (`text`, `integer`, `real`,
  `boolean`, `date`, `timestamp`, `json`, `email`, `url`, `richText`, `media`, `mediaList`,
  `select`, `group`, `repeater`, `blocks`), and where they apply `notNull`, `enum`, `multiple`,
  `multiline`, `accept`, `default` (`{ "value": … }` with one string, number or boolean, or
  `{ "now": true }`), `rules` (`min`, `max`), `fields`, `layouts` and `ui`.
- **`access`** on a new kind maps `read`, `create`, `update`, `delete` (globals: `read`, `update`)
  to a role, `"anyone"`, `"authenticated"`, `true` or `false`. A rule that is a function is source.
- **Rules.** The compiler's, with the compiler's diagnostic code in the refusal (`F3001`, `F2001`,
  `F3101`, `F1221`). The site adds its own: a field added to an existing collection is optional or
  has a default (`schema_required`); a name every kind or site has is not available
  (`schema_reserved`); a removed name comes back only with the stored type it had, and a name
  that any build which ran on the site stores as another type keeps that type (`schema_retype`), so
  two builds the host serves at once never read one value two ways; something a build declares is not removed at runtime (`schema_in_use`, or
  `schema_build_only` when no runtime change added it). Every other operation (renaming, retyping,
  tables, hooks, actions, jobs, pages, taxonomies) is `schema_build_only`, with the source edit to
  make. Fields of a translated or synced collection are build-only for now.
- **Hooks.** A `beforeCreate` or `beforeUpdate` hook sees only the fields its build declares. The
  runtime fields of the write are kept aside while it runs and added back to what it returns.
- **Removal hides.** A removed field or kind leaves the schema, the API and the editor. Its post
  meta, posts and options stay, and adding the same name again brings the values back.
- **Rollback** is a new version: `reversal(version)` gives the change set that undoes a version,
  newest change first, and applying it is an ordinary change. The reversed version stays stored.
- **Versions.** An accepted change set is the next row of `<prefix>first__schema_versions`:
  version, parent, the build it was validated on, who applied it, when, the changes in stored
  form, and a hash chained to the parent's. Rows are never updated or deleted. A change names the
  version it was made against; when another was applied first it is refused with 409
  `schema_conflict`.
- **Loading.** The active version's additions are in one autoloaded option,
  `first_<app>_runtime_schema`. A request adds them to the compiled schema and does nothing else.
  A kind, field or relation the build declares itself is never replaced; only a label and a
  field's `ui` are. A new field is post meta `first_<field>` (an option, on a global); a new
  collection is post type `first_<name>` with no SQL table. Both are registered like compiled
  ones, from the request after the change. `GET /__first/api/v1` reports `runtimeSchema: {
  version, hash, build }`.
- **In the project.** `first/_generated/runtime-schema.json` lists a site's changes for the build:
  `collections` and `globals` (fields added to declared kinds), `added` (new kinds) and `overrides`
  (labels and presentation). The build declares them as if they were authored. A build that lacks
  the site's changes does not drop them: they stay active, with their data.

This release has the store, the loader, the rules and the build's reading of the lock. Applying a
change is `First\Wp\SchemaVersions::of($plugin)->apply($parent, $changeSet, $actor)` from PHP;
the Abilities, the `first schema` commands, `first pull` and the admin screen are not built yet.
Taxonomies can't be added at runtime: `taxonomy()` is not in this First version.

## Plugin packages

A plugin is an npm package that adds hooks, actions and jobs. It runs
in the app's PHP process. The compiler records everything its code can do,
and the app grants that in a committed lock file.

```ts
// node_modules/first-plugin-seo/src/index.ts
import { definePlugin } from "first";
import { summarize } from "./summarize";

export default (options: { suffix: string }) =>
  definePlugin({
    name: "seo",
    hooks: { posts: { beforeCreate(data) { data.summary = summarize(data.title) + options.suffix; } } },
  });
```

```ts
// first.config.ts, after `npm install first-plugin-seo`
import seo from "first-plugin-seo";
export default defineConfig({ collections: { posts }, use: [seo({ suffix: " | Site" })] });
```

- `use` lists plugins in order. `plugins` stays the WordPress.org pin map.
- Plugin hooks run before the app's hook for the same collection and kind,
  in `use` order. A before-hook's returned replacement becomes the next
  hook's `data`. A throw aborts the request, as in app hooks.
- A plugin's actions and jobs are registered as `<name>_<key>`.
  Inside the plugin, `jobs.<key>` names its own jobs.
- A plugin package can import its own modules, `"first"` and ordinary npm
  packages. Importing the app's modules or another plugin's package fails
  with `F1201`. Each plugin's compiled helpers, captured data, class state
  and `once()` keys are its own.

There is no capability list to write. `first build` infers each plugin's
grant and writes `first/_generated/plugins.lock.json`:

```json
{ "version": 1, "plugins": { "seo": {
  "package": "first-plugin-seo", "version": "1.2.0", "integrity": "sha256-…",
  "grant": { "read": ["posts"], "write": ["posts.summary"], "hooks": ["posts.beforeCreate"],
             "http": [], "env": [], "mail": [], "jobs": [], "...": [] } } } }
```

| Kind | Values |
|---|---|
| `read` | collection keys and `globals.<name>`: queries, relation loads, hooked collections |
| `write` | `<collection>.<field>` (or `.*`), `globals.<name>`: inserts, updates, before-hook changes, including through helpers |
| `delete` | collection keys |
| `hooks`, `actions` | what the plugin registers |
| `http` | hosts with a written `https://host/` prefix; `*` for a URL built at runtime |
| `env` | variable names, including `crypto.hmacSha256` keys and signature secrets |
| `mail` | `send` |
| `jobs` | the plugin's own jobs it enqueues |
| `abilities` | `vendor/name` of each `abilities.call` from `"php/wordpress"` |
| `wpHooks` | WordPress actions and filters the plugin's code registers; empty today, since hooks come only from the app's `first/wp-hooks/` directory |
| `php` | reserved for PHP functions imported from `"php/wordpress"`, `"php/<slug>"` or `"php"` (`wordpress:get_option`); always empty today |

Commit the lock: it is the grant.

- **New plugin or new package source:** `first build` updates the entry and
  prints the diff. Review it, then commit.
- **CI:** when `CI` is set, or with `first build --frozen`, any capability
  beyond the committed entry, or a plugin without one, fails the build with
  `F4201` at the call that needs it.
- **Narrowing:** edit the entry. With the package source unchanged, code that
  needs more than the entry fails with `F4201`. Replace `*` in `http` with
  hosts to limit runtime-built URLs. The generated PHP then checks every
  request and redirect hop and refuses others with `502 first_fetch_host_denied`.

`first check --json` adds a `plugins` list: package, version, integrity, the
locked and inferred grants, and `flows`, the handlers that both read data
(rows or environment values) and send it out (`fetch`, `mail.send`). It's a
report, not a refusal. A granted read plus a granted host can send data out.
There are no CPU or memory limits.

## Hooks

`hooks.<collectionKey>` in `defineConfig`:

| hook | arguments | notes |
|---|---|---|
| `beforeCreate` | `(data: Insert, ctx)` | mutate `data` or return a replacement |
| `afterCreate` | `(row: Row, ctx)` | |
| `beforeUpdate` | `(patch: Partial<Insert>, existing: Row, ctx)` | mutate `patch` or return a replacement |
| `afterUpdate` | `(row: Row, previous: Row, ctx)` | |
| `beforeDelete` / `afterDelete` | `(row: Row, ctx)` | throw to abort |

`ctx` is `{ user: { id, name, role } | null }`.

`ctx` is an ordinary value. Pass it to helpers, return it, and read its keys,
including `ctx["user"]` and keys typed `keyof HookCtx`. Type a helper's
parameters with the types `"first"` exports:

- `HookCtx` for the context of an action, hook or route;
- `JobCtx` for a job's context, which adds `attempt` and `jobId`;
- `User` and `Role` for `ctx.user` and its role;
- `RouteRequest` and `RouteResponse` for a route's request and result.

```ts
import { db, type HookCtx, type User } from "first";

function author(ctx: HookCtx): string {
  return ctx.user === null ? "guest" : ctx.user.name;
}
async function addNote(ctx: HookCtx, body: string) {
  await db.insert(notes).values({ body, author: author(ctx) });
}
```

A key read whose value no type bounds, such as `ctx[name]` with
`name: string`, is refused. Use a `keyof` type, a `switch` or a
`Record<string, T>` instead.

Throwing anything aborts the request and rolls back every write in it.
`throw new HttpError(status, code, message)` picks the HTTP response.

## Actions

`action({ input: { ...columns }, access?, handler(input, ctx) { ... } })` → `POST /__first/api/v1/actions/<name>`.
`input` uses column builders for validation; the return value is the response `data`.

- `idempotent: true`: a request with an `Idempotency-Key` header runs once per
  key and caller; a repeat returns the stored result, and the same key with
  different input is a 409. `once(key, fn)` does the same inside any handler.
- `signature: { secret: env("NAME"), header, scheme: "first" | "hmac-sha256" }`:
  an inbound webhook. The HMAC over the raw body replaces the access rule;
  `first` also checks a timestamp so old deliveries are refused.
- `agents: false` keeps it out of MCP and the abilities' public REST
  discovery; it stays callable over the app's own API.
- `readonly: true` marks an action that only reads; `destructive: true` one
  that deletes or overwrites data, so agents confirm before running it.

Each action is also the Ability `<app>/<kebab-name>`. Its annotations come from
these options, its input schema from `input`, and its output schema from the
handler's TypeScript return type (left out when the type has no single JSON
shape). Core's run route, `/wp-json/wp-abilities/v1/abilities/<app>/<name>/run`,
serves it with the action's own access rule, so an `access: "anyone"` action
runs anonymously. Core picks the method from the annotations: `GET` for
`readonly`, `DELETE` for `destructive` with `idempotent`, `POST` otherwise.
Errors are core's `WP_Error` JSON, with First's code (`first_<code>`), status
and `data.pointer`.

## HTTP routes

> On a hosted Spacefast Space, routes outside `/wp-json` aren't served yet: the host doesn't hand those paths to WordPress. The compiled manifest lists them (`routes`, and `pagePaths` for pages) for the host change that will. On your own WordPress they work today.
>
> For a host reading those lists: trim one trailing `/` from the request path, treat `HEAD` as `GET`, and hand over any request whose path matches an entry whatever its method, so the app answers a wrong method with 405. `:name` takes one segment and `*name` one or more.

An HTTP route serves your own methods on a path of the site, outside
`/wp-json`: a feed, a sitemap, a payment provider's webhook, anything that is
not a JSON action call. It is a `route.ts` file under `first/app/`, at the
folder of its URL ([pages](pages.md) describes the folder rules); `first/app/`
needs no pages for it.

```ts
// first/app/api/feed.json/route.ts: GET /api/feed.json
import { db, type RouteRequest } from "first";

export const access = "anyone";

export async function GET(req: RouteRequest) {
  const limit = Number(req.query.get("limit") ?? "20");
  const notes = await db.query.notes.findMany({ where: { status: "published" }, limit });
  return {
    headers: { "content-type": "application/feed+json" },
    body: JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: notes.map((n) => ({ id: String(n.id), title: n.title })) }),
  };
}
```

```ts
// first/app/webhooks/stripe/route.ts: POST /webhooks/stripe
import { env, type RouteRequest } from "first";

export const signature = { secret: env("STRIPE_WEBHOOK_SECRET"), header: "stripe-signature", scheme: "hmac-sha256" };

export function POST(req: RouteRequest) {
  const event = JSON.parse(req.body) as { type: string };
  return { status: 202, body: "ok " + event.type };
}
```

- Export one handler per method: `GET`, `POST`, `PUT`, `PATCH` or `DELETE`.
  `GET` also answers `HEAD`. Any other method on the path answers `405`. A
  `page.tsx` may export the same handlers, except `GET`, for its own URL.
- The folder is the path. A folder is a literal segment (lowercase letters,
  digits, `. _ ~ -`), `[name]` for one segment, or a final `[...name]` for one
  or more; `req.params.name` is the decoded segment, or the decoded segments
  joined with `/`. An encoded `/` or a `.`/`..` segment never matches. A
  trailing slash matches. Two files that serve one URL are refused, and so is a
  first folder that WordPress or First owns (`wp-admin`, `wp-json`,
  `wp-content`, `feed`, `first-admin`, `auth`, `__spacefast`, `.well-known`,
  ...).
- Export exactly one of `access` or `signature`; there is no default. `access`
  takes the same rules as actions (`"anyone"`, `"authenticated"`, a role, a
  boolean, or a function of `ctx`). `signature` verifies an HMAC over the raw
  body, as on [actions](#actions). The verified caller is then anonymous.
- `req` is `{ method, url, path, params, query, headers, body }`. `url` is the
  absolute URL: `https://`, the hostname (lowercase, no port), then the path and
  query. A share-link secret never reaches the handler: `__`, `token` and
  `purchaseToken` values and a `/__/<token>` segment read `[redacted]` in `url`,
  and `__` is left out of `query`. Header names are lowercase. `body` is the raw text: use `JSON.parse(req.body)` for JSON.
- `req.query` reads the raw query string the way `URLSearchParams` does:
  `get(name)` (the first value, or `null`), `getAll(name)`, `has(name)` and
  `entries()`. Names are kept exactly (`a.b`, `x[]`), `+` is a space, and a
  repeated name keeps every value in order. PHP's `$_GET` would rename `a.b` to
  `a_b` and keep only the last value.
- When several routes match, the most specific one wins. Segments are
  compared from the left, and a literal folder beats a `[param]`, which beats a
  `[...rest]`: `api/feed.json` wins over `api/[id]`, `api/probe/[id]` wins over
  `api/[kind]/[id]`, and `files/[bucket]/latest` wins over `files/[...path]`.
- The handler returns `{ status?, headers?, body? }`. `status` defaults to
  `200`, `body` to `""`, and `Content-Type` to `text/plain; charset=utf-8`. Header
  names are case-insensitive, so the handler's `content-type` replaces the
  default. Responses send `Cache-Control: private, no-store` unless the handler
  sets its own. Any other return type is a compile error.
- The handler runs in one transaction. A throw rolls it back, and
  `throw new HttpError(status, code, message)` answers with a problem+json
  document. `db`, `jobs` and `once` work as they do in actions.
- Cookie sessions authenticate `GET` and `HEAD` routes. On other methods a
  signed-in visitor counts only with a valid `X-WP-Nonce` (`wp_rest`) header;
  otherwise the request runs anonymously, so another site cannot post as your
  visitor. Keep `GET` handlers free of writes for the same reason. Application
  passwords are not accepted here; use actions for API clients.

Routes are WordPress front-controller requests: no theme or template renders
for them, and they need no rewrite rules or permalink flush.

## Outbound HTTP

Handlers call other services with the standard global `fetch`. Nothing is
imported; the types come from `@types/node`, which new projects install:

```ts
import { action, defineConfig, HttpError, text } from "first";

export default defineConfig({
  actions: {
    weather: action({
      input: { city: text() },
      access: "anyone",
      async handler({ city }) {
        const query = new URLSearchParams({ q: city });
        const response = await fetch("https://api.example.com/v1/weather?" + query.toString(), {
          headers: { authorization: "Bearer " + (process.env.WEATHER_KEY ?? "") },
        });
        if (!response.ok) throw new HttpError(502, "weather_unavailable", "Weather is unavailable.");
        return (await response.json()) as { temperature: number };
      },
    }),
  },
});
```

The compiler lowers each call to the WordPress HTTP API in PHP. What it
compiles, and what it refuses with a fix:

| | Supported | Refused |
| --- | --- | --- |
| `input` | a URL string or a `URL` | `Request` objects |
| `method` | `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` | other methods (`first_fetch_method_denied`) |
| `headers` | an object of strings, an array of `[name, value]` pairs, or `new Headers(...)` | |
| `body` | a string (`JSON.stringify(value)` for JSON) or `URLSearchParams` | `Blob`, `FormData`, `ArrayBuffer`, streams |
| `redirect` | `"follow"` (default), `"manual"`, `"error"` | |
| other options | | `signal`, `credentials`, `mode`, `cache`, `keepalive` and the rest |
| `Response` | `status`, `statusText`, `ok`, `url`, `redirected`, `bodyUsed`, `headers.get/has/forEach`, `text()`, `json()` | `body`, `arrayBuffer()`, `blob()`, `formData()`, `clone()` |
| `Headers` | `new Headers(init)`, `get`, `has`, `set`, `append`, `delete`, `forEach` | iterators, `getSetCookie` |
| `URL`, `URLSearchParams` | the WHATWG URL Standard (see [language support](language-support.md#whatwg-url)): parsing, components, `searchParams`, and every `URLSearchParams` method, iterator and `sort` | `URL.createObjectURL` |

A string body is sent as `text/plain;charset=UTF-8` and `URLSearchParams` as
`application/x-www-form-urlencoded;charset=UTF-8` unless `headers` sets
`content-type`. As in fetch, a body can be read once.

- Only `https:` URLs without credentials are fetched. The host must not be
  `localhost` or a platform host, and every address it resolves to must be
  public: private, loopback, link-local (including `169.254.169.254`), CGNAT,
  documentation, multicast and other special-purpose IPv4 and IPv6 ranges are
  refused, as are IPv4-mapped and 6to4 forms of them. The connection is pinned
  to the checked address.
- `redirect: "follow"` follows up to three redirects and checks each hop again.
  303, and 301/302 after a POST, become a GET without a body; `authorization`
  and `cookie` headers are dropped when the origin changes. `"manual"` returns
  the 3xx response; `"error"` throws `first_fetch_redirect_denied`.
- Each call has 10 s and 1 MiB for the request body and the response.
  `connection`, `host` and other hop-by-hop request headers are ignored, and
  `set-cookie` is never returned.
- A refused or failed call throws `HttpError(502)` with a code:
  `first_fetch_scheme_denied`, `first_fetch_credentials_denied`,
  `first_fetch_host_denied`, `first_fetch_address_denied`,
  `first_fetch_method_denied`, `first_fetch_payload_too_large`,
  `first_fetch_response_too_large`, `first_fetch_redirect_denied`,
  `first_fetch_too_many_redirects`, `first_fetch_timeout` or
  `first_fetch_upstream_unavailable`. A non-2xx answer is a response, not an
  error.
- A handler that fetches holds its transaction open while it waits. Keep calls
  in actions short, or enqueue a job for slow ones. Access rules can't fetch.

A site plugin can open one internal target with the
`first_fetch_allow_address` filter (`$open, $address, $host, $port`), and
answer for a privately resolved name with `first_fetch_resolve`
(`$answer, $host`). Request input never reaches either.

## Runtime variables

Handlers read the process environment with `process.env.NAME` or
`process.env["NAME"]`. The value is a `string`, or `undefined` when the
variable is unset; the process environment is read first, then a
`wp-config.php` constant of that name.

The name must be written out. A computed name (`process.env[key]`), iterating
or spreading `process.env`, writing to it, and every other `process` member are
compile errors, so request input can never choose a server variable. Reading
`process.env` while the config is evaluated is an error too: settings that
WordPress resolves later (webhook URLs and secrets, action signatures, upload
credentials) take `env("NAME")` from `"first"`, which is a reference, not a
value, and is refused inside handlers.

## Hashing and random values

Hash, sign and compare with `"node:crypto"` (or `"crypto"`), imported in
TypeScript or required from static CommonJS. Random UUIDs also come from the
global `crypto`. Every call is synchronous:

```ts
import { action, defineConfig, text } from "first";
import { createHmac, timingSafeEqual } from "node:crypto";

export default defineConfig({
  actions: {
    verify: action({
      input: { body: text(), signature: text() },
      access: "anyone",
      handler({ body, signature }) {
        const expected = createHmac("sha256", process.env.WEBHOOK_SECRET!).update(body).digest("hex");
        return Buffer.byteLength(expected) === Buffer.byteLength(signature)
          && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
      },
    }),
  },
});
```

| Form | Result |
| --- | --- |
| `createHash(alg).update(text)....digest(enc)` | Digest of the UTF-8 bytes. `alg` is `md5`, `sha1`, `sha256`, `sha384` or `sha512`; `enc` is `hex`, `base64` or `base64url` |
| `createHmac(alg, key).update(text)....digest(enc)` | HMAC with the same algorithms and encodings |
| `randomBytes(n).toString(enc)` | `n` (0 to 1024) random bytes from `random_bytes` |
| `randomUUID()`, `crypto.randomUUID()` | A random version 4 UUID |
| `timingSafeEqual(Buffer.from(a), Buffer.from(b))` | Constant-time comparison of the UTF-8 bytes; different byte lengths throw `RangeError`, as in Node |
| `Buffer.byteLength(text)` | The UTF-8 byte length, for the check before `timingSafeEqual` |

A hash or HMAC is compiled as one expression ending in `digest(enc)`; storing
the hash object, `digest()` without an encoding, and other Buffer values are
compile errors. A `createHmac` key written as `process.env.NAME` (with or
without `!`) is read trimmed, and an unset or blank variable throws
`500 crypto_key_unavailable`, so a missing secret never signs with an empty key.
Any other key is used as given. Inputs are capped at 1 MiB
(`413 crypto_input_too_large`).

Other `node:crypto` functions (ciphers, keys, KDFs, streams), other Node
built-ins, `crypto.getRandomValues` (typed arrays are not compiled) and
`crypto.subtle` are refused with a fix. For inbound webhooks, prefer an
action's or route's `signature` option, which also checks timestamps.

## Email

`mail.send(message)` from `"first"` sends email from a hook, action, route or
job:

```ts
import { action, defineConfig, email, mail, text } from "first";

export default defineConfig({
  actions: {
    invite: action({
      input: { to: email(), name: text().optional() },
      access: "editor",
      async handler({ to, name }) {
        const queued = await mail.send({
          to: { email: to, name: name ?? undefined },
          subject: "You're invited",
          text: "Open the link to join.",
          html: "<p>Open the link to join.</p>",
        });
        return queued.id;
      },
    }),
  },
});
```

- The message has `to`, `subject` and `text` and/or `html`, plus optional
  `from`, `cc`, `bcc`, `replyTo` and `headers`. Addresses are strings or
  `{ email, name? }`; `to`, `cc` and `bcc` may be lists, 50 recipients in all.
  `from` defaults to `noreply@` the site's host.
- `send` validates the message, then queues it inside the handler's
  transaction. It is handed off after the request commits, so a rolled-back
  write sends nothing. A refused hand-off is retried by the job runner (5
  attempts, with backoff) and shows in `wp first jobs list`.
- Delivery goes to `wp_mail`, so the site's mail plugin or SMTP configuration
  applies. Display names are RFC 2047-encoded, and line breaks, commas inside
  an address and reserved headers (`From`, `To`, `Content-Type`, ...) are
  refused at `send`.
- A managed host supplies its own transport through the
  `first_mail_transport` filter (`null, $message` → `true` when accepted). On
  Spacefast that is the Space's sender, which requires `from` on the Space's
  primary sending domain and counts recipients against the Space's daily
  allowance. A managed host without a transport refuses rather than falling
  back to `wp_mail`.

## WordPress abilities

A handler can call any ability registered on the site with the WordPress
Abilities API: the app's own, core's, or another plugin's (WooCommerce,
Jetpack, ...). Import `abilities` from `"php/wordpress"`:

```ts
import { action, defineConfig, text } from "first";
import { abilities } from "php/wordpress";

export default defineConfig({
  actions: {
    count: action({
      input: { text: text() },
      access: "authenticated",
      async handler(input) {
        const result = await abilities.call("acme/word-count", { text: input.text });
        return result.count;
      },
    }),
  },
});
```

- The name is a string literal. The input is checked against the ability's
  input schema and the result is typed from its output schema, by the
  compiler and by tsc.
- The app's own abilities (`<app>/<collection>-list`, `<app>/<action>`, ...)
  are typed from the schema with nothing else to do. An action's result is
  `unknown`: its ability publishes no output schema.
- Other abilities come from `first/_generated/abilities.json`, which you commit.
  `first abilities pull [dir] --site <url>` writes it from a running site;
  `--only acme/*` (repeatable) keeps matching names. The pull signs in only
  with `FIRST_APP_PASSWORD=user:application-password` from the environment.
  `first build` and `first check` read the lock and never contact the site.
- Map `"php/wordpress"` in tsconfig.json next to `"first"`
  (`types/wordpress.d.ts` in the CLI package); `first build` writes the ability
  types into `first/_generated/db.d.ts` when the app imports the module.
- The call runs core's `WP_Ability::execute()` for the current WordPress user:
  core validates the input, runs the ability's permission check and validates
  the output. It runs inside the handler's transaction, so the ability's
  database writes roll back with the handler's.
- Errors are `HttpError`s. A site without the ability answers
  `503 ability_unavailable` (the build's lock no longer matches the site). A
  `WP_Error` with a `status` keeps it and its code; otherwise a permission
  failure is `401 unauthenticated` or `403 forbidden`, invalid input is
  `422 invalid_input`, and anything else is 500 with the ability's code.
- JSON Schema maps to TypeScript for `type` (with `"null"`), `properties` and
  `required`, arrays, `enum`, `const`, `oneOf`/`anyOf` and
  `additionalProperties`. `allOf`, `$ref`, `not`, `patternProperties` and
  tuple `items` become `unknown`, and the pull prints a warning for each.
- `first doctor --site <url>` (with `FIRST_APP_PASSWORD`) reports every locked
  ability the site no longer has or whose schema changed since the pull.

## WordPress functions

A short, curated set of WordPress core functions is importable from
`"php/wordpress"` and callable from hooks, actions, routes and jobs:

```ts
import { current_user_can, esc_html, get_post, update_option, wp_insert_post } from "php/wordpress";

if (!current_user_can("edit_posts")) throw new HttpError(403, "forbidden", "Editors only");
const id = wp_insert_post({ post_title: input.title, post_status: "draft" });
const post = get_post(id);                       // WP_Post | null
return post === null ? "" : esc_html(post.post_title);
```

| Function | TypeScript |
|---|---|
| `get_option(option)` | `unknown` (a missing option is `false`) |
| `update_option(option, value)`, `delete_option(option)` | `boolean` |
| `get_post(post_id)` | `WP_Post \| null` |
| `wp_insert_post({ post_title?, post_content?, post_excerpt?, post_status?, post_type?, post_name?, post_author?, post_parent?, menu_order? })` | `number`; throws on failure |
| `current_user_can(capability)`, `is_user_logged_in()` | `boolean` |
| `get_current_user_id()` | `number` |
| `get_userdata(user_id)` | `WP_User \| false` |
| `get_permalink(post_id)` | `string \| false` |
| `home_url(path)` | `string` |
| `sanitize_text_field`, `sanitize_title`, `esc_html`, `esc_attr`, `esc_url`, `wp_strip_all_tags` | `string` → `string` |

- Types come from `php-stubs/wordpress-stubs` 7.1.2 (WordPress's own
  signatures and phpdoc) through the same pinned generator as the hook
  catalog, narrowed where a PHP parameter accepts several shapes. Each call
  passes exactly the listed arguments; later PHP parameters keep their
  defaults (`wp_insert_post` always asks for a `WP_Error` instead of `0`).
- A function is admitted only when it maps soundly: no by-reference
  parameters, no echoing template tags (`the_title`), no reliance on request
  globals (`the_post`). Anything else is a build error at the import that
  lists what is available.
- `WP_Post` and `WP_User` results are the same read-only views hook arguments
  are.
- A `WP_Error` result throws an `HttpError` with the error's code and its
  `status` when it carries one, otherwise 422.
- The call runs as the current WordPress user, inside the handler's
  transaction. A rolled-back handler undoes the function's database writes,
  and First clears WordPress's cache of every option and post the call wrote.
- A call is a direct PHP function call through First's value conversions,
  never a PHP string or `eval`.

## WordPress hooks

`first/wp-hooks/` adds WordPress actions and filters. Name a
file after the hook, or make a directory of that name for several handlers.
Each file default-exports its handler:

```text
first/wp-hooks/
├── save_post.ts
└── the_content/
    ├── 10-reading-time.ts
    └── 20-frame.ts
```

```ts
// first/wp-hooks/the_content/20-frame.ts
import type { Handler } from "php/wordpress";

const frame: Handler<"the_content"> = (content) => `<div class="frame">${content}</div>`;
export default frame;
```

```ts
// first/wp-hooks/save_post.ts
import type { WP_Post } from "php/wordpress";

export const priority = 20;
export default function (postId: number, post: WP_Post, update: boolean) {
  if (!update && post.post_type === "post") { /* ... */ }
}
```

- The files compile to PHP like hooks and actions, and the app plugin
  registers them with `add_filter`/`add_action`. No JavaScript reaches the site.
- Hooks come from a curated catalog generated from core's docblocks
  (`@wp-hooks/wordpress-core` 1.13.0) and `php-stubs/wordpress-stubs` 7.1.2:
  `init`, `wp_head`, `wp_footer`, `wp_body_open`, `wp_enqueue_scripts`,
  `template_redirect`, `the_content`, `the_title`, `the_excerpt`,
  `excerpt_length`, `excerpt_more`, `body_class`, `post_class`, `save_post`,
  `wp_insert_post`, `deleted_post`, `transition_post_status`, `user_register`,
  `wp_login`, `wp_logout`, `rest_api_init`, `wp_mail`, `pre_get_posts` and
  `login_message`. Any other name is a build error with the closest one.
  There is no untyped escape hatch.
- Arguments are typed from the catalog. A filter must return its first
  argument's type. Handlers are synchronous: WordPress doesn't wait.
- `WP_Post` and `WP_User` arguments are read-only copies of their documented
  public properties (`post_title`, `post_status`, `user_login`, `roles`, ...).
  `WP_Query` (`pre_get_posts`) offers `get(var)`, `set(var, value)` and
  `is_main_query()` on the query WordPress runs. Nothing else of these
  objects is reachable.
- Files of one hook register in file-name order, all at priority 10, so they
  run in that order after core's own callbacks at 10. `export const priority =
  <integer>` moves a file; lower runs first. A file exports only `default` and
  `priority`; share code through an ordinary imported module.
- `first/wp-hooks/` accepts only `.ts` files, directly or one directory deep. A
  file without a default export, another file type, or the same hook as both a
  file and a directory is a build error at that path.
- Handlers run in WordPress's own request, whichever it is: a page view, an
  editor save, cron, REST, WP-CLI. They are in a First transaction only when the
  hook fires during a First write (see [Transactions](#transactions)). `db`
  works and, outside such a write, each write commits on its own; `ctx` and
  `HttpError` responses don't apply, since there is no First request.
- A handler that throws is logged to the PHP error log as
  `[first] first/wp-hooks/<hook>: ...`. A filter then returns the value it was given,
  so one broken handler leaves the page as WordPress rendered it. An action's
  throw stops only that handler.

## Jobs and webhooks

```ts
jobs: {
  notifyEditors: job({ input: { commentId: integer() }, retries: 3, handler: async (input, ctx) => { ... } }),
},
webhooks: [{ url: env("HOOK_URL"), secret: env("HOOK_SECRET"), events: ["posts.created", "posts.updated"] }],
```

`jobs.<name>.enqueue(input, { delay?, key? })` from a hook or action queues a
job; it runs after the request commits, never inside it. `key` collapses
duplicates still waiting. A handler that throws is retried with backoff up to
`retries`, then marked dead; `ctx.attempt` and `ctx.jobId` say which run this
is. Each job is handed to Action Scheduler (cron, or `wp action-scheduler run`);
`wp first jobs list|retry|cancel` manage the queue.

A webhook POSTs `{ id, event, collection, at, data: { row, previous? } }` for
each matching write (`<collection>.created|updated|deleted`, or `"*"`), signed
in the `first-signature` header as `t=<unix>,v1=hex(HMAC-SHA256(secret, "t.body"))`.
Deliveries are jobs, so a failing endpoint is retried. `env(name)` is resolved
when the webhook is sent: the process environment first, then a
`wp-config.php` constant of that name.

## Known gaps

What the design specifies and this build doesn't do yet:

- `first sync --watch` isn't available; run `first sync` again, or from a scheduler.
- Sync skips the columns listed under [Sync](#sync); edit those through the site.

## The subset (enforced at build time)

Supported: `const`/`let`/`var`, functions, arrows, closures, destructuring,
spread, template literals, `if`/`for`/`for...of`/`for...in`/`while`/`switch`/`try`,
`?.`, `??`, objects, arrays, type annotations, type aliases, interfaces,
generics (erased), `structuredClone`.

`encodeURI(value)` and `encodeURIComponent(value)` accept exactly one string in
configuration evaluation and compiled handlers. Both preserve `-_.!~*'()`;
only `encodeURI` preserves URI delimiters (`;,/?:@&=+$#`). They percent-encode
UTF-8 bytes with uppercase hex. The PHP helper refuses malformed UTF-8 with
`URIError`; source strings with lone UTF-16 surrogates are already outside the
subset. General JS argument coercion and decoding globals are not implemented.

Use [`first check --json`](compiler-diagnostics.md) for machine-readable blockers.
The [tested compatibility inventory](language-support.md) links specific
restrictions and intentional differences to executable evidence.

Statically typed array/tuple reads and destructured elements include `null` when an
entry is missing. Check the fetched
value or supply a default with `??` or a destructuring initializer. A non-null
assertion (`values[0]!`) is available when your code guarantees the entry exists.
Adding `unknown` to a direct read from a declared string array uses checked
JavaScript addition and returns `string | number`: a missing element can yield
`NaN`. This does not permit `unknown + number` or nullable string elements.

Objects and arrays have reference identity: assignment, argument passing,
spreads and closures share their descendants as in JavaScript. Use
`structuredClone(value)` for an independent graph; shared descendants and
cycles survive cloning. Class instances become plain own-field objects when cloned. Captured module-level objects live for the PHP process
(one web request, or the worker's lifetime), as module data does in Node.

Arrays are dense. Writing at `length` appends; writing past `length`, at a
negative or fractional index, or at `NaN`/`Infinity` throws `RangeError`.
Grow arrays with `push` or `Array.from({ length: n }, mapper)`.
Fixed-length callback walks (`map`, `filter`, `forEach`, `some`, `every`,
`reduce`, `flatMap`, `find*`) throw `RangeError` if they reach an index their
callback removed. Shrinkage after the final visit or an early return is fine;
growth is ignored by these walks. `for…of` and `Array.from(array, mapper)`
read live length. Elisions, `new Array(n)`, `delete a[i]` (use `splice`), `a.length = n` and
non-numeric index types are compile errors.

Explicit `undefined` has its own runtime value: `typeof undefined` gives
`"undefined"`, `String(undefined)` gives `"undefined"`, and JSON omits undefined
object properties. Some statically typed missing reads still use PHP null:
indexed reads, optional properties and schema nullable values retain their
existing contracts. Optional typed parameters include null in body reads.
Imported JavaScript distinguishes missing values from explicit null throughout
its checked operations.

Bitwise operators (`& | ^ ~ << >> >>>` and their compound assignments) follow
JavaScript's 32-bit semantics: ToInt32 operands, shift counts masked to five
bits, and an unsigned result for `>>>`. `key in object` checks own properties,
then the value's built-in prototype chain (class methods, array, function and
error prototypes, `Object.prototype`), and narrows object unions like
TypeScript. `delete obj.key` and `delete obj?.key` remove optional properties
and map entries with strict-mode results: true for absent keys, a `TypeError`
for non-configurable ones such as `length`. `do…while` and labeled loops,
switches and blocks (`break label`, `continue label`) follow JavaScript.
Named function expressions (`const f = function fact(n) {...}`) can call
themselves. Destructuring assignment (`[a, b] = [b, a]`, `({ x, y: o.y = 0 } = value)`)
assigns existing variables and fields in JavaScript order. Tagged templates
call the tag with the call site's strings array (with `raw`) and the
substitutions; `String.raw` is supported. BigInt (`10n`, `bigint`, `BigInt(x)`)
is exact; mixing it with numbers in arithmetic is a TypeError, as in JavaScript.

Host globals: `fetch`, `Headers`, `URLSearchParams`, `process.env.NAME`,
`crypto.randomUUID()`, `Buffer.from`/`Buffer.byteLength` in the forms above, and
`"node:crypto"`; see [Outbound HTTP](#outbound-http),
[Runtime variables](#runtime-variables) and
[Hashing](#hashing-and-random-values). They run in handlers only.

Rejected with a located error and a fix: `this` at module level, `enum`, generators,
getters/setters, dynamic `import()`, `any`,
`eval`/`Function`, `setTimeout`, `globalThis`, `Promise`, `URL`, `Request`,
`Response`, `FormData`, `Blob`, `AbortController`, `require` outside static
CommonJS sources, assigning to module-level state from a hook,
`includes`/`startsWith`/`endsWith` on a string with a position (slice first),
a string `lastIndexOf` position other than a numeric, null or undefined literal
(use a literal position or omit it; typed missing values use the nullable boundary), `await` on
anything that isn't a First API call or your own `async` function, an `async`
call without `await`.

Build-time evaluation forbids I/O, `Date.now()`, `new Date()`, `Math.random()`,
and `db`, and stops runaway loops with a step budget.

Imports: `"first"`, `"node:crypto"` (or `"crypto"`), relative TypeScript/ESM
JavaScript sources, and locally installed source packages. Package imports search the nearest `node_modules`, support scoped
names and exact subpath exports, and select `import`/`default` export conditions,
an explicit `module` entry, or a supported `main`/index entry. `.mjs`, `.ts` and `.mts` identify
source directly. A `.cjs` source, or a `.js` source with no ESM syntax outside a
`"type": "module"` package, is static CommonJS. It runs once at build time, like
Node's module cache: top-level `require("<literal>")` of relative files and
CommonJS packages (resolved with the `require`/`default` conditions), and
`module.exports = …` or `exports.name = …` outside functions. ESM importers get
`module.exports` as the default export, plus the statically assigned names as
named exports. Dynamic `require`, `require` inside a function, `require` of an ES
module, `require` cycles, writes to `module` or `exports` inside a function,
other `module` properties, mixed ESM/CommonJS and implicit sloppy-mode
`arguments` are refused. `require("node:crypto")` gives the supported
`node:crypto` functions. Export patterns, Node built-ins other than `node:crypto`,
package aliases and declaration-only targets are refused. Package entry targets
must name existing files inside the package; the compiler does not install them.
Relative `.js` imports can resolve to their TypeScript source counterparts.

Raw `.js`, `.mjs` and `.cjs` inputs use checked dynamic operations for supported
values; `.ts` and `.mts` retain static type checking regardless of where they
are installed. Declaration files are not automatically applied as parameter
types. Function-scoped `var`, ordinary function `arguments`, comma expressions,
loose equality and own-key `for…in` are supported. Arrays are dense and plain
objects have no user-defined prototype chain. Host APIs, custom iterators,
arbitrary prototypes and asynchronous effects are not supplied by package
resolution. Type-only bare imports remain erased. See the
[real package probes](../examples/npm-compat/README.md) for pinned versions,
source adaptations and Node/PHP comparisons.


### Classes in callbacks

Declare concrete named classes at module scope, including in relative modules
with named exports. Construct them inside actions, hooks and other compiled
callbacks. Public instance fields, ordinary methods, `this` member reads and
writes, `new`, identity comparisons, named `extends`, overrides, `super(...)`,
`super.method(...)` and `instanceof` are supported. Arrows inside methods keep
that method's `this`. `typeof Counter` returns `"function"`; instances return
`"object"`. Extracting a prototype method is refused; use
`() => instance.method()` when passing a callback.

```ts
class Counter {
  value = 0;
  constructor(public label: string) {}
  add(n: number): number { this.value += n; return this.value; }
  reader(): () => number { return () => this.value; }
}
class DoubleCounter extends Counter {
  add(n: number): number { return super.add(n * 2); }
}
const countVisits = action({
  input: {},
  handler: () => {
    const counter = new DoubleCounter("visits");
    const read = counter.reader();
    counter.add(2);
    return { value: read(), isCounter: counter instanceof Counter }; // 4, true
  },
});
```

Base fields initialize in declaration order before constructor parameter defaults.
Derived fields initialize immediately after `super(...)`, before the rest of the
constructor. A derived constructor must call `super(...)` as its first statement;
an omitted constructor forwards arguments to the parent. Public/readonly typed
TypeScript parameter properties create own fields, then receive their parameter
values before authored constructor statements. Defaults and other field
initializers cannot read those parameter values yet, matching TypeScript's ES2022 class-field emit.
Uninitialized fields read as nullable because missing/undefined is PHP null.

Field types infer from plain data initializers; annotate fields initialized from
`this` or calls. Parameters need a type or a primitive default. Annotate recursive,
forward or overridden method returns when inference cannot establish a signature.
Derived instances can pass to helpers expecting their base. Mutation effects
include receivers, arguments, constructors, inherited methods and captured values;
numeric updates widen literal reads and writes invalidate prior narrowing.

Static fields start from pure build-time data and live for the PHP process.
Static methods inherit and dispatch with the actual class receiver. A subclass
write to an inherited static field creates its own value; nested objects retain
their shared identity. Static initializers cannot use runtime `this`, construct
instances or perform I/O.

Instances retain identity through assignment, arguments and closures. JSON
responses and generated client types contain own fields only; they do not
include methods or class metadata. Object spread copies own fields shallowly.
`structuredClone`, stored JSON, callback inputs and persistent `once` results
produce plain data without class identity. Use object types in `json<T>()`;
class types and assertions that would pretend to hydrate a class are refused.

Private names (`#field`, `#method()`, `static #x` and `#x in value`) belong to
the class that declares them, as in JavaScript. A subclass declaring the same
`#x` gets a separate slot, and only code inside the declaring class body can
name it. Private state is invisible to `Object.keys`, JSON, spread and
`structuredClone`; a clone does not carry the brand. Reading a private member
from an object the class did not initialize throws `TypeError`.

Classes in imported JavaScript (`.js`, `.mjs`, `.cjs`) need no annotations:
fields, parameters and returns use checked JavaScript values, and method values
such as `instance.method` keep one identity per class, so `call` supplies the
receiver.

Class `get`/`set` accessors, including `static` ones, live on the class like
prototype members: they are not own fields, so `Object.keys` and JSON skip them.
Own data wins over an accessor, and an accessor wins over a method. Assigning a
getter without a setter is a compile error in typed code and a `TypeError` in
imported JavaScript. Redefining either half in a subclass replaces the inherited
pair, and `super.name` reads the parent getter with the current receiver. A
getter's type comes from its return annotation, its setter's parameter, or its
body. A class `toJSON()` method is called by `JSON.stringify` with the property
key; actions that return such an instance directly are refused, because the
generated client describes own fields.

Classes can extend `Error`, `TypeError`, `RangeError` and `SyntaxError`. `super(message,
options)` sets non-enumerable `message`, `cause` (from `options.cause`) and
`stack`, so `Object.keys` and JSON show only fields and an assigned `name`.
`name` and `message` otherwise come from the prototype, and `String(error)`
follows `Error.prototype.toString`. `instanceof` sees the whole chain, including
`Error`. Any such instance can be thrown and caught with its identity and fields
intact. `stack` is the `Name: message` header without frames; First does not
expose PHP frames. `Error.captureStackTrace(target)` gives `target` that same
header-only stack. In typed code, `catch (e)` narrows with
`e instanceof AppError`.

These class features remain outside the supported surface, with located errors:
class expressions, default-export class declarations and
anonymous/local/abstract/ambient/generic classes;
decorators; private/protected members; private accessors; static blocks; computed names;
generic/rest methods; dynamic inheritance and built-in bases other than the Error family; constructor return values;
prototype/reflection machinery and custom coercion members (`toString`, `valueOf`).
Indexed class members and recursive class field types are also refused.
Uninitialized optional fields follow the same missing-to-null boundary. Class
values are limited to construction, `instanceof`, `typeof` and static access.
Method calls and escaping instances during construction/initialization are refused
to avoid partially initialized virtual receivers. Construction and method calls
inside access rules are refused; return filters from plain functions instead.

See [class compilation and library reuse](class-compilation.md) for the runtime
representation, validation owners and the OXC/SWC assessment. This support does
not enable arbitrary npm execution.
