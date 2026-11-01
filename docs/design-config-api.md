# Design: the `zero.config.ts` API, reviewed

Status: proposal, for the owner's review. Nothing here is implemented. After
approval it lands as stacked PRs (§7).

`zero.config.ts` is the product. Zero is "a TypeScript framework for building
backends, fast", and the config file is the whole authoring surface: every
collection, field, rule, hook, action, job and integration is written there,
evaluated at build time by Zero's own evaluator, and compiled to a WordPress
plugin. The phase-1 and phase-2 lanes each added their own options in
parallel, and the seams show. This document inventories what exists, checks
every claim against the compiler (`src/extract.rs`, `src/eval.rs`), borrows
from the systems users already know, and proposes one consistent, smaller
API.

Zero is WordPress-only: the standalone PHP+SQLite target is being removed.
This proposal is written for that Zero: every default below is a WordPress
primitive (post status, roles and capabilities, SCF field types,
attachments, `wp_users`), and §4.12 lists what having one target lets the
config drop outright. Line references to the compiler are to `main` at
`b45e586`, before the removal.

Three sentences of the result:

- **Collections are inferred from their columns.** `id`, `createdAt`,
  `updatedAt`, the title, the body, the slug, the post type and the relations
  all come from the column set; nothing needs declaring twice.
- **Everything about a collection lives in `collection()`.** Access, hooks and
  the sync pattern sit beside the columns; `defineConfig` only lists what
  exists plus the app-wide things (jobs, webhooks, locales, media, buckets).
- **One way to say each thing.** Six duplicate spellings go, three
  single-purpose flags go, two flags become inferred, and the examples shrink by
  a sixth without losing a feature.
- **WordPress is the vocabulary.** A content collection is a post type with
  its native status, a table is a `$wpdb` table, access is roles and
  capabilities, a user is a `wp_users` row, media is an attachment. Nothing
  in the config exists to make a second runtime behave the same.

The before/after rewrite of the two examples is in §5: `examples/site` goes
from 205 to 169 lines (170 to 137 non-comment), `examples/pantry` from 117
to 102 (105 to 89) and loses most of its helper module, each with the same
features as on `main`.

---

## 1. Inventory of today's surface

Everything below is what `src/extract.rs` and `src/eval.rs` accept on `main`
(the reference, `docs/config-api.md`, only documents what already compiles).
Line references are
to `main` at `b45e586`.

### 1.1 Column builders (18 kinds, `src/eval.rs:1358`)

| builder | options | storage kind |
|---|---|---|
| `id()` | | integer PK autoincrement |
| `integer()`, `real()`, `boolean()`, `date()`, `timestamp()`, `json()` | | scalar |
| `text(opts?)` | `enum`, `multiline` | text |
| `email()`, `url()` | | validated text |
| `slug(opts?)` | `source` | unique text |
| `richText()` | | HTML |
| `media(opts?)` | `accept: "image" \| "any"`, `multiple` | media id / id list |
| `file({ bucket })` | `bucket` (required) | private file id |
| `select({ options, multiple? })` | | `text({ enum })` or JSON list |
| `group({ fields })`, `repeater({ fields })` | | JSON |
| `blocks({ layouts })` | | JSON tagged list |

### 1.2 Column modifiers (`src/eval.rs:2028`, the `MODIFIERS` list)

`notNull`, `unique`, `primaryKey`, `default`, `defaultNow`, `$default`,
`$defaultFn`, `$onUpdate`, `$onUpdateFn`, `references`, `$type`, `min`, `max`,
`pattern`, `validate`, `access`, `showIf`, `localized`.

### 1.3 Collection options (`COLLECTION_OPTIONS`, `src/extract.rs:64`)

`label`, `editor`, `drafts`, `revisions`, `title`, `content`, `access`, `api`,
`sync`, `uid`, `auth`, `agents`.

### 1.4 `defineConfig` keys (`src/extract.rs:49`)

`name`, `target`, `schema`, `relations`, `globals`, `hooks`, `actions`,
`jobs`, `webhooks`, `files`, `media`, `locales`, `plugins`. The Zero Admin
design (`docs/design-admin.md`) proposes `admin: true`.

### 1.5 Other builders

- `global(name, fields, { label?, agents?, access?: { read?, update? } })`;
  `defineConfig.globals` key must equal `name` (`src/extract.rs:976`).
- `defineRelations(schema, (r) => ({ coll: { rel: r.one.x({ from, to, optional? }) | r.many.x({ from, to }?) } }))`.
- `action({ input, handler, access?, agents?, idempotent?, signature? })`;
  `input` is optional in the compiler (`src/extract.rs:453`), required in
  the types (`index.d.ts:1012`).
- `job({ input, handler, retries?, agents? })`; `input` required
  (`src/extract.rs:2530`).
- `files(name, { accept, maxBytes, access?: { read?, create?, delete? } })`;
  `defineConfig.files` key must equal `name` (`src/extract.rs:2143`).
- `env(NAME)`, `once(key, fn)`, `jobs.<name>.enqueue(input, { delay?, key? })`,
  `db`, `HttpError`.
- Access vocabulary (`src/extract.rs:912`): `true`/`false`, `"anyone"`,
  `"authenticated"`, a role (`guest < subscriber < author < editor < admin`),
  `"self"` (auth collections, not on create), `"owner"` (file buckets only),
  or a function returning `boolean | filter`.
- Hooks: `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`,
  `beforeDelete`, `afterDelete`, keyed by schema key under `defineConfig.hooks`.

### 1.6 Findings

Each finding was checked against the compiler, not the docs. **R** =
redundancy (two ways to say one thing), **I** = inconsistency, **D** = a flag
that should be a default or inferred, **U** = no real use.

| # | kind | finding | evidence |
|---|---|---|---|
| F1 | R | `text({ enum })` and `select({ options })` are the same column. | `"select" => ColType::Text` and `"enum" \| "options" => c.enum_values` (`src/eval.rs:1372,1451`). 4 uses of the first form, 11 of the second. |
| F2 | R | `$default`/`$defaultFn` and `$onUpdate`/`$onUpdateFn` are literal aliases. | `"$default" \| "$defaultFn" =>` (`src/eval.rs:1974`). Zero uses of either `Fn` alias in the repo. |
| F3 | R | `id()` and `integer().primaryKey()` produce the same column. | `"primaryKey" => { c.auto_increment = c.ty == ColType::Integer }` (`src/eval.rs:1947`). 153 of 163 collections write `id: id()` by hand. |
| F4 | R | `defaultNow()` and `$default(() => new Date())` are the same (`DefaultVal::Now`). | `now_or_fn` (`src/eval.rs:1890`). |
| F5 | R | `timestamp().notNull().defaultNow()` + `.$onUpdate(() => new Date())` is written by hand in every example (8 times, plus a shared `timestamps` helper in pantry), while WordPress posts already carry `post_date`/`post_modified`. Payload and Convex add these automatically. | `examples/pantry/lib/fields.ts`, `WpPostStore.php:85`. |
| F6 | R | A relation needs three declarations: the `references()` column, `r.one` with `from`/`to`, and `r.many` on the other side. The `one` side is derivable from the FK and the `many` side already is (`pending_many`). Every `r.one` in the repo (14) repeats exactly the `references()` pair. The two mechanisms are independent today (an FK without a relation, or a relation without an FK, both compile); no config in the repo uses a relation without an FK. | `src/extract.rs:1288,1678-1870`. |
| F7 | R | `files.<key>` must equal `files(name, …)`'s name; same for `globals.<key>` and `global(name, …)`. The name is stated twice and the compiler rejects a mismatch. | `src/extract.rs:976,2143`. |
| F8 | R | `uid: true` is implied by `sync`, required for being a sync reference target, and otherwise unused in examples except to satisfy that rule (3 uses, all for sync). | `uid = flag("uid")?.unwrap_or(sync.is_some())` (`src/extract.rs:705`); `sync references need uid: true on …` (`:2490`). |
| F9 | R | `access.update` and `access.delete` are identical in 4 of 5 examples; `create`/`update`/`delete` are identical in most. There is no "all writes" shorthand. | `ACCESS_OPS` loop (`src/extract.rs:812`). |
| F10 | R | `ctx.user?.role === "admin" \|\| ctx.user?.role === "editor"` is the way to say "editor or above" inside a function; the ladder exists in the runtime but not in `ctx`. 7 copies in the repo, plus a `STAFF` array in the site example. | `Access.php:53` has `roleRank`; `AccessCtx` has only `user`. |
| F11 | I | `editor` names a WordPress storage choice but is the master switch for `drafts` and `revisions`, and it was explained as "no storage effect on standalone"; `editor: false` appears on 111 collections (93 in fixtures, 86 fixture files), i.e. the "default" is the minority case for everything that isn't blog content. | `editor = flag("editor")?.unwrap_or(!auth)`; `drafts … None => editor`; `revisions … unwrap_or(editor)` (`src/extract.rs:658-667`). |
| F12 | I | `title`/`content` are inferred only from columns literally named `title` and `content`; a `name: text().notNull()` collection must add `title: "name"` (7 uses). WordPress needs a title; the inference rule could cover the first NOT NULL text. | `columns.get("title").filter(...)` (`src/extract.rs:716`). |
| F13 | I | Structured builders take their fields under a key (`group({ fields })`, `blocks({ layouts })`) while `select` takes `options`; a bare object would do, since each builder has exactly one required option. | `required` table (`src/eval.rs:1390`). |
| F14 | I | `media({ accept: "image" })` is a two-value enum while `files({ accept: ["image/*"] })` takes MIME patterns. Same concept, two grammars. | `src/eval.rs:1462`, `src/extract.rs:2149`. |
| F15 | I | `files()` takes a bucket name as its first argument; `global()` takes a name; `collection()` takes a table name; `job()` and `action()` take none (the key names them). | signatures in `index.d.ts`. |
| F16 | I | Collection-level `access` has four ops; field-level has three (no `delete`); globals two; files three (`read`, `create`, `delete`, no `update`); actions one. Fine in substance, but the shorthands differ: `"self"` only on auth collections, `"owner"` only on buckets, and neither on the collections that model ownership with a hand-written `ownerId`/`userId` column (8 uses) and a function rule. | `access_rule` (`src/extract.rs:912-945`). |
| F17 | I | `hooks` live in `defineConfig`, keyed by schema key, far from the collection; `access` lives in the collection. Every hook in the repo is about one collection. The WP test app needs a `mergeHooks` helper because of it. | `src/extract.rs:360-420`, `tests/wp/app/compose.ts`. |
| F18 | I | `relations` are keyed by schema key, `references()` by collection value, `webhooks.events` by table name (`posts.created` checks `out.schema.collections.contains_key`, which is keyed by table). Three namings for one collection. | `src/extract.rs:2619`. |
| F19 | I | `locales: { default, all, fallback? }`: `default` must be repeated inside `all`, and `fallback: false` is unused anywhere. | `src/extract.rs:2072-2096`. |
| F20 | I | `slug({ source })` is unique by construction and limited to one per collection, so it is a collection property spelled as a column option. Fine, but `source` must name a column while `title:` is also a column name, so the same post has `title: "name"` and `slug({ source: "name" })`. | `src/extract.rs:769`. |
| F21 | D | `drafts` and `revisions` default to `editor`, and `drafts: false` with `editor: true` is rejected; the independent settings are `drafts: true` on a table (1 non-rejection use) and `revisions` either way (5 uses, all `true` on tables). | `src/extract.rs:659-667`. |
| F22 | D | `agents` defaults `true` everywhere except jobs (`false`); 9 uses, all in tests. It is a WordPress-only MCP visibility flag that most users will never touch. The asymmetry is deliberate (phase-2 ruling: an agent enqueuing a job is a side effect) and stays. | `src/extract.rs:709,2523`. |
| F23 | D | `label` is title-cased from the table name; every explicit `label` in the examples equals the derived one except `"Site settings"`. | `title_case` (`src/schema.rs:526`). |
| F24 | D | `.notNull().default(x)` is what nearly every defaulted column in the repo writes: `boolean().notNull().default(false)` 10 times, `.notNull().default([])` 5 times. The exceptions are global fields and sub-fields (`text().default("Hello")` in `phase2-surface`), where NOT NULL would need the default anyway. Today a default only fills an *absent* value; an explicit `null` is still accepted unless `.notNull()` is there too (`Db.php:429`). So the two words are not redundant, but the combination users almost always want is two words long. | `src/eval.rs:1907,1952`; `RequiredInsertKeys` (`index.d.ts:322`) makes a defaulted column optional on insert. |
| F25 | D | `unique()` text needs `.max(191)` or the build fails; the number is a MySQL constant the user has to know (22 uses). | `MAX_UNIQUE_TEXT` (`src/extract.rs:82`). |
| F26 | D | `target` in the config duplicates `zero build --target`; 3 uses, all in fixtures. With one target it has no meaning at all. | `src/extract.rs:169`. |
| F27 | U | `api: { list, get, create, update, delete }`: zero uses in the repo. Access rules cover everything but splitting `list` from `get` (either direction), and a disabled op answers 405 rather than 403 (`App.php:328`). | `src/extract.rs:854`. |
| F28 | U | `references(..., { onUpdate })`: ids are autoincrement and never change; zero uses. | `src/eval.rs:2002`. |
| F29 | U | `.primaryKey()` on a non-integer column: 3 fixture uses, two of them rejection tests. Auth collections require a key named `id`; editor and sync collections require an autoincrement integer key under any name (`src/extract.rs:681,2394,2475`). | `src/extract.rs:671,2394,2448`. |
| F30 | U | `optional: false` on `r.one` is a type-only flag (4 uses, each on a `.notNull()` FK) and it is unsound: a loaded `one` is `null` whenever the viewer may not read the target or a nested `where` excludes it, whatever the FK says (`Db.php:292`). | `src/extract.rs:1751`; `index.d.ts:541`. |
| F31 | I | `action.input` is required in the types but optional in the compiler; `job.input` is required in both. Two actions write `input: {}`. | `src/extract.rs:453` vs `:2530`. |
| F32 | I | `defineConfig.schema` is the Drizzle word, but Zero's docs, REST paths, abilities and the admin all say "collections". | `src/extract.rs:51`. |

Not findings, kept as they are: the Drizzle 1.0 object filter and
`db.query` API (users know it, the compiler checks it); the restricted TS
subset; `.validate()`, `.min/.max/.pattern`; `showIf` as UI-only (Payload
semantics, as `docs/design-phase2.md` §10 decided); `job`/`action`/`once`/`env`; `plugins`.

---

## 2. What the others do, and what fits a compiled config

Each borrowed idea names its source and why it fits Zero, whose config is
evaluated once at build time by a Rust evaluator (no runtime reflection, no
classes, no npm).

| idea | from | why it fits Zero |
|---|---|---|
| Automatic system fields: `_id`/`_creationTime` (Convex), `timestamps: true` default adding `createdAt`/`updatedAt` (Payload), `date-created`/`date-updated` specials (Directus). | Convex, Payload, Directus | The extractor already injects `status`, `publishedAt`, `uid`, `locale`; adding `id`, `createdAt`, `updatedAt` is the same mechanism (`src/extract.rs:321`). |
| Feature toggles that inject known fields: `auth: true`, `upload: true`, `versions.drafts`. `true` means defaults, an object refines. | Payload | Zero's `auth: true` already does this; `drafts`/`revisions` fold into one content toggle. |
| Title designated by a pointer (`displayField`, `useAsTitle`, `titleField`, `slugField`), with a documented inference fallback (a string field named `title`). | Contentful, Payload, EmDash, Keystatic, Sanity's default preview | Zero already does exactly this (a column named `title`, else the `title:` pointer) and keeps it. A pointer is checkable at build time; a per-field `isTitle` flag (Tina) needs a "one per collection" runtime rule. |
| The reverse side of a relation is inferred from the forward side (`r.many.posts()` with no config, `join` fields). | Drizzle 1.0, Payload | The extractor's `pending_many` already does this; the proposal makes the forward side inferred from the FK too. |
| Reference as a typed column that names its target: `v.id("users")`, `relationTo: "users"`, `fields.relationship({ collection })`, `to: [{ type: "author" }]`. | Convex, Payload, Keystatic, Sanity | A `ref("authors")` column names the target by its registered key, as `v.id("users")` does; `references(() => authors.id)` makes the user name the PK, which is always `id`. |
| Access functions return `boolean \| Where`; field access is boolean only. | Payload | Exactly Zero's model; keep. |
| A role check available on the context (`currentUser.roles.find(...)`) and the role ladder as a comparison. | Sanity conditional fields, Zero's own runtime | `ctx.is("editor")` compiles to `roleRank` which already exists in PHP (`Access.php:53`). |
| Validation stays a chainable builder (`required().min().max().regex()`, `.custom((value, ctx) => true \| "message")`). | Sanity `Rule`, Payload `validate` | Zero's `.min/.max/.pattern/.validate` already match; keep. |
| `options.list` / `select.options` as a bare array of strings. | Sanity, Payload | `select(["a", "b"])` is a positional literal, trivially evaluated. |
| Conditional UI as a pure function of a fixed context, never async. | Sanity `hidden`, Payload `admin.condition` | `showIf` as a static sibling filter is even simpler and stays; the compiler already checks it. |
| Localization per field with one flag, locales listed once at the top. | Contentful `localized`, Payload `localized`, EmDash `translatable` | Zero's `.localized()` is right; `locales` becomes a plain array. |
| Hooks keyed by event name beside the collection. | Payload `hooks`, Strapi `lifecycles` | Moving `hooks` into `collection()` costs nothing: the extractor compiles closures from wherever it finds them (`out.roots`). |
| MIME patterns for uploads: `mimeTypes: ["image/*"]`. | Payload | One grammar for `media.accept` and buckets. |
| Image sizes with `position`/focal, declared once at the upload level. | Payload `imageSizes` | Zero's `media.sizes` already matches; keep. |
| Validators double as function input schemas: `query({ args: v.* })`. | Convex | Zero's `action({ input: { … columns } })` already matches; keep, make `input` optional. |
| Config must be deterministic (no `Date.now()` at config time). | Tina | Already enforced by the evaluator; state it as a principle. |
| Content as files with `path`/`format` beside the collection. | Keystatic, Tina | Zero's `sync: "content/posts/*.md"` already matches; keep. |

Rejected after study: Sanity-style `defineField({ type: "string" })` object
literals (Zero's chainable builders type better and are already evaluated);
Keystatic `conditional()` as the blocks primitive (Zero's `blocks()` is the
same union with a nicer spelling); Payload-style default-deny access (Zero's
public-read default is right for a CMS and its examples depend on it); Drizzle
`snakeCase.table` casing wrappers (Zero's columns are the API's field names;
WordPress meta keys are already prefixed); Payload's own role model (a
`users` collection with a `roles` field): Zero's roles *are* WordPress roles
and its capabilities come from `map_meta_cap`, so inventing a second ladder
would be the kind of parallel runtime a WordPress-only Zero has no use for.

---

## 3. Principles

1. **The least config.** A content collection is its columns. A table is its
   columns. Everything else has a default that is right for a CMS and can be
   turned off in one word.
2. **Inference over declaration.** If the columns say it, the user doesn't:
   the primary key, timestamps, the title, the body, the slug, the relations.
3. **One way to do each thing.** No aliases, no two spellings of a column kind,
   no name stated twice.
4. **Field-level where it belongs, collection-level where it belongs.** Rules
   about a value sit on the column; rules about rows (access, hooks, sync,
   auth) sit on the collection; app-wide things (locales, media, buckets,
   jobs, webhooks) sit in `defineConfig`.
5. **Every magic default is overridable and predictable.** §4.9 lists what each
   one expands to and the one word that turns it off.
6. **Buildable.** Everything below is a literal, a builder chain, a closure
   or a lazy arrow, i.e. what the evaluator already folds. §7.3 lists the
   three places the subset grows.
7. **WordPress primitives, not Zero re-inventions.** When a default needs a
   concept, it is the WordPress one: `post_status` for drafts and scheduling,
   `wp_users` and roles for identity and access, attachments for media, SCF
   field types for the editor, Action Scheduler for jobs, Polylang for
   locales. The config never names a runtime.

---

## 4. The proposed API

### 4.1 Columns

Builders (19: `id` goes, `ref` and `user` arrive, and `select` absorbs
`text({ enum })`):

```ts
text(opts?)          // { multiline?: true }
integer(), real(), boolean(), date(), timestamp(), json<T>()
email(), url()
slug(opts?)          // { source?: column | false } — source defaults to the title; false = supplied by the writer
richText()
media(opts?)         // { accept?: string | string[], multiple?: true }   MIME patterns, default any
file("bucket")       // the bucket's key under defineConfig.files
select(options, opts?)   // select(["a","b"]) | select(["a","b"], { multiple: true })
ref("target", opts?) // the target's key under defineConfig.collections; { onDelete?: "cascade" | "restrict" | "set null" }
user(opts?)          // a wp_users id, the ownership column (§4.8); { onDelete?: "cascade" | "restrict" | "set null" } as for ref
group({ ...fields }), repeater({ ...fields }), blocks({ layout: { ...fields } })
```

`many("target", "column")` is not a column; it names an inferred reverse
relation in a collection's `relations:` option (§4.3).

What changed and why:

- **`select(options)`** is the only enum column. `text({ enum })` goes (F1).
  `select` is the CMS word (Sanity `options.list`, Payload `select`,
  Contentful `in`), and the array is positional because it is the one
  required option (F13).
- **`group`, `repeater`, `blocks`** take the fields object directly (F13).
  `blocks({ hero: {...}, quote: {...} })` reads as "these layouts".
- **`json<T>()`** replaces `json().$type<T>()`, and `$type` goes. The
  evaluator already reads call type arguments for `$type` (`src/eval.rs:891`);
  the same `type_args` on `json` is one line. `$type` on any other column
  is already a build error (`src/eval.rs:2073` allows it on `json` only,
  whatever the declaration says), and a scalar brand like `number &
  { __brand }` does not lower (`src/lower.rs:944` merges object
  intersections only), so there is nothing to keep. All 4 uses in the repo
  are on `json()`.
- **`ref("authors")`** replaces `integer().references(() => authors.id, …)`
  (F6). The argument is the target's key under `defineConfig.collections`,
  the same name `db.query.authors`, `hooks` and webhook events use. The
  column is an integer FK to the target's automatic `id`; a target with its
  own `.primaryKey()` column, text or integer, cannot be referenced (build
  error: "`codes` has its own key `code`; references need the automatic
  `id`"). That is an API choice, not a typing limit: a text key could not
  type as `number` when the column's TS type is fixed before the target is
  known, but an integer custom key could. Allowing only the automatic `id`
  keeps `ref()` one shape (an integer named `<x>Id`, relation `<x>`), and
  every reference in the repo targets an automatic integer `id`. A relation
  with no foreign key behind it (allowed
  by `defineRelations` today, unused in the repo) goes with it: `ref()` is
  both the constraint and the relation. The extractor resolves the key after
  every collection is registered, the
  way it resolves `hooks.<key>` today (`src/extract.rs:367`), so forward and
  self references need no lazy arrow. It also declares the relation (§4.3).
  References to non-key columns (one fixture, `a.name`) go; a
  `.references()` escape hatch is not kept.

  Typing, and why it is not circular: at the column, `ref("authors")` is
  `ColumnBuilder<"ref", number, …, { target: "authors" }>`, a string
  literal carried as a phantom type and nothing more; the column's own type
  is `number` everywhere (row, insert, filter), which is why text-keyed
  targets are refused rather than typed late, so defining a collection
  never depends on the map it will be registered in. The key is validated and the relation
  typed only where today's relation typing already lives: `zero.gen.ts`
  registers the config, and `db.query.<key>`, `with` and relation filters
  derive from `Register` after the fact (`index.d.ts:814`). A wrong key is
  a build error with a suggestion, and in the editor a type error on
  `with: { author: true }`, not on the column. This is what lets
  `collection()` drop its name argument (§4.2): a collection's identity is
  its key, not its column set.
- **`media({ accept })`** takes MIME patterns like buckets do (F14); both
  accept one pattern or a list. `"image"` is not a value; the error for it
  suggests `"image/*"`. `multiple: true` needs `accept` within `image/*`:
  SCF renders a media list as a `gallery` field (`Wp/Scf.php:165`), which
  is images only, so a mixed or document list is a build error ("a media
  list is an image gallery; use a repeater of `media()` for other files").
- **`file("manuscripts")`** takes the bucket's key under
  `defineConfig.files` (F7, F15), resolved and type-checked exactly like a
  `ref` target. Today's `{ bucket: "name" }` object becomes the one string
  it carries.
- **`id()` goes** (F3, see §4.9.1). A collection gets `id` automatically.
  `.primaryKey()` stays for the rare custom key and is allowed on
  `integer`, `text`, `email`, `url` and `slug` only (today every builder
  accepts it, `src/eval.rs:2064`, so `json().primaryKey()` extracts and
  then renders an unkeyable `LONGTEXT` key, `src/migrate.rs:250`); a text
  key implies `.max(191)` like `.unique()` does, so MySQL gets a `VARCHAR`
  it can key. A custom key suppresses the automatic `id` (F29).

Modifiers (13, down from 18):

```
.notNull() .nullable() .unique() .primaryKey()
.default(value | () => value)   // a constant, or a function run in PHP on insert
.onUpdate(() => value)          // run in PHP on update
.min(n) .max(n) .pattern(/re/) .validate((value, ctx) => true | "message")
.access({ read?, write? | create?, update? }) .showIf(filter) .localized()
```

- **`.default()` accepts a function** and `$default`, `$defaultFn`,
  `defaultNow`, `$onUpdateFn` go (F2, F4). The evaluator already branches on
  `Value::Closure` inside `default` to reject it (`src/eval.rs:1952`); it
  routes to `now_or_fn` instead. `() => new Date()` on a time column still
  means "now" (`DefaultVal::Now`, filled by the PHP pipeline; SQL defaults
  carry constants only, `src/migrate.rs:130`). `$onUpdate` loses the `$`
  because nothing else in the modifier set has one and Drizzle's `$` marks
  "not a SQL default", which is true of every Zero default function.
- **`.onUpdate()` no longer counts as a default.** Today `$onUpdate` sets
  `hasDefault` in the types (`index.d.ts:168`) but not in the compiler
  (`src/extract.rs:1383`, `optional_on_insert` at `src/schema.rs:213`), so
  `timestamp().notNull().$onUpdate(fn)` may be omitted on insert in
  TypeScript and is required by the build. The compiler's reading is the
  right one and the types follow it; a column that needs both uses
  `.default(fn).onUpdate(fn)`, which is what the automatic `updatedAt`
  expands to.
- **`.default()` implies `.notNull()`** (F24). This is a behaviour change,
  not a removal of redundant syntax: today `.default(false)` alone still
  accepts an explicit `null`; after it, the column is NOT NULL, an explicit
  `null` is a 422, and an absent value takes the default. That is what every
  defaulted column in the repo asks for, so `boolean().default(false)` reads
  as the column it is. Precedence: `.nullable()` anywhere in the chain wins
  over the implication, in either order (`.nullable().default(x)` and
  `.default(x).nullable()` are the same column: nullable, default `x` when
  absent). `.default(null)` is a build error ("a null default is the
  absence of one; drop it or use `.nullable()`"). `.notNull().default(x)`
  stays valid and means the same as `.default(x)`. The explicit words never
  resolve by order: `.nullable()` together with `.notNull()` or
  `.primaryKey()` in one chain is a build error at the second of them
  ("`x` is both nullable and NOT NULL"). Only the *implied* NOT NULL from
  `.default()` yields to `.nullable()`. The compiler's handler-input typing
  follows the same words: today it strips nullability from every defaulted
  action or job input (`src/types.rs:426`) while the declarations keep it
  (`InferActionInput`, `index.d.ts:998`); after this, a `.default(x)` input
  is non-null in both and a `.nullable().default(x)` input is nullable in
  both. One declaration follows: the write
  shape of `group`/`repeater`/`blocks` sub-fields (`WriteStructured`,
  `index.d.ts:335`) makes a sub-field optional by nullability alone, so a
  NOT NULL sub-field with a default would become required on write even
  though the runtime fills it; it becomes optional when nullable *or*
  defaulted, which is what the runtime already does. That needs the
  structured builders to carry their child builders (`F`) instead of the
  erased `SelectShape<F>` (`index.d.ts:301`), so `hasDefault` survives to the
  write type; the read type is unchanged. Globals get the same treatment:
  their update type is `Partial<SelectShape>` today (`index.d.ts:1027`) and
  the compiler checks `db.globals.x.update()` patches against the read shape
  (`src/compile.rs:4491`); both move to the write shape so a defaulted
  sub-field may be omitted in a global patch as it may in a row.
- **`.unique()` on a text kind implies `.max(191)`** (F25): `text`,
  `email` and `url`, the kinds today's check covers (`src/extract.rs:1224`,
  `is_stringy`). The constant moves into the compiler; an explicit larger
  `.max()` on a unique text column is the build error it is today.
- **`.unique()` is declared for the kinds the evaluator accepts.** Today
  the declarations allow it on `boolean` (`UniqueKind`,
  `types/zero/index.d.ts:91`) and the evaluator rejects it
  (`src/eval.rs:2070`), so `boolean().unique()` type-checks and then fails
  the build. `boolean` leaves `UniqueKind`; the kinds otherwise match
  (integer, real, date, timestamp and the text kinds) and nothing in the
  repo is affected.
- **`.access({ write })`** is a shorthand for `create` and `update` together
  (F9); either may still be given alone and the specific one wins.

### 4.2 Collections

```ts
collection({ ...columns }, {
  // identity
  label?: string,            // default: title case of the key
  title?: column,            // default: a column named title (§4.9.2)
  body?: column | false,     // default: the only richText column; several need a choice (§4.9.5)
  author?: column | false,   // content only: the user() column stored as post_author; default: the only one (§4.8)
  // behaviour
  content?: boolean,         // default: inferred (§4.9.3). true = posts + drafts + revisions on WP; false = a plain table
  drafts?: true,             // on a table: add status/publishedAt and scheduling anyway
  revisions?: boolean,       // default: content
  sync?: "dir/*.md" | "dir/*.json",
  auth?: true,
  // rules
  access?: { read?, write?, create?, update?, delete? },
  hooks?: { beforeCreate?, afterCreate?, beforeUpdate?, afterUpdate?, beforeDelete?, afterDelete? },
  relations?: { name: many("other", "column") | false } | false,   // name or decline an inferred reverse (§4.3)
  // rarely
  timestamps?: false,        // drop createdAt/updatedAt
  agents?: false,            // keep out of MCP (WordPress)
})
```

- **No name argument.** The schema key is the name, like `jobs`, `actions`
  and Drizzle's `defineRelations` keys (F15, F18). One value, one key: the
  same `collection()` value registered under two keys is a build error
  ("`records` is registered as `active` and `archived`; call `collection()`
  twice"), so `db.insert(records)` always names one table, as today's
  object-identity lookup requires (`src/compile.rs:945`). The table name is
  the key;
  `zero_` prefixing is unchanged. Snake-case keys stay valid identifiers
  (`shopping_list` today) and a camel-case key (`shoppingList`) is the
  table name `shoppingList`, which MySQL accepts; the REST path is
  the key too. The three namings (key, table, `.$name`) collapse to one.
  WordPress lower-cases registered post-type names, so a content
  collection's key must be lowercase (`blog_posts`, not `blogPosts`): a
  camel-case key on a content collection is a build error, beside today's
  15-character one. Tables keep any identifier.
- **`content` replaces `editor`** (F11). The word says what it is: a
  content collection is a WordPress post type (`zero_<key>`, SCF fields,
  the block editor, core revisions, `post_status` with `future` for
  scheduling, `/wp/v2/zero_<key>` under Zero's access rules); a table is a
  `$wpdb` table. `editor` was named for a storage switch and then explained
  as "no storage effect on standalone, it only drives defaults"; with one
  target there is nothing to keep in step and the flag is the kind.
  `drafts: true` and `revisions: true` stay as opt-ins on tables (F21: the
  only independent setting today), and `revisions: false` as the opt-out on
  content. `drafts: false` on content stays rejected: a post always has a
  status.
- **`body` replaces `content`** as the designation of the rich-text column,
  because `content` now names the collection kind, and "body" is the word the
  Markdown sync already uses for it.
- **`hooks` move in** (F17). They are compiled identically; the key under
  `defineConfig` goes. Inline hook functions are contextually typed from the
  columns, `beforeCreate(data) { data.name … }` as today. A *named* helper
  used as a hook (`afterCreate: restock`) cannot be typed from the
  collection it is a hook of: `items`' initializer mentions `restock`, so a
  `Row<typeof items>` parameter on `restock` is a cycle TypeScript reports
  (TS7022/TS2502), `NoInfer` or not, and so is `Row<"items">` through the
  registered config. The helper is typed from the *columns*, which are a
  separate value: `const itemFields = { … }`, `collection(itemFields, {
  hooks: { afterCreate: restock } })`, `function restock(item:
  Row<typeof itemFields>)`. `Row<F>` accepts a columns object as well as a
  collection. For a columns object it is the row `collection(F, O)` would
  have, with `O` an optional second type argument defaulting to `{}`:
  exactly one derivation, the `.d.ts`'s `Collection<TCols, TOptions>`
  type, applied to the same inputs the collection was given. That
  derivation includes the inference of §4.9: `{ title: text().notNull() }`
  with no options is a content collection, so `Row<typeof thoseFields>`
  has `status` and `publishedAt`, as the collection's row does. A
  collection whose *options* change the row (`content: false` on a
  titled table, `sync`, `auth`, `timestamps: false`) types its named
  helper with the same options object: `const itemOptions = { sync:
  "content/items/*.md" } as const`, passed to both `collection()` and
  `Row<typeof itemFields, typeof itemOptions>`; the compiler checks a
  declared hook parameter against the collection's real row
  (`src/compile.rs:468`, exact keys at `:4938`) and names that fix when
  the options were left out. The pantry rewrite needs no options (§5.2);
  it is the one pattern the move costs, and only for named helpers of
  collections with row-changing options. A hook that needs another collection
  references it by name as today (module scope, hoisted). Open question 9
  asks whether this cost is worth the move.
- **`uid` goes** (F8): a synced collection and every collection a synced
  collection references get a `uid` column automatically; the compiler can see
  the reference graph. `uid: true` for its own sake has no use in the repo.
- **`api` goes** (F27). Access rules are the one way to close an endpoint;
  a closed endpoint answers 403 instead of today's 405. What this loses:
  independent control of `list` and `get`, in either direction (unlisted
  but fetchable rows, or a list with no by-id route), and per-channel
  control, since `api.update: false` closes Zero's own route
  (`App.php:325`) while wp-admin and core REST still edit, whereas
  `access.update: false` closes every channel (`CoreAccess`,
  `EditorSave.php:245`). Nothing in the repo uses either; open question 10
  asks whether to keep `api` for them.
- **`target` goes** (F26, §4.12): there is one target. `name` stays (it is
  the plugin slug).

Rejections stay as today where they are not subsumed: a content collection
needs a title; names over 15 characters on content collections; reserved
names; two slugs; user columns named `status`/`publishedAt`/`createdAt`/
`updatedAt`/`id` colliding with system columns (new error: "`id` is added
automatically; remove it, or name your own key").

### 4.3 Relations

Relations are inferred from `ref()` columns. `defineRelations` goes.

```ts
export const posts = collection({ authorId: ref("authors") });
export const comments = collection({ postId: ref("posts").notNull() });
```

expands to

```
posts.author     : one authors     (from posts.authorId, to authors.id)
comments.post    : one posts       (from comments.postId, to posts.id)   // FK NOT NULL; the loaded row is still Row | null
authors.posts    : many posts      (reverse of posts.author)
posts.comments   : many comments   (reverse of comments.post)
```

Rules, all enforced at build time:

- The **relation is named by stripping `Id` from the column name**:
  `authorId` gives `author`. A `ref` column not ending in `Id` is a build
  error naming the convention. The column and the relation stay two keys, as
  today: `row.authorId` is the id, `with: { author: true }` loads the row,
  `{ authorId: 5 }` filters the id and `{ author: { name: "x" } }` filters
  through the relation. Sharing one key was considered and rejected: the
  compiler and the runtime resolve a filter key as a column before a relation
  (`src/compile.rs:4276`, `Sql.php:238`), so `{ author: { in: [5] } }` would be
  ambiguous, and the row type would have to intersect a number with the
  loaded object. This is the Drizzle convention the config already uses; the
  importer already derives `<name>Id` the same way (`translate.rs:279`).
- The **reverse relation is named after the referencing collection's key**
  (`authors.posts`). When two `ref` columns of one collection point at the
  same target (`posts.authorId` and `posts.editorId` both to `authors`) no
  reverse is inferred, the build says so, and the target names them:
  `relations: { written: many("posts", "authorId"), edited: many("posts", "editorId") }`,
  or declines them: `relations: { posts: false }` suppresses every inferred
  reverse from `posts` (and `relations: false` every inferred reverse on
  this collection), since an inferred default must be refusable as well as
  renamable. `many("t", "col")` joins `t.col` to this collection's primary
  key; with `false` it is the whole explicit relation form. Today's `r.many.x({ from, to })` with
  arbitrary endpoints (`r.posts.id` to `r.subscribers.postId`) is exactly
  this case, since `from` is always the primary key in every use; joins
  between two non-key columns go with non-key `references()` targets.
- `optional` goes (F30), and so does the non-null relation type. A loaded
  `one` is always `Row | null`: `.notNull()` guarantees the id exists, not
  that the viewer may read its target, and the runtime applies the target's
  read rule and any nested `where` whatever the `with` spelling
  (`with: true` becomes empty options, `Db.php:266`; an excluded target
  reads `null`, `:292`). Today's `optional: false` claimed otherwise and was
  unsound; the pantry's `i.location?.name` is the right shape and stays.
- One rule for reverses, in order: first, every `ref` column named by an
  explicit `relations:` entry on the target is taken out of inference;
  then each remaining `ref` column gets the reverse `<referencing key>` on
  the target; a reverse whose name is already taken on the target (by a
  column, a forward relation, or another reverse from the same pass) is a
  build error naming both sides ("name the reverse of posts.editorId in
  authors.relations"). The one exception is deliberate: when two or more
  `ref` columns of one collection target the same collection, *none* of
  their reverses is inferred and every one must be named, so adding
  `posts.editorId` beside `posts.authorId` is a build error until both
  `written` and `edited` exist or `posts: false` declines both, and the
  inferred `authors.posts` can never silently rebind from one column to
  the other.
- `onDelete` defaults to `"set null"` for nullable refs and `"restrict"` for
  NOT NULL refs, the same rule the importer already applies
  (`docs/config-migration.md`, "Original Zero reference"); `cascade` is
  explicit.
- A relation name colliding with a column (`author: text()` beside
  `authorId: ref()`) stays the error it is today.
- `zero.gen.ts` registers the collections map on its own, as today's
  `schema` registration does (`import type { collections } from
  "./zero.config"; interface Register { collections: typeof collections }`),
  and `db.query`, `with` and relation types derive from it. Registering
  the *config* for this would be circular: an action's return type is
  inferred from `db.query.posts.findMany()`, `db.query` reads `Register`,
  and `Register.config` would contain that action. So the config carries
  only what nothing inside it reads back (globals and jobs, as today,
  `index.d.ts:810`), and the collections map is a named export the config
  also passes to `defineConfig` (the rewritten examples export
  `collections` for this reason; the `relations` registration goes).

### 4.4 Access

```ts
access?: {
  read?: Rule, write?: Rule,            // write = create + update + delete
  create?: Rule, update?: Rule, delete?: Rule,   // override write
}
Rule = boolean | "anyone" | Role | "self" | ((ctx) => boolean | Filter)   // Role = "guest" | "subscriber" | "author" | "editor" | "admin"; a role admits itself and above
```

- `write` is the shorthand (F9): it is copied into whichever of `create`,
  `update`, `delete` is not given. A function `write` is compiled once per
  operation it covers, so the create copy is held to today's rule ("create
  rules return a boolean", `src/compile.rs:1369`): a `write` that returns a
  filter needs an explicit `create`. The defaults for ordinary collections
  are unchanged: `read: "anyone"`, `write: "editor"`.
- **Auth collections default to `read: "self"`, `update: "self"`,
  `create: "admin"`, `delete: "admin"`.** This is a change: today an auth
  collection inherits the ordinary defaults (public read, editor writes,
  `src/extract.rs:817`), which no auth collection in the repo keeps. The
  examples and the WP test app write exactly these four; two fixtures
  (`auth`, `phase2-surface`) open `create` to `"anyone"` and keep that one
  line (what it permits depends on zero-identity, §4.8). Admin-only
  creation is the safe default for a users table, not the only sensible
  one. Any explicit key overrides its one
  operation; the others keep the auth default.
- **`ctx.is(role)`** (F10): true when the viewer's role is `role` or above.
  It compiles to the `roleRank` comparison the runtime already has. The seven
  `admin || editor` copies and the site example's `STAFF` array become
  `ctx.is("editor")`.
- **`"self"` widens to ownership** (F16): on a collection with exactly one
  `user()` column (§4.8), `"self"` on `read`, `update` or `delete` means
  "rows whose `user()` column is the viewer" (an anonymous viewer gets
  nothing), and it keeps the function rule's behaviour it replaces: the
  draft guard that shorthand reads get for viewers below editor
  (`Db.php:231`) is not added, so an author's `"self"` read sees their own
  drafts, exactly as `{ userId: ctx.user?.id ?? -1 }` does today. On an auth
  collection it means the viewer's own row, as today.
  With two `user()` columns (`createdById`, `assignedToId`) `"self"` is a
  build error asking for a function rule naming the column. On `create`, `"self"`
  stays rejected as today (open question 5 proposes a meaning). The
  hand-written `ownerId`/`userId` column plus `{ ownerId: ctx.user?.id ?? -1 }`
  function pair (8 uses) becomes `userId: user()` and `"self"`. `"owner"`
  on buckets is renamed `"self"` so the vocabulary is one word.
- Field access keeps `read`/`create`/`update` and gains `write`. `"self"`
  on a field rule is a build error: today the types admit it
  (`FieldRule`, `index.d.ts:908`) and the extractor accepts it on auth
  fields (`src/extract.rs:912`), but the runtime evaluates `"self"` to a
  filter and a field rule that returns one throws
  (`FieldAccess.php:490`). A per-row ownership test on a field is written
  as a function (`ctx.data.userId === ctx.user?.id`), which is what the
  repo's field rules already do.

### 4.5 Globals

```ts
export const settings = global({ ...fields }, { label?, access?: { read?, update? }, agents? });
defineConfig({ globals: { settings } })
```

No name argument (F7, F15); the key names it. Field rules unchanged in
substance, but the declarations are narrowed to what the compiler accepts:
global fields take no `.access()` (`src/extract.rs:1143` rejects it today
while the builder type allows it), and `GateRule` for actions and globals
loses `"self"` (`src/extract.rs:927` rejects it; `index.d.ts:965` admits
it).

### 4.6 Actions and jobs

```ts
action({ input?, access?, idempotent?, signature?, agents?, handler })
job({ input?, retries?, agents?, handler })
```

`input` becomes optional on both (F31); `input: {}` goes. Nothing else
changes: these two were designed together and are consistent.

### 4.7 Files, media, locales, webhooks

```ts
export const manuscripts = bucket({ accept: ["application/pdf"], maxBytes: 1_000_000, access?: { read?, write?, create?, delete? } });
defineConfig({
  files: { manuscripts },
  media: { sizes: { card: { width, height?, fit? } } },
  locales: ["en", "de"],              // first = default
  localeFallback?: false,             // default true: read the default-locale row when a locale has no translation
  webhooks: [{ url, secret, events }],
})
```

- `files(name, …)` becomes `bucket({…})` (F7, F15): the key names it,
  `file("key")` points at it, and "bucket" is what the docs already call it.
  Its access takes `write` too, covering `create` and `delete` (a bucket
  has no update). `"self"` on a bucket means the uploader, as `"owner"`
  does today, and is valid on `read` and `delete` only: an upload has no
  row to own yet (`Media/Files.php:92` needs one), so `create: "self"` and
  a `write: "self"` are build errors ("name who may upload: a role, or a
  function"), exactly today's rule for collections.
- `locales` as an array (F19): the first entry is the default. `fallback`
  (no use in the repo) moves to a sibling key, `localeFallback: false`, so
  there is one spelling of the list and `default` is never repeated. It
  stays because it is Zero's own read behaviour on WordPress too: the
  locale filter on every read consults `schema.locales.fallback`
  (`Locale/Read.php:69`), Polylang supplies languages and translation
  groups only (`Wp/Polylang.php`), and localized tables are outside Polylang
  altogether.
- Webhook events name collections by key, which is now the only name (F18).

### 4.8 Auth and users

```ts
export const members = collection({ name: text().notNull() }, { auth: true });
```

- `auth: true` marks the collection whose rows *are* the site's users: a
  row is a `wp_users` account plus the collection's profile columns in
  usermeta, as today (`WpUserStore.php`). Its `id` is the `wp_users.ID`.
  It gets two system columns, both backed by `wp_users`: `email`
  (`user_email`; unique and required for members, as the store checks today
  (`WpUserStore.php:253`); `null` for a guest, whose core row has an empty
  `user_email` (`:261`), and for a natively created account with none) and
  `role` (the WordPress role, mapped as in `WpUserStore.php:25`, admin-only
  to change). So the column types as `string | null` and the uniqueness is
  the store's, enforced on write, not a SQL constraint Zero owns. Making
  the column nullable moves the requiredness too: today it is the declared
  `email().notNull()` that the pipeline enforces (`Db.php:442`), and
  `checkEmail` tests duplicates only (`WpUserStore.php:382`). So the store
  gains the write rule the declaration carried: a member `create` needs a
  non-empty, well-formed email (`422 invalid_input` at `/email` as the
  pipeline would have raised), a guest `create` does not, and an `update`
  may not set a member's email to `null` or `""`. Reads stay nullable
  because guests and natively created accounts exist either way. The user
  no longer declares `email` (`src/extract.rs:2402` insisted on it); the
  virtual `password` input stays, write-only, and is the one way the API
  creates a sign-in (`wp_insert_user` with `user_pass`, `WpUserStore.php:266`).
  The hidden `suspendedAt` and `guest` columns go (§4.12): suspension is
  zero-identity's, and a guest is a viewer with the `zero_guest` role. The
  hidden `passwordHash` column goes too, but it is live plumbing, not
  standalone baggage: the write pipeline turns the `password` input into a
  pending-password token stored there (`Auth/Module.php:284`,
  `IdentityBridge.php:144`) and the store redeems it on `wp_set_password`
  (`WpUserStore.php:330`). Its replacement is a pipeline-level side channel
  (the pending token travels on the write context, not in the row), which
  is §7.1's PR 5; until then the column stays hidden as today. CRUD on the collection is
  CRUD on accounts: `create` runs `wp_insert_user`, `delete` runs
  `wp_delete_user` (`:320`), `update` writes `user_email`/`user_pass` and
  the profile meta. `create: "anyone"` means what the runtime lets it
  mean: with zero-identity installed, emails are verified on its screens
  and a non-admin create or email change is refused (`Auth/Module.php:311`,
  `IdentityBridge.php:130`), so self-signup is the account screen and the
  rule only governs who may create members *through the API* (admins, in
  practice); without zero-identity it is plain self-signup. The two
  fixtures that write `create: "anyone"` keep that line and that meaning.
  `ctx.user` gains `email` so hooks and rules can read the account's
  address.
- **`user(opts?)`** is a new column: an integer reference to the app's user
  (`User.id`), named with the `Id` suffix like any `ref` (`userId`,
  `createdById`). With an auth collection in the config it is exactly
  `ref("<auth key>")` plus the ownership meaning: the `Id`-stripping rule
  names the relation (`userId` gives `user`, loadable with
  `with: { user: true }`) and the reverse on the auth collection is inferred
  as for any `ref`. Without an auth collection there is no row to
  load, so it declares no relation. A synced collection may not reference
  users at all, by either spelling (`user()` or `ref("<auth key>")`; the
  check is on the resolved target, build error: "`userId` names a user of
  this site; sync has no portable identity for users; leave it out of the
  synced collection"): sync carries references as uids of registered
  collections (`src/extract.rs:2488`), an auth collection cannot itself
  sync (`src/extract.rs:2359`) so its rows never acquire matching uids
  across sites, and an unmatched uid fails the push
  (`sync_missing_reference`, `Sync/Wire.php:254`). Portable users are a
  sync feature to design, not a config option. A `user()` id is a
  `wp_users.ID`, whether or not an auth collection exists (an auth
  collection's `id` is the same number, `src/extract.rs:2397`), so adding
  or removing the auth collection never changes what the column means; the
  standalone user table that made that a hazard is gone (§4.12). Deletion of
  the user follows `ref()`'s rule: `"set null"` when nullable, `"restrict"`
  when `.notNull()`, and `{ onDelete: "cascade" }` explicitly. `wp_users`
  has no foreign keys and users are deleted from wp-admin, WP-CLI and other
  plugins, so the rule runs on core's `delete_user` action (which fires
  before the row goes, with the reassignment target core offers), inside
  one transaction that also contains core's own deletion. The contract is
  single-site, as Zero is today (nothing in the runtime tests
  `is_multisite()`): on a network, `wp_delete_user` removes a site
  membership and keeps the global account, and `wpmu_delete_user` deletes
  the account through a different action, so neither maps onto "the
  referenced user is gone". Multisite support, if it comes, decides there
  whether a reference means the account or the membership; until then the
  plugin refuses to activate on a network, as it does not claim to run on
  one. Transaction
  ownership follows the rule the editor-save path already uses
  (`Connection::begin()` is the outermost transaction and refuses to nest,
  `Connection.php:140`; Zero's own transactions join an open one): when
  `wp_delete_user` is reached from Zero's pipeline (an API delete of an
  auth row, `Db.php:768` → `WpUserStore.php:320`) a transaction is already
  open and the hook joins it, so a later `afterDelete` failure still rolls
  everything back; when it is reached natively (wp-admin, WP-CLI, another
  plugin) the hook asks the connection whether a transaction is open
  with the probe zero-identity already uses (`SAVEPOINT` then
  `RELEASE SAVEPOINT`: under autocommit the release fails because the
  savepoint was discarded at once, inside a transaction it succeeds and
  changes nothing, `runtime/identity/src/DB.php:122`). It is portable,
  which `SELECT @@in_transaction` is not: that variable exists on MariaDB
  only, and WordPress runs on MySQL too. If no transaction is open the hook opens one, and only then does it
  commit on `deleted_user` or roll back if core fails in between. If
  another plugin's `$wpdb` transaction is open the hook *refuses* the
  deletion (`wp_die` naming the open transaction; an `HttpError` under
  Zero's pipeline cannot happen, because there the open transaction is
  Zero's own and the hook simply runs inside it). Joining with a savepoint
  was considered and dropped: a joined transaction has an owner Zero cannot
  observe, and Zero's `afterCommit` and `onRollback` callbacks are tied to
  its own `COMMIT` and `ROLLBACK` (`Connection.php:149,187,192`). The
  cascade registers such callbacks, among them the physical deletion of a
  bucket file after commit (`WpFiles.php:236`) and the post-cache cleanup
  after rollback (`cleanCaches`, `:232`); an outbox could defer the
  irreversible effects, but no invalidation timing makes the object cache
  safe without hearing the owner's commit or rollback: invalidating at
  savepoint release lets another request repopulate the cache with the old
  committed rows before the owner commits, and the originating request can
  cache uncommitted rows before the owner rolls back. The one host-side
  notification that exists (`zero_identity_touched_user`,
  `runtime/identity/src/DB.php:115`) flows the other way, into a Zero
  transaction, and its receiver cleans user caches only
  (`IdentityBridge.php:39`). So the hook fails closed. In practice nothing
  in the repo deletes a user inside a foreign transaction: wp-admin, WP-CLI
  and zero-identity (`runtime/identity/src/Plugin.php:166` listens on `delete_user`, it never
  calls `wp_delete_user`) reach the hook with autocommit on.
  `Connection::begin()` gains the same probe (behind `suppress_errors`, as
  identity runs it) and the same refusal, since today it checks Zero's own
  depth only (`Connection.php:140`). In every case the hook locks the account row (`SELECT … FROM wp_users WHERE
  ID = ? FOR UPDATE`, the same lock a reference write takes on its target
  before it validates existence, which today only checks, `Db.php:705`),
  checks every `"restrict"` column first and refuses the whole deletion
  (an `HttpError` inside the pipeline, a `wp_die` naming the rows
  natively; the existing `delete_user` hook only guards storage
  availability today), then runs `"set null"` (clear, or rewrite to the
  reassignment target core was given) and `"cascade"` through the
  pipeline. The restrict check and the rows the cascade and `"set null"`
  passes operate on are read with `SELECT … FOR UPDATE`, not the plain
  select the in-pipeline check uses today (`Db.php:713`, a snapshot read
  under `REPEATABLE READ` that could miss a reference committed after the
  transaction's first read); a locking read returns the latest committed
  version and holds the child rows until the deletion commits. A concurrent
  reference write therefore either commits before the account lock and is
  seen by the restrict check, or waits on the lock and then fails its
  existence check; a concurrent write to a child row waits on the row lock
  and then finds the parent gone. Without an auth collection
  the same hook applies; `Db::referentialActions()` keys on a registered
  target today and gains the built-in users as one, with the restrict
  check split out of its in-order loop. It is what
  `authors.userId` and the `ownerId` columns are by hand today, and it is
  what `"self"` reads.
- **One owner per post.** On a content collection, ownership has one
  authoritative home: `post_author`. A collection with exactly one `user()`
  column stores that column *as* `post_author` (a core column, like `slug`
  is `post_name`), not as meta; wp-admin's author box, "Mine" views,
  `edit_others_posts` and Zero's `"self"` therefore read the same value and
  cannot disagree. The contract is the same on content collections and
  tables: an omitted value on create is the current user's id when there
  is one, else `null` (today's `post_author => get_current_user_id()`,
  `WpPostStore.php:221`, made explicit and extended to tables); an
  explicit `null` is stored and reads back `null`, which on a post is
  `post_author = 0` (WordPress's "no author"), so `{ userId: { isNull:
  true } }` filters `post_author = 0`; a native editor save keeps whatever
  the author box set; and a `.notNull()` author column refuses `null` and
  `0` alike on both storages. Revisions keep their own meaning of
  `post_author`: a revision row's `post_author` is the editing actor
  (`WpPostStore.php:526` sets it; wp-admin's revision screen shows it as
  attribution), so the owner is snapshotted into the revision's
  `_zero_system` meta beside `status`, `publishedAt` and the slug
  (`snapshotKeys`, `:497`), and revision reads and `restoreRevision`
  (`Db.php:983`) take it from there, never from the revision post's
  `post_author`; wp-admin's own restore excludes `post_author` from the
  fields it copies back, so the editor-save path's restore hook
  (`EditorSave::endRestore`, `EditorSave.php:205`, which today only
  authorizes and commits) applies the owner from the revision's
  `_zero_system` before it commits, so both restores agree. Revisions
  written before the mapping existed carry no
  such key, but they do carry the old column's meta, because
  `snapshotRevision` copies the parent's field meta into every revision
  (`acf_copy_metadata`, `:539`); the migration that moves the column
  (§6.4) therefore writes each revision's own meta value into its
  `_zero_system` entry, so `restoreRevision` restores the owner the post
  had at that revision, and the parent's current value is the fallback
  only for a revision with neither, the fallback `revisionEntry` already
  applies to the other snapshot keys (`:452`). Moving ownership into a
  core column also moves it onto core's surfaces: `/wp/v2` responses carry
  `author` and an `author` link, and list queries accept `author`,
  `author_exclude` and `orderby=author`. Today `CoreAccess::strip` drops
  only the designated content and slug of a hidden column (`:276-277`) and
  `queryDenial` guards only their query parameters (`:330`), so without
  more a `user().access({ read: false })` column would leak through core
  REST. Both gain the author case: `strip` removes `author` and the
  `author` link when the owner column is hidden from the viewer, and
  `queryDenial` refuses the three author parameters with the same `403`
  it gives a hidden slug (§7.1, PR 5). wp-admin has the same two sides:
  today the classic editor's content box and the slug box are blanked for
  a viewer the column is hidden from (`adminContent`, `adminSlug`,
  `CoreAccess.php:467,473`) and a blank control posted back does not
  overwrite the stored value (`keepHidden`, `:484`). The author gets the
  same pair: the author box and quick edit's author dropdown are removed
  (`remove_meta_box` and the `quick_edit_dropdown_authors_args` filter)
  when the owner column is hidden from the viewer, and `keepHidden` keeps
  `post_author` when it is hidden, so a native save by such a viewer never
  changes the owner. A forged `post_author` reaches `EditorSave` as a
  write to a hidden column and is refused as one, as today for content
  and slug. A content collection with two `user()` columns must say
  which is the author (`author: "assignedToId"`, a new designation beside
  `title` and `body`), or `author: false` for meta-only user columns; adding
  a second `user()` column without it is a build error, whether or not any
  rule says `"self"`. Tables have no `post_author`; their `user()` columns
  are ordinary columns.

### 4.9 Magic that removes config

Each default, what it expands to, and the one word that turns it off.

#### 4.9.1 `id`

Every collection without a `.primaryKey()` column gets
`id: integer().primaryKey()` (autoincrement) as its first column. Off: declare
your own `.primaryKey()` under another name. A user column named `id` is
always an error, with or without `.primaryKey()` ("`id` is added
automatically; remove it, or name your own key"), so the manual spelling
F3 removes does not survive under a new name.

#### 4.9.2 `title`

On a content collection, `title` is the `title:` option, else a column
named `title`. The chosen column must be NOT NULL text (today's rule). Off:
`content: false`. Error when nothing matches: today's "has no title" with
the options listed. Unchanged from today in substance; a wider rule ("the
first NOT NULL text column") was considered and dropped because a reordered
field would silently change the post title. The three `title: "title"`
designations go; `title: "name"` stays where the title column is not called
`title`.

#### 4.9.3 `content`

A collection is a content collection when it has a `richText()` column, a
column named `title` whose kind is text (which includes a single
`select()`, since that is a text column with an enum, F1; `.notNull()` is
checked by the title rule, not this one), an explicit `title:` option, or
Markdown `sync`. Otherwise it is a table; `auth: true` is always a table and
`auth: true, content: true` is rejected (today's rule for `editor`). Off:
`content: true` or `content: false` written out. The rule is printed in
`zero build --explain` (§7.2), and the generated client's `SCHEMA` gains a
`kind` entry per collection: today it carries `drafts`, `revisions` and
`localized` but not the storage kind (`src/client.rs:566`), and the two
flags cannot stand in for it since a table may enable both.

Because the kind decides storage (a post type or a `$wpdb` table), a
kind change caused by an edit to the columns is refused, not applied:
`zero build` compares the inferred kind with the migration snapshot's and
fails with "`events` was a table and is now a content collection (it gained
a `title` column); write `content: true` to confirm, or `content: false`"
when the config does not say `content:` explicitly. The flag is then the
one word it should always have been for that collection.

Checked against the repo's 157 collections (125 tables, 32 content): the
rule reproduces today's flag on all but 4 tables that happen to carry a
`title: text()` or a `richText()` column (`jobNotes`, `hookNotes`, `guides`
in `locales-client`, and a rejection fixture); they write `content: false`.
No content collection needs `content: true`.

#### 4.9.4 `createdAt` / `updatedAt`

Every collection gets `createdAt: timestamp().default(() => new Date())` and
`updatedAt: timestamp().default(() => new Date()).onUpdate(() => new Date())`
as system columns, readable, filterable, orderable, never writable through the
API or `db`. Sync treats them like today's `$onUpdate` columns: left out of
the record (`Sync/Wire.php:27` keys on `onUpdate`; `createdAt` joins that
list as a system column), so a Markdown file carries neither and a round
trip never writes them. On content collections `updatedAt` is
`post_modified_gmt`, a core column every post already has, and every Zero
write bumps it: today a meta-only update skips `wp_update_post`
(`WpPostStore.php:244-255`), so the store sets `post_modified_gmt` itself
on that path, paired with the local `post_modified` WordPress keeps beside
it (`get_date_from_gmt`, as the store already does for `post_date`,
`:289`), in one `UPDATE` beside `touchPost`, followed by the
`clean_post_cache` the path already runs (`:256`) so wp-admin's dates and
REST's `modified` agree with Zero's `updatedAt`; that paired write is what
`.onUpdate(() => new Date())` means for this column; `createdAt` is
post meta like any other column, because `post_date_gmt` is the
publication time (it already backs `publishedAt`, `WpPostStore.php:84`, and
moves when a post is scheduled or re-dated, `:282`). On tables both are
columns of the `$wpdb` table. On the auth collection `createdAt` is
`wp_users.user_registered` (read-only, every account has it) and
`updatedAt` is usermeta that the pipeline sets on every profile write and
that `profile_update` sets on a native wp-admin edit; an account created
natively (wp-admin, WP-CLI) has no `updatedAt` until its first edit, so on
the auth collection `updatedAt` reads as `createdAt` when absent rather
than null (today's `fillDefaultsAt` skips system columns for native
accounts, `WpUserStore.php:78`; that is the one place it fills). Off:
`timestamps: false`. Error: a user column of either name. Localized rows
keep per-row timestamps (today's rule for `$onUpdate` columns).

#### 4.9.5 `body` and `slug`

`body` is the only `richText()` column; with two or more, `body:` must name
one (a build error says so), so reordering fields never moves the WordPress
post content. `body: false` keeps every rich-text column as a plain field.
Because the designation decides where the value lives (`post_content` or
meta), an inferred change of body is refused like a kind change (§4.9.3):
today only an explicit designation or a rich-text column literally named
`content` is the post content (`src/extract.rs:748`), so an existing
collection with one rich-text `description` column stores it in meta, and
the build compares the inferred body with the migration snapshot's
(§6.4) and fails with "`description` would become the post content; write
`body: "description"` to move it, or `body: false` to keep it a field"
until the config says which. `slug()` with no `source` derives from the
title column when there is one,
and on a table with no title it is a hand-supplied slug, as a source-free
`slug()` is today. `slug({ source: false })` makes the hand-supplied form
explicit on a content collection. Off: `body: false`; `slug({ source: "other" })`
or `slug({ source: false })`.

#### 4.9.6 Relations

As §4.3: every `ref()` is a `one`, every `one` not named in the target's
`relations:` gets a `many` back named after the referencing collection; a
taken name is an error, and two `ref` columns to one target infer nothing
until both are named or declined. Off: name the reverse explicitly with
`relations:` on the target, or decline it (`relations: { posts: false }`).

#### 4.9.7 `uid`

A `uid` column exists on synced collections and on every collection a synced
collection references. Off: none; it is a system column. In the types,
`uid` appears on a row only when the collection itself has `sync` (local
to the collection, as today's `IdentityColumns` reads it,
`index.d.ts:489`). On a collection that merely *is referenced* by a synced
one, `uid` is a hidden system column: the sync wire carries it
(`Sync/Wire.php:215`), and the API, hooks and `Row<typeof t>` do not see
it. The generated client already drops hidden columns (`src/client.rs:388`);
the compiler's row type does not yet (`columns_row`, `src/types.rs:354`,
takes every column), so it gains the same filter, listed in §7.3. The
runtime needs the matching projection: today hidden columns are stripped
for API viewers but kept on trusted reads (`Auth/Module.php:255`), and
hooks receive the decoded storage row as is (`Db.php:736`), so an
inherited `uid` would reach a hook or an action's returned rows and
contradict the types. The pipeline therefore strips hidden columns from
every row it hands to application code (hook arguments, `db.query`
results in actions and jobs) and keeps them only on its internal reads
(sync, translation groups, the auth issuer), which is the distinction
`strip()` already draws between viewers and internal callers. That keeps
the editor, the compiler and the runtime exact without typing anything by
registration key, which §4.2 shows would be circular for hook helpers.
Nothing in the repo reads a reference target's uid, so no form of `Row`
needs to expose it.

#### 4.9.8 Access on auth collections

`read: "self"`, `update: "self"`, `create: "admin"`, `delete: "admin"`. Off:
any explicit `access`.

#### 4.9.9 Required with a default

`.default(x)` implies `.notNull()`. Off: `.nullable()`.

#### 4.9.10 Unique text length

`.unique()` on `text`, `email` or `url` implies `.max(191)`. Off: an
explicit smaller `.max()`.

### 4.10 `defineConfig`

```ts
defineConfig({
  name?, collections, globals?, actions?, jobs?, files?, media?, locales?, localeFallback?, webhooks?, plugins?, admin?,
})
```

`schema` becomes `collections` (F32); `relations`, `hooks` and `target` go.
Zero Admin's `admin: true` fits as is.

### 4.11 The whole surface on one page

```ts
import {
  collection, global, bucket,
  text, integer, real, boolean, date, timestamp, json, email, url, slug, richText,
  media, file, select, ref, user, group, repeater, blocks, many,
  action, job, jobs, once, env, db, HttpError, defineConfig,
  type Row, type Insert,
} from "zero";
```

`Row<T>` and `Insert<T>` replace `InferSelectModel`/`InferInsertModel`
(shorter, and the Drizzle names were the only reason for the long ones).
`T` is a collection (`typeof items`) or a columns object (`typeof
itemFields`, for a helper the collection's own hooks name, §4.2) with an
optional second argument carrying the collection's options; a columns
object with no options gives the row of a default collection over it. The
compiler resolves these by name (`src/compile.rs:854`) and today accepts a
collection path only, so the rename and the columns form are compiler
changes, not only `.d.ts` ones (§7.3). What only the
whole config knows (an inherited `uid`, §4.9.7) is not part of `Row`.

Not one way yet, and said so: `.notNull().default(x)` and `.default(x)` are
the same column (the first is kept so the explicit form stays legal);
`media.accept` and `bucket.accept` both take a pattern or a list; `true`
and `"anyone"` are the same access rule (`src/extract.rs:914`), kept
because `true` is what a function rule returns and `"anyone"` is what a
reader understands.

---

### 4.12 WordPress-only simplifications

With the standalone PHP+SQLite target removed, everything the config
carried to keep two runtimes in step can go. This list is what the redesign
removes *because* there is one target, over and above §4.1 to §4.11; each
row names the compiler site so the removal and this redesign can be
reconciled.

| removed | why it existed | where |
|---|---|---|
| `defineConfig.target`, `zero build --target` | choose a runtime | `src/extract.rs:169`, `src/commands/build.rs` |
| `ctx.target` in hooks, access, validators, jobs | branch on the runtime | `HookCtx.target`, `AccessCtx.target`, `ValidateCtx.target` (`index.d.ts:102,920,926`); `src/compile.rs:390` |
| the `editor` flag's "no storage effect on standalone" meaning | one config, two behaviours | `src/extract.rs:658`; replaced by `content` (§4.2) |
| the `translationGroup` system column on content collections | standalone had no Polylang groups | `src/extract.rs:2467` (emitted when `!c.editor \|\| target == Standalone`); stays only for tables, where Polylang has no row |
| the auth collection's standalone half: `__zero_users`, `suspendedAt`, `guest` | standalone accounts, suspension and guest tokens | `src/extract.rs:2414-2435`; the row *is* a `wp_users` account (§4.8): `email` is `user_email`, the write-only `password` input is `wp_set_password` (`WpUserStore.php:335`, `IdentityBridge.php:140`), suspension is zero-identity's, guests are the `zero_guest` role. `passwordHash` is WordPress plumbing (the pending-password token) and goes only with the pipeline change in §4.8 |
| `"authenticated"` as distinct from `"guest"` | standalone guest tokens | the ladder `guest < subscriber < author < editor < admin` already makes `"guest"` mean "any signed-in viewer, guests included"; `"authenticated"` is the same rule spelled twice and goes (`src/extract.rs:915`, `Access.php:52`) |
| the standalone job worker (`zero jobs work`, the dev worker) | standalone queue | Action Scheduler is the queue; `job()` is unchanged, the CLI shrinks |
| `files` bucket storage choice | standalone wrote to disk under the app | buckets are uploads under `wp-content/uploads/zero-private/` streamed through PHP, as today on WP; `bucket()` is unchanged |
| the standalone GD image pipeline | standalone had no `wp_get_image_editor` | `media.sizes` is unchanged: on WordPress Zero registers the sizes (`add_image_size`, `WpMedia.php:80`), keeps core from rendering them (`:83`) and renders each focal crop itself through `wp_get_image_editor` (`:201-210`); that renderer stays, only its GD twin goes |
| `zero users add`, the standalone issuer's `za_` access and refresh tokens and `__zero_sessions`, `zt_` CLI tokens | standalone identity | application passwords and zero-identity's bearer tokens (which stay: `WpAuth.php:12,21` resolves them); no config surface |
| the standalone half of `sync`, `webhooks`, `once`, `env` | same feature, second runtime | `env()` reads `wp-config.php` constants; config unchanged |

Not removed, because it was never standalone-only: `drafts: true` and
`revisions: true` on tables are Zero's own behaviour on WordPress too
(`WpTableStore.php:142,169`), so they stay as §4.2 says.

What one target *adds* to the defaults, now that WordPress is the only
vocabulary:

- **Status is `post_status`.** `status: "draft" \| "published" \| "scheduled"`
  stays the API's spelling, mapped to `draft`/`publish`/`future` as today
  (`WpPostStore.php:280`). `"pending"` and `"private"` are not modelled; a
  collection that needs them says so in open question 11.
- **Roles are WordPress capabilities, normalized.** Zero's ladder is read
  from the viewer's capabilities, not their role name: `manage_options` is
  `admin`, `edit_others_posts` is `editor`, `publish_posts` or `edit_posts`
  is `author`, the `zero_guest` role is `guest`, anything else is
  `subscriber` (`WpAuth.php:60`); writing a member's `role` maps the other
  way (`WpUserStore.php:25`). So a custom WordPress role lands on the rung
  its capabilities earn, and a config rule never names a WordPress role or
  capability directly. On content collections the rules then answer
  `map_meta_cap` for Zero's post capabilities (`CoreAccess.php:43,95`), so
  wp-admin and the API agree by construction. The rules are the authority,
  not the native capabilities: a capability earns a rung, and from then on
  the collection's rule decides, so a user with `edit_posts` but not
  `publish_posts` (a `contributor`, or a custom role built the same way)
  satisfies `create: "author"` and publishes a Zero post, in the API and
  in wp-admin alike, because `map_meta_cap` grants `publish_<type>` from
  the same rule (`CoreAccess.php:157`). That is today's behaviour and the
  proposal keeps it as a deliberate override: a Zero collection is governed
  by its config. The override cannot yet be undone from the config: both
  roles normalize to `author` (`WpAuth.php:63`) and the rule context
  carries the viewer's id, name and rung only (`src/types.rs:457`), so no
  rule can tell `edit_posts` from `publish_posts` today. Restoring
  WordPress's publish gate for a collection needs either a `contributor`
  rung or a capability accessor on the context; that is open question 12.
- **`"self"` is `post_author`.** On a content collection with one `user()`
  column, that column is written to `post_author`, so WordPress's own
  "Mine" views and `edit_others_posts` capability match Zero's `"self"`.
- **Field types are SCF types.** Every builder in §4.1 has an SCF
  rendering (`Wp/Scf.php:33,150-172`): `text` / `textarea`, `number`,
  `true_false`, `date_picker`, `date_time_picker`, `email`, `url`,
  `wysiwyg` (the body is `post_content`), `image` / `file` for `media()`,
  `gallery` for a media list, `select` (with `multiple` for a multiple
  select), `post_object` (`ref` to a content collection; a `number` field
  to a table), `group`, `repeater`, `flexible_content`. Two are plain
  inputs rather than pickers and stay so: a private `file()` is a `number`
  (the private file id has no SCF picker) and `json` is a `textarea`.
  `user()` renders as SCF's `user` field, the one new mapping (today's
  hand-written `userId: integer()` is a number field). Structured fields on
  the auth collection stay API-only on the WordPress profile screen, as
  today (`WpUserStore.php:46`). `showIf` is SCF conditional logic.
- **Media is an attachment.** `media()` is an attachment id; `sizes` are
  registered image sizes rendered by Zero through `wp_get_image_editor`;
  `focal` is `_zero_focal` meta.
- **The title is `post_title`, the slug is `post_name`.** A content
  collection's `slug()` column *is* `post_name` (`WpPostStore.php:272`),
  which is why a collection has at most one; Zero's own `-2`, `-3`
  suffixing (`Db.php:639`) keeps the API and the editor deriving the same
  slug.

## 5. Before and after

The "before" is each example as it is on `main` today (`17e76cd`, which
includes the phase-2 integration: the site has localized fields and an auth
collection, the pantry has its notification job), the "after" is the same
app, feature for feature, in the proposed API. Counts are total lines and
non-blank, non-comment lines. The compiler line references elsewhere in
this document are to `b45e586`, where the examples were shorter (189 and
104 lines) because those features had not landed; the reduction is
measured against the version that has them, so it is API simplification
only.

| example | before | after | before (code) | after (code) |
|---|---|---|---|---|
| `examples/site/zero.config.ts` | 205 | 169 | 170 | 137 |
| `examples/pantry/zero.config.ts` | 117 | 102 | 105 | 89 |
| `examples/pantry/lib/fields.ts` | 16 | 4 | 13 | 2 |

Beyond the counts, the site example loses: its `STAFF` array, the
`defineRelations` block (11 lines), the `hooks:` block in `defineConfig`
(moved beside the collections), every `id: id()`, the `title: "title"` and
`content: "body"` designations, every `editor: false`, `uid: true`,
`updatedAt`, `createdAt`, `.notNull()` before `.default()`, `.max(191)` after
`.unique()`, the hand-written auth access block, and the
`files("manuscripts", …)` name repeat. It keeps every feature: localized fields, sync, private files,
field access, `showIf`, blocks, a job, a webhook, an auth collection, two
actions and five hooks.

### 5.1 `examples/site/zero.config.ts`, after

```ts
// A small publication: authors write posts with rich fields in English and German, readers sign in
// as members and leave comments that editors moderate through an action, and editors keep the site
// settings. tests/system drives a whole user journey through this app on real WordPress.
import {
  collection, global, bucket, text, integer, boolean, richText, media, slug, select, repeater, group,
  blocks, email, url, ref, user, file, defineConfig, action, job, jobs, env, db, HttpError,
} from "zero";

export const authors = collection({
  name: text().notNull().max(80),
  bio: text({ multiline: true }).max(500),
  avatar: media({ accept: "image/*" }),
  userId: user(),                          // the account that writes as this author
}, { title: "name", access: { write: "admin" } });

// Private: never a public URL; signed 5-minute download links for whoever may read them.
export const manuscripts = bucket({
  accept: ["text/plain", "application/pdf"],
  maxBytes: 1_000_000,
  access: { create: "author", read: "editor", delete: "editor" },
});

export const posts = collection({
  // Translated per locale. The other fields are shared by a post's translations, except each
  // row's own slug, status and dates.
  title: text().notNull().min(1).max(120).localized(),
  slug: slug(),
  body: richText().localized(),
  dek: text({ multiline: true }).max(240).localized(),
  cover: media({ accept: "image/*" }),
  // The author's draft manuscript: a private file, readable by the desk.
  manuscript: file("manuscripts"),
  topics: select(["culture", "science", "tech"], { multiple: true }).default([]),
  featured: boolean().default(false),
  // The desk's private notes: staff read and write them; readers' rows never carry the column.
  deskNotes: text({ multiline: true }).max(2000).access({ read: "author", write: "editor" }),
  authorId: ref("authors"),
  // The editor shows metaTitle only while the post is indexable (SCF conditional logic).
  seo: group({ noindex: boolean().default(false), metaTitle: text().max(70).showIf({ noindex: false }) }),
  related: repeater({ label: text().notNull().max(80), href: url().notNull() }).max(6),
  sections: blocks({
    pullQuote: { text: text({ multiline: true }).notNull(), cite: text().max(80) },
    figure: { image: media({ accept: "image/*" }).notNull(), caption: text().max(160) },
  }),
}, {
  // Writers can draft in Markdown in the repo: `zero sync` keeps content/posts/*.md and the site in step.
  sync: "content/posts/*.md",
  access: {
    read: (ctx) => ctx.is("author") ? true : { status: "published" },
    create: "author",
    update: (ctx) => ctx.is("editor") ? true : { author: { userId: ctx.user?.id ?? -1 } },
    delete: "editor",
  },
  hooks: {
    // Each time a post becomes published (through the API or the editor) readers hear about it;
    // the job key collapses repeats still waiting on the queue. Scheduled posts that the clock
    // publishes run no hooks (WP cron parity), so they announce nothing.
    async afterCreate(row) {
      if (row.status === "published") await jobs.notifyReaders.enqueue({ postId: row.id }, { key: `publish-${row.id}` });
    },
    async afterUpdate(row, previous) {
      if (row.status === "published" && previous.status !== "published") {
        await jobs.notifyReaders.enqueue({ postId: row.id }, { key: `publish-${row.id}` });
      }
    },
    async beforeCreate(data, ctx) {
      if (data.authorId == null && ctx.user) {
        const author = await db.query.authors.findFirst({ where: { userId: ctx.user.id } });
        if (author) data.authorId = author.id;
      }
    },
  },
});

export const comments = collection({
  postId: ref("posts", { onDelete: "cascade" }).notNull(),
  name: text().notNull().max(60),
  body: text({ multiline: true }).notNull().min(1).max(2000),
  approved: boolean().default(false),
}, {
  // Readers (anonymous, guests, members) see approved comments only; staff see the moderation queue.
  access: { read: (ctx) => ctx.is("author") ? true : { approved: true }, create: "anyone", write: "editor" },
  hooks: {
    // Editors can close comments site-wide; readers can't approve their own; staff skip the queue.
    async beforeCreate(data, ctx) {
      const site = await db.globals.settings.get();
      if (!site.commentsOpen) throw new HttpError(403, "comments_closed", "Comments are closed on this site");
      if (!ctx.is("author")) data.approved = false;
    },
    async afterCreate(row, ctx) {
      if (ctx.is("author")) await db.update(comments).set({ approved: true }).where({ id: row.id });
    },
  },
});

// Newsletter sign-ups from a post. Anyone may sign up; only admins see who did.
export const subscribers = collection({
  email: email().notNull().unique(),
  postId: ref("posts"),
}, { access: { read: "admin", write: "admin", create: "anyone" } });

// One row per post announcement the notifyReaders job sent; staff can see what went out.
export const announcements = collection({
  postId: ref("posts", { onDelete: "cascade" }).notNull(),
  recipients: integer().notNull(),
  attempt: integer().notNull(),
}, { access: { read: "editor", write: "admin" } });

// Readers who sign in: WordPress users, through the zero-identity screens. Each member sees and
// edits only their own row.
export const members = collection({
  name: text().notNull().max(80),
  plan: select(["free", "supporter"]).default("free"),
}, { auth: true });

export const settings = global({
  siteTitle: text().default("The Zero Review").max(80),
  tagline: text().max(160),
  commentsOpen: boolean().default(true),
  social: repeater({ label: text().notNull().max(40), href: url().notNull() }),
}, { label: "Site settings" });

export const collections = { authors, posts, comments, subscribers, announcements, members };

export default defineConfig({
  name: "site",
  collections,
  globals: { settings },
  files: { manuscripts },
  locales: ["en", "de"],
  // A square `card` crop of every image for listings, centred on the image's focal point.
  media: { sizes: { card: { width: 120, height: 120, fit: "cover" } } },
  // Every new comment is POSTed, signed, to the moderation tool at SITE_HOOK_URL (retried on failure).
  webhooks: [{ url: env("SITE_HOOK_URL"), secret: env("SITE_HOOK_SECRET"), events: ["comments.created"] }],
  jobs: {
    // Runs after the publishing request commits, on the queue (Action Scheduler on WordPress).
    notifyReaders: job({
      input: { postId: integer().notNull() },
      retries: 3,
      handler: async ({ postId }, ctx) => {
        const readers = await db.query.subscribers.findMany({ columns: { id: true } });
        await db.insert(announcements).values({ postId, recipients: readers.length, attempt: ctx.attempt });
      },
    }),
  },
  actions: {
    moderateComment: action({
      input: { id: integer().notNull(), decision: select(["approve", "reject"]).notNull() },
      access: "editor",
      async handler({ id, decision }) {
        if (decision === "reject") {
          const [gone] = await db.delete(comments).where({ id }).returning();
          if (!gone) throw new HttpError(404, "not_found", `No comment ${id}`);
          return { id, approved: false, removed: true };
        }
        const [row] = await db.update(comments).set({ approved: true }).where({ id }).returning();
        if (!row) throw new HttpError(404, "not_found", `No comment ${id}`);
        return { id, approved: true, removed: false };
      },
    }),
    frontPage: action({
      access: "anyone",
      async handler() {
        const featured = await db.query.posts.findMany({ where: { status: "published", featured: true }, columns: { id: true } });
        return { featured: featured.map((p) => p.id) };
      },
    }),
  },
});
```

What the inference does here, collection by collection: `authors` (explicit
`title: "name"`) and `posts` (a `title` column, a `richText`, Markdown sync)
are content collections; `members` is a table because `auth` forces it, as
today; `comments`, `subscribers` and `announcements` are tables (no title,
no rich text). `posts.slug` derives from `title`; `posts.body` is the body.
Relations, from the four `ref("…")` columns: `posts.author`/`authors.posts`,
`comments.post`/`posts.comments`, `subscribers.post`/`posts.subscribers`,
`announcements.post`/`posts.announcements`. The old config's `comments.post`
was `optional: false` by hand, which claimed a non-null loaded row; that
claim was unsound and goes (§4.3), so `comments.post` loads as `Row | null`
and the FK's `.notNull()` is the only requiredness left. `authors.userId`
is a `user()` column; since `members` is the auth collection it also gives
`authors.user` and `members.authors`.

### 5.2 `examples/pantry/zero.config.ts`, after

```ts
import {
  collection, text, integer, boolean, date, timestamp, json, select, ref, slug,
  defineConfig, action, job, jobs, db, HttpError, type Row,
} from "zero";
import { UNITS, LOW_STOCK } from "./lib/fields";

// Composition is plain TypeScript: shared field sets, factories, spreads.
const named = <T extends object>(extra: T) => ({ name: text().notNull(), ...extra });

export const locations = collection(named({
  kind: select(["fridge", "freezer", "pantry"]).default("pantry"),
}));

// Named so restock() can be typed from the columns: a helper the collection's own hooks name can't be
// typed from the collection without a cycle.
const itemFields = named({
  slug: slug({ source: "name" }),
  quantity: integer().default(1),
  unit: select(UNITS).default("pcs"),
  lowStockAt: integer().default(LOW_STOCK),
  expiresOn: date(),
  opened: boolean().default(false),
  locationId: ref("locations"),
  tags: json<string[]>().default([]),
});

export const items = collection(itemFields, {
  hooks: {
    beforeCreate(data) {
      data.name = data.name.trim();
      if (data.name === "") throw new HttpError(422, "invalid_input", "name can't be empty");
      data.tags = (data.tags ?? []).map((t) => t.toLowerCase());
    },
    afterCreate: restock,
    afterUpdate: restock,
  },
});

export const shoppingList = collection({
  itemId: ref("items", { onDelete: "cascade" }).unique(),
  name: text().notNull(),
  done: boolean().default(false),
  notifiedAt: timestamp(),                // set by the notifyLowStock job
});

async function restock(item: Row<typeof itemFields>) {
  if (item.quantity > item.lowStockAt) return;
  const existing = await db.query.shoppingList.findFirst({ where: { itemId: item.id } });
  if (!existing) {
    await db.insert(shoppingList).values({ itemId: item.id, name: item.name });
    // Off the request: Action Scheduler runs this after the write commits.
    await jobs.notifyLowStock.enqueue({ itemId: item.id }, { key: `low-${item.id}` });
  }
}

export const collections = { locations, items, shoppingList };

export default defineConfig({
  collections,
  jobs: {
    // A real pantry would push a notification here; this one stamps the list entry.
    notifyLowStock: job({
      input: { itemId: integer().notNull() },
      retries: 2,
      handler: async ({ itemId }) => {
        await db.update(shoppingList).set({ notifiedAt: new Date().toISOString() }).where({ itemId });
      },
    }),
  },
  actions: {
    consume: action({
      input: { itemId: integer().notNull(), amount: integer().default(1) },
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
    expiringSoon: action({
      input: { days: integer().default(3) },
      async handler({ days }) {
        const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
        const soon = await db.query.items.findMany({
          where: { expiresOn: { lte: cutoff }, quantity: { gt: 0 } },
          orderBy: { expiresOn: "asc" },
          with: { location: true },
        });
        return soon.map((i) => ({
          name: i.name,
          expiresOn: i.expiresOn,
          where: i.location?.name ?? "somewhere",
        }));
      },
    }),
  },
});
```

The pantry is all tables: none of the three has a `richText`, a `title`
column or `sync`, so `content` is inferred `false` for each and the three
`editor: false` go. `restock` is a named helper used by `items`' own hooks,
so it is typed from the columns value, `Row<typeof itemFields>`, not from
`items` (§4.2); the evaluator hoists function declarations
(`src/eval.rs:1822`), so `items` may name it before it is declared. `items.slug` was a NOT NULL `text().unique().max(191)`
overwritten by a `slugify` helper in `beforeCreate` on every create; the
proposed `slug({ source: "name" })` is a behaviour change, not the same
column: a supplied slug is kept, an omitted one is derived with `-2`, `-3`
suffixes on collision (`Db.php:639`), the slug grammar is Zero's, and the
column is nullable for a name with no sluggable characters. The example
accepts that (it is what the site's posts already do); `.notNull()` and a
`.validate()` would restore the old guarantees. `restock` was typed
`InferSelectModel<typeof items>`; because it is now referenced from inside
`items`' own options, it is typed `Row<typeof itemFields>` (§4.2, open
question 9). `lib/fields.ts` keeps `UNITS` and `LOW_STOCK` (4 lines).

---

## 6. Migration: every change

Zero is pre-1.0; nothing is shimmed. This is the list the implementation PRs
work from. "Where" names the compiler site that changes.

### 6.1 Removed

| today | instead | where |
|---|---|---|
| `id()` | automatic `id`; `.primaryKey()` for a custom key | `src/eval.rs:1781`, `src/extract.rs:304` |
| `text({ enum })` | `select([...])` | `src/eval.rs:1381` |
| `select({ options, multiple })` | `select(options, { multiple })` | `src/eval.rs:1385` |
| `group({ fields })`, `repeater({ fields })`, `blocks({ layouts })` | `group({...})`, `repeater({...})`, `blocks({...})` | `src/eval.rs:1386` |
| `.$type<T>()` | `json<T>()`; no narrowing on other columns (it had no compiler effect) | `src/eval.rs:888`, `src/types.rs:260` |
| `integer().references(() => t.id, opts)` | `ref("t", opts)` | `src/eval.rs:1976` |
| `references(..., { onUpdate })` | none | `src/eval.rs:2002` |
| `$default`, `$defaultFn`, `defaultNow` | `.default(() => …)` | `src/eval.rs:1952-1975` |
| `$onUpdate`, `$onUpdateFn` | `.onUpdate(() => …)` | same |
| `media({ accept: "image" \| "any" })` | `media({ accept: "image/*" \| string[] })`; default any | `src/eval.rs:1462` |
| `file({ bucket: "name" })` | `file("name")` | `src/eval.rs:1454` |
| `files(name, opts)` | `bucket(opts)` | `src/extract.rs:2135` |
| `global(name, fields, opts)` | `global(fields, opts)` | `src/extract.rs:975` |
| `collection(name, cols, opts)` | `collection(cols, opts)`; `Collection<TName, …>` and `Column.table` lose the name, identity is the registered key | `src/eval.rs:1181`, `src/extract.rs:210`, `index.d.ts:426,436` |
| `editor` | `content` (inferred); `drafts: true` on a table stays | `src/extract.rs:658` |
| `content: "col"` | `body: "col"` | `src/extract.rs:748` |
| `uid: true` | inferred from sync and references | `src/extract.rs:705,2490` |
| `api: {...}` | access rules | `src/extract.rs:854` |
| `defineConfig.target` | none; one target | `src/extract.rs:169` |
| `ctx.target` | none | `index.d.ts:102,920,926` |
| `"authenticated"` | `"guest"` (the ladder's lowest role) | `src/extract.rs:915` |
| auth hidden columns `passwordHash`, `suspendedAt`, `guest`; the declared `email` requirement | `email` and `role` are system columns backed by `wp_users`; `password` stays as the write-only input | `src/extract.rs:2402-2435`, `index.d.ts:429` |
| `defineConfig.schema` | `defineConfig.collections` | `src/extract.rs:196` |
| `defineConfig.relations`, `defineRelations`, `r.one`, `r.many`, `optional` | inferred from `ref()`; `relations: { x: many("t", "col") }` on the target for the ambiguous case | `src/extract.rs:1677` |
| `defineConfig.hooks` | `collection(..., { hooks })` | `src/extract.rs:360` |
| `locales: { default, all, fallback }` | `locales: ["en", "de"]` and `localeFallback: false` | `src/extract.rs:2072` |
| auth collection access defaults (anyone/editor) | `self`/`self`/`admin`/`admin` | `src/extract.rs:817` |
| `references(() => t.col)` to a non-key column | none | `src/extract.rs:1288` |
| `"owner"` (buckets) | `"self"` | `src/extract.rs:939` |
| `action.input` required (types) | optional | `index.d.ts:1012` |
| `job.input` required | optional | `src/extract.rs:2530` |
| `InferSelectModel`, `InferInsertModel` | `Row<T>`, `Insert<T>` | `index.d.ts:489` |
| manual `createdAt`/`updatedAt` | system columns; `timestamps: false` to drop | `src/extract.rs:321` (same place as `status`) |
| `.default(x)` alone (nullable, explicit null accepted) | `.default(x)` is NOT NULL; `.nullable().default(x)` for the old meaning | `src/eval.rs:1907,1952`; `Db.php:429` |
| `.unique().max(191)` on text | `.unique()` | `src/extract.rs:1224` |
| `ctx.user?.role === "admin" \|\| …` | `ctx.is("editor")` | `src/types.rs:457,488` (ctx types), `Access.php:53` |
| `ownerId: integer()` + function rule | `userId: user()` + `"self"` | new column kind; `src/extract.rs:918` |

### 6.2 Added

`ref()`, `user()`, `bucket()`, `many()` (target-side explicit reverse),
`json<T>()`, `select(options, opts?)`, `.onUpdate()`, `.nullable()`,
`.access({ write })`, `access.write`, `ctx.is()`, `collection.content`,
`collection.body`, `collection.hooks`, `collection.timestamps`,
`collection.relations`, `defineConfig.collections`, `localeFallback`,
`Row`, `Insert`, system columns `id`, `createdAt`, `updatedAt`, the
kind-change refusal (§4.9.3), `zero build --explain`.

### 6.3 Unchanged

`text`, `integer`, `real`, `boolean`, `date`, `timestamp`, `email`, `url`,
`slug`, `richText`, `media`, `.notNull`, `.unique` (its declared kinds lose
`boolean`, which the evaluator already rejects), `.primaryKey`, `.min`,
`.max`, `.pattern`, `.validate`, `.access` (shape), `.showIf`, `.localized`,
`label`, `title`, `sync`, `auth`, `agents` (and its job default),
`drafts: true`, `revisions`, `access` (semantics; defaults for ordinary
collections), hooks (names, signatures), `action`, `job`, `jobs`, `once`,
`env`, `db`, `HttpError`, `media.sizes`, `webhooks`, `plugins`, `name`, the
filter grammar, the subset.

### 6.4 Existing data

Zero is pre-1.0 and no app outside this repo runs on the current config, so
existing databases are rebuilt, not migrated. For the record, seven changes
touch storage and `zero build`'s migration step must at least refuse rather
than destroy: a collection whose key differs from its old name argument is a
table rename (`shopping_list` to `shoppingList` in the pantry); a content
collection's single `user()` column moving from meta to `post_author`
(§4.8) is a storage change the snapshot does not record today
(`src/migrate.rs:74` keeps `editor`, `drafts` and columns, no author
mapping), and the two can disagree, since an admin may have assigned an
author record to another user while `post_author` kept the creating
admin's id; the snapshot gains an `author` entry per content collection
and the generated migration copies the meta value into `post_author`
(`UPDATE wp_posts p LEFT JOIN wp_postmeta m … SET p.post_author =
COALESCE(m.meta_value, 0) WHERE p.post_type = <type>`: a left join, because
a nullable column with no meta row reads as `null` today and must become
`0`, not keep the creating user's id) before dropping the meta, so the meta value,
which was the one Zero read and enforced, wins over the core value nobody
checked; the reverse move (`author: false` on a column that was
`post_author`) copies `post_author` into new meta the same way; the body
designation (§4.9.5) is recorded in the snapshot the same way, an
inferred change is refused, and an explicit change generates the copy
between `post_content` and the column's meta in the direction the config
moved; `ref()`
columns keep their names but the inferred `onDelete` (`"restrict"` on a
NOT NULL FK that had none) is a changed constraint; `.default()` implying
NOT NULL turns a nullable column NOT NULL, which is new migration work:
today's `destructive()` (`src/migrate.rs:573`) flags dropped tables and
columns and storage transitions only, and `sql_default()` deliberately
emits constant defaults only. The implementation adds two steps to the
generated migration: a nullable-to-NOT NULL transition emits
`UPDATE … SET col = <default> WHERE col IS NULL` before the constraint
(function defaults have no SQL form, so a column with one is refused at
build time: "`x` has a function default; backfill it in a hook or give it
a constant default"), and an added NOT NULL timestamp is added nullable,
backfilled at apply time with the current UTC instant in Zero's canonical
format (`DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%fZ')` trimmed to
milliseconds, through `UPDATE … WHERE col IS NULL`), then constrained; the
generated SQL is the same for the same schema change whenever it is built,
and the value is right whenever it is applied. MySQL's bare
`CURRENT_TIMESTAMP` is not Zero's timestamp format (`Schema.php:527` does
not normalize it), which is why the expression formats it. The SQL form
covers table columns only; the same nullable-to-NOT NULL transition also
reaches storage the snapshot does not constrain: a content collection's
postmeta and an auth collection's usermeta (where a missing or `NULL` meta
reads as `null`, `Schema.php:521` returns stored nulls unchanged), the
options row a global lives in, and sub-fields of `group`, `repeater` and
`blocks`, whose constraints the snapshot omits (`src/migrate.rs:103` keeps
the parent column only) and which `fillFields` reads back as `null` when
absent (`:548`). Without more, a `.default(x)` sub-field types as non-null
while old rows still return `null`. So the migration step compares the
full declared shape, not the SQL snapshot alone: the snapshot gains the
nullability of meta-backed columns, global fields and structured
sub-fields, and a transition to NOT NULL on any of them emits a PHP
backfill step in the migration, a new step kind beside the SQL files
(`Wp/Migrator.php:63` applies `.sql` only today; the step runs under the
same per-site lock and ledger, `:103`), that walks the affected posts,
users, option or JSON values and writes the constant default where the
value is `null`; a function default is refused there as it is for SQL
columns. The build cannot know which databases have run it, so the gate
is the runtime's, not the build's: the artifact ships with its backfill
step, the first request of any kind applies pending migrations before
Zero serves (`Plugin.php:102`), and while storage is behind the build
Zero's REST answers `503` and so do the core `/wp/v2` writes to its
collections (`:30,163`); core `/wp/v2` reads are exempt today
(`refuseCoreWrites` passes `GET`, `:166`) and prepare their response
through the new schema (`PostsController.php:80`), so the gate is widened
to reads of Zero's post types while storage is behind, and no request
reads the new type before the backfill has run; the declared type and the
stored rows never disagree;
the automatic `createdAt`/
`updatedAt` are added columns, and an app that had authored columns of those
names drops its own (on content collections `updatedAt` reads
`post_modified_gmt`, which every post already has; `createdAt` is new meta,
backfilled once by the migration from `post_date_gmt`, or from
`post_modified_gmt` for the unpublished drafts Zero writes with
`0000-00-00 00:00:00` there, `WpPostStore.php:285`). The examples'
committed migrations and snapshots are regenerated in the PRs that change
them.

### 6.5 What else moves

- **`zero migrate config`** (`src/config_migrate/translate.rs`) emits the
  new shapes: no `id: id()`, `ref()` instead of `<name>Id: integer().references`
  plus a relations block (`:279-380`), `select([...])`, `content: false`
  instead of `editor: false`, no `target`. Its "a required text field named
  `title` enables a post type" rule (`:276,665`) is narrower than §4.9.3 in
  two ways, and the importer writes the difference out rather than
  inheriting the inference: wherever the old rule made a table and §4.9.3
  would infer a content collection, the importer emits `content: false`
  with a report entry saying why (an *optional* text field named `title`,
  which would also fail the title rule; a required single `select` named
  `title`, a text kind to §4.9.3 but not to `:665`, which admits
  `string`/`text`/`textarea` only; a rich-text column on a collection with
  no title); and a source field that is
  optional but has a default (today `.default(x)` without `.notNull()`,
  `:627`) becomes `.nullable().default(x)`, because under §4.9.1 a bare
  `.default(x)` would make it required. Required fields keep
  `.notNull()` (`:530,536`). Timestamps follow §4.9.4: for a Payload
  collection with automatic timestamps the importer emits nothing, since
  the system columns are the same two (today it writes them out, `:336`,
  and refuses an authored `createdAt`/`updatedAt` beside them, `:333`,
  which stays the error); for a Payload collection with `timestamps:
  false`, or any source whose own fields are named `createdAt` or
  `updatedAt`, it emits `timestamps: false` and keeps the authored columns,
  with a report entry saying the automatic columns were turned off to
  preserve them. A source default of `null` (`defaultValue: null`,
  Sanity's `initialValue: null`, accepted at `:620`) is dropped rather than
  emitted, because `.default(null)` is an error under §4.1 and a nullable
  column with no default already reads `null`; the report says so. One
  input has no equal spelling: an
  original-Zero multi-media field carries attachment ids with no type
  restriction and is emitted as `media({ multiple: true })` today
  (`:487`), which §4.1 now accepts for image galleries only. The importer
  emits `repeater({ file: media().notNull() })` for it (`.notNull()`
  because the list normalizer refuses a null item today, `Schema.php:411`,
  and a bare `media()` item would accept `{}`), with a report entry marked
  `changed` saying that the value shape moves from a list of ids to a list
  of `{ file: id }` objects, and `zero migrate site` writes the stored
  values in that shape. Everything else the importer emits is unchanged
  in meaning, and the report says where the new spelling differs.
- **The original-Zero migration** (`docs/migrating-from-zero.md`, `zero
  migrate site`) maps the capsule's implicit timestamps to the new system
  columns instead of reporting them as a gap (`docs/zero-compatibility.md`
  row 3).
- **`docs/config-api.md`** is rewritten from §4; the "Full example" becomes
  §5.2.
- **`types/zero/index.d.ts`**: `Collection` loses `TName`/`$name` and
  `Column.table`; `RelationsOf` derives from `ref` columns' phantom target
  keys instead of `Register.relations`; `One` loses `TOptional`;
  `WriteStructured` treats defaulted sub-fields as optional; `zero.gen.ts`
  registers `collections`, `config` (globals and jobs) and `locales` as
  three separate entries (§4.3; `Register.locales`, `index.d.ts:1139`):
  localized collections already contain `Locale` (`LocaleColumns`, `:485`)
  and actions read `db.query`, so neither may be derived from the config
  that contains them. `zero.gen.ts` writes the locale union from the
  extracted schema, as it does now.
- **Generated client** (`src/client.rs`): relation names come from the
  column name; `with` typing follows.
- **Fixtures**: 114 `tests/fixtures/*/zero.config.ts`, the three examples,
  `tests/wp/app` and its lanes, `tests/system`. Most of the rewrite is
  mechanical (a codemod over `id: id()`, `editor: false`, `references`,
  `$onUpdate`, `defineRelations`). Fixtures for removed options are
  deleted along with the options; the replacements are proven through
  their runtime behaviour and type contracts. `drafts: true` on a table
  remains supported and keeps its fixture.
- **Neighbouring designs and work** (what this simplifies for them; none
  of their files are edited here):
  - Localized relations: localized `many` loads under `with` are keyed by
    the inferred relation; nothing to add to the config.
  - The `.d.ts` primary-key typing: `main` types row ids from the actual
    primary key and already gives the builder a `TPrimary` flag that
    `.primaryKey()` sets (`index.d.ts:120,128,181`). §4.9.1 reuses it to
    know whether to add `id`: the first item of §7.1's PR 2 is the
    automatic `id` on top of that flag, not the flag itself, and
    `RowId<TCols>` then simplifies because `id` is always present unless
    `TPrimary` says otherwise.
  - Compiler aliasing: untouched; `ref("key")` is a string the extractor
    resolves, not an expression the compiler sees.
  - The README: its first example should be §5.2's first collection; a
    `collection({ name: text().notNull() })` line is the whole pitch.
  - Zero Blocks (`docs/design-blocks.md`): `bind.field("excerpt")` names a
    column; unchanged.
  - Zero Admin (`docs/design-admin.md`): `admin: true` is kept as proposed;
    the admin derives its list title from `title`, which is now inferred
    more often.

---

## 7. Implementation notes

### 7.1 Stacked PRs (after approval)

1. Columns: `select`, structured builders, `json<T>`, `.default(fn)`,
   `.onUpdate`, `.nullable`, implied NOT NULL, implied `.max(191)`, `media`
   MIME patterns. Fixtures and examples follow in the same PR.
2. System columns: a `TPrimary` flag on `ColumnBuilder` (set by
   `.primaryKey()`, read by `collection()` to decide whether `id` is
   added); automatic `id`, `createdAt`, `updatedAt`; `timestamps`;
   the WP post-date mapping; `id()` removed. The automatic `id` is added to
   the evaluator's `CollectionVal.columns` (`src/eval.rs:1181`), not only to
   the extracted schema, because `.references(() => authors.id)` still
   resolves the property through the evaluator (`src/eval.rs:1059`) until
   PR 3 replaces it.
3. `ref()` and inferred relations; `many()`; `defineRelations` removed;
   `zero.gen.ts`, client and `.d.ts` relation typing.
4. Collections: no name argument, `content` inferred, `body`, `hooks` in
   `collection()`, `uid` inferred, `api`/`editor`/`target` removed,
   `collections` key.
5. Access and auth: `write`, `ctx.is()`, `user()`, `"self"` on `user()`
   columns, `"owner"` renamed; the auth collection's system `email` and
   `role`, the `delete_user` hook, the pending-password side channel that
   replaces `passwordHash` (`Auth/Module.php:284`, `WpUserStore.php:330`),
   and the removal of `suspendedAt`/`guest`.
6. Names: `global(fields)`, `bucket()`, `file("key")`, `locales` array,
   optional `input`, `Row`/`Insert`.
7. Importers and docs: `zero migrate config`, `docs/config-api.md`,
   `docs/migrating-from-zero.md`, `zero build --explain`.

Each PR keeps the differential, compiler, PHP, WP and system suites green on
its own; the examples are rewritten in the PR that breaks them.

### 7.2 `zero build --explain`

Inference needs to be visible. `zero build --explain` (or the existing
`zero doctor`) prints, per collection: kind (content/table) and why, title,
body, slug source, system columns, relations and their reverse names, access
after defaults. The generated client's `SCHEMA` carries some of it
(`drafts`, `revisions`, `localized`, relations, media and file columns,
`src/client.rs:566`); the kind, the designations and the reasons are new,
and this is the human-readable form.

### 7.3 Where the subset grows

Three places, all small:

- **Type arguments on a builder call** (`json<string[]>()`): the IR already
  carries `type_args` on every call (`src/ir.rs:280`); the evaluator reads
  them only for `$type` (`src/eval.rs:888`). `json` reads them the same way.
- **A method on `ctx`** (`ctx.is("editor")`): access and hook closures are
  compiled, not evaluated; the `ctx` types live in `src/types.rs:457,488`
  and `src/compile.rs:390` picks one per slot; the method lowers to a PHP
  call. No evaluator change.
- **Two type names** (`Row<typeof t>`, `Insert<typeof t>`): the compiler's
  annotation resolver matches `InferSelectModel`/`InferInsertModel` by name
  and resolves a collection path (`TyAnn::Query`, `src/compile.rs:854`);
  the new arm also resolves a path to a columns object (a plain object of
  column builders at module scope, which the evaluator already holds as
  values) and an optional options object (a plain object literal the
  evaluator holds too), and builds the row exactly as `extract` builds a
  collection's from the same two inputs, so the two can never disagree. Two more
  changes make the compiler's row agree with the `.d.ts` exactly, which is
  what lets an object that type-checks in the editor be assignable in the
  compiler (`assignable()` is exact on object keys, `src/compile.rs:4938`):
  the row drops hidden system columns (one filter on `columns_row`,
  `src/types.rs:354`, matching the client's at `src/client.rs:388`), and
  enum columns type as the union of their literals (`select(["a","b"])` is
  `"a" | "b"`, a multiple select `("a" | "b")[]`) instead of `string` and
  `string[]` (`col_base`, `src/types.rs:260`); the `Ty` model already has
  `StrLit` and unions, so this is the one place that widens.

Nothing else is new to the evaluator: `select(array, opts)` is positional
arguments it already handles; `collection(cols, opts)` drops an argument;
`ref("key")` and `file("key")` are strings the extractor resolves once every
collection and bucket is registered, as `hooks.<key>` is today; `hooks`
inside the options object are closures found in an object literal, as
`access` functions are today.

### 7.4 Risks

- **Inferred `content` can surprise.** A table that gains a `title` column
  later would become a content collection (drafts, revisions, a WP post
  type, a 15-character name limit). §4.9.3 refuses the kind change at build
  time unless `content:` is explicit, so the surprise is an error, not a
  storage change. Open question 1 asks whether to require the flag always.
- **Hooks beside the columns cost one typing pattern.** A named helper
  used as a hook is typed from the collection's columns object, not from
  the collection (§4.2, §5.2). Open question 9.
- **Automatic timestamps on tables** (`editor: false` today) are two new
  NOT NULL columns in every `$wpdb` table; the migration step needs the
  backfill rules in §6.4, which it doesn't have today.
- **Snake-case keys.** Today `collection("shopping_list")` with key
  `shoppingList` gives a snake-case table and a camel-case query key. Dropping
  the name argument makes the key both, renames the pantry's table, and
  changes its derived label: `title_case` splits on underscores and hyphens
  only (`src/schema.rs:526`), so `shopping_list` was "Shopping List" and
  `shoppingList` is "ShoppingList". The derivation splits camel case too
  (`shoppingList` → "Shopping List"), so no example needs a `label`.
  Open question 4.

---

## 8. Open questions for the owner

1. **Infer `content` from the columns (§4.9.3), or require it?** Inference
   removes the most common line in the repo (`editor: false`, 111 times) and
   matches the importer's existing rule. Requiring `content: true` is
   predictable but means every blog collection writes it. A middle option: infer,
   and have `zero build` print one line per collection the first time it
   decides ("`events` is a table: no richText, no title; add `content: true`
   to publish it"). The proposal picks inference plus `--explain`.
2. **The `authorId`/`author` pair (proposed), or one shared name?** Payload,
   Sanity, Keystatic and Convex use one key for id and object. Zero's filter
   grammar, compiler and runtime resolve a key as a column before a relation,
   so one key would need a new disambiguation rule and a row type that
   changes shape under `with`. The pair keeps Drizzle's flat row types and
   today's grammar; `ref()` still removes `defineRelations`. If the owner
   wants one key, §4.3 needs a filter-grammar design first.
3. **Automatic `createdAt`/`updatedAt` on every collection, or only on
   content collections?** Payload and Convex add them everywhere. Tables that
   model pure lookups (`locations`) carry two unused columns. The proposal
   picks everywhere with `timestamps: false`, because the hook signatures and
   the client stay uniform.
4. **Table names.** With the name argument gone, is the key the table name
   verbatim (`shoppingList` → `zero_shoppingList`), or snake-cased
   (`zero_shopping_list`)? The proposal picks verbatim (no second naming to
   learn, and MySQL accepts it); snake-casing is a one-line change in the
   extractor if the owner prefers SQL-looking tables, and content
   collections are lowercase either way (§4.2). Either way the derived
   label splits camel case (§7.4).
5. **`"self"` on `create`.** Should `"self"` be allowed on `create` for a
   collection with a `user()` column, meaning "any signed-in viewer, and the
   row's `user()` column is set to them (filled when absent, 403 when
   different)"? It would make "members create their own rows" one word, and
   `write: "self"` would then cover all three writes. The proposal keeps
   today's rejection and asks.
6. **Keep `agents`?** It is an MCP visibility flag with no non-test use.
   Keeping it costs one option on four builders; removing it means every
   ability is exposed when the MCP adapter is active. The proposal keeps it.
7. **`revisions` on tables.** Two fixtures turn revisions on for a
   non-content table. If that is a real need, `revisions: true` stays as
   proposed; if not, `revisions` can fold into `content` entirely and go.
8. **Branded ids?** `$type` goes because the compiler never allowed it
   outside `json`.
   Drizzle users sometimes brand scalars (`integer().$type<UserId>()`); that
   would need the subset to lower `number & { __brand }` to `number`. The
   proposal does not add it; say so if branded ids matter.
9. **Hooks beside the columns, or a separate `hooks(items, {...})` call?**
   Beside the columns is where Payload and Strapi put them and it removes a
   `defineConfig` key, at the cost of typing a named hook helper from the
   columns object (§4.2). A separate `export const itemHooks =
   hooks(items, { afterCreate: restock })` registered under
   `defineConfig.hooks` keeps `Row<typeof items>` everywhere at the cost of
   one more top-level key. The proposal picks beside the columns.
10. **Drop `api`, or keep it for splitting `list` from `get`?** The proposal
    drops it (zero uses); the one thing access rules can't express is
    `list` and `get` set differently. If that matters (unlisted but linkable
    rows, say), `api` stays as the rarely-used option it is.
11. **Model `pending` and `private` post statuses?** WordPress has them;
    Zero's `status` has `draft`/`published`/`scheduled`. An editorial
    workflow (contributors submit, editors publish) needs `pending`. The
    proposal keeps three; adding `"pending"` is one enum value and one
    mapping line, but every access rule that says `{ status: "published" }`
    is unaffected either way.
12. **Add `contributor` to the role ladder?** WordPress's `contributor` can
    write but not publish, which is the role `pending` is for. Zero's ladder
    skips it, and today's capability mapping folds contributors into
    `author` (`edit_posts` or `publish_posts` both give `author`,
    `WpAuth.php:63`), so `ctx.is("author")` and the examples' staff rules
    already admit them. Adding `contributor` means a new rung
    (`subscriber < contributor < author`), a capability test on
    `publish_posts` alone for `author`, the `ROLES` map and the `Role`
    union; leaving it out keeps contributors as authors. A custom role with
    `edit_posts` but not `publish_posts` has the same standing, so a rung
    alone does not restore WordPress's publish gate for roles the ladder
    cannot name. The alternative is a capability test in rules
    (`ctx.can("publish_posts")`), which lets a site write the native gate
    without Zero modelling every role. Tied to question 11.
