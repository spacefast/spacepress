# zero.config.ts API (v0)

`zero build` reads `zero.config.ts`, evaluates it at build time with Zero's own
Rust evaluator (no Node, no JS engine), and compiles hooks/actions to PHP.
Everything below is exported from the `"zero"` module. Shapes follow Drizzle
ORM 1.0 (beta.22): column builders, `defineRelations`, relational-query
`findMany`/`findFirst` with object filters.

## WordPress plugins

Use a top-level package map in `defineConfig`:

```ts
plugins: { "classic-editor": "1.6.7" }
```

Values are exact WordPress.org versions or resource objects with `version`,
`pluginData`, optional `requires`, and a checksum (required for direct URLs).
See [plugin dependencies](wp-plugins.md) for resources, locks and assembly.

## Mixed content and app data

```ts
import {
  collection, table, text, integer, defineRelations, defineConfig,
} from "zero";

// Native WordPress content with an editor and an implicit id: id().
const posts = collection({ title: text().notNull() });
// App data in SQL, with a reference to the content.
const stock = table({
  postId: integer().references(() => posts.id, { onDelete: "cascade" }),
  quantity: integer().notNull().default(0),
});
const collections = { posts };
const tables = { stock };
const relations = defineRelations({ ...collections, ...tables }, (r) => ({
  stock: { post: r.one.posts({ from: r.stock.postId, to: r.posts.id }) },
  posts: { stock: r.many.stock() },
}));

export default defineConfig({
  collections, tables, relations,
  hooks: { posts: { beforeCreate(data) { data.title = data.title.trim(); } } },
});
```

The generated client stays flat: `zero.posts.create({ title: "Hello" })`,
`zero.stock.create({ postId, quantity: 2 })`, then
`zero.stock.list({ where: { post: { title: "Hello" } }, with: { post: true } })`.
See the [pantry](../examples/pantry/zero.config.ts) for a table-only app and
[blog](../examples/blog/zero.config.ts) for editorial content with related app data.

## Columns

The SQL column is the one a `table()` gets in the generated MySQL migration;
a `collection()` stores the same values
as post fields and meta.

| builder | SQL | TS select type |
|---|---|---|
| `id()` | BIGINT UNSIGNED AUTO_INCREMENT, primary key | `number` |
| `integer()` | BIGINT | `number` |
| `real()` | DOUBLE | `number` |
| `text()` / `text({ enum: [...] })` | LONGTEXT (VARCHAR when unique, when `.max()` is 191 or less, or for an enum) | `string` / union of the enum |
| `boolean()` | TINYINT(1) 0/1 | `boolean` |
| `timestamp()` | CHAR(24) (UTC ISO-8601 with ms); writes take epoch ms or ISO 8601 with `Z`/`±HH:MM` (a bare `YYYY-MM-DD` is UTC midnight) | `string` |
| `date()` | CHAR(10) `YYYY-MM-DD`, a real calendar day | `string` |
| `json()` / `json().$type<T>()` | LONGTEXT (JSON; an object keyed exactly `"0"`, `"1"`, ... reads back as a list, so a `.default()` can't contain one) | `unknown` / `T` |
| `text({ multiline: true })` | LONGTEXT | `string` (textarea in wp-admin) |
| `email()` / `url()` | VARCHAR or LONGTEXT as `text()`, validated | `string` |
| `slug({ source? })` | VARCHAR(200), unique, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, derived from `source` when omitted | `string` |
| `richText()` | LONGTEXT (HTML) | `string` |
| `media({ accept? })` | BIGINT media id | `number` (a media row with `with: { col: true }`) |
| `media({ multiple: true })` | LONGTEXT (JSON ids) | `number[]` |
| `select({ options })` | same as `text({ enum })` | union of the options |
| `select({ options, multiple: true })` | LONGTEXT (JSON) | `option[]` |
| `group({ fields })` | LONGTEXT (JSON) | `{ ...fields }` |
| `repeater({ fields })` | LONGTEXT (JSON) | `{ ...fields }[]` |
| `blocks({ layouts })` | LONGTEXT (JSON) | `({ layout: "a", ...a } \| { layout: "b", ...b })[]` |

Modifiers (each returns a new builder; builders are immutable so shared field
sets are safe): `.notNull()`, `.default(value)`, `.defaultNow()`
(timestamp/date), `.$default(() => value)` / `.$defaultFn(...)` (runs in PHP on
insert), `.$onUpdate(() => value)` / `.$onUpdateFn(...)` (runs in PHP on
update; `() => new Date()` on a timestamp is recognized as "now"),
`.unique()`, `.primaryKey()`, `.references(() => other.col, { onDelete,
onUpdate })` with actions `"cascade" | "restrict" | "set null" | "no action"`,
`.$type<T>()` (type only), `.min(n)` / `.max(n)` (numbers: bounds; strings:
length; lists: item count), `.pattern(/re/)` (strings), `.validate((value, ctx)
=> true | "message")` (compiled to PHP, runs on every write).

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
  the same metadata. See the [SEO recipe](../examples/recipes/seo.ts).
- `.showIf({ sibling: value | { eq, ne, in, isNull, isNotNull } })`: editor
  visibility only, as SCF conditional logic on WordPress. Scalar siblings, ANDed,
  with a top-level `OR`. It never hides data from the API.
- `.localized()`: the field is translated per locale (text, richText, json,
  select, group, repeater, blocks). See [Locales](#locales).
- `file({ bucket })`: a column holding a private file's id. See [Files](#files).

Each modifier is checked against the column kind (design §1.2): `.max()` on a
boolean, `.pattern()` on a number, `.references()` on text and so on fail the
build at the modifier. `.unique()` text needs `.max(≤191)` (MySQL index limit).
Sub-fields of `group`/`repeater`/`blocks` can't use `id()`, `.primaryKey()`,
`.unique()`, `.references()`, `slug()`, `blocks()`, or `.$onUpdate()`, and nest
at most 3 deep.

Column keys are the SQL column names.

## Collections, tables and user projections

`collection(fields, options?)` is editorial content: a WordPress custom post
type with the native editor, draft status and revisions. `table(fields,
options?)` is app/relational data in its own SQL table. Fields never choose
storage. Register each definition in its matching namespace:

```ts
const posts = collection({ title: text().notNull() });
const stock = table({ postId: integer().references(() => posts.id) });
export default defineConfig({ collections: { posts }, tables: { stock } });
```

Definitions need no exports. Backend-only config is sufficient; `zero build`
emits `zero.gen.ts` to type `db.query` without importing authored definitions.
An `id: id()` primary key is implicit. Tables may declare a custom single primary
key; collections and user projections use the native integer `id`.

The registry key is the logical name, used verbatim by `db.query`, hooks,
relations and the flat generated client (`zero.shoppingList`). Physical names
and REST paths default to deterministic snake_case: `shoppingList` → `shopping_list`,
`HTTPLogs` → `http_logs`. A table uses `wp_zero_shopping_list`; a collection
registers `zero_shopping_list`. Duplicate logical or physical names across all
registries are rejected before artifacts are emitted. A definition may be
registered once.

| option | default | meaning |
|---|---|---|
| `storageName` | registry key in snake_case | explicit physical resource name without `wp_` / `zero_` prefixes; retain existing storage on upgrade |
| `existingTable` | none | `table()` only; exact pre-existing SQL table name, with no added prefixes. The first migration checks columns and declared index/foreign-key names without creating or copying the table. |
| `label` | title-cased physical name | wp-admin menus, client docs |
| `drafts` | `true` for collections, `false` for tables | adds `status` and `publishedAt`; collections always have native drafts |
| `revisions` | `true` for collections, `false` for tables | collections always keep native revisions; tables may opt in |
| `title` | a `title: text()` column | WordPress post title; must be `text().notNull()` for collections |
| `content` | a `content: richText()` column | WordPress post content |
| `access` | read `"anyone"`, writes `"editor"` | see below |
| `api` | all `true` | `{ list?, get?, create?, update?, delete? }` |
| `uid` | `false` (`true` with `sync`) | stable immutable `uid` on every row |
| `sync` | none | project-relative `*.md` or `*.json` pattern for `zero sync` |
| `agents` | `true` | expose operations as WordPress abilities |

Collections need a title and physical names of at most 15 characters (WordPress
prefixes `zero_`). Built-in route names are reserved. User projections retain
WordPress identity storage; see [Sign-in](#sign-in).

An `existingTable` binding accepts an ASCII SQL identifier of at most 64 characters.
It is distinct from `storageName`, which still identifies the logical resource's
migration history. The binding is committed in the snapshot and cannot change
on later builds. Later column, index and foreign-key migrations use the exact
bound name. The existing columns must already have compatible storage; the first
check establishes column existence, not type equivalence. Adoption statements carry
`-- zero-adopt` metadata that the WordPress migrator validates before recording the
step. Pending adoption checks run before any migration DDL or ledger writes.
Declared unique indexes, primary keys and foreign keys must already have the
compiler's names, columns, uniqueness and reference actions. Prefix-only unique
indexes are refused. Other existing indexes are retained and remain unmanaged.
This keeps later constraint removals consistent with the committed snapshot. Database
engine checks include these tables. Uninstall retains their rows like normal tables.
An [adopted application table](migrating-from-zero.md#application-source-migration)
keeps its TEXT/DOUBLE storage and string response IDs.

### Upgrading authoring

Replace named builders with unnamed `collection()` or `table()` and register
under `collections` or `tables`. Keep the logical keys, existing physical storage
and committed migration snapshots. The snapshot format and runtime storage
model are unchanged: an authoring-only change must produce no migration.
For a persisted name that differs from the derived snake_case name, set
`storageName` to the exact name in `zero/_generated/migrations/snapshot.json`. For example,
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

1. Keep the entire committed `zero/_generated/migrations/` directory, including the v2
   `snapshot.json` and every numbered SQL file. Do not remove registrations as
   an intermediate step: that authors a destructive migration.
2. Change the builders/registries and add the physical bindings, then run
   `zero build .`. This authoring-only transition must leave the snapshot and
   historical SQL unchanged and produce no new numbered SQL. Review with
   `git diff -- zero/_generated/migrations` before deployment.
3. Deploy the generated `.zero/wp-content` plugins together as an ordinary
   file-copy update to the existing site. The runtime keeps the app's migration
   ledger, rows, reference targets and revision identities; it has no data
   migration to apply. Verify existing reads, relations and revision history
   through the new client/runtime before making schema changes.

This also supports old logical aliases: use the original physical name as the
binding even if the registry key is different. Changing a binding does not move
or rename data. Snapshots contain physical names without old logical aliases.
A build that removes existing storage while adding new storage is refused as
an ambiguous replacement, even when both names are snake_case. Retain the
binding during the authoring cut; stage intentional resource removal separately
after reviewing its data migration.

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
Zero's API, core `/wp/v2`, wp-admin (lists, the editor, quick edit,
revisions, autosaves, search) and abilities. A post type's capabilities
(`edit_zero_posts`, `edit_others_zero_posts`, ...) are answered from its rules
through `map_meta_cap`, and no role is granted them, so granting one by hand
changes nothing. Core reads apply the read rule and field access; core writes
and editor saves apply the create, update and field rules, and are authorized
on the saved data before they commit.

## Globals

`global(name, fields, { label?, access?: { read?, update? } })`, registered in
`defineConfig({ globals: { name } })`. One record per global; fields use the
sub-field rules, and notNull fields need a default. `GET`/`PATCH
/wp-json/zero/v1/globals/<name>`.

## defineConfig

`defineConfig({ name?, collections?, tables?, users?, relations?, globals?, hooks?, actions?,
jobs?, routes?, webhooks?, media?, files?, locales?, plugins?, use?, admin? })`. `name` (a slug,
default: the project directory) names the WordPress plugin `zero-app-<name>`.
`admin: true` ships the optional admin screens as a fourth plugin,
`zero-admin`; by default the build emits none.

## Plugin packages

A plugin is an npm package that adds hooks, actions, jobs and routes. It runs
in the app's PHP process. The compiler records everything its code can do,
and the app grants that in a committed lock file.

```ts
// node_modules/zero-plugin-seo/src/index.ts
import { definePlugin } from "zero";
import { summarize } from "./summarize";

export default (options: { suffix: string }) =>
  definePlugin({
    name: "seo",
    hooks: { posts: { beforeCreate(data) { data.summary = summarize(data.title) + options.suffix; } } },
  });
```

```ts
// zero.config.ts, after `npm install zero-plugin-seo`
import seo from "zero-plugin-seo";
export default defineConfig({ collections: { posts }, use: [seo({ suffix: " | Site" })] });
```

- `use` lists plugins in order. `plugins` stays the WordPress.org pin map.
- Plugin hooks run before the app's hook for the same collection and kind,
  in `use` order. A before-hook's returned replacement becomes the next
  hook's `data`. A throw aborts the request, as in app hooks.
- A plugin's actions, jobs and routes are registered as `<name>_<key>`.
  Inside the plugin, `jobs.<key>` names its own jobs.
- A plugin package can import its own modules, `"zero"` and ordinary npm
  packages. Importing the app's modules or another plugin's package fails
  with `Z1201`. Each plugin's compiled helpers, captured data, class state
  and `once()` keys are its own.

There is no capability list to write. `zero build` infers each plugin's
grant and writes `zero/plugins.lock.json`:

```json
{ "version": 1, "plugins": { "seo": {
  "package": "zero-plugin-seo", "version": "1.2.0", "integrity": "sha256-…",
  "grant": { "read": ["posts"], "write": ["posts.summary"], "hooks": ["posts.beforeCreate"],
             "http": [], "env": [], "mail": [], "jobs": [], "...": [] } } } }
```

| Kind | Values |
|---|---|
| `read` | collection keys and `globals.<name>`: queries, relation loads, hooked collections |
| `write` | `<collection>.<field>` (or `.*`), `globals.<name>`: inserts, updates, before-hook changes, including through helpers |
| `delete` | collection keys |
| `hooks`, `actions`, `routes` | what the plugin registers |
| `http` | hosts with a written `https://host/` prefix; `*` for a URL built at runtime |
| `env` | variable names, including `crypto.hmacSha256` keys and signature secrets |
| `mail` | `send` |
| `jobs` | the plugin's own jobs it enqueues |
| `abilities` | `vendor/name` of each `abilities.call` from `"php/wordpress"` |
| `wpHooks` | WordPress actions and filters the plugin's code registers; empty today, since hooks come only from the app's `wp-hooks/` directory |
| `php` | reserved for PHP functions imported from `"php/wordpress"`, `"php/<slug>"` or `"php"` (`wordpress:get_option`); always empty today |

Commit the lock: it is the grant.

- **New plugin or new package source:** `zero build` updates the entry and
  prints the diff. Review it, then commit.
- **CI:** when `CI` is set, or with `zero build --frozen`, any capability
  beyond the committed entry, or a plugin without one, fails the build with
  `Z4201` at the call that needs it.
- **Narrowing:** edit the entry. With the package source unchanged, code that
  needs more than the entry fails with `Z4201`. Replace `*` in `http` with
  hosts to limit runtime-built URLs. The generated PHP then checks every
  request and redirect hop and refuses others with `502 zero_fetch_host_denied`.

`zero check --json` adds a `plugins` list: package, version, integrity, the
locked and inferred grants, and `flows`, the handlers that both read data
(rows or environment values) and send it out (`fetch`, `mail.send`). It's a
report, not a refusal. A granted read plus a granted host can send data out.
There are no CPU or memory limits.

## Relations

`defineRelations({ ...collections, ...tables, ...users }, (r) => ({ ... }))`, Drizzle 1.0 style:
`r.one.<key>({ from: r.<this>.<col>, to: r.<target>.<col>, optional? })`,
`r.many.<key>({ from, to })`. `r.many.<key>()` with no config is inferred from
the single `one` relation pointing back.

One graph covers collection↔collection, table↔table and both directions across
storage kinds. Relation filters and `with` loads use the same runtime machinery
and target row/field access rules. Hidden target fields stay masked; relation
filters cannot probe them. Media and private file references work on both kinds.

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
parameters with the types `"zero"` exports:

- `HookCtx` for the context of an action, hook or route;
- `JobCtx` for a job's context, which adds `attempt` and `jobId`;
- `User` and `Role` for `ctx.user` and its role;
- `RouteRequest` and `RouteResponse` for a route's request and result.

```ts
import { db, type HookCtx, type User } from "zero";

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

`action({ input: { ...columns }, access?, handler(input, ctx) { ... } })` → `POST /wp-json/zero/v1/actions/<name>`.
`input` uses column builders for validation; the return value is the response `data`.

- `idempotent: true`: a request with an `Idempotency-Key` header runs once per
  key and caller; a repeat returns the stored result, and the same key with
  different input is a 409. `once(key, fn)` does the same inside any handler.
- `signature: { secret: env("NAME"), header, scheme: "zero" | "hmac-sha256" }`:
  an inbound webhook. The HMAC over the raw body replaces the access rule;
  `zero` also checks a timestamp so old deliveries are refused.
- `agents: false` keeps it out of MCP and the abilities' public REST
  discovery; it stays callable over the app's own API.

## HTTP routes

`routes` serves your own method and path on the site, outside `/wp-json`: a
feed, a sitemap, a payment provider's webhook, anything that is not a JSON
action call.

```ts
import { defineConfig, route, env, db } from "zero";

export default defineConfig({
  routes: {
    feed: route({
      method: "GET",
      path: "/api/feed.json",
      access: "anyone",
      async handler(req) {
        const limit = Number(req.query.get("limit") ?? "20");
        const notes = await db.query.notes.findMany({ where: { status: "published" }, limit });
        return {
          headers: { "content-type": "application/feed+json" },
          body: JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: notes.map((n) => ({ id: String(n.id), title: n.title })) }),
        };
      },
    }),
    stripe: route({
      method: "POST",
      path: "/webhooks/stripe",
      signature: { secret: env("STRIPE_WEBHOOK_SECRET"), header: "stripe-signature", scheme: "hmac-sha256" },
      handler(req) {
        const event = JSON.parse(req.body) as { type: string };
        return { status: 202, body: "ok " + event.type };
      },
    }),
  },
});
```

- `method`: `GET`, `POST`, `PUT`, `PATCH` or `DELETE`, one per route. A `GET`
  route also answers `HEAD`. A path that a route serves with another method
  answers `405`.
- `path` starts with `/`. Each segment is literal (`A-Z a-z 0-9 . _ ~ -`) or
  `:name`, which matches one segment. The last segment may be `*name`, which
  matches one or more segments; `req.params.name` is them decoded and joined
  with `/`. An encoded `/` or a `.`/`..` segment never matches. A trailing
  slash matches. Two routes with the same method and shape are refused. So is
  a first segment WordPress or Zero
  owns (`wp-admin`, `wp-json`, `wp-content`, `feed`, `zero-admin`, `auth`,
  `__spacefast`, `.well-known`, ...), and so is a URL that a
  [TSX page](pages.md) serves.
- Pass exactly one of `access` or `signature`; there is no default. `access`
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
- When several routes match, the most specific one wins, whatever their order
  in the config. Segments are compared from the left, and a literal segment
  beats a `:param`, which beats a `*rest`: `/api/feed.json` wins over
  `/api/:id`, `/api/probe/:id` wins over `/api/:kind/:id`, and
  `/files/:bucket/latest` wins over `/files/*path`.
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
import { action, defineConfig, HttpError, text } from "zero";

export default defineConfig({
  actions: {
    weather: action({
      input: { city: text().notNull() },
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
| `method` | `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` | other methods (`zero_fetch_method_denied`) |
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
  the 3xx response; `"error"` throws `zero_fetch_redirect_denied`.
- Each call has 10 s and 1 MiB for the request body and the response.
  `connection`, `host` and other hop-by-hop request headers are ignored, and
  `set-cookie` is never returned.
- A refused or failed call throws `HttpError(502)` with a code:
  `zero_fetch_scheme_denied`, `zero_fetch_credentials_denied`,
  `zero_fetch_host_denied`, `zero_fetch_address_denied`,
  `zero_fetch_method_denied`, `zero_fetch_payload_too_large`,
  `zero_fetch_response_too_large`, `zero_fetch_redirect_denied`,
  `zero_fetch_too_many_redirects`, `zero_fetch_timeout` or
  `zero_fetch_upstream_unavailable`. A non-2xx answer is a response, not an
  error.
- A handler that fetches holds its transaction open while it waits. Keep calls
  in actions short, or enqueue a job for slow ones. Access rules can't fetch.

A site plugin can open one internal target with the
`zero_fetch_allow_address` filter (`$open, $address, $host, $port`), and
answer for a privately resolved name with `zero_fetch_resolve`
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
credentials) take `env("NAME")` from `"zero"`, which is a reference, not a
value, and is refused inside handlers.

## Hashing and random values

Hash, sign and compare with `"node:crypto"` (or `"crypto"`), imported in
TypeScript or required from static CommonJS. Random UUIDs also come from the
global `crypto`. Every call is synchronous:

```ts
import { action, defineConfig, text } from "zero";
import { createHmac, timingSafeEqual } from "node:crypto";

export default defineConfig({
  actions: {
    verify: action({
      input: { body: text().notNull(), signature: text().notNull() },
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

`mail.send(message)` from `"zero"` sends email from a hook, action, route or
job:

```ts
import { action, defineConfig, email, mail, text } from "zero";

export default defineConfig({
  actions: {
    invite: action({
      input: { to: email().notNull(), name: text() },
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
  attempts, with backoff) and shows in `wp zero jobs list`.
- Delivery goes to `wp_mail`, so the site's mail plugin or SMTP configuration
  applies. Display names are RFC 2047-encoded, and line breaks, commas inside
  an address and reserved headers (`From`, `To`, `Content-Type`, ...) are
  refused at `send`.
- A managed host supplies its own transport through the
  `zero_mail_transport` filter (`null, $message` → `true` when accepted). On
  Spacefast that is the Space's sender, which requires `from` on the Space's
  primary sending domain and counts recipients against the Space's daily
  allowance. A managed host without a transport refuses rather than falling
  back to `wp_mail`.

## WordPress abilities

A handler can call any ability registered on the site with the WordPress
Abilities API: the app's own, core's, or another plugin's (WooCommerce,
Jetpack, ...). Import `abilities` from `"php/wordpress"`:

```ts
import { action, defineConfig, text } from "zero";
import { abilities } from "php/wordpress";

export default defineConfig({
  actions: {
    count: action({
      input: { text: text().notNull() },
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
- Other abilities come from `zero/abilities.json`, which you commit.
  `zero abilities pull [dir] --site <url>` writes it from a running site;
  `--only acme/*` (repeatable) keeps matching names. The pull signs in only
  with `ZERO_APP_PASSWORD=user:application-password` from the environment.
  `zero build` and `zero check` read the lock and never contact the site.
- Map `"php/wordpress"` in tsconfig.json next to `"zero"`
  (`types/wordpress.d.ts` in the CLI package); `zero build` writes the ability
  types into `zero.gen.ts` when the app imports the module.
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
- `zero doctor --site <url>` (with `ZERO_APP_PASSWORD`) reports every locked
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
  and Zero clears WordPress's cache of every option and post the call wrote.
- A call is a direct PHP function call through Zero's value conversions,
  never a PHP string or `eval`.

## WordPress hooks

`wp-hooks/` beside `zero.config.ts` adds WordPress actions and filters. Name a
file after the hook, or make a directory of that name for several handlers.
Each file default-exports its handler:

```text
wp-hooks/
├── save_post.ts
└── the_content/
    ├── 10-reading-time.ts
    └── 20-frame.ts
```

```ts
// wp-hooks/the_content/20-frame.ts
import type { Handler } from "php/wordpress";

const frame: Handler<"the_content"> = (content) => `<div class="frame">${content}</div>`;
export default frame;
```

```ts
// wp-hooks/save_post.ts
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
- `wp-hooks/` accepts only `.ts` files, directly or one directory deep. A
  file without a default export, another file type, or the same hook as both a
  file and a directory is a build error at that path.
- Handlers run in WordPress's own request, whichever it is: a page view, an
  editor save, cron, REST, WP-CLI. They are not in a Zero transaction. `db`
  works and each write commits on its own; `ctx` and `HttpError` responses
  don't apply, since there is no Zero request.
- A handler that throws is logged to the PHP error log as
  `[zero] wp-hooks/<hook>: ...`. A filter then returns the value it was given,
  so one broken handler leaves the page as WordPress rendered it. An action's
  throw stops only that handler.

## Jobs and webhooks

```ts
jobs: {
  notifyEditors: job({ input: { commentId: integer().notNull() }, retries: 3, handler: async (input, ctx) => { ... } }),
},
webhooks: [{ url: env("HOOK_URL"), secret: env("HOOK_SECRET"), events: ["posts.created", "posts.updated"] }],
```

`jobs.<name>.enqueue(input, { delay?, key? })` from a hook or action queues a
job; it runs after the request commits, never inside it. `key` collapses
duplicates still waiting. A handler that throws is retried with backoff up to
`retries`, then marked dead; `ctx.attempt` and `ctx.jobId` say which run this
is. Each job is handed to Action Scheduler (cron, or `wp action-scheduler run`);
`wp zero jobs list|retry|cancel` manage the queue.

A webhook POSTs `{ id, event, collection, at, data: { row, previous? } }` for
each matching write (`<collection>.created|updated|deleted`, or `"*"`), signed
in the `zero-signature` header as `t=<unix>,v1=hex(HMAC-SHA256(secret, "t.body"))`.
Deliveries are jobs, so a failing endpoint is retried. `env(name)` is resolved
when the webhook is sent: the process environment first, then a
`wp-config.php` constant of that name.

## Media and files

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

## Sign-in

Register one `userProjection(fields, options?)` under `users: { members }`.
It projects existing WordPress users and usermeta, preserving their IDs and
authentication; it creates no second user table or post type. It needs
`email: email().notNull().unique()`, gets a write-only `password` and an
admin-only `role`, and cannot have drafts, revisions, slugs or localization. Members sign in
through the typed client: `auth.signIn()` and `auth.handleCallback()` redirect
through the zero-identity screens (register the frontend once with
`zero identity app add --name=<name> --id=<app_id> --redirect=<url> --origin=<origin>`).
`GET /me` returns the user with their `member` row.

Anonymous visitors can write as guests (`createClient({ auth: { guests: true } })`):
the first rejected write starts a guest session, and `auth.upgrade()` keeps the
guest's rows when they sign up.

## Sync

Every publish seeds synced files: missing records are created, trashed records stay deleted, and no records are removed.
Existing editable records keep their site content; the publish reports `zero_seed_skipped_existing` for differing files, and `zero sync` merges them.
For `editor: false` collections the file wins; files without a `uid` use a stable identity derived from the collection and basename, so republishes and later syncs match the same record.

```ts
{ sync: "content/posts/*.md" }
```

`zero sync [--site <url>]`, with `ZERO_APP_PASSWORD=user:pass` (or `ZERO_TOKEN=<jwt>`) in the environment, keeps
`content/posts/<slug>.md` and the site in step: front matter for fields, the
body as Markdown for the `content` column. Both sides may change; it merges
per field, and writes `.zero/conflicts/<uid>.md` when the same field changed on
both (`zero sync resolve <uid>` applies your edit of it).
`--check` exits 2 when anything would change. The first sync with a site
matches records and deletes nothing. It commits the files it wrote unless
`--no-commit`. `zero build` adds `.zero/*` and `!.zero/sync-base.json` to
`.gitignore`, because the sync base is committed.

What sync leaves out: `$onUpdate` columns, derived and hidden system columns,
and fields the viewer's field access hides. A synced collection needs `id()`
as its primary key. References to a `uid` collection are written as that
row's uid. When required references form a cycle that no order of writes can
satisfy, sync reports it and writes nothing.

## Database API (hooks and actions only)

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

List columns (`select({ multiple })`, `media({ multiple })`) take `has`,
`isNull`/`isNotNull` and `eq: []`; JSON columns (`json`, `group`, `repeater`,
`blocks`) take `eq`/`ne` on the whole value and `isNull`/`isNotNull`, and
neither can be ordered by. On editor collections `group`/`repeater`/`blocks`
can't be compared at all (their WordPress meta is spread over many rows).
These are build errors with the same message the runtime returns.
`with: { cover: true }` on a media column puts the media row in place of the id.

`await` on these calls compiles to plain blocking PHP calls.

## Known gaps

What the design specifies and this build doesn't do yet:

- `zero sync --watch` isn't available; run `zero sync` again, or from a scheduler.
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

Use [`zero check --json`](compiler-diagnostics.md) for machine-readable blockers.
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
anything that isn't a Zero API call or your own `async` function, an `async`
call without `await`.

Build-time evaluation forbids I/O, `Date.now()`, `new Date()`, `Math.random()`,
and `db`, and stops runaway loops with a step budget.

Imports: `"zero"`, `"node:crypto"` (or `"crypto"`), relative TypeScript/ESM
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
produce plain data without class identity. Use object types in `json().$type<T>()`;
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

Classes can extend `Error`, `TypeError` and `RangeError`. `super(message,
options)` sets non-enumerable `message`, `cause` (from `options.cause`) and
`stack`, so `Object.keys` and JSON show only fields and an assigned `name`.
`name` and `message` otherwise come from the prototype, and `String(error)`
follows `Error.prototype.toString`. `instanceof` sees the whole chain, including
`Error`. Any such instance can be thrown and caught with its identity and fields
intact. `stack` is the `Name: message` header without frames; Zero does not
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
