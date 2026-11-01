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

## Full example (the pantry tracker)

```ts
import {
  collection, id, text, integer, real, boolean, date, timestamp, json,
  defineRelations, defineConfig, action, db, HttpError,
  type InferSelectModel,
} from "zero";

// Composition is plain TypeScript: shared field sets, factories, spreads.
const timestamps = {
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
};

const named = (extra = {}) => ({ id: id(), name: text().notNull(), ...extra });

export const locations = collection("locations", {
  ...named(),
  kind: text({ enum: ["fridge", "freezer", "pantry"] }).notNull().default("pantry"),
});

export const items = collection("items", {
  ...named(),
  quantity: integer().notNull().default(1),
  unit: text({ enum: UNITS }).notNull().default("pcs"),
  lowStockAt: integer().notNull().default(LOW_STOCK),
  expiresOn: date(),
  opened: boolean().notNull().default(false),
  locationId: integer().references(() => locations.id, { onDelete: "set null" }),
  tags: json().$type<string[]>().notNull().$default(() => []),
  ...timestamps,
});

export const shoppingList = collection("shopping_list", {
  id: id(),
  itemId: integer().references(() => items.id, { onDelete: "cascade" }).unique(),
  name: text().notNull(),
  done: boolean().notNull().default(false),
  ...timestamps,
});

export const schema = { locations, items, shoppingList };

export const relations = defineRelations(schema, (r) => ({
  items: {
    location: r.one.locations({ from: r.items.locationId, to: r.locations.id }),
  },
  locations: { items: r.many.items() },
  shoppingList: {
    item: r.one.items({ from: r.shoppingList.itemId, to: r.items.id }),
  },
}));

type Item = InferSelectModel<typeof items>;

async function restock(item: Item) {
  if (item.quantity > item.lowStockAt) return;
  const existing = await db.query.shoppingList.findFirst({ where: { itemId: item.id } });
  if (!existing) {
    await db.insert(shoppingList).values({ itemId: item.id, name: item.name });
  }
}

export default defineConfig({
  schema,
  relations,
  hooks: {
    items: {
      beforeCreate(data) {
        data.name = data.name.trim();
        if (data.name === "") throw new HttpError(422, "invalid_input", "name can't be empty");
      },
      afterCreate: restock,
      afterUpdate: restock,
    },
  },
  actions: {
    consume: action({
      input: { itemId: integer().notNull(), amount: integer().notNull().default(1) },
      async handler({ itemId, amount }) {
        const item = await db.query.items.findFirst({ where: { id: itemId } });
        if (!item) throw new HttpError(404, "not_found", `No item ${itemId}`);
        const [updated] = await db
          .update(items)
          .set({ quantity: Math.max(0, item.quantity - amount) })
          .where({ id: itemId })
          .returning();
        if (!updated) throw new HttpError(404, "not_found", `No item ${itemId}`);
        return { item: updated, message: `${updated.name}: ${updated.quantity} ${updated.unit} left` };
      },
    }),
  },
});
```

## Columns

The SQL column is the one a custom table (`editor: false`) gets in the
generated MySQL migration; a collection with an editor stores the same values
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

## Collections

`collection(name, columns, options?)`. `name` is the table name and the
REST path segment (`/wp-json/zero/v1/<name>`); the key under `schema` is the name used in
`db.query.<key>` and in `hooks`/`relations`. A collection with no primary key
is a build error.

| option | default | meaning |
|---|---|---|
| `label` | title-cased name | wp-admin menus, client docs |
| `editor` | `true` | WordPress: posts + SCF fields (wp-admin editing). `false`: a plain table everywhere |
| `drafts` | `editor` | adds system columns `status` (`draft \| published \| scheduled`) and `publishedAt` |
| `revisions` | `editor` | keep a revision per write |
| `title` | a `title: text()` column | the WordPress post title; must be `text().notNull()`; required when `editor` |
| `content` | a `content: richText()` column | the WordPress post content |
| `access` | read `"anyone"`, writes `"editor"` | see below |
| `api` | all `true` | `{ list?, get?, create?, update?, delete? }` |
| `uid` | `false` (`true` with `sync`) | a stable `uid` (`zr_` + 20 hex) on every row, immutable once set |
| `sync` | none | `"content/posts/*.md"` or `"*.json"`: keep rows and files in step with `zero sync`. See [Sync](#sync) |
| `auth` | `false` | this collection's rows are the app's users. See [Sign-in](#sign-in) |
| `agents` | `true` | WordPress: expose its operations as abilities, and so over MCP |

Rejected: an editor collection without a title, names longer than 15
characters on editor collections (WordPress post types are ≤ 20 with the
`zero_` prefix), the reserved names `media`, `globals`, `actions`, `me`,
`_schema`, `auth`, two `slug()` columns, `drafts: false` with `editor: true`,
and user columns named `status`/`publishedAt` on drafts collections.

### Access

`access: { read, create, update, delete }`, each one of `true`/`false`,
`"anyone"`, `"authenticated"` (signed in, guests included), a role (`"guest" <
"subscriber" < "author" < "editor" < "admin"`, that role or higher), `"self"`
(on an `auth` collection: the signed-in user's own row), or
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

`defineConfig({ name?, schema, relations?, globals?, hooks?, actions?,
jobs?, webhooks?, media?, files?, locales?, plugins?, admin? })`. `name` (a slug,
default: the project directory) names the WordPress plugin `zero-app-<name>`.
`admin: true` ships the optional admin screens as a fourth plugin,
`zero-admin`; by default the build emits none.

## Relations

`defineRelations(schema, (r) => ({ ... }))`, Drizzle 1.0 style:
`r.one.<key>({ from: r.<this>.<col>, to: r.<target>.<col>, optional? })`,
`r.many.<key>({ from, to })`. `r.many.<key>()` with no config is inferred from
the single `one` relation pointing back.

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
Deliveries are jobs, so a failing endpoint is retried. `env(name)` reads the
process environment first, then a `wp-config.php` constant of that name.

## Media and files

`media: { sizes: { card: { width: 600, height: 400, fit: "cover" } } }` makes
each named size for every uploaded image. `cover` crops around the image's
focal point (`PATCH /media/<id>` with `{ focal: { x, y } }`, editors only;
centre by default); `inside` scales to fit. Media rows carry
`sizes.<name>.url`.

<a id="files"></a>Private files live in buckets:

```ts
files: { decks: files("decks", { accept: ["application/pdf"], maxBytes: 20_000_000, access: { read: "owner", delete: "editor" } }) },
```

and a `file({ bucket: "decks" })` column holds one by id. Files never get a
public URL: `GET /files/<bucket>/<id>` returns the row with a signed `url`
valid for five minutes, and that link streams the bytes through PHP. `"owner"` means the uploader. Uploads outside
`accept` are refused (422 at `/file`); uploads over `maxBytes` get 413
`payload_too_large`.

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

One collection may be `auth: true`: its rows are the app's users, which are
WordPress users. It needs a unique `email`, gets a write-only `password` and
an admin-only `role`, and can't be an editor collection. Members sign in
through the typed client: `auth.signIn()` and `auth.handleCallback()` redirect
through the zero-identity screens (register the frontend once with
`wp zero-identity app add --name=<name> --id=<app_id> --redirect=<url> --origin=<origin>`).
`GET /me` returns the user with their `member` row.

Anonymous visitors can write as guests (`createClient({ auth: { guests: true } })`):
the first rejected write starts a guest session, and `auth.upgrade()` keeps the
guest's rows when they sign up.

## Sync

```ts
{ sync: "content/posts/*.md" }
```

`zero sync --site <url> --app-password user:pass` (or `--bearer <jwt>`) keeps
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

Supported: `const`/`let`, functions, arrows, closures, destructuring,
spread, template literals, `if`/`for`/`for...of`/`while`/`switch`/`try`,
`?.`, `??`, objects, arrays, type annotations, type aliases, interfaces,
generics (erased).

`encodeURI(value)` and `encodeURIComponent(value)` accept exactly one string in
configuration evaluation and compiled handlers. Both preserve `-_.!~*'()`;
only `encodeURI` preserves URI delimiters (`;,/?:@&=+$#`). They percent-encode
UTF-8 bytes with uppercase hex. The PHP helper refuses malformed UTF-8 with
`URIError`; source strings with lone UTF-16 surrogates are already outside the
subset. General JS argument coercion and decoding globals are not implemented.

Use [`zero check --json`](compiler-diagnostics.md) for machine-readable blockers.
The [tested compatibility inventory](language-support.md) links specific
restrictions and intentional differences to executable evidence.

Indexed array/tuple reads and destructured elements include `null` when an
entry is missing (Zero represents `undefined` as PHP null). Check the fetched
value or supply a default with `??` or a destructuring initializer. A non-null
assertion (`values[0]!`) is available when your code guarantees the entry exists.

Mutating a tuple broadens its positional reads to the union of its element
types; its authored assignment constraints remain unchanged. Optional parameters
include null in body reads, while a default initializer supplies the missing value.

Rejected with a located error and a fix: classes, `this`, `var`, `enum`,
`==` (except `== null`), `in`, `instanceof`, `delete`, generators,
`for...in`, labels, getters/setters, BigInt, dynamic `import()`, `any`,
`eval`/`Function`, assigning to module-level state from a hook, mutating an
object after storing it in another (PHP copies on store), changing an array
element in place (`list[i] = v`, `list[i] += v`, `list[i]++`, `list[i].x = v`;
use `push`, or build the new array with `map`; PHP turns a hole into a key), a closure
capturing a `for (let …)` variable that holds an object or array (copy what it
needs into a `const` inside the loop body),
`includes`/`startsWith`/`endsWith` on a string with a position (slice first),
a `lastIndexOf` position that may be null or undefined, reassigning a
parameter that also mutates its object or array (use a separate local
binding for the replacement), mutating a nested container through a
destructured parameter (accept the whole parameter), replacing an earlier
object/array argument passed to a mutating parameter while evaluating a
later argument (evaluate them in separate statements), `await` on anything that isn't a Zero API call or your own `async` function, an
`async` call without `await`.

Build-time evaluation forbids I/O, `Date.now()`, `new Date()`, `Math.random()`,
and `db`, and stops runaway loops with a step budget.

Imports: type-only imports (erased), relative `.ts` files (compiled with the
config), and `"zero"`. npm packages are rejected unless they ship TypeScript
source that fits the subset (not implemented yet: today they're rejected).
