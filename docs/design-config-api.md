# Design: the `zero.config.ts` API, reviewed

Status: proposal, for the owner's review. Nothing here is implemented. After
approval it lands as stacked PRs (§7).

`zero.config.ts` is the product. Zero is "a TypeScript framework for building
backends, fast", and the config file is the whole authoring surface: every
collection, field, rule, hook, action, job and integration is written there,
evaluated at build time by Zero's own evaluator, and compiled to PHP. The
phase-1 and phase-2 lanes each added their own options in parallel, and the
seams show. This document inventories what exists, checks every claim against
the compiler (`src/extract.rs`, `src/eval.rs`), borrows from the systems users
already know, and proposes one consistent, smaller API.

Three sentences of the result:

- **Collections are inferred from their columns.** `id`, `createdAt`,
  `updatedAt`, the title, the body, the slug, the post type and the relations
  all come from the column set; nothing needs declaring twice.
- **Everything about a collection lives in `collection()`.** Access, hooks and
  the sync pattern sit beside the columns; `defineConfig` only lists what
  exists plus the app-wide things (jobs, webhooks, locales, media, buckets).
- **One way to say each thing.** Six duplicate spellings go, three
  single-purpose flags go, two flags become inferred, and the examples shrink by
  a fifth without losing a feature.

The before/after rewrite of the two examples is in §5: `examples/site` goes
from 205 to 168 lines (170 to 136 non-comment), `examples/pantry` from 117
to 96 (105 to 87) and loses most of its helper module.

---

## 1. Inventory of today's surface

Everything below is what `src/extract.rs` and `src/eval.rs` accept on `main`
plus PR #50 (which only documents what already compiles). Line references are
to `main` at `b45e586`.

### 1.1 Column builders (19 kinds, `src/eval.rs:1358`)

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

### 1.2 Column modifiers (`src/eval.rs:1904`, the `MODIFIERS` list)

`notNull`, `unique`, `primaryKey`, `default`, `defaultNow`, `$default`,
`$defaultFn`, `$onUpdate`, `$onUpdateFn`, `references`, `$type`, `min`, `max`,
`pattern`, `validate`, `access`, `showIf`, `localized`.

### 1.3 Collection options (`COLLECTION_OPTIONS`, `src/extract.rs:64`)

`label`, `editor`, `drafts`, `revisions`, `title`, `content`, `access`, `api`,
`sync`, `uid`, `auth`, `agents`.

### 1.4 `defineConfig` keys (`src/extract.rs:49`)

`name`, `target`, `schema`, `relations`, `globals`, `hooks`, `actions`,
`jobs`, `webhooks`, `files`, `media`, `locales`, `plugins`. Zero Admin (#52)
proposes `admin: true`.

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
| F6 | R | A relation needs three declarations: the `references()` column, `r.one` with `from`/`to`, and `r.many` on the other side. The `one` side is derivable from the FK and the `many` side already is (`pending_many`). Every `r.one` in the repo (14) repeats exactly the `references()` pair. | `src/extract.rs:1678-1870`. |
| F7 | R | `files.<key>` must equal `files(name, …)`'s name; same for `globals.<key>` and `global(name, …)`. The name is stated twice and the compiler rejects a mismatch. | `src/extract.rs:976,2143`. |
| F8 | R | `uid: true` is implied by `sync`, required for being a sync reference target, and otherwise unused in examples except to satisfy that rule (3 uses, all for sync). | `uid = flag("uid")?.unwrap_or(sync.is_some())` (`src/extract.rs:705`); `sync references need uid: true on …` (`:2490`). |
| F9 | R | `access.update` and `access.delete` are identical in 4 of 5 examples; `create`/`update`/`delete` are identical in most. There is no "all writes" shorthand. | `ACCESS_OPS` loop (`src/extract.rs:812`). |
| F10 | R | `ctx.user?.role === "admin" \|\| ctx.user?.role === "editor"` is the way to say "editor or above" inside a function; the ladder exists in the runtime but not in `ctx`. 7 copies in the repo, plus a `STAFF` array in PR #50's site example. | `Access.php:53` has `roleRank`; `AccessCtx` has only `user`. |
| F11 | I | `editor` names a WordPress storage choice but is the master switch for `drafts` and `revisions` on both targets; `editor: false` appears on 111 collections (93 in fixtures, 86 fixture files), i.e. the "default" is the minority case for everything that isn't blog content. | `editor = flag("editor")?.unwrap_or(!auth)`; `drafts … None => editor`; `revisions … unwrap_or(editor)` (`src/extract.rs:658-667`). |
| F12 | I | `title`/`content` are inferred only from columns literally named `title` and `content`; a `name: text().notNull()` collection must add `title: "name"` (7 uses). WordPress needs a title; the inference rule could cover the first NOT NULL text. | `columns.get("title").filter(...)` (`src/extract.rs:716`). |
| F13 | I | Structured builders take their fields under a key (`group({ fields })`, `blocks({ layouts })`) while `select` takes `options`; a bare object would do, since each builder has exactly one required option. | `required` table (`src/eval.rs:1390`). |
| F14 | I | `media({ accept: "image" })` is a two-value enum while `files({ accept: ["image/*"] })` takes MIME patterns. Same concept, two grammars. | `src/eval.rs:1462`, `src/extract.rs:2149`. |
| F15 | I | `files()` takes a bucket name as its first argument; `global()` takes a name; `collection()` takes a table name; `job()` and `action()` take none (the key names them). | signatures in `index.d.ts`. |
| F16 | I | Collection-level `access` has four ops; field-level has three (no `delete`); globals two; files three (`read`, `create`, `delete`, no `update`); actions one. Fine in substance, but the shorthands differ: `"self"` only on auth collections, `"owner"` only on buckets, and neither on the collections that model ownership with a hand-written `ownerId`/`userId` column (8 uses) and a function rule. | `access_rule` (`src/extract.rs:912-945`). |
| F17 | I | `hooks` live in `defineConfig`, keyed by schema key, far from the collection; `access` lives in the collection. Every hook in the repo is about one collection. The WP test app needs a `mergeHooks` helper because of it. | `src/extract.rs:360-420`, `tests/wp/app/compose.ts`. |
| F18 | I | `relations` are keyed by schema key, `references()` by collection value, `webhooks.events` by table name (`posts.created` checks `out.schema.collections.contains_key`, which is keyed by table). Three namings for one collection. | `src/extract.rs:2619`. |
| F19 | I | `locales: { default, all, fallback? }`: `default` must be repeated inside `all`, and `fallback: false` is unused anywhere. | `src/extract.rs:2072-2096`. |
| F20 | I | `slug({ source })` is unique by construction and limited to one per collection, so it is a collection property spelled as a column option. Fine, but `source` must name a column while `title:` is also a column name, so the same post has `title: "name"` and `slug({ source: "name" })`. | `src/extract.rs:769`. |
| F21 | D | `drafts` and `revisions` default to `editor`, and `drafts: false` with `editor: true` is rejected, so `drafts` is only ever `editor` or an explicit `true` on a non-editor table (2 uses). | `src/extract.rs:659-667`. |
| F22 | D | `agents` defaults `true` everywhere except jobs (`false`); 9 uses, all in tests. It is a WordPress-only MCP visibility flag that most users will never touch. | `src/extract.rs:709,2523`. |
| F23 | D | `label` is title-cased from the table name; every explicit `label` in the examples equals the derived one except `"Site settings"`. | `title_case` (`src/schema.rs:526`). |
| F24 | D | `.notNull()` on a column with `.default(...)` is noise: the column can never be null on insert, and the compiler already types it as required. `boolean().notNull().default(false)` appears 10 times, `.notNull().default([])` 5 times. | `RequiredInsertKeys` (`index.d.ts:306`). |
| F25 | D | `unique()` text needs `.max(191)` or the build fails; the number is a MySQL constant the user has to know (22 uses). | `MAX_UNIQUE_TEXT` (`src/extract.rs:82`). |
| F26 | D | `target` in the config duplicates `zero build --target`; 3 uses, all in fixtures. A config should be target-independent (the Admin design says the same of `admin`). | `src/extract.rs:169`. |
| F27 | U | `api: { list, get, create, update, delete }`: zero uses in the repo; `access: { read: false }` already removes the endpoints' usefulness, and a route that exists but 403s is the documented behaviour elsewhere. | `src/extract.rs:854`. |
| F28 | U | `references(..., { onUpdate })`: ids are autoincrement and never change; zero uses. | `src/eval.rs:2002`. |
| F29 | U | `.primaryKey()` on a non-integer column: 3 fixture uses, two of them rejection tests; auth, sync and editor collections all require `id: id()`. | `src/extract.rs:671,2394,2448`. |
| F30 | U | `optional: false` on `r.one` is a type-only flag that the FK's `.notNull()` already implies (4 uses, each on a `.notNull()` FK). | `src/extract.rs:1751`; `index.d.ts:541`. |
| F31 | I | `action.input` is required in the types but optional in the compiler; `job.input` is required in both. Two actions write `input: {}`. | `src/extract.rs:453` vs `:2530`. |
| F32 | I | `defineConfig.schema` is the Drizzle word, but Zero's docs, REST paths, abilities and the admin all say "collections". | `src/extract.rs:51`. |

Not findings, kept as they are: the Drizzle 1.0 object filter and
`db.query` API (users know it, the compiler checks it); the restricted TS
subset; `.validate()`, `.min/.max/.pattern`; `showIf` as UI-only (Payload
semantics, phase-2 ruling 9); `job`/`action`/`once`/`env`; `plugins`.

---

## 2. What the others do, and what fits a compiled config

Each borrowed idea names its source and why it fits Zero, whose config is
evaluated once at build time by a Rust evaluator (no runtime reflection, no
classes, no npm).

| idea | from | why it fits Zero |
|---|---|---|
| Automatic system fields: `_id`/`_creationTime` (Convex), `timestamps: true` default adding `createdAt`/`updatedAt` (Payload), `date-created`/`date-updated` specials (Directus). | Convex, Payload, Directus | The extractor already injects `status`, `publishedAt`, `uid`, `locale`; adding `id`, `createdAt`, `updatedAt` is the same mechanism (`src/extract.rs:321`). |
| Feature toggles that inject known fields: `auth: true`, `upload: true`, `versions.drafts`. `true` means defaults, an object refines. | Payload | Zero's `auth: true` already does this; `drafts`/`revisions` fold into one content toggle. |
| Title designated by a pointer (`displayField`, `useAsTitle`, `titleField`, `slugField`), with a documented inference fallback (a string field named `title`). | Contentful, Payload, EmDash, Keystatic, Sanity's default preview | Zero already infers `title`; the proposal widens the fallback and keeps the pointer. A pointer is checkable at build time; a per-field `isTitle` flag (Tina) needs a "one per collection" runtime rule. |
| The reverse side of a relation is inferred from the forward side (`r.many.posts()` with no config, `join` fields). | Drizzle 1.0, Payload | The extractor's `pending_many` already does this; the proposal makes the forward side inferred from the FK too. |
| Reference as a typed column that names its target: `v.id("users")`, `relationTo: "users"`, `fields.relationship({ collection })`, `to: [{ type: "author" }]`. | Convex, Payload, Keystatic, Sanity | A `ref(() => authors)` column gives the compiler the target collection at build time; `references(() => authors.id)` makes the user name the PK, which is always `id`. |
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
WordPress meta keys are already prefixed).

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

---

## 4. The proposed API

### 4.1 Columns

Builders (16, down from 19):

```ts
text(opts?)          // { multiline?: true }
integer(), real(), boolean(), date(), timestamp(), json<T>()
email(), url()
slug(opts?)          // { source?: column } — source defaults to the title
richText()
media(opts?)         // { accept?: "image/*" | string[] , multiple?: true }
file(bucket)         // the bucket value, not its name
select(options, opts?)   // select(["a","b"]) | select(["a","b"], { multiple: true })
ref(() => target, opts?) // { onDelete?: "cascade" | "restrict" | "set null" }
group({ ...fields }), repeater({ ...fields }), blocks({ layout: { ...fields } })
```

What changed and why:

- **`select(options)`** is the only enum column. `text({ enum })` goes (F1).
  `select` is the CMS word (Sanity `options.list`, Payload `select`,
  Contentful `in`), and the array is positional because it is the one
  required option (F13).
- **`group`, `repeater`, `blocks`** take the fields object directly (F13).
  `blocks({ hero: {...}, quote: {...} })` reads as "these layouts".
- **`json<T>()`** replaces `json().$type<T>()`. The evaluator already reads
  call type arguments for `$type` (`src/eval.rs:891`); the same `type_args`
  on `json` is one line. `$type` stays for the rare non-JSON narrowing.
- **`ref(() => authors)`** replaces `integer().references(() => authors.id, …)`
  (F6). The column is an integer FK to the target's primary key; the compiler
  already resolves lazy arrows at extraction (`call_closure_public`,
  `src/extract.rs:1272`). It also declares the relation (§4.3). Non-PK
  reference targets (one fixture, `a.name`) are not worth a second grammar;
  a `.references()` escape hatch is not kept.
- **`media({ accept })`** takes MIME patterns like buckets do (F14);
  `"image/*"` is the common case and `"image"` is accepted as its alias
  only in the error message's suggestion, not as a value.
- **`file(bucket)`** takes the bucket value (F7, F15): the bucket is a
  module-level constant like a collection, so the column can point at it and
  the compiler checks the pointer the way it checks `ref` targets.
- **`id()` goes** (F3, see §4.9.1). A collection gets `id` automatically.
  `.primaryKey()` stays for the rare text key (`code: text().primaryKey()`),
  which suppresses the automatic `id` (F29).

Modifiers (14, down from 18):

```
.notNull() .unique() .primaryKey()
.default(value | () => value)   // a constant, or a function run in PHP on insert
.onUpdate(() => value)          // run in PHP on update
.min(n) .max(n) .pattern(/re/) .validate((value, ctx) => true | "message")
.access({ read?, write? | create?, update? }) .showIf(filter) .localized()
.$type<T>()
```

- **`.default()` accepts a function** and `$default`, `$defaultFn`,
  `defaultNow`, `$onUpdateFn` go (F2, F4). The evaluator already branches on
  `Value::Closure` inside `default` to reject it (`src/eval.rs:1952`); it
  routes to `now_or_fn` instead. `() => new Date()` on a time column still
  means SQL "now". `$onUpdate` loses the `$` because nothing else in the
  modifier set has one and Drizzle's `$` marks "runtime-only", which every
  Zero modifier is.
- **`.notNull()` is implied by `.default()`** (F24). A column with a default
  is never null on insert; the proposal makes it NOT NULL in SQL too, which
  is what every use in the repo wants. `boolean().default(false)` reads as
  the column it is. To keep a nullable column with a default (no use in the
  repo), write `.nullable()`; the opposite of `.notNull()` is otherwise
  missing from the vocabulary.
- **`.unique()` on text implies `.max(191)`** (F25). The constant moves into
  the compiler; an explicit larger `.max()` on a unique text column is the
  build error it is today.
- **`.access({ write })`** is a shorthand for `create` and `update` together
  (F9); either may still be given alone and the specific one wins.

### 4.2 Collections

```ts
collection({ ...columns }, {
  // identity
  label?: string,            // default: title case of the key
  title?: column,            // default: see §4.9.2
  body?: column,             // default: the first richText column; false = none
  // behaviour
  content?: boolean,         // default: inferred (§4.9.3). true = posts + drafts + revisions on WP; false = a plain table
  revisions?: boolean,       // default: content
  sync?: "dir/*.md" | "dir/*.json",
  auth?: true,
  // rules
  access?: { read?, write?, create?, update?, delete? },
  hooks?: { beforeCreate?, afterCreate?, beforeUpdate?, afterUpdate?, beforeDelete?, afterDelete? },
  // rarely
  timestamps?: false,        // drop createdAt/updatedAt
  agents?: false,            // keep out of MCP (WordPress)
})
```

- **No name argument.** The schema key is the name, like `jobs`, `actions`
  and Drizzle's `defineRelations` keys (F15, F18). The table name is the key;
  `zero_` prefixing is unchanged. Snake-case keys stay valid identifiers
  (`shopping_list` today) and a camel-case key (`shoppingList`) is the
  table name `shoppingList`, which SQLite and MySQL accept; the REST path is
  the key too. The three namings (key, table, `.$name`) collapse to one.
- **`content` replaces `editor`** (F11). The word says what it means on both
  targets: a content collection has drafts, revisions, scheduling and a
  wp-admin editor; a table doesn't. `drafts` goes: it was never independently
  settable (F21). `revisions` stays as an opt-in on tables (2 uses) and an
  opt-out on content.
- **`body` replaces `content`** as the designation of the rich-text column,
  because `content` now names the collection kind, and "body" is the word the
  Markdown sync already uses for it.
- **`hooks` move in** (F17). They are compiled identically; the key under
  `defineConfig` goes. A hook that needs another collection's value references
  it by name as today (module scope, hoisted).
- **`uid` goes** (F8): a synced collection and every collection a synced
  collection references get a `uid` column automatically; the compiler can see
  the reference graph. `uid: true` for its own sake has no use in the repo.
- **`api` goes** (F27). Access rules are the one way to close an endpoint.
- **`target` goes** from the config (F26); `zero build --target` and
  `zero.toml`/CLI defaults own it. `name` stays (it is the plugin slug).

Rejections stay as today where they are not subsumed: a content collection
needs a title; names over 15 characters on content collections; reserved
names; two slugs; user columns named `status`/`publishedAt`/`createdAt`/
`updatedAt`/`id` colliding with system columns (new error: "`id` is added
automatically; remove it, or use `.primaryKey()` on your own key").

### 4.3 Relations

Relations are inferred from `ref()` columns. `defineRelations` goes.

```ts
export const posts = collection({ author: ref(() => authors) });
export const comments = collection({ post: ref(() => posts).notNull() });
```

expands to

```
posts.author     : one authors     (from posts.author, to authors.id, optional: true)
comments.post    : one posts       (from comments.post, to posts.id, optional: false)   // notNull
authors.posts    : many posts      (reverse of posts.author)
posts.comments   : many comments   (reverse of comments.post)
```

Rules, all enforced at build time:

- The **column name is the relation name**. `author: ref(() => authors)` is
  read as `row.author` (the id) and loaded with `with: { author: true }`
  (the row), exactly as `media()` columns work today (`Db.php:254`). The
  `authorId`/`author` pair goes; filters use `{ author: 5 }` for the id and
  `{ author: { name: "x" } }` for the relation, which the Drizzle filter
  grammar already distinguishes by value shape (`RelationsFilter`,
  `index.d.ts:672`).
- The **reverse relation is named after the referencing collection's key**
  (`authors.posts`). When two `ref` columns of one collection point at the
  same target (`posts.author` and `posts.editor` both to `authors`) no reverse
  is inferred and the user names them: `reverse: { authors: { written: "author", edited: "editor" } }` is **not** proposed; instead the
  target collection gets `relations: { written: many(() => posts, "author") }`.
  That is the only remaining explicit relation form and it is also how a
  `many` with no FK (today's `r.many.subscribers({ from, to })`) is written.
- `optional` goes (F30): the FK's `.notNull()` decides it.
- `onDelete` defaults to `"set null"` for nullable refs and `"restrict"` for
  NOT NULL refs, the same rule the importer already applies
  (`docs/config-migration.md`, "Original Zero reference"); `cascade` is
  explicit.
- `zero.gen.ts` registers `collections` only; the `relations` registration
  path goes.

### 4.4 Access

```ts
access?: {
  read?: Rule, write?: Rule,            // write = create + update + delete
  create?: Rule, update?: Rule, delete?: Rule,   // override write
}
Rule = boolean | "anyone" | "authenticated" | Role | "self" | ((ctx) => boolean | Filter)
```

- `write` is the shorthand (F9). Defaults are unchanged: `read: "anyone"`,
  `write: "editor"`, and on auth collections `read: "self"`, `update: "self"`,
  `create: "admin"`, `delete: "admin"` (the exact rule the site example
  writes by hand).
- **`ctx.is(role)`** (F10): true when the viewer's role is `role` or above.
  It compiles to the `roleRank` comparison the runtime already has. The seven
  `admin || editor` copies and PR #50's `STAFF` array become `ctx.is("editor")`.
- **`"self"` widens to ownership** (F16): on a collection with a `user()`
  column (§4.8) `"self"` means "rows whose `user` column is the viewer".
  On an auth collection it means the viewer's own row, as today. The hand-
  written `ownerId`/`userId` column plus `{ ownerId: ctx.user?.id ?? -1 }`
  function pair (8 uses) becomes `user: user()` and `"self"`. `"owner"` on
  buckets is renamed `"self"` so the vocabulary is one word.
- Field access keeps `read`/`create`/`update` and gains `write`.

### 4.5 Globals

```ts
export const settings = global({ ...fields }, { label?, access?: { read?, update? }, agents? });
defineConfig({ globals: { settings } })
```

No name argument (F7, F15); the key names it. Field rules unchanged.

### 4.6 Actions and jobs

```ts
action({ input?, access?, idempotent?, signature?, agents?, handler })
job({ input?, retries?, agents?, handler })
```

`input` becomes optional on both (F31); `input: {}` goes. Nothing else
changes: these two were designed together and are consistent.

### 4.7 Files, media, locales, webhooks

```ts
export const manuscripts = bucket({ accept: ["application/pdf"], maxBytes: 1_000_000, access?: { read?, create?, delete? } });
defineConfig({
  files: { manuscripts },
  media: { sizes: { card: { width, height?, fit? } } },
  locales: ["en", "de"],              // first = default; or { default, all, fallback }
  webhooks: [{ url, secret, events }],
})
```

- `files(name, …)` becomes `bucket({…})` (F7, F15): the key names it, the
  value is what `file(bucket)` points at, and "bucket" is what the docs already
  call it.
- `locales` as an array (F19): the first entry is the default. The object
  form stays for `fallback: false`.
- Webhook events name collections by key, which is now the only name (F18).

### 4.8 Auth and users

```ts
export const members = collection({ name: text().notNull() }, { auth: true });
```

- `auth: true` adds `email` (`email().notNull().unique()`) as well as `role`
  and the hidden columns; the user no longer declares the one column the
  compiler insists on (`src/extract.rs:2402`). Declaring `email` yourself
  stays allowed for extra rules.
- **`user()`** is a new column: an integer reference to the app's user
  (`User.id`), nullable, `"set null"` on delete. It is what `authors.userId`
  and the `ownerId` columns are by hand today, and it is what `"self"` reads.
  On WordPress it is a `wp_users` id; on standalone the `__zero_users` id; with
  an auth collection it is also that collection's `id` (they are the same
  number today, `src/extract.rs:2397`).

### 4.9 Magic that removes config

Each default, what it expands to, and the one word that turns it off.

#### 4.9.1 `id`

Every collection without a `.primaryKey()` column gets
`id: integer().primaryKey()` (autoincrement) as its first column. Off: declare
your own `.primaryKey()`. Error: a user column named `id` without
`.primaryKey()`.

#### 4.9.2 `title`

On a content collection, `title` is, in order: the `title:` option; a column
named `title`; the first `text()` column (not multiline) that is `.notNull()`.
The chosen column must be NOT NULL text (today's rule). Off: `content: false`.
Error when nothing matches: today's "has no title" with the three options
listed. This turns the seven `title: "name"` into nothing.

#### 4.9.3 `content`

A collection is a content collection when it has a `richText()` column, a
`text()` column named `title`, an explicit `title:` option, or Markdown
`sync`. Otherwise it is a table; `auth: true` is always a table (today's
rule). Off: `content: true` or `content: false` written out. The rule is
printed in `zero build --explain` (see §7) so nobody has to guess, and the
generated client's `SCHEMA` carries it as today.

Checked against the repo's 157 collections (125 tables, 32 content): the
rule reproduces today's flag on all but 4 tables that happen to carry a
`title: text()` or a `richText()` column (`jobNotes`, `hookNotes`, `guides`
in `locales-client`, and a rejection fixture); they write `content: false`.
No content collection needs `content: true`.

#### 4.9.4 `createdAt` / `updatedAt`

Every collection gets `createdAt: timestamp().default(() => new Date())` and
`updatedAt: timestamp().default(() => new Date()).onUpdate(() => new Date())`
as system columns, readable, filterable, orderable, never writable through the
API. On WordPress content collections they are `post_date_gmt` and
`post_modified_gmt` (the store already reads `post_date_gmt`,
`WpPostStore.php:85`). Off: `timestamps: false`. Error: a user column of
either name. Localized rows keep per-row timestamps (today's rule for
`$onUpdate` columns).

#### 4.9.5 `body` and `slug`

`body` is the first `richText()` column. `slug()` with no `source` derives
from the title column. Off: `body: false`; `slug({ source: "other" })`.

#### 4.9.6 Relations

As §4.3: every `ref()` is a `one`, every `one` gets a `many` back unless the
target already has one from the same collection. Off: name the reverse
explicitly with `relations:` on the target.

#### 4.9.7 `uid`

A `uid` column exists on synced collections and on every collection a synced
collection references. Off: none; it is a system column.

#### 4.9.8 Access on auth collections

`read: "self"`, `update: "self"`, `create: "admin"`, `delete: "admin"`. Off:
any explicit `access`.

#### 4.9.9 Required with a default

`.default(x)` implies `.notNull()`. Off: `.nullable()`.

#### 4.9.10 Unique text length

`.unique()` on text implies `.max(191)`. Off: an explicit smaller `.max()`.

### 4.10 `defineConfig`

```ts
defineConfig({
  name?, collections, globals?, actions?, jobs?, files?, media?, locales?, webhooks?, plugins?, admin?,
})
```

`schema` becomes `collections` (F32); `relations`, `hooks` and `target` go.
Zero Admin's `admin: true` fits as is.

### 4.11 The whole surface on one page

```ts
import {
  collection, global, bucket,
  text, integer, real, boolean, date, timestamp, json, email, url, slug, richText,
  media, file, select, ref, user, group, repeater, blocks,
  action, job, jobs, once, env, db, HttpError, defineConfig,
  type Row, type Insert,
} from "zero";
```

`Row<typeof items>` and `Insert<typeof items>` replace `InferSelectModel`/
`InferInsertModel` (shorter, and the Drizzle names were the only reason for
the long ones).

---

## 5. Before and after

The "before" is PR #50's version of each example (the current state of the
integration branch), the "after" is the same app in the proposed API. Counts
are total lines and non-blank, non-comment lines.

| example | before | after | before (code) | after (code) |
|---|---|---|---|---|
| `examples/site/zero.config.ts` | 205 | 168 | 170 | 136 |
| `examples/pantry/zero.config.ts` | 117 | 96 | 105 | 87 |
| `examples/pantry/lib/fields.ts` | 16 | 4 | 12 | 2 |

Beyond the counts, the site example loses: its `STAFF` array, the
`defineRelations` block (11 lines), the `hooks:` block in `defineConfig`
(moved beside the collections), every `id: id()`, every `title: "…"`, every
`editor: false`, `uid: true`, `updatedAt`, `createdAt`, `.notNull()` before
`.default()`, `.max(191)` after `.unique()`, and the `files("manuscripts", …)`
name repeat. It keeps every feature: localized fields, sync, private files,
field access, `showIf`, blocks, a job, a webhook, an auth collection, two
actions and seven hooks.

### 5.1 `examples/site/zero.config.ts`, after

```ts
// A small publication: authors write posts with rich fields in English and German, readers sign in
// as members and leave comments that editors moderate through an action, and editors keep the site
// settings. tests/system drives a whole user journey through this app on both targets (WordPress and
// standalone).
import {
  collection, global, bucket, text, integer, boolean, richText, media, slug, select, repeater, group,
  blocks, email, url, ref, user, file, defineConfig, action, job, jobs, env, db, HttpError,
} from "zero";

export const authors = collection({
  name: text().notNull().max(80),
  bio: text({ multiline: true }).max(500),
  avatar: media({ accept: "image/*" }),
  user: user(),                            // the account that writes as this author
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
  manuscript: file(manuscripts),
  topics: select(["culture", "science", "tech"], { multiple: true }).default([]),
  featured: boolean().default(false),
  // The desk's private notes: staff read and write them; readers' rows never carry the column.
  deskNotes: text({ multiline: true }).max(2000).access({ read: "author", write: "editor" }),
  author: ref(() => authors),
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
    update: (ctx) => ctx.is("editor") ? true : { author: { user: ctx.user?.id ?? -1 } },
    delete: "editor",
  },
  hooks: {
    // Each time a post becomes published (through the API or the editor) readers hear about it;
    // the job key collapses repeats still waiting on the queue. Scheduled posts that the clock
    // publishes run no hooks (both targets), so they announce nothing.
    async afterCreate(row) {
      if (row.status === "published") await jobs.notifyReaders.enqueue({ postId: row.id }, { key: `publish-${row.id}` });
    },
    async afterUpdate(row, previous) {
      if (row.status === "published" && previous.status !== "published") {
        await jobs.notifyReaders.enqueue({ postId: row.id }, { key: `publish-${row.id}` });
      }
    },
    async beforeCreate(data, ctx) {
      if (data.author == null && ctx.user) {
        const author = await db.query.authors.findFirst({ where: { user: ctx.user.id } });
        if (author) data.author = author.id;
      }
    },
  },
});

export const comments = collection({
  post: ref(() => posts, { onDelete: "cascade" }).notNull(),
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
  post: ref(() => posts),
}, { access: { read: "admin", write: "admin", create: "anyone" } });

// One row per post announcement the notifyReaders job sent; staff can see what went out.
export const announcements = collection({
  post: ref(() => posts, { onDelete: "cascade" }).notNull(),
  recipients: integer().notNull(),
  attempt: integer().notNull(),
}, { access: { read: "editor", write: "admin" } });

// Readers who sign in: WordPress users through the zero-identity screens, or a password on
// standalone. Each member sees and edits only their own row.
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

export default defineConfig({
  name: "site",
  collections: { authors, posts, comments, subscribers, announcements, members },
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
        await db.insert(announcements).values({ post: postId, recipients: readers.length, attempt: ctx.attempt });
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
Relations: `posts.author`/`authors.posts`, `comments.post`/`posts.comments`,
`subscribers.post`/`posts.subscribers`, `announcements.post`/
`posts.announcements`. The old config's `comments.post` was `optional: false`
by hand; here `.notNull()` says it.

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

export const items = collection(named({
  slug: slug({ source: "name" }),
  quantity: integer().default(1),
  unit: select(UNITS).default("pcs"),
  lowStockAt: integer().default(LOW_STOCK),
  expiresOn: date(),
  opened: boolean().default(false),
  location: ref(() => locations),
  tags: json<string[]>().default([]),
}), {
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
  item: ref(() => items, { onDelete: "cascade" }).unique(),
  name: text().notNull(),
  done: boolean().default(false),
  notifiedAt: timestamp(),                // set by the notifyLowStock job
});

async function restock(item: Row<typeof items>) {
  if (item.quantity > item.lowStockAt) return;
  const existing = await db.query.shoppingList.findFirst({ where: { item: item.id } });
  if (!existing) {
    await db.insert(shoppingList).values({ item: item.id, name: item.name });
    // Off the request: runs after this write commits (`zero jobs work`, or the dev worker).
    await jobs.notifyLowStock.enqueue({ itemId: item.id }, { key: `low-${item.id}` });
  }
}

export default defineConfig({
  collections: { locations, items, shoppingList },
  jobs: {
    // A real pantry would push a notification here; this one stamps the list entry.
    notifyLowStock: job({
      input: { itemId: integer().notNull() },
      retries: 2,
      handler: async ({ itemId }) => {
        await db.update(shoppingList).set({ notifiedAt: new Date().toISOString() }).where({ item: itemId });
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
`editor: false` go. `items.slug` was a `text().unique().max(191)` filled by a
`slugify` helper in `beforeCreate`; the proposed `slug({ source: "name" })` is
the same column, derived by the runtime. `lib/fields.ts` keeps `UNITS` and
`LOW_STOCK` (4 lines).

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
| `json().$type<T>()` | `json<T>()` (`$type` stays for other kinds) | `src/eval.rs:888` |
| `integer().references(() => t.id, opts)` | `ref(() => t, opts)` | `src/eval.rs:1976` |
| `references(..., { onUpdate })` | none | `src/eval.rs:2002` |
| `$default`, `$defaultFn`, `defaultNow` | `.default(() => …)` | `src/eval.rs:1952-1975` |
| `$onUpdate`, `$onUpdateFn` | `.onUpdate(() => …)` | same |
| `media({ accept: "image" \| "any" })` | `media({ accept: "image/*" \| string[] })`; default any | `src/eval.rs:1462` |
| `file({ bucket: "name" })` | `file(bucketValue)` | `src/eval.rs:1454` |
| `files(name, opts)` | `bucket(opts)` | `src/extract.rs:2135` |
| `global(name, fields, opts)` | `global(fields, opts)` | `src/extract.rs:975` |
| `collection(name, cols, opts)` | `collection(cols, opts)` | `src/eval.rs:1181`, `src/extract.rs:210` |
| `editor`, `drafts` | `content` (inferred) | `src/extract.rs:658` |
| `content: "col"` | `body: "col"` | `src/extract.rs:748` |
| `uid: true` | inferred from sync and references | `src/extract.rs:705,2490` |
| `api: {...}` | access rules | `src/extract.rs:854` |
| `defineConfig.target` | CLI only | `src/extract.rs:169` |
| `defineConfig.schema` | `defineConfig.collections` | `src/extract.rs:196` |
| `defineConfig.relations`, `defineRelations`, `r.one`, `r.many`, `optional` | inferred from `ref()`; `relations: { x: many(() => t, "col") }` on the target for the ambiguous case | `src/extract.rs:1677` |
| `defineConfig.hooks` | `collection(..., { hooks })` | `src/extract.rs:360` |
| `locales: { default, all }` | `locales: ["en", "de"]` (object form kept for `fallback`) | `src/extract.rs:2072` |
| `"owner"` (buckets) | `"self"` | `src/extract.rs:939` |
| `action.input` required (types) | optional | `index.d.ts:1012` |
| `job.input` required | optional | `src/extract.rs:2530` |
| `InferSelectModel`, `InferInsertModel` | `Row<T>`, `Insert<T>` | `index.d.ts:489` |
| manual `createdAt`/`updatedAt` | system columns; `timestamps: false` to drop | `src/extract.rs:321` (same place as `status`) |
| `.notNull().default(x)` | `.default(x)` (implies NOT NULL); `.nullable()` opts out | `src/eval.rs:1907,1952` |
| `.unique().max(191)` on text | `.unique()` | `src/extract.rs:1224` |
| `ctx.user?.role === "admin" \|\| …` | `ctx.is("editor")` | `src/compile.rs:390` (ctx types), `Access.php:53` |
| `ownerId: integer()` + function rule | `user: user()` + `"self"` | new column kind; `src/extract.rs:918` |

### 6.2 Added

`ref()`, `user()`, `bucket()`, `many()` (target-side explicit reverse),
`json<T>()`, `select(options, opts?)`, `.onUpdate()`, `.nullable()`,
`.access({ write })`, `access.write`, `ctx.is()`, `collection.content`,
`collection.body`, `collection.hooks`, `collection.timestamps`,
`collection.relations`, `defineConfig.collections`, `Row`, `Insert`,
system columns `id`, `createdAt`, `updatedAt`.

### 6.3 Unchanged

`text`, `integer`, `real`, `boolean`, `date`, `timestamp`, `email`, `url`,
`slug`, `richText`, `media`, `.notNull`, `.unique`, `.primaryKey`, `.min`,
`.max`, `.pattern`, `.validate`, `.access` (shape), `.showIf`, `.localized`,
`.$type`, `label`, `title`, `sync`, `auth`, `agents`, `revisions`, `access`
(semantics, defaults), hooks (names, signatures), `action`, `job`, `jobs`,
`once`, `env`, `db`, `HttpError`, `media.sizes`, `webhooks`, `plugins`,
`name`, the filter grammar, the subset.

### 6.4 What else moves

- **`zero migrate config`** (`src/config_migrate/translate.rs`) emits the
  new shapes: no `id: id()`, `ref()` instead of `<name>Id: integer().references`
  plus a relations block (`:279-380`), `select([...])`, `content: false`
  instead of `editor: false`, no `target`. Its "a required text field named
  `title` enables a post type" rule becomes exactly §4.9.3, so the importer
  no longer needs to decide.
- **The original-Zero migration** (`docs/migrating-from-zero.md`, `zero
  migrate site`) maps the capsule's implicit timestamps to the new system
  columns instead of reporting them as a gap (`docs/zero-compatibility.md`
  row 3).
- **`docs/config-api.md`** is rewritten from §4; the "Full example" becomes
  §5.2.
- **`types/zero/index.d.ts`**: `Collection` loses `$name`; `ColumnRefs` are
  keyed by the schema key; `RelationsOf` derives from `ref` columns instead of
  `Register.relations`; `zero.gen.ts` registers `collections` and `config`.
- **Generated client** (`src/client.rs`): relation names come from the
  column name; `with` typing follows.
- **Fixtures**: 114 `tests/fixtures/*/zero.config.ts`, the three examples,
  `tests/wp/app` and its lanes, `tests/system`. Most of the rewrite is
  mechanical (a codemod over `id: id()`, `editor: false`, `references`,
  `$onUpdate`, `defineRelations`), and the rejection fixtures for removed
  options become rejection fixtures for their replacements (an `id` column,
  `drafts`, `api`, `uid`, `target`, `schema` each get a "did you mean"
  error naming the new form).
- **In-flight lanes** (what this simplifies for them; none of their files
  are edited here):
  - K1 (guest pruning, localized relations): localized `many` loads under
    `with` are keyed by the inferred relation; nothing to add to the config.
  - K2 (`.d.ts` primary-key types, `p2/k2-tooling-gaps`): its `TPrimary`
    builder parameter is what §4.9.1 needs to know whether a user key exists;
    keep it, and `RowId<TCols>` simplifies because `id` is always present
    unless `TPrimary` says otherwise.
  - S (compiler aliasing): untouched; `ref()` is one more lazy arrow of the
    kind `references()` already resolves.
  - PR #50 (`examples/site`, `docs/config-api.md`): merges first; this
    proposal's §5 is written against its versions.
  - README (`p3/readme`): the tagline example should use §5.2's first
    collection; a `collection({ name: text().notNull() })` line is the whole
    pitch.
  - Zero Blocks (#51): `bind.field("excerpt")` names a column; unchanged.
  - Zero Admin (#52): `admin: true` is kept as proposed; the admin derives its
    list title from `title`, which is now inferred more often.

---

## 7. Implementation notes

### 7.1 Stacked PRs (after approval)

1. Columns: `select`, structured builders, `json<T>`, `.default(fn)`,
   `.onUpdate`, `.nullable`, implied NOT NULL, implied `.max(191)`, `media`
   MIME patterns. Fixtures and examples follow in the same PR.
2. System columns: automatic `id`, `createdAt`, `updatedAt`; `timestamps`;
   the WP post-date mapping; `id()` removed.
3. `ref()` and inferred relations; `many()`; `defineRelations` removed;
   `zero.gen.ts`, client and `.d.ts` relation typing.
4. Collections: no name argument, `content` inferred, `body`, `hooks` in
   `collection()`, `uid` inferred, `api`/`drafts`/`editor`/`target` removed,
   `collections` key.
5. Access: `write`, `ctx.is()`, `user()`, `"self"` on `user()` columns,
   `"owner"` renamed.
6. Names: `global(fields)`, `bucket()`, `file(bucket)`, `locales` array,
   optional `input`, `Row`/`Insert`.
7. Importers and docs: `zero migrate config`, `docs/config-api.md`,
   `docs/migrating-from-zero.md`, `zero build --explain`.

Each PR keeps the differential, compiler, PHP, WP and system suites green on
its own; the examples are rewritten in the PR that breaks them.

### 7.2 `zero build --explain`

Inference needs to be visible. `zero build --explain` (or the existing
`zero doctor`) prints, per collection: kind (content/table) and why, title,
body, slug source, system columns, relations and their reverse names, access
after defaults. The generated client's `SCHEMA` already carries most of it;
this is the human-readable form.

### 7.3 Where the subset grows

Three places, all small:

- **Type arguments on a builder call** (`json<string[]>()`): the IR already
  carries `type_args` on every call (`src/ir.rs:280`); the evaluator reads
  them only for `$type` (`src/eval.rs:888`). `json` reads them the same way.
- **A lazy arrow as a builder argument** (`ref(() => posts)`): the same
  `call_closure_public` the extractor uses for `references()`
  (`src/extract.rs:1272`), called at extraction time after every collection
  value exists, so forward and self references work as today.
- **A method on `ctx`** (`ctx.is("editor")`): access and hook closures are
  compiled, not evaluated; `ctx` is typed in `src/compile.rs:390` and the
  method lowers to a PHP call. No evaluator change.

Nothing else is new to the evaluator: `select(array, opts)` is positional
arguments it already handles; `collection(cols, opts)` drops an argument;
`hooks` inside the options object are closures found in an object literal,
as `access` functions are today.

### 7.4 Risks

- **Inferred `content` can surprise.** A table that gains a `title` column
  later silently becomes a content collection (drafts, revisions, a WP post
  type, a 15-character name limit). Mitigation: `--explain`, the `status`
  column appearing in the generated types, and the name-length error naming
  the rule. Open question 1 asks whether to require the flag instead.
- **Relation names collide with column names.** `author: ref()` is both the
  id and the relation; today's `relation has the same name as a column` error
  goes away by design. The filter grammar distinguishes them by value shape;
  the row type has `author: number` and `with: { author: true }` replaces it
  with the row, as `media` does today. Open question 3.
- **Automatic timestamps on WordPress tables** (`editor: false` today) are two
  new columns in every custom table: a migration for existing apps, written by
  the `zero build` migration step as usual.
- **Snake-case keys.** Today `collection("shopping_list")` with key
  `shoppingList` gives a snake-case table and a camel-case query key. Dropping
  the name argument makes the key both. Open question 4.

---

## 8. Open questions for the owner

1. **Infer `content` from the columns (§4.9.3), or require it?** Inference
   removes the most common line in the repo (`editor: false`, 111 times) and
   matches the importer's existing rule. Requiring `content: true` is
   predictable but means every blog collection writes it. A middle option: infer,
   and have `zero build` print one line per collection the first time it
   decides ("`events` is a table: no richText, no title; add `content: true`
   to publish it"). The proposal picks inference plus `--explain`.
2. **Relation name = column name (`author`), or keep the `authorId`/`author`
   pair?** The single name is what Payload, Sanity, Keystatic and Convex do,
   and it removes `defineRelations`. The pair is what Drizzle users expect and
   keeps row types flat (`authorId: number`) with the relation a separate key.
   The proposal picks the single name; if the pair is preferred, `ref()` still
   infers the relation and names it by stripping `Id`.
3. **Automatic `createdAt`/`updatedAt` on every collection, or only on
   content collections?** Payload and Convex add them everywhere. Tables that
   model pure lookups (`locations`) carry two unused columns. The proposal
   picks everywhere with `timestamps: false`, because the hook signatures and
   the client stay uniform.
4. **Table names.** With the name argument gone, is the key the table name
   verbatim (`shoppingList` → `zero_shoppingList`), or snake-cased
   (`zero_shopping_list`)? The proposal picks verbatim (no second naming to
   learn, and MySQL/SQLite accept it); snake-casing is a one-line change in
   the extractor if the owner prefers SQL-looking tables.
5. **`"self"` on `user()` columns.** Should `"self"` also satisfy
   `create` (meaning "the row's `user` must be the viewer", filled in
   automatically when absent)? It would make "members create their own rows"
   one word. The proposal leaves `create` as a boolean rule as today and asks.
6. **Keep `agents`?** It is a WordPress-only MCP visibility flag with no
   non-test use. Keeping it costs one option on four builders; removing it
   means every ability is exposed when the MCP adapter is active. The proposal
   keeps it.
7. **`revisions` on tables.** Two fixtures turn revisions on for a
   non-content table. If that is a real need, `revisions: true` stays as
   proposed; if not, `revisions` can fold into `content` entirely and go.
8. **Keep `.$type<T>()` at all?** With `json<T>()` the only remaining use is
   branding a scalar (`integer().$type<UserId>()`). Drizzle users know it; it
   is type-only and costs nothing in the compiler. The proposal keeps it.
