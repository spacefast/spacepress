# Zero: WordPress parity — design contract

Status: frozen for implementation. Four owners build against this without
talking: **R** (Rust compiler), **P** (shared PHP runtime + SQLite + standalone
auth), **W** (WordPress stores + plugin), **T** (types + typed client +
examples). §10 says who owns what and in which order the pieces freeze.

Running example: `examples/blog` (§1.9). Every table below uses it.

**Revision 2 (2026-10-28).** Rulings applied: CPT-per-collection approved;
shadow index table **rejected** in favour of querying `wp_posts` +
`wp_postmeta` directly; access defaults approved. Changed sections: §0 (WP
reads row), §1.8 (one row), §2 (`'table'` key note), §3.2 (`Store` interface:
`table()` → `source()`, `afterWrite` removed, new `Source`/`ColumnRef`, reworded
guarantees), §3.3 (pipeline steps, recursion note, transactions), §3.5 (filter
compilation, new §3.5.1 postmeta mapping), §4.2 (replaced: custom tables only
+ performance), §4.3 (timestamp/date SCF mapping, decoded column), §4.4
(status/publishedAt expressions), §4.6 (media nulling), §4.9 (hooks table, store
description), §6.3 (one row), §9.1/9.2 (postmeta tests, harness `sql`), §10
(P/W deliverables), §11 (item 2 rewritten, item 13 added). Everything else is
unchanged.

Conventions: "both targets" = standalone PHP+SQLite app and the WordPress
plugin. "Rejected" = `zero check`/`zero build` fails with `file:line:col` and a
fix, on **both** targets unless stated: the config is target-independent, so a
config that can't build for WP doesn't build at all.

---

## 0. Decisions in one screen

| Area | Decision |
|---|---|
| Targets | `zero build --target standalone\|wp`. One `zero.config.ts`, one runtime pipeline, three stores: `SqliteStore`, `WpTableStore`, `WpPostStore`. |
| WP content collections | One **custom post type per collection** (`zero_<table>`), not native `post` + taxonomy (§4.1 says why). Fields are SCF fields with meta key `zero_<column>`. |
| WP reads | Post-backed collections are read from `wp_posts` + `wp_postmeta` directly: no duplicate data, no index table. One `Sql` compiler serves all stores through a `Source` mapping (column → SQL expression + join); on post-backed collections each filtered/ordered meta column is one `LEFT JOIN wp_postmeta`, typed via `CAST(NULLIF(meta_value,''))`. `editor: false` collections are real `{prefix}zero_<table>` tables and remain the fast path. |
| Drafts | `drafts` defaults to `editor !== false`. Adds `status` (`draft\|published\|scheduled`) and `publishedAt`. API-created rows default to `published`. Sub-editor readers only see `published` unless the read rule is a function. |
| Access | Payload-style `access: { read, create, update, delete }` = `boolean \| "anyone" \| "authenticated" \| Role \| (ctx) => boolean \| Filter`. Defaults: `read: "anyone"`, writes and actions `"editor"`. Hooks and `db` are trusted. |
| Identity | WP: whatever WP REST authenticates (cookie+nonce, application passwords). Standalone: bearer tokens in `__zero_tokens`, minted by the CLI, with a role. Four roles: `subscriber < author < editor < admin`. |
| Revisions | In on both targets. WP-native for post-backed; `__zero_revisions` table for everything else. `GET /{c}/{id}/revisions`, restore runs the update pipeline. |
| Scheduling | `status: "scheduled"` + future `publishedAt`. WP: `future` + cron. Standalone: lazy promotion at request start + `publish-due` CLI. No hooks fire on promotion on either target. |
| Media | Built-in `media` collection on both targets (`__zero_media` + `public/uploads` standalone; attachments on WP). `media()` columns hold ids and populate **in place** with `with`. |
| Globals | `global(name, fields, options)`. Standalone `__zero_globals`; WP SCF options page with `post_id = zero_global_<name>`. |
| REST | Same routes and shapes; prefix `/api` standalone, `/wp-json/zero/v1` on WP. |
| Client | `zero build` writes a dependency-free `zero/client/index.ts` (generated interfaces + embedded runtime). Not the `"zero"` types package. |
| schema.php | Version 2, §2. Compiler emits all WP identifiers (post type, meta keys, SCF keys); the runtime derives nothing. |

---

## 1. Config API v1 additions (TypeScript surface)

Everything below is exported from `"zero"`. Existing builders, modifiers,
`defineRelations`, hooks, actions, `db` keep their current shape and names.

### 1.1 New column builders

```ts
// Scalars with a format. Storage is TEXT; they differ in validation and SCF type.
export declare function email(): ColumnBuilder<"email", string, false, false>;
export declare function url(): ColumnBuilder<"url", string, false, false>;

// text() gains one option. Default single line.
export declare function text(config?: { multiline?: boolean }): ColumnBuilder<"text", string, false, false>;
export declare function text<const E extends readonly [string, ...string[]]>(
  config: { enum: E; multiline?: boolean },
): ColumnBuilder<"text", E[number], false, false>;

// URL-safe identifier. Pattern ^[a-z0-9]+(?:-[a-z0-9]+)*$, max 200. Unique by default.
// `source` names a text column of the same collection; when the writer omits the slug it is
// derived from that column (slugify + "-2", "-3" ... until unique). At most one per collection.
export declare function slug(config?: { source?: string }): ColumnBuilder<"slug", string, false, false>;

// HTML string. On WP the `content`-designated richText is post_content (block editor); any other
// richText is an SCF wysiwyg field. Standalone stores it verbatim.
export declare function richText(): ColumnBuilder<"richText", string, false, false>;

// Reference to the built-in `media` collection. Value is the media id (number).
export declare function media(config?: { accept?: "image" | "any" }): ColumnBuilder<"media", number, false, false>;
export declare function media(config: { accept?: "image" | "any"; multiple: true }): ColumnBuilder<"mediaList", number[], false, false>;

// Enum. Single = exactly text({ enum }) (same column type "text"). Multiple = JSON array of enum values.
export declare function select<const E extends readonly [string, ...string[]]>(config: { options: E }): ColumnBuilder<"text", E[number], false, false>;
export declare function select<const E extends readonly [string, ...string[]]>(config: { options: E; multiple: true }): ColumnBuilder<"select", E[number][], false, false>;

// Structured values. Sub-fields use the same builders (restrictions in 1.3).
export declare function group<F extends FieldsConfig>(config: { fields: F }): ColumnBuilder<"group", SelectShape<F>, false, false>;
export declare function repeater<F extends FieldsConfig>(config: { fields: F }): ColumnBuilder<"repeater", SelectShape<F>[], false, false>;
export declare function blocks<L extends Record<string, FieldsConfig>>(config: { layouts: L }): ColumnBuilder<"blocks", BlockValue<L>[], false, false>;

export type FieldsConfig = Record<string, AnyColumnBuilder>;
export type BlockValue<L extends Record<string, FieldsConfig>> = {
  [K in keyof L & string]: Simplify<{ layout: K } & SelectShape<L[K]>>;
}[keyof L & string];
```

`ColumnKind` becomes
`"id" | "integer" | "real" | "text" | "boolean" | "date" | "timestamp" | "json" | "email" | "url" | "slug" | "richText" | "media" | "mediaList" | "select" | "group" | "repeater" | "blocks"`.

### 1.2 New modifiers (on `ColumnBuilder`)

```ts
/** Numbers: inclusive bounds. text/email/url/slug/richText: length in code points. repeater/mediaList/select(multiple): item count. */
min(n: number): this-shaped builder;
max(n: number): this-shaped builder;
/** Strings only. A JS RegExp literal; compiled to PCRE at build time. */
pattern(re: RegExp): this-shaped builder;
/**
 * Custom validation, compiled to PHP, run after type coercion on every write (REST, db, CLI, wp-admin).
 * Return `true`/`undefined` to accept, a string to reject with that message (422 invalid_input, pointer /<col>).
 * Throwing HttpError also works.
 */
validate(fn: (value: NonNullable<TData>, ctx: ValidateCtx) => true | string | void): this-shaped builder;

export interface ValidateCtx {
  /** The whole row being written (insert: data after defaults; update: existing merged with patch). */
  data: Record<string, unknown>;
  user: User | null;
  target: "standalone" | "wp";
}
```

Allowed per kind (anything else is rejected: "`.max()` isn't valid on a boolean column"):

| kind | `.min/.max` | `.pattern` | `.validate` | `.unique` | `.references` | `.default` |
|---|---|---|---|---|---|---|
| integer, real | yes | no | yes | yes | yes | yes |
| text, email, url, slug | yes | yes | yes | yes | no | yes |
| richText | yes | no | yes | no | no | yes |
| boolean, date, timestamp | no | no | yes | yes (date/timestamp) | no | yes |
| json | no | no | yes | no | no | yes |
| media | no | no | yes | no | no | no |
| mediaList, select(multiple), repeater | yes (count) | no | yes | no | no | yes (constant array) |
| group, blocks | no (blocks: yes, count) | no | yes | no | no | yes (constant) |

`.validate` is also allowed on sub-fields; its `ctx.data` is then the enclosing
row (not the sub-object). `.unique()` on a text column with no `.max()` or
`.max()` > 191 is rejected ("unique text columns are limited to 191 characters
on MySQL; add `.max(191)`").

### 1.3 Sub-field restrictions (group / repeater / blocks)

Sub-fields may be: integer, real, text, boolean, date, timestamp, json, email,
url, richText, media, mediaList, select, group, repeater (nesting depth ≤ 3
counting the top column as 1). Rejected inside sub-fields: `id()`,
`.primaryKey()`, `.unique()`, `.references()`, `slug()`, `blocks()` (no nested
flexible content), `.$onUpdate()`. `.notNull()` on a sub-field means "required
in every item"; sub-field defaults apply per item. Sub-field names follow
column-name rules.

### 1.4 Collection options

```ts
export interface CollectionOptions {
  /** Shown in wp-admin menus and the typed client docs. Default: name with underscores → spaces, title-cased. */
  label?: string;
  /**
   * WP: true = posts + SCF fields (wp-admin editing, revisions, scheduling); false = custom table via $wpdb.
   * Standalone: no storage effect; it only drives the drafts/revisions defaults so one config behaves the same everywhere.
   * Default true.
   */
  editor?: boolean;
  /** Adds `status` + `publishedAt` system columns (§6). Default `editor !== false`. `false` with `editor: true` is rejected. */
  drafts?: boolean;
  /** Keep a revision per update (§6.4). Default `editor !== false`. */
  revisions?: boolean;
  /** Column that is the WP post title. Must be a notNull text(). Default: a column named `title` if it is text(). Required when `editor !== false`. */
  title?: string;
  /** Column that is the WP post_content (block editor). Must be richText(). Default: a column named `content` if it is richText(). Optional. */
  content?: string;
  access?: AccessConfig;
  api?: { list?: boolean; get?: boolean; create?: boolean; update?: boolean; delete?: boolean };
}
```

Rejections (both targets): `editor !== false` and no title designation ("add a
`title: text().notNull()` column or `title:` option, or set `editor: false`");
`title` not a notNull text; `content` not richText; a collection named `media`,
`globals`, `actions`, `me`, `_schema` (reserved); a table name longer than 15
characters when `editor !== false` ("WordPress post types are limited to 20
characters and Zero prefixes `zero_`"); more than one `slug()` column; a
`slug({ source })` naming a column that isn't text; `drafts: false` with
`editor: true`; a user column named `status` or `publishedAt` on a drafts
collection ("reserved: drafts add these").

### 1.5 Globals

```ts
export declare function global<const TName extends string, TCols extends FieldsConfig>(
  name: TName,
  fields: TCols,
  options?: { label?: string; access?: { read?: AccessRule; update?: AccessRule } },
): Global<TName, TCols>;

// defineConfig gains `globals` and `name`:
export interface ConfigInput<...> {
  /** Project name: plugin slug (`zero-<name>`), wp-admin menu, client docs. Default: project directory name. */
  name?: string;
  /** Default build target when `--target` isn't passed. Default "standalone". */
  target?: "standalone" | "wp";
  schema: TSchema;
  relations?: TRelations;
  globals?: Record<string, AnyGlobal>;          // key = name used in db.globals.<key> and /globals/<name>
  hooks?: NoInfer<Hooks<TSchema>>;
  actions?: Record<string, AnyAction>;
}
```

Global fields: same builders and restrictions as sub-fields (§1.3) plus
`.unique()`/`id()`/`slug()`/`blocks()` rejected. Every field is optional on
update; missing notNull fields without defaults are rejected at build time
("global fields that are notNull need a default"). Default access:
`read: "anyone"`, `update: "editor"`.

`db.globals.<key>.get(): Promise<Row>` and `db.globals.<key>.update(patch): Promise<Row>`
inside hooks/actions (trusted). A global that was never written reads as its
defaults.

### 1.6 Access rules

```ts
export type Role = "subscriber" | "author" | "editor" | "admin";   // ladder, in this order
export interface User { id: number; name: string; role: Role }

export interface AccessCtx<TData = Record<string, unknown>> {
  user: User | null;
  target: "standalone" | "wp";
  op: "read" | "create" | "update" | "delete";
  /** create: the incoming row (after defaults, before beforeCreate). update: the patch. Absent otherwise. */
  data?: TData;
}

export type AccessRule<T extends AnyCollection = AnyCollection> =
  | boolean
  | "anyone"            // everyone, including unauthenticated
  | "authenticated"     // any user
  | Role                // this role or higher
  | ((ctx: AccessCtx<Partial<Insert<T>>>) => boolean | TableFilter<T>);

export interface AccessConfig<T extends AnyCollection = AnyCollection> {
  read?: AccessRule<T>; create?: AccessRule<T>; update?: AccessRule<T>; delete?: AccessRule<T>;
}
```

Semantics:

| rule result | read | create | update / delete |
|---|---|---|---|
| `false` | 403 `forbidden` (401 `unauthenticated` when no user) | same | same |
| `true` | all rows | allowed | all matching rows |
| filter | rows ANDed with the filter | rejected at build time ("create rules return a boolean") | only rows matching the filter; a by-id request for a non-matching row → 404 `not_found` (never leaks existence) |

Functions are compiled to PHP (`<table>__access__<op>`) with the same subset
rules as hooks; they may read `ctx` and captured constants, may not call `db`
(rejected: "access rules can't query; put that in a hook"). Returned filters
are checked at build time against the collection's columns and relations like
any literal filter.

Defaults when `access` or a key is omitted: `read: "anyone"`,
`create: "editor"`, `update: "editor"`, `delete: "editor"`. Actions:
`action({ input, handler, access?: AccessRule })`, default `"editor"`.

Draft visibility (collections with `drafts`): when the read rule is a boolean
or shorthand string, readers below `editor` get `AND status = "published"`
appended. When the read rule is a function, its result is used as returned —
the function is authoritative and should return `{ status: "published" }`
itself when it wants that for anonymous readers (the blog example shows this).

Who gets checked: REST/typed client and the WP REST routes always; hooks and
actions calling `db` never (trusted, every status visible, no implied status
filter); CLI never. wp-admin editing is governed by WordPress capabilities, not
Zero access rules (§5.1).

### 1.7 What hooks, validators and actions see

Every compiled hook and action handler receives a trailing `ctx: HookCtx`
argument (`{ user: User | null; target: "standalone" | "wp" }`):

```ts
beforeCreate?: (data: Insert<T>, ctx: HookCtx) => Awaitable<Insert<T> | void>;
afterCreate?:  (row: Row<T>, ctx: HookCtx) => Awaitable<void>;
beforeUpdate?: (patch: Patch<T>, existing: Row<T>, ctx: HookCtx) => Awaitable<Patch<T> | void>;
afterUpdate?:  (row: Row<T>, previous: Row<T>, ctx: HookCtx) => Awaitable<void>;
beforeDelete?: (row: Row<T>, ctx: HookCtx) => Awaitable<void>;
afterDelete?:  (row: Row<T>, ctx: HookCtx) => Awaitable<void>;
handler: (input: InferActionInput<I>, ctx: HookCtx) => Awaitable<R>;
```

Rows seen by hooks and by `db` include `status`/`publishedAt` on drafts
collections and are never status-filtered. Writes from hooks run the full
pipeline (defaults, validation, nested hooks) but no access check.

Editor saves on WP (wp-admin, core `/wp/v2/zero_<table>`): `.validate`,
`.min/.max/.pattern` run via SCF validation (blocking, with the message); after
the save, `afterCreate`/`afterUpdate`/`afterDelete` run with the synced row
and `ctx.user` = the editing WP user. `beforeCreate`/`beforeUpdate` do **not**
run on editor saves (the post is already saved when Zero learns about it);
`slug({ source })` derivation is done by WP's own slug box there.

### 1.8 Target behaviour matrix

| Item | standalone | wp (`editor: true`) | wp (`editor: false`) |
|---|---|---|---|
| email/url/slug | TEXT, validated | SCF email/url; slug = post_name | VARCHAR(191)/LONGTEXT, validated |
| richText | TEXT verbatim | post_content (designated) or SCF wysiwyg; `wp_kses_post` unless `unfiltered_html` | LONGTEXT verbatim |
| media/mediaList | id(s) into `__zero_media` | SCF image/file/gallery, attachment ids | BIGINT id(s) of attachments |
| select multiple, group, repeater, blocks | TEXT JSON | SCF select(multiple)/group/repeater/flexible_content meta (SCF's own layout), normalised to JSON on read | LONGTEXT JSON |
| drafts | real columns, lazy promotion | post_status/post_date_gmt + cron | real columns, lazy promotion |
| revisions | `__zero_revisions` | WP revisions (+SCF meta) | `{prefix}zero__revisions` |
| `.validate` | pipeline | pipeline + `acf/validate_value` | pipeline |
| access | pipeline | pipeline (Zero REST only) | pipeline |
| globals | `__zero_globals` | SCF options page | SCF options page |

### 1.9 The blog example (`examples/blog/zero.config.ts`)

```ts
import {
  collection, global, id, text, integer, boolean, timestamp, richText, media, slug, select,
  repeater, group, blocks, email, url, defineRelations, defineConfig, action, db, HttpError,
} from "zero";

export const authors = collection("authors", {
  id: id(),
  name: text().notNull().max(80),
  email: email().notNull().unique().max(191),
  bio: text({ multiline: true }).max(500),
  avatar: media({ accept: "image" }),
  userId: integer(),                       // the User.id that owns this author profile
}, { label: "Authors", title: "name", access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export const posts = collection("posts", {
  id: id(),
  title: text().notNull().min(1).max(120),
  slug: slug({ source: "title" }),
  body: richText(),
  excerpt: text({ multiline: true }).max(300),
  cover: media({ accept: "image" }),
  tags: select({ options: ["news", "guide", "release"], multiple: true }).notNull().default([]),
  authorId: integer().references(() => authors.id, { onDelete: "set null" }),
  seo: group({ fields: {
    metaTitle: text().max(70),
    metaDescription: text().max(160),
    noindex: boolean().notNull().default(false),
  } }),
  gallery: repeater({ fields: { image: media({ accept: "image" }).notNull(), caption: text().max(120) } }).max(12),
  sections: blocks({ layouts: {
    hero: { heading: text().notNull().max(80), image: media({ accept: "image" }) },
    quote: { text: text({ multiline: true }).notNull(), cite: text().max(80) },
  } }),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
}, {
  label: "Posts",
  title: "title",
  content: "body",
  access: {
    read: (ctx) => ctx.user && ctx.user.role !== "subscriber" ? true : { status: "published" },
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { author: { userId: ctx.user?.id ?? -1 } },
    delete: "editor",
  },
});

export const comments = collection("comments", {
  id: id(),
  postId: integer().notNull().references(() => posts.id, { onDelete: "cascade" }),
  name: text().notNull().max(60),
  body: text({ multiline: true }).notNull().min(1).max(2000).validate((v) => v.includes("http://") ? "No links in comments" : true),
  approved: boolean().notNull().default(false),
  createdAt: timestamp().notNull().defaultNow(),
}, {
  editor: false,
  access: { read: (ctx) => ctx.user ? true : { approved: true }, create: "anyone", update: "editor", delete: "editor" },
});

export const schema = { authors, posts, comments };

export const relations = defineRelations(schema, (r) => ({
  posts: { author: r.one.authors({ from: r.posts.authorId, to: r.authors.id }), comments: r.many.comments() },
  authors: { posts: r.many.posts() },
  comments: { post: r.one.posts({ from: r.comments.postId, to: r.posts.id, optional: false }) },
}));

export const settings = global("settings", {
  siteTitle: text().notNull().default("My blog").max(80),
  tagline: text().max(160),
  postsPerPage: integer().notNull().default(10).min(1).max(50),
  social: repeater({ fields: { label: text().notNull().max(40), href: url().notNull() } }),
}, { label: "Site settings" });

export default defineConfig({
  name: "blog",
  schema,
  relations,
  globals: { settings },
  hooks: {
    posts: {
      beforeCreate(data, ctx) {
        if (data.authorId == null && ctx.user) {
          // authors.userId links a profile to the signed-in user
        }
      },
    },
    comments: {
      afterCreate(row, ctx) {
        if (ctx.user && ctx.user.role !== "subscriber") {
          // staff comments are approved on sight
        }
      },
    },
  },
  actions: {
    approveComment: action({
      input: { id: integer().notNull() },
      access: "editor",
      async handler({ id }) {
        const [row] = await db.update(comments).set({ approved: true }).where({ id }).returning();
        if (!row) throw new HttpError(404, "not_found", `No comment ${id}`);
        return row;
      },
    }),
    publishedCount: action({
      input: {},
      access: "anyone",
      async handler() {
        const rows = await db.query.posts.findMany({ where: { status: "published" }, columns: { id: true } });
        return { count: rows.length };
      },
    }),
  },
});
```

(T fills the two hook bodies with real logic: `beforeCreate` looks up the
author by `userId` and sets `authorId`; `afterCreate` approves staff comments
via `db.update`.)

---

## 2. schema.php v2

`zero/app/schema.php` returns one array. The runtime refuses any other
`version` (`Schema::load` throws `RuntimeException("schema.php version 2 required")`).
Keys are always present (empty arrays, `null`, or `false` rather than absent)
except where marked *optional*. Order of collections/columns = config order.

```php
return [
  'version' => 2,
  'name' => 'blog',
  'target' => 'wp',                       // 'standalone' | 'wp' — the target this file was built for
  'collections' => [
    'posts' => [                          // keyed by table name
      'key' => 'posts',                   // schema key (db.query.posts)
      'label' => 'Posts',
      'editor' => true,
      'drafts' => true,
      'revisions' => true,
      'title' => 'title',                 // column name or null
      'content' => 'body',                // column name or null
      'slug' => 'slug',                   // the slug() column name or null
      'primaryKey' => 'id',
      'columns' => [
        'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
        'title' => ['type' => 'text', 'notNull' => true, 'rules' => ['min' => 1, 'max' => 120]],
        'slug' => ['type' => 'slug', 'unique' => true, 'source' => 'title'],
        'body' => ['type' => 'richText'],
        'excerpt' => ['type' => 'text', 'multiline' => true, 'rules' => ['max' => 300]],
        'cover' => ['type' => 'media', 'accept' => 'image'],
        'tags' => ['type' => 'select', 'multiple' => true, 'enum' => ['news', 'guide', 'release'], 'notNull' => true, 'default' => ['value' => []]],
        'authorId' => ['type' => 'integer', 'references' => ['collection' => 'authors', 'column' => 'id', 'onDelete' => 'set null']],
        'seo' => ['type' => 'group', 'fields' => [
            'metaTitle' => ['type' => 'text', 'rules' => ['max' => 70]],
            'metaDescription' => ['type' => 'text', 'rules' => ['max' => 160]],
            'noindex' => ['type' => 'boolean', 'notNull' => true, 'default' => ['value' => false]],
        ]],
        'gallery' => ['type' => 'repeater', 'rules' => ['max' => 12], 'fields' => [
            'image' => ['type' => 'media', 'accept' => 'image', 'notNull' => true],
            'caption' => ['type' => 'text', 'rules' => ['max' => 120]],
        ]],
        'sections' => ['type' => 'blocks', 'layouts' => [
            'hero' => ['heading' => ['type' => 'text', 'notNull' => true, 'rules' => ['max' => 80]], 'image' => ['type' => 'media', 'accept' => 'image']],
            'quote' => ['text' => ['type' => 'text', 'multiline' => true, 'notNull' => true], 'cite' => ['type' => 'text', 'rules' => ['max' => 80]]],
        ]],
        'createdAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => ['now' => true]],
        'updatedAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => ['now' => true], 'onUpdate' => ['now' => true]],
        // System columns, emitted by the compiler when drafts = true (always last, in this order):
        'status' => ['type' => 'text', 'notNull' => true, 'enum' => ['draft', 'published', 'scheduled'], 'default' => ['value' => 'published'], 'system' => true],
        'publishedAt' => ['type' => 'timestamp', 'system' => true],
      ],
      'relations' => [ /* unchanged v1 shape */ ],
      'hooks' => ['beforeCreate' => 'posts__beforeCreate'],
      'beforeCreateFills' => [],          // optional, as v1
      'access' => [
        'read' => ['fn' => 'posts__access__read'],     // one of: ['allow' => true|false] | ['role' => 'anyone'|'authenticated'|Role] | ['fn' => name]
        'create' => ['role' => 'author'],
        'update' => ['fn' => 'posts__access__update'],
        'delete' => ['role' => 'editor'],
      ],
      'api' => ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true],
      'wp' => [                            // present on both targets (harmless on standalone); null when editor = false
        'postType' => 'zero_posts',
        'groupKey' => 'group_zero_posts',
        'metaPrefix' => 'zero_',           // meta key = metaPrefix . column
        'fieldKeyPrefix' => 'field_zero_posts_',   // field key = prefix . column (sub: prefix . column . '_' . sub; blocks layout: prefix . column . '_' . layout . '_' . sub)
      ],
      'table' => null,                     // physical table without the WP prefix for editor:false collections ('zero_comments'); null when post-backed (storage is wp_posts/wp_postmeta); standalone uses the collection name and ignores this
    ],
  ],
  'globals' => [
    'settings' => [
      'label' => 'Site settings',
      'fields' => [ /* column shape, same codecs */ ],
      'access' => ['read' => ['role' => 'anyone'], 'update' => ['role' => 'editor']],
      'wp' => ['postId' => 'zero_global_settings', 'menuSlug' => 'zero-global-settings', 'groupKey' => 'group_zero_global_settings', 'fieldKeyPrefix' => 'field_zero_global_settings_', 'optionPrefix' => 'zero_global_settings_'],
    ],
  ],
  'actions' => [
    'approveComment' => ['input' => [...], 'handler' => 'action__approveComment', 'access' => ['role' => 'editor']],
  ],
];
```

Column keys, exhaustive: `type`, `primaryKey`, `autoIncrement`, `notNull`,
`unique`, `enum`, `multiple` (select), `multiline` (text), `accept` (media),
`source` (slug), `default`, `onUpdate`, `references`, `fields` (group,
repeater), `layouts` (blocks), `rules`, `system`. `rules` keys: `min`, `max`,
`pattern` (`['source' => string, 'flags' => string]`, JS form; runtime uses
`Js::re`), `validate` (function name). Nested field definitions use the same
keys minus `primaryKey/autoIncrement/unique/references/onUpdate/system`.

`type` values: `integer real text boolean timestamp date json email url slug richText media mediaList select group repeater blocks`.
`select` without `multiple` is never emitted (it compiles to `text` + `enum`).

Compiled function calling conventions (functions.php, namespace `ZeroApp`):

| slot | call | return |
|---|---|---|
| hooks | as v1 plus trailing `$ctx` (array `['user' => ?array, 'target' => string]`) | as v1 |
| action handler | `$fn($input, $ctx)` | data |
| `access.*.fn` | `$r = $fn($ctx)` with `$ctx = ['user' => ?array, 'target' => string, 'op' => string, 'data' => ?array]` | `bool` or filter array |
| `rules.validate` | `$r = $fn($value, $ctx)` with `$ctx = ['data' => array, 'user' => ?array, 'target' => string]` | `true`/`null` ok, `string` = rejection |

The runtime always passes variables (by-reference parameters stay legal).

`GET /_schema` (`Schema::describe()`) exposes everything above except function
names (`fn` → `true`), `hooks`, `beforeCreateFills`, and `wp` identifiers.

---

## 3. Runtime architecture

### 3.1 Shape

```
runtime/Zero/
  bootstrap.php  Schema.php  Js.php  RegExp.php  JsError.php  HttpError.php   (as today)
  App.php        HTTP routing, problem documents, CLI; target-agnostic
  Db.php         the ONE pipeline: validate, defaults, hooks, access, drafts, revisions, `with`; calls a Store
  Store.php      interface Zero\Store (§3.2)
  Sql.php        Drizzle-filter → SQL compiler, parameterised, with a Dialect (sqlite | mysql)
  Auth.php       interface Zero\Auth (§5): resolves the request to a User
  Identity.php   standalone Auth: __zero_tokens
  Media.php      standalone media: __zero_media + public/uploads
  Migrator.php   SQLite migrations (as today)
  Store/SqliteStore.php
  Wp/            owned by W (§4.9): WpPostStore.php, WpTableStore.php, WpAuth.php, WpMedia.php, Scf.php, Rest.php, Plugin.php, Migrator.php
```

`App::boot(string $appRoot, Store $store, Auth $auth, Media $media, ?bool $migrate = null)`.
Standalone `index.php` builds `SqliteStore`+`Identity`+`Media`; the WP plugin
builds `Wp\*`. `App` and `Db` never check `target` except to pass it in `ctx`.

### 3.2 `Zero\Store` (frozen first; P and W implement it independently)

```php
namespace Zero;

interface Store
{
    /** Open a transaction (or join one). Any Throwable rolls back everything written inside. */
    public function transaction(callable $fn): mixed;

    /**
     * Raw rows matching a compiled query. $q is produced by Sql::select() against $this->dialect()
     * and $this->source($collection): ['sql' => string, 'params' => list<scalar>]. Rows come back as
     * assoc arrays keyed by column name, values in STORAGE form (§3.4; strings/ints/null); Db decodes
     * them with Schema::decodeRow. Every column of the collection is present in every row.
     */
    public function select(string $collection, array $q): array;

    /** Insert one encoded row ($values keyed by column, storage form). Returns the primary key value. */
    public function insert(string $collection, array $values): int|string;

    /** Update one row by primary key with encoded values. */
    public function update(string $collection, int|string $pk, array $values): void;

    /** Delete one row by primary key. */
    public function delete(string $collection, int|string $pk): void;

    /** The SQL dialect filters compile to for this store. */
    public function dialect(): Dialect;

    /**
     * How Sql reads this collection: the base table, its primary-key expression, and one ColumnRef per
     * column. SqliteStore/WpTableStore return a plain table where every ColumnRef is `<alias>.<col>`;
     * WpPostStore returns wp_posts with core columns as expressions and meta columns as joins (§3.5.1).
     * System tables ('__zero_revisions', '__zero_tokens', '__zero_globals', '__zero_media') are plain.
     */
    public function source(string $collection): Source;

    /** Globals and revisions are small key/value surfaces; stores own them so WP can use options/revisions. */
    public function globalRead(string $name): ?array;          // encoded values keyed by field, null if never written
    public function globalWrite(string $name, array $values): void;
    public function revisions(string $collection, int|string $pk): array;   // list of ['id' => int, 'at' => iso, 'userId' => ?int, 'row' => encoded row], newest first
    public function revisionWrite(string $collection, int|string $pk, array $encodedRow, ?int $userId): void;
    public function revision(string $collection, int|string $pk, int $revisionId): ?array;

    /** Scheduled publishing. Standalone/WpTable: UPDATE ... SET status='published' WHERE status='scheduled' AND publishedAt <= $nowIso; returns pks. WpPost: no-op (WP cron does it). */
    public function promoteDue(string $collection, string $nowIso): array;

    /** Map a driver exception to a HttpError (unique_violation with pointer when the column is known, reference_violation) or rethrow. */
    public function mapError(\Throwable $e): \Throwable;
}

final class Dialect   // value object; Sql uses it
{
    public function __construct(
        public readonly string $name,            // 'sqlite' | 'mysql'
        public readonly string $quoteOpen,       // '"' | '`'
        public readonly string $quoteClose,
        public readonly string $likeFn,          // sqlite: 'zero_like(%s, ?, %d)'; mysql: '%s LIKE ? COLLATE utf8mb4_bin' / 'utf8mb4_0900_ai_ci' chosen by Sql for ci
        public readonly bool $windowFunctions,   // both true (SQLite ≥3.25, MariaDB ≥10.2)
    ) {}
}

final class Source
{
    public function __construct(
        public readonly string $table,                 // quoted, prefixed: '"posts"' | '`wp_zero_comments`' | '`wp_posts`'
        public readonly string $baseWhere,             // '' for plain tables; "{a}.post_type = 'zero_posts' AND {a}.post_status <> 'trash' AND {a}.post_status <> 'auto-draft'" for posts
        /** @var array<string, ColumnRef> keyed by column name */
        public readonly array $columns,
    ) {}
}

final class ColumnRef
{
    public function __construct(
        /** SQL expression yielding the STORAGE-form value; '{a}' is replaced by the base alias, '{j}' by this column's join alias. */
        public readonly string $expr,                  // '{a}."name"' | '{a}.post_title' | 'NULLIF({j}.meta_value, \'\')'
        /** Join emitted once per (query alias, column) when the column is filtered/ordered/selected; '' when none. */
        public readonly string $join,                  // "LEFT JOIN `wp_postmeta` {j} ON {j}.post_id = {a}.ID AND {j}.meta_key = 'zero_authorId'"
        /** Comparison expression for typed operators; '' = use expr. */
        public readonly string $cmpExpr,               // 'CAST(NULLIF({j}.meta_value, \'\') AS SIGNED)'
        /** 'scalar' | 'serialized-list' | 'json' — decides which operators Sql allows (§3.5). */
        public readonly string $kind,
    ) {}
}
```

Guarantees every store must hold:

1. `insert/update/delete` are called **only inside** `transaction()`. Nested
   `transaction()` joins the outer one; the outermost commits.
2. `select` executes exactly the SQL given; it never rewrites filters. Status
   filtering, access filtering and `with` are all in `Db`/`Sql`.
3. After `insert`, a `select` by primary key in the same transaction returns the
   row (post-backed store: post + all meta are written before `insert` returns,
   and `wp_cache` for that post is flushed so a core read sees it too).
4. `mapError` turns UNIQUE and FK driver errors into the v1 problem codes; `Db`
   never parses driver messages. `WpPostStore` has no SQL UNIQUE on meta, so it
   enforces `unique()` itself inside the transaction (`SELECT ... FOR UPDATE`
   on the meta row, §3.5.1) and throws the same `unique_violation`.
5. `source($collection)` names every column of the collection; a column's
   `expr` yields the §3.4 storage form on every store (post-backed: core
   columns and SCF meta are mapped onto it in SQL, §3.5.1) so `Schema::decode`
   is shared.
6. `promoteDue` fires no hooks and writes no revision.

### 3.3 `Db` pipeline (shared; P owns)

Reads: `Db::findMany($collection, $opts, ?Viewer $viewer = null)`. `$viewer`
null = trusted (hooks, actions, CLI). With a viewer: the access rule is
evaluated (§1.6); `false` → 401/403; a filter → ANDed into `where`; the draft
rule appended. `with` loads each relation with one query per level as today;
the viewer's read rule for the **target** collection is applied to the nested
query too (a `with: { comments }` on a post never leaks unapproved comments to
an anonymous reader). `media`/`mediaList` columns populate in place when
listed in `with` (`with: { cover: true }`) — the value becomes a media row
(§4.6) or stays an id when not requested.

Create (per row), the v1 order with insertions:

1. reject unknown keys; 2. defaults (incl. `status`/`publishedAt` rules §6);
2b. required check; **2c. access `create`** (viewer only; `ctx.data` = row);
3. `beforeCreate(data, ctx)`; 4. encode + **rules** (`min/max/pattern/validate`,
nested field validation, media/reference existence); **4b. slug derivation**
(`slug.source`, when absent/empty); 5. `Store::insert`; 6. re-read →
**6b. revision** (when `revisions`); `afterCreate(row, ctx)`.

Update: select matching rows (trusted select, then access `update` filter
applied as a second `where` when a viewer is present); per row: v1 steps with
`beforeUpdate(patch, existing, ctx)`, rules, **slug re-derivation only when the
patch sets slug to `null`**, `Store::update`, re-read, revision,
`afterUpdate`. Delete: access `delete` filter, `beforeDelete`, `Store::delete`,
`afterDelete`.

Hook recursion: `MAX_HOOK_DEPTH = 8` as today; depth counts every nested
`insert/update/delete` through `Db`, including the `afterCreate`/`afterUpdate`
runs that editor saves trigger on WP (§4.9). Exceeding → 500 `hook_recursion`.

Transactions: one `Store::transaction` per HTTP request / CLI command / WP REST
request / editor save hook. On WP both stores use `$wpdb->query('START TRANSACTION')`
… `COMMIT`/`ROLLBACK` — InnoDB only; the plugin activation checks that
`wp_posts`, `wp_postmeta` and every `zero_*` table report `ENGINE=InnoDB` and
refuses to activate otherwise.
Post-backed writes (`wp_insert_post`, `update_field`) happen inside that
transaction too, so a hook throwing after a `wp_insert_post` rolls the post
back. Object caches are the one thing MySQL can't roll back: `WpPostStore`
calls `clean_post_cache($id)` for every post it touched in a transaction that
rolled back (it tracks them).

### 3.4 Storage forms (shared codecs in `Schema`)

| type | input accepted | storage (all stores) | decoded |
|---|---|---|---|
| integer, real, text, boolean, timestamp, date, json | as v1 | as v1 | as v1 |
| email | string, RFC 5322 addr-spec via `filter_var(FILTER_VALIDATE_EMAIL)` | TEXT | string |
| url | string, `http(s)://` absolute | TEXT | string |
| slug | string matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤200 | TEXT | string |
| richText | string | TEXT (HTML) | string |
| media | int id of an existing media row; `null` | INTEGER | int |
| mediaList | list<int> | TEXT JSON `[1,2]` | int[] |
| select (multiple) | list of enum strings, unique | TEXT JSON | string[] |
| group | object; sub-fields validated recursively; absent optional sub-fields → `null`; absent defaulted → default | TEXT JSON | object with every sub-key |
| repeater | list of objects (as group); count rules | TEXT JSON | list |
| blocks | list of `{ layout, ...fields }`; `layout` ∈ layouts; each item validated against its layout | TEXT JSON | list |

`Schema::encode`/`decode` gain these cases; `Schema::validateInput` (actions)
handles nested fields the same way. Rules run after type coercion, in order
`min/max`, `pattern`, `validate`; the first failure wins and carries the pointer
(`/gallery/2/caption` for nested values — pointers use RFC 6901 segments through
arrays and objects).

### 3.5 `Sql`: filters per dialect

`Sql::select(Schema $schema, Store $store, string $collection, array $opts, ?array $partition): array{sql, params}`
is the v1 `Db::fetch` query builder lifted out of `Db`, taking the base table,
per-column expressions and joins from `Store::source()` and quoting from
`Dialect`. **One compiler serves all three stores**: the Drizzle grammar,
pointer errors, `with` batching and per-parent windows are written once;
the only store-specific knowledge is the `Source` mapping (a plain table for
SQLite/custom tables, `wp_posts` + postmeta joins for post-backed collections,
§3.5.1). A separate compiler in `WpPostStore` was rejected because every
operator would need two implementations whose results must stay identical;
with `ColumnRef` the per-store surface is three strings per column.

How a query is assembled: `SELECT <expr AS col for every column> FROM <table> {a}
<joins for every column referenced by SELECT, WHERE, ORDER BY> WHERE <baseWhere>
AND <filter> ORDER BY ... LIMIT ...`. Joins are emitted once per
(alias, column), so a column filtered and ordered costs one join. Relation
filters (`EXISTS (SELECT 1 FROM <target source> ...)`) and `with` batches
(`WHERE <to.cmpExpr> IN (...)`) use the target collection's `Source` the same
way. `{a}`/`{j}` placeholders are substituted by `Sql` (`t0`, `t0_m3`).

Operators, by `ColumnRef::kind`:

- `scalar` (every type except the JSON-valued ones): the full v1 operator set.
  `eq/ne/gt/gte/lt/lte/in/notIn` compare `cmpExpr` (or `expr`) against
  encoded params. `like/ilike/notLike/notIlike`: SQLite keeps `zero_like()`;
  MySQL emits `expr LIKE ? ESCAPE '\\'` with `COLLATE utf8mb4_bin` (like) or
  the server's case-insensitive collation (`utf8mb4_0900_ai_ci` on MySQL 8,
  `utf8mb4_unicode_ci` on MariaDB; `Dialect` carries the choice from
  `$wpdb->db_version()`). `isNull`/`isNotNull` test `expr IS NULL`.
- `json` (`json`, `group`, `repeater`, `blocks`): only `eq`/`ne` on the whole
  value and `isNull`/`isNotNull`; anything else → 400 `invalid_query`
  "`gt` isn't supported on JSON columns". Ordering by them → 400. On
  post-backed collections `eq`/`ne` on `group/repeater/blocks` are **also**
  rejected (their meta is spread across many rows; nothing to compare) with
  "`eq` on `seo` isn't supported on editor collections; filter on a scalar
  column"; `isNull` means "no rows/empty".
- `serialized-list` (`mediaList`, `select` multiple): `has`, `isNull`,
  `isNotNull`, and `eq: []` (empty). `{ tags: { has: "news" } }` compiles per
  store: SQLite `EXISTS (SELECT 1 FROM json_each(expr) WHERE value = ?)`;
  custom MySQL table `JSON_CONTAINS(expr, ?)` (param JSON-encoded);
  post-backed `{j}.meta_value LIKE ?` with the param
  `'%' . $wpdb->esc_like(serialize((string|int) $v)) . '%'` — i.e. `%s:4:"news";%`
  / `%i:12;%`, which is exact for PHP-serialized arrays because the
  type-length-value encoding can't produce a false substring match for a
  complete element. `in`/`notIn`/`like` on lists → 400 "`in` isn't supported
  on list columns; use `has`". Same message on every store (build-time check
  too, for literal filters).
- Per-parent limit/offset uses window functions on both dialects (MariaDB 11.4
  and SQLite ≥3.25 have them).

Build-time checks (R) mirror the runtime: a literal filter in a hook that uses
a rejected operator on a JSON/list column, or `orderBy` on one, is a build
error with the same text, so the differential test and runtime agree.

### 3.5.1 Post-backed `Source` (WpPostStore)

Base: `` `wp_posts` {a} ``, `baseWhere`
`{a}.post_type = 'zero_<table>' AND {a}.post_status NOT IN ('trash', 'auto-draft', 'inherit')`.
Every column maps as follows; `M(key)` stands for
`LEFT JOIN wp_postmeta {j} ON {j}.post_id = {a}.ID AND {j}.meta_key = 'key'`
and `V` for `NULLIF({j}.meta_value, '')` (SCF writes `''` for an empty
optional field; Zero reads both "no row" and `''` as `null`, so `isNull`
covers both and the two are indistinguishable by design).

| column | `expr` (storage form) | `join` | `cmpExpr` | kind |
|---|---|---|---|---|
| `id` | `{a}.ID` | — | same | scalar |
| title column | `{a}.post_title` | — | same | scalar |
| content column | `{a}.post_content` | — | same | scalar (no ordering; `like` allowed) |
| slug column | `{a}.post_name` | — | same | scalar |
| `status` | `CASE {a}.post_status WHEN 'publish' THEN 'published' WHEN 'future' THEN 'scheduled' ELSE 'draft' END` | — | same | scalar |
| `publishedAt` | `CASE WHEN {a}.post_date_gmt = '0000-00-00 00:00:00' THEN NULL ELSE DATE_FORMAT({a}.post_date_gmt, '%Y-%m-%dT%H:%i:%s.000Z') END` | — | `NULLIF({a}.post_date_gmt, '0000-00-00 00:00:00')` with params converted to `Y-m-d H:i:s` UTC by `Sql` for this column | scalar |
| integer, media, references | `V` | `M(zero_<col>)` | `CAST(V AS SIGNED)` | scalar |
| real | `V` | `M` | `CAST(V AS DECIMAL(30,10))` | scalar |
| boolean | `V` (`'1'`/`'0'`) | `M` | `V` compared to `'1'`/`'0'` | scalar |
| text, email, url, richText (SCF) | `V` | `M` | `V` (strings; `like` on `{j}.meta_value`) | scalar |
| text enum / select single | `V` | `M` | `V` | scalar |
| timestamp (SCF `date_time_picker`; Zero stores UTC `Y-m-d H:i:s` in meta, converting the site-tz picker value in `acf/update_value`, §4.3) | `CONCAT(REPLACE(V, ' ', 'T'), '.000Z')` | `M` | `V` (params converted to `Y-m-d H:i:s` UTC) | scalar |
| date (SCF `date_picker`, stored `Ymd`) | `DATE_FORMAT(STR_TO_DATE(V, '%Y%m%d'), '%Y-%m-%d')` | `M` | `V` (params converted to `Ymd`) | scalar |
| json (SCF textarea) | `V` | `M` | — | json |
| mediaList, select multiple (SCF serialized array) | `V` (runtime normalises `a:2:{...}` → JSON in `WpPostStore::select` post-processing, so `Schema::decode` sees JSON) | `M` | `{j}.meta_value` (for `has` LIKE) | serialized-list |
| group, repeater, blocks | `NULL` placeholder in SQL; `WpPostStore::select` fills the value from `get_field()` per row after the query (SCF's layout is one meta row per sub-field/row index) | — | — | json (no filters) |

`WpPostStore::select` therefore does: run the compiled SQL (one round trip,
rows in storage form for every scalar/list column), then for each row call
`get_field('zero_<col>', $id, false)` for group/repeater/blocks columns and
JSON-encode them. That is N extra cached-meta lookups only when the
collection has such columns; `update_meta_cache` is primed with one
`_prime_post_caches()` call for the page of IDs, so it is 1 + 1 queries per
page, not N+1.

Uniqueness on meta (`unique()` on a post-backed column): before INSERT/UPDATE,
`SELECT post_id FROM wp_postmeta {j} JOIN wp_posts p ... WHERE meta_key = ? AND meta_value = ? AND p.post_type = ? AND p.ID <> ? FOR UPDATE`;
a hit → `unique_violation` with pointer. Slugs use `post_name` and the same
check. Races are serialised by the request transaction.

Performance (documented, accepted): a filtered or sorted list on a post-backed
collection costs one `LEFT JOIN wp_postmeta` per referenced column; core
indexes `post_id` and `meta_key(191)` but **not** `meta_value`, so a
`WHERE meta_value = ?` over a large post type is a scan of that key's rows —
**large filtered lists on post-backed collections are O(postmeta for that
key)**. Zero adds **no** meta indexes in this pass (`meta_value` is LONGTEXT;
a prefix index would need a schema change to core tables, which plugins must
not make). Core-column filters (`id`, title, slug, `status`, `publishedAt`)
use `wp_posts` indexes (`type_status_date`, `post_name`) and are fast.
`editor: false` collections are real tables with real indexes and FKs and are
the fast path for anything query-heavy. Build-time hint (R, cheap): when a
post-backed collection has a `unique()` or `references()` on a meta column,
or `.references()` from another collection targets a post-backed one, `zero
build` prints `hint: "<table>.<col>" is filtered through postmeta on WordPress; set editor: false on "<table>" if this list grows large`
once per build (not an error; silenced with `--quiet`).

### 3.6 Media and globals in `Db`

`Db::media()` returns the `Media` service (`upload(string $tmpPath, string $filename, ?User): array`,
`get(int $id): ?array`, `delete(int $id): void`); REST wraps it (§4.6).
`Db::globalGet($name, ?Viewer)` / `Db::globalUpdate($name, $patch, ?Viewer)`
validate like a row (fields with defaults fall back to defaults when unset) and
call `Store::globalRead/globalWrite`.

---

## 4. WordPress mapping (W owns)

### 4.1 Collections → post types

One registered post type per `editor !== false` collection: `zero_<table>`
(≤20 chars, enforced at build). Not the original `post` + `zero_collection`
taxonomy design, for three concrete reasons: (1) per-collection admin menus,
labels and capabilities come free with a CPT and are what wp-admin users expect
("Posts" and "Authors" as separate menus); (2) the taxonomy design existed to
share one wp.cloud site across Spaces, which is not a constraint here; (3) core
`/wp/v2/<type>` REST and `WP_Query` filter by post type natively, so no
`tax_query` on every read. Registration:

```php
register_post_type('zero_posts', [
  'label' => 'Posts', 'labels' => [...],
  'public' => false, 'show_ui' => true, 'show_in_menu' => true, 'show_in_rest' => true,
  'rest_base' => 'zero_posts', 'menu_icon' => 'dashicons-database',
  'supports' => array_values(array_filter(['title', $content !== null ? 'editor' : null, 'revisions', 'author'])),
  'capability_type' => ['zero_posts', 'zero_posts'], 'map_meta_cap' => true,
  'hierarchical' => false, 'has_archive' => false, 'rewrite' => false, 'query_var' => false,
]);
```

Custom capabilities are granted on activation: `administrator` and `editor` get
all; `author` gets `edit_/publish_/delete_` own; `subscriber` nothing. The
`author`-level grants are what make `ctx.user.role` and wp-admin agree (§5.1).

### 4.2 Custom tables (`editor: false`) and where post-backed data lives

Post-backed collections have **no Zero table**: the row is the `wp_posts` row
plus its `wp_postmeta` rows (SCF layout), read through the §3.5.1 mapping and
written through `wp_insert_post`/`wp_update_post` + `update_field`. There is
no duplicate copy and nothing to resync; what wp-admin saved is what
`/zero/v1` reads, in the same request.

`editor: false` collections are real tables `{prefix}zero_<table>` with all
columns in the §3.4 storage form, created by `Wp\Migrator`. They are the fast
path (indexes, FKs, UNIQUE) and the right choice for anything query-heavy
(comments, logs, reactions, carts).

Column DDL (`Wp\Migrator`, MySQL dialect; `dbDelta`-compatible):

| type | MySQL |
|---|---|
| integer, media | `BIGINT` (`BIGINT UNSIGNED NOT NULL AUTO_INCREMENT` for the pk) |
| real | `DOUBLE` |
| boolean | `TINYINT(1)` |
| text/email/url/slug with `.unique()` or `.max(n ≤ 191)` | `VARCHAR(n)` |
| other text, richText, json, mediaList, select, group, repeater, blocks | `LONGTEXT` |
| timestamp | `CHAR(24)` (the ISO form; sorts lexically = chronologically) |
| date | `CHAR(10)` |
| references | `FOREIGN KEY ... ON DELETE <action>` — **only** when both sides are `editor: false`; cross-kind and post↔post references are checked by `Db` (existence on write, `set null`/`cascade` emulated in `Db::delete` — same code path on every store, so FK actions are pipeline-level semantics with the SQL FK as an extra guard) |

Migrations for `editor: false` tables (and the `zero__*` system tables) are
generated by the compiler as `zero/migrations/wp/NNNN_<name>.sql` (MySQL dialect, same snapshot
diff as SQLite, `ALTER TABLE` for additive changes, no rebuilds), applied by
`Wp\Migrator` on activation and on `admin_init` when `get_option('zero_blog_schema')`
≠ the built schema hash, recorded in `{prefix}zero__migrations`.

### 4.3 Field types → SCF

Field group per post-backed collection, registered on `acf/init` priority 5
via `acf_add_local_field_group`, `key` = `group_zero_<table>`, location
`post_type == zero_<table>`, `show_in_rest => 1`. The title- and
content-designated columns are **not** SCF fields. Field `name` = `zero_<col>`
(meta key), `key` = `field_zero_<table>_<col>`.

| Zero | SCF `type` | settings | stored (postmeta `zero_<col>`) | read via (`WpPostStore::select`) | decoded |
|---|---|---|---|---|---|
| text | `text` / `textarea` (multiline) | `maxlength` = rules.max | string | SQL (§3.5.1) | string |
| text enum / select single | `select` | `choices`, `allow_null` = !notNull, `return_format: value`, `ui: 1` | string | | string |
| select multiple | `select` | `multiple: 1`, `return_format: value` | serialized array | | JSON list |
| integer | `number` | `step: 1`, `min/max` | string | | int |
| real | `number` | `step: any`, `min/max` | | | float |
| boolean | `true_false` | `ui: 1` | `"1"/"0"` | | bool |
| date | `date_picker` | `return_format: Y-m-d`, `display_format: Y-m-d` | `Ymd` | SQL `STR_TO_DATE` | `Y-m-d` |
| timestamp | `date_time_picker` | `return_format: Y-m-d\TH:i:s`, `display_format: Y-m-d H:i` | `Y-m-d H:i:s` **UTC** (`acf/update_value` converts from site tz; `acf/load_value` converts back for the picker) | SQL | ISO |
| email | `email` | | string | | string |
| url | `url` | | | | string |
| richText (non-content) | `wysiwyg` | `toolbar: full`, `media_upload: 1`, `tabs: all` | HTML | | string |
| media (image) | `image` | `return_format: id`, `library: all`, `preview_size: medium` | attachment id | | int |
| media (any) | `file` | `return_format: id` | | | int |
| mediaList | `gallery` | `return_format: id` | serialized ids | | JSON list |
| json | `textarea` | `rows: 8`, validated as JSON | JSON text | | decoded |
| integer `.references(posts.id)` | `post_object` | `post_type: [zero_<target>]`, `return_format: id`, `allow_null` | id | | int |
| integer `.references(<editor:false>.id)` | `number` | instructions "ID of a <label>" | id | | int |
| group | `group` | `sub_fields`, `layout: block` | `zero_<col>_<sub>` meta per sub-field (SCF layout) | `get_field` after the query | JSON object |
| repeater | `repeater` | `sub_fields`, `min/max` = rules, `layout: table`, `button_label` | `zero_<col>` = count, `zero_<col>_<i>_<sub>` | `get_field` after the query | JSON list |
| blocks | `flexible_content` | `layouts` keyed by layout key, each `name` = layout, `sub_fields` | `zero_<col>` = serialized layout list, `zero_<col>_<i>_<sub>` | `get_field` after the query; each row's `acf_fc_layout` → `layout` | JSON list |

Validation parity: `Scf::registerFilters()` adds `acf/validate_value/key=<field key>`
for every Zero field, which runs `Schema::encode` + rules on the posted value
(`$input` decoded by field) and returns the message string on failure — so
wp-admin shows the same message the API would. `acf/update_value` for `json`
normalizes to canonical JSON; `acf/load_value` for timestamp fields converts
to UTC ISO. All three filters live in `runtime/Zero/Wp/Scf.php`.

### 4.4 Core post columns

| Zero | WP |
|---|---|
| `id` | `ID` |
| title column | `post_title` |
| content column (richText) | `post_content` (block markup or HTML, as given; read back via `get_post()->post_content`; **not** `the_content` filters) |
| slug column | `post_name` (Zero validates its pattern; WP's `wp_unique_post_slug` is bypassed by passing the final value) |
| `status` | `post_status`: `draft→draft`, `published→publish`, `scheduled→future`; reads (the §3.5.1 `CASE`): `publish→published`, `future→scheduled`, `draft/pending/private→draft`; `trash`/`auto-draft`/`inherit` rows are excluded by `baseWhere` (a `delete` through Zero calls `wp_delete_post($id, true)`) |
| `publishedAt` | `post_date_gmt` (and `post_date` in site tz); null for drafts ↔ `0000-00-00 00:00:00`; read/compared via the §3.5.1 expressions |
| `createdAt`/`updatedAt` user columns | ordinary meta (Zero's values), NOT `post_date`/`post_modified` |
| author | `post_author` = `ctx.user.id` on create via Zero; untouched otherwise |

### 4.5 Globals → options pages

`acf_add_options_page(['page_title' => label, 'menu_slug' => 'zero-global-<name>', 'post_id' => 'zero_global_<name>', 'capability' => 'edit_others_posts', 'show_in_rest' => true, 'parent_slug' => 'zero-blog'])`
plus a field group `group_zero_global_<name>` located `options_page == zero-global-<name>`.
Values live in options `zero_global_<name>_<field>` (SCF's `{post_id}_{name}`
convention). `WpTableStore::globalRead` reads with `get_field($name, 'zero_global_<name>')`
per field (so repeater/group meta layouts decode via SCF); `globalWrite` uses
`update_field`. The plugin registers a top-level menu `zero-blog` ("Blog")
that holds the globals pages; collections keep their own menus.

### 4.6 Media

Built-in collection `media` on both targets, REST `/media`:

```
POST   /media            multipart: file=<binary>, alt?=string         → 201 media row
GET    /media/{id}, GET /media?where=..., DELETE /media/{id}
media row: { id, url, mime, size, width, height, alt, filename, createdAt }
```

WP: attachments (`wp_handle_sideload` + `wp_insert_attachment` +
`wp_generate_attachment_metadata`); `url` = `wp_get_attachment_url`, `alt` =
`_wp_attachment_image_alt`. Access: `read: "anyone"`, `create: "author"`,
`delete: "editor"` (fixed; not configurable this pass). `accept: "image"`
rejects non-`image/*` mime with 422 pointer `/<col>`. Deleting a media row
nulls `media` columns and removes the id from `mediaList` columns that reference
it (pipeline-level, both targets: `Db` runs `update` with `{ col: null }` /
the filtered list for every row matched by `{ col: id }` or `{ col: { has: id } }`
through the normal `Sql` path, so hooks and revisions apply).

Standalone: `__zero_media(id, filename, mime, size, width, height, alt, path, createdAt)`,
files under `<appRoot>/public/uploads/YYYY/MM/<uuid>.<ext>`, `url` =
`/uploads/...` relative; `width/height` via `getimagesize` (gd present).

### 4.7 Revisions

Post-backed: WP revisions. `revisions` support is on; SCF's `revisions.php`
stores field meta per revision (SCF 6.9.7 `ACF_Revisions` hooks
`_wp_post_revision_fields`), so `Store::revisions()` lists `wp_get_post_revisions($id)`
and `revision($id, $rid)` decodes the revision post + its meta through the same
mapper used for live posts. Restore (`POST /{c}/{id}/revisions/{rid}/restore`)
reads the revision row and runs the **update pipeline** with it as the patch
(so hooks, rules, and access apply; WP `wp_restore_post_revision` is not
called — the update produces a new revision anyway).

Custom tables and standalone: `{prefix}zero__revisions(id, collection, pk, at, userId, row LONGTEXT)` /
`__zero_revisions` with the same columns; a row is written after every
successful update (the **previous** state, like WP) and on create (the initial
state), keep-all. Trimming is out of this pass.

### 4.8 REST routes

Standalone prefix `/api`; WP prefix `/wp-json/zero/v1`. **Everything after the
prefix is identical**, including problem documents (WP routes bypass
`WP_Error` shapes: the handler returns a `WP_REST_Response` whose body is the
Zero problem/`{data}` and sets `Content-Type` itself).

| Method + path | Notes |
|---|---|
| `GET /_schema` | as v1 + globals, access summary (`"anyone"`/`"authenticated"`/role/`"rule"`) |
| `GET /me` | `{ data: User \| null }` |
| `GET /{c}`, `GET /{c}/{id}`, `POST /{c}`, `PATCH /{c}/{id}`, `DELETE /{c}/{id}` | as v1; `with` accepts `with=author,comments` or JSON `with={"author":true}`; `status` query shorthand `?status=draft` (= where status) |
| `GET /{c}/{id}/revisions` | `{ data: [{ id, at, user: {id,name}\|null }] }`; needs `update` access on the row |
| `GET /{c}/{id}/revisions/{rid}` | the full row at that revision |
| `POST /{c}/{id}/revisions/{rid}/restore` | runs update; returns the row |
| `GET /globals/{g}`, `PATCH /globals/{g}` | `{ data: values }` |
| `POST /media` (multipart), `GET /media[/{id}]`, `DELETE /media/{id}` | §4.6 |
| `POST /actions/{name}` | as v1, access-checked |
| `POST /auth/token` | standalone only (§5.2); on WP → 404 |

New problem codes: `unauthenticated` 401, `forbidden` 403, `payload_too_large` 413.
Status filter shorthand aside, query parameters are exactly v1.

Core `/wp/v2/zero_<table>` stays enabled (Gutenberg needs it) and is governed
by WP capabilities only. The typed client and docs point at `/zero/v1` only.

### 4.9 Plugin bootstrap

Build output (`.zero/wp/zero-blog/`, zipped as `zero-blog.zip`):

```
zero-blog/
  zero-blog.php            main file: header, constants, require runtime/bootstrap.php, new Zero\Wp\Plugin(__DIR__)
  zero/runtime/*.php       shared runtime (same bytes as standalone)
  zero/runtime/Wp/*.php
  zero/app/schema.php      target => 'wp'
  zero/app/functions.php
  zero/app/migrations/*.sql   MySQL dialect
  vendor/                  empty; no Composer
```

`Zero\Wp\Plugin::__construct` wires, in order:

| hook | work |
|---|---|
| `register_activation_hook` | require `wp-admin/includes/upgrade.php`; `Wp\Migrator::migrate()` (creates `editor: false` tables + `zero__*` system tables; InnoDB check on them and on `wp_posts`/`wp_postmeta`); grant capabilities; `flush_rewrite_rules` not needed (no rewrite) |
| `plugins_loaded` | abort with an admin notice if SCF (`class ACF`) is missing or `< 6.9.7`, or WP `< 6.7` |
| `init` (10) | `register_post_type` for every post-backed collection; `App::boot($dir, new WpPostStore+WpTableStore composite, new WpAuth, new WpMedia)` |
| `acf/init` (5) | `Scf::registerGroups()`: field groups + options pages + validate/update/load filters |
| `rest_api_init` | `Rest::register()`: `register_rest_route('zero/v1', '/(?P<path>.*)', ['methods' => 'GET,POST,PATCH,DELETE,OPTIONS', 'permission_callback' => '__return_true', 'callback' => [Rest, 'dispatch']])` — one catch-all route that hands `(method, path, query, body)` to `App::handle()`; Zero's own access rules decide. |
| `acf/save_post` (20) | editor hooks: `Db::afterEditorSave($collection, $postId, $previousRow)` runs `afterCreate` (new post) or `afterUpdate` (with `$previousRow` captured on `pre_post_update` through a normal `Db::findFirst`) using the row re-read through `WpPostStore::select`, `ctx.user` = `wp_get_current_user()` mapped, inside one transaction. A static re-entrancy flag skips posts that Zero itself is inserting/updating in this request (their hooks already ran in the pipeline). |
| `before_delete_post` / `deleted_post` | if the post belongs to a Zero collection and Zero isn't the deleter: `beforeDelete($row)` on `before_delete_post`, `afterDelete($row)` on `deleted_post`; pipeline-emulated FK actions (§4.2) run from `afterDelete` the same way `Db::delete` does |
| `transition_post_status` (`future`→`publish`) | nothing: the §3.5.1 `CASE` reads the new status directly (no hooks: §6.3) |
| `admin_menu` | top-level "Blog" menu (`zero-blog`) for globals |
| `admin_init` | re-run `Wp\Migrator::migrate()` when the schema hash option differs (plugin updated by upload) |

`WpPostStore` and `WpTableStore` are two classes; `Wp\CompositeStore` routes
by `schema.collections[c].editor` and holds the shared `$wpdb` transaction.
`WpPostStore::insert` = `wp_insert_post` (title/content/name/status/date/author)
+ `update_field` per SCF field (`acf/update_value` filters apply, so SCF
layouts for group/repeater/blocks and timestamp conversion are SCF's own);
`update` = `wp_update_post` + `update_field` for patched fields; `delete` =
`wp_delete_post($id, true)`. `select` runs the §3.5.1 SQL, primes the meta
cache for the page, and fills group/repeater/blocks via `get_field`. The store
keeps a per-request set of post IDs it is writing so the editor hooks (table
above) don't double-fire.

---

## 5. Identity and auth

### 5.1 The `User` and roles

`ctx.user` is `null` or `['id' => int, 'name' => string, 'role' => 'subscriber'|'author'|'editor'|'admin']`.
Role rules compare on the ladder (`"author"` admits author, editor, admin).

WP mapping (`Wp\WpAuth::resolve()`): the user WordPress authenticated for the
REST request (`wp_get_current_user()` after core's cookie+nonce or Application
Password handling; Zero adds nothing) → `id` = `ID`, `name` = `display_name`,
`role` from capabilities: `manage_options` → admin; `edit_others_posts` →
editor; `publish_posts` or `edit_posts` → author; any other logged-in user →
subscriber. Unauthenticated → `null`. A cookie without a valid `X-WP-Nonce` is
anonymous, as in core.

### 5.2 Standalone: bearer tokens

Table `__zero_tokens(id INTEGER PK, name TEXT NOT NULL, role TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL, lastUsedAt TEXT, revokedAt TEXT)`
and `__zero_users(id INTEGER PK, name TEXT NOT NULL UNIQUE, role TEXT NOT NULL, passwordHash TEXT, createdAt TEXT NOT NULL)`.
A token belongs to a user (`userId` column; FK). `Authorization: Bearer zt_<40 base62>`;
stored as `hash = sha256(token)`; the plaintext is shown once.

CLI (`php zero/bin/zero.php ...`, also `zero users …`/`zero tokens …` wrappers in the Rust CLI that shell out):

```
user add <name> --role admin|editor|author|subscriber [--password]   → {data: {id, name, role}}
user list | user role <name> <role> | user remove <name>
token create <user> [--name label]   → {data: {token: "zt_...", id}}   (plaintext once)
token list [user] | token revoke <id>
```

`POST /api/auth/token` `{ name, password }` → `{ data: { token, user } }` for
users with a password (so a frontend can log in); 401 `unauthenticated` on
mismatch. `GET /api/me` works with a bearer. There is no session/cookie
mechanism standalone. Rate limiting is out of this pass.

### 5.3 Viewer in the pipeline

`App::handle` resolves `Auth::resolve($headers)` once per request into
`Viewer { ?User $user; string $target }` and passes it to `Db` reads/writes
and to `runAction`. CLI passes `null` (trusted). On WP, the catch-all REST
callback runs after core auth, so `WpAuth::resolve` just maps the current user.

---

## 6. Drafts and publishing

### 6.1 Columns and transitions

Drafts collections carry `status` (`draft | published | scheduled`, default
`published`) and `publishedAt` (nullable timestamp). Pipeline rules, both
targets, applied in step 2 (create) and before `beforeUpdate` (update):

| incoming | effect |
|---|---|
| `status` absent on create | `published`, `publishedAt = now` |
| `status: "published"`, `publishedAt` absent/null | `publishedAt = now` |
| `status: "scheduled"` | `publishedAt` required and must be > now, else 422 pointer `/publishedAt` ("scheduled rows need a future publishedAt") |
| `status: "draft"` | `publishedAt` kept as given (may be null) |
| update `published → draft` | `publishedAt` kept |

Both columns are plain columns to hooks, `db`, filters and `orderBy`.

### 6.2 Visibility

§1.6: shorthand/boolean read rules get `status = "published"` for viewers below
`editor` (anonymous included); function rules are authoritative. `scheduled`
rows are therefore invisible to the public until promoted; `publishedAt` in
the past with `status: "scheduled"` is impossible to create (6.1) but possible
by clock drift — promotion handles it.

### 6.3 Scheduled publishing

| target | mechanism |
|---|---|
| standalone, WP `editor: false` | **Lazy promotion**: `App::handle`/`cli` call `Store::promoteDue($collection, now)` for every drafts collection at the start of each request/command (one cheap `UPDATE` per collection); plus `php zero/bin/zero.php publish-due` for cron. |
| WP `editor: true` | `post_status = future` + WP cron (`publish_future_post`); reads see the new status immediately through the §3.5.1 `CASE`. |

Promotion fires **no hooks and writes no revision** on either target
(parity: WP cron doesn't run Zero hooks). Teams that need "on publish" logic
use `afterUpdate` and compare `previous.status`, which fires for explicit
status changes via the API or editor.

### 6.4 Revisions

In on both targets (§4.7). `revisions: false` turns it off per collection.
Revision rows are not status-filtered and need `update` access on the parent
row.

---

## 7. Typed client

`zero build` writes `zero/client/index.ts` (both targets, same file apart from
the default base path) — self-contained, zero dependencies, `fetch`-based,
usable in any TS/JS frontend via copy or path import. It is **not** the
`"zero"` types package (that package types `zero.config.ts` and is build-time
only); the client embeds generated interfaces derived from the schema, so a
frontend never needs `zero.config.ts` or the `"zero"` module.

```ts
// Generated. Shapes for the blog example:
export interface Post { id: number; title: string; slug: string; body: string | null; excerpt: string | null; cover: number | null;
  tags: ("news" | "guide" | "release")[]; authorId: number | null; seo: { metaTitle: string | null; metaDescription: string | null; noindex: boolean } | null;
  gallery: { image: number; caption: string | null }[] | null; sections: ({ layout: "hero"; heading: string; image: number | null } | { layout: "quote"; text: string; cite: string | null })[] | null;
  createdAt: string; updatedAt: string; status: "draft" | "published" | "scheduled"; publishedAt: string | null }
export interface PostInsert { /* required/optional as InsertShape */ }
export type PostPatch = Partial<PostInsert>;
export interface Media { id: number; url: string; mime: string; size: number; width: number | null; height: number | null; alt: string | null; filename: string; createdAt: string }
export interface User { id: number; name: string; role: "subscriber" | "author" | "editor" | "admin" }

export interface ClientOptions {
  /** Base URL including the prefix: "https://x.test/api" or "https://x.test/wp-json/zero/v1". Default: "/api" (standalone build) or "/wp-json/zero/v1" (wp build). */
  url?: string;
  /** Standalone bearer token. */
  token?: string;
  /** WP cookie auth: the REST nonce; sent as X-WP-Nonce with credentials: "same-origin". */
  nonce?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export declare function createClient(options?: ClientOptions): Client;

export interface Client {
  posts: CollectionClient<Post, PostInsert, PostPatch, PostWith, PostFilter, PostOrder>;
  authors: ...; comments: ...;
  media: { list(q?): Promise<Media[]>; get(id: number): Promise<Media>; upload(file: Blob | File, opts?: { alt?: string; filename?: string }): Promise<Media>; delete(id: number): Promise<Media> };
  actions: { approveComment(input: { id: number }): Promise<Comment>; publishedCount(input?: {}): Promise<{ count: number }> };
  globals: { settings: { get(): Promise<Settings>; update(patch: Partial<Settings>): Promise<Settings> } };
  auth: { me(): Promise<User | null>; login(name: string, password: string): Promise<{ token: string; user: User }> /* standalone only */ };
  schema(): Promise<unknown>;
}

export interface CollectionClient<Row, Insert, Patch, With, Filter, Order> {
  list(q?: { where?: Filter; orderBy?: Order; limit?: number; offset?: number; with?: With }): Promise<RowWith<Row, With>[]>;
  get(id: number, q?: { with?: With }): Promise<RowWith<Row, With>>;
  create(data: Insert): Promise<Row>;
  update(id: number, patch: Patch): Promise<Row>;
  delete(id: number): Promise<Row>;
  revisions: { list(id: number): Promise<RevisionSummary[]>; get(id: number, rid: number): Promise<Row>; restore(id: number, rid: number): Promise<Row> };
}

export class ZeroError extends Error {   // thrown for every non-2xx; fields = the problem document
  readonly status: number; readonly code: string; readonly detail: string; readonly pointer?: string; readonly title: string;
}
```

Wire mapping: `list` → `GET /{c}?where=<json>&orderBy=name,-createdAt&limit&offset&with=<json>`;
`with` is sent as JSON when any entry is an object, comma list otherwise.
`RowWith` attaches `one` → row|null, `many` → row[], `media` columns →
`Media | null` when requested. Filter/Order/With types are generated per
collection from the same rules as `types/zero` (operators table, relation
keys, `has` on list columns). Network/JSON failures throw `ZeroError` with
`status: 0, code: "network"`.

Generated alongside: `zero/client/README.md` (one screen: import, create
client, three calls) — owned by T, template in `runtime/client/` embedded by
the Rust binary like the PHP runtime. The Rust side (R) only emits the
interface section (`zero/client/types.ts`) and copies the runtime file
(`zero/client/index.ts` re-exports `./types` and the runtime); the runtime
file is handwritten TS by T, free of schema knowledge except a generated
`const SCHEMA = {...}` descriptor (collection → relations/media columns/actions/globals)
emitted by R as `zero/client/schema.ts`.

---

## 8. Build output and CLI

```
zero build [dir] [--target standalone|wp] [--out <dir>]   default target: `target` in zero.config.ts (`defineConfig({ target })`, default "standalone")
zero check [dir]                                           evaluates + compiles; emits nothing; runs both targets' rejection rules
zero dev [dir] [--port n]                                  standalone: php -S as today
zero dev [dir] --wp [--port n]                             builds the plugin, boots tests/wp-style docker (WP+MariaDB+SCF), installs the plugin, prints URL + admin creds; rebuilds + re-copies the plugin on config change
zero users|tokens …                                        standalone: shells to zero/bin/zero.php (§5.2)
```

Output layout:

```
<project>/
  zero.config.ts  zero.gen.ts                      (as today)
  zero/migrations/sqlite/NNNN_*.sql + snapshot.json   (moved from zero/migrations/; `zero build` migrates the old location once)
  zero/migrations/wp/NNNN_*.sql + snapshot.json
  zero/client/{index.ts, types.ts, schema.ts, README.md}
  .zero/app/...                                    standalone (as today + data/, public/uploads/)
  .zero/wp/zero-<name>/...  and  .zero/wp/zero-<name>.zip
```

Both migration sets are generated on **every** build regardless of `--target`
(so a repo building standalone still commits WP migrations and vice versa; the
snapshot is shared). `--target` picks what lands in `.zero/` and `schema.php`'s
`target`.

`zero dev --wp` requires docker; it reuses `tests/wp/harness.sh` (§9.2) with
`ZERO_WP_PLUGIN=<built dir>`.

---

## 9. Test plan

Rules (from the monorepo's AGENTS.md): behaviour only, no source-grep, one
behaviour at the lowest level that can break it, extend existing tests before
adding, no `sleep`, no `.only`.

### 9.1 Where each behaviour is proven

| Behaviour | Level | Suite (owner) |
|---|---|---|
| New builders/modifiers accepted; every §1 rejection with `file:line:col` | compiler | `tests/compiler.rs` `rejects_*` + `tests/fixtures/reject-*` (R). One fixture per rejection class, not per message. |
| schema.php v2 shape for the blog example | compiler golden | `tests/compiler.rs`: build `examples/blog`, `require` schema.php via `php -r`, compare JSON to `tests/fixtures/blog.schema.json` (drift-guard; R) |
| Access functions / validators compile to the same result as Node | differential | `tests/differential/cases.ts` gains cases for `ctx`-reading access functions and `.validate` closures (R) |
| Codecs: email/url/slug/select/group/repeater/blocks/media encode/decode + rules + nested pointers | pure PHP | `tests/php/schema_test.php` (new file; P) |
| Pipeline: access (role ladder, filter, 401/403/404 masking), drafts transitions, lazy promotion, slug derivation, revisions, hook ctx, media delete nulling, globals | PHP in-process against SQLite via `App::handle` | `tests/php/db_test.php` extended (P). The fixture app's hand-written schema.php moves to v2. |
| Standalone tokens: CLI mint, bearer resolves role, revoked token anonymous, `/auth/token` | PHP | `tests/php/auth_test.php` (P) |
| Sql compiler per dialect: `has`, like/ilike collation, JSON rejects, window partition | pure PHP, both dialects (`Dialect` objects; MySQL SQL text asserted, executed only in WP suite) | `tests/php/sql_test.php` (P writes; W may add MySQL-executed cases in `tests/wp/`) |
| WP: plugin activates, tables created InnoDB, CPT + field groups registered, options pages exist | WP e2e via WP-CLI in docker | `tests/wp/plugin.test.ts` (W) |
| WP: full REST parity — the **same** scenario script runs against standalone and WP | cross-target e2e | `tests/e2e/blog-scenario.ts` (T writes the scenario as a function of `createClient`; run by `tests/e2e/standalone.test.ts` (P) and `tests/wp/rest.test.ts` (W)). Covers: anonymous sees published only; author creates draft, can't publish others'; editor schedules; promotion (standalone: time travel via `ZERO_NOW` env; WP: `wp cron event run --due-now` after setting `post_date_gmt` in the past via WP-CLI); revisions list/restore; media upload + `with`; globals; action access; problem documents identical (`code`, `status`, `pointer`). |
| WP: editor-side parity — a post saved through core `/wp/v2/zero_posts` with `acf` fields shows up in `/zero/v1/posts` with decoded fields in the same request, `afterUpdate` ran, invalid value rejected with Zero's message; a core-side status change (`wp post update --post_status=draft`) is visible without any sync | WP e2e | `tests/wp/editor.test.ts` (W) |
| WP: `editor:false` table, FK, unique → 409 with pointer | WP e2e | `tests/wp/tables.test.ts` (W) |
| WP: postmeta filter compilation executed for real — every operator in §3.5 on each post-backed column kind (typed CAST ordering of integers/reals/dates, boolean, `isNull` for missing and `''` meta, `has` on gallery/select-multiple, rejected operators → 400 with the shared message, `unique()` on meta → 409, relation filter and `with` across post↔table) | WP e2e against MariaDB | `tests/wp/postmeta.test.ts` (W). The SQL text itself is pinned in P's `tests/php/sql_test.php` with a hand-built post `Source` fixture. |
| Typed client types: `@ts-expect-error` set over the generated `types.ts` | tsc | `examples/blog/client-tests/negative.ts` (T) |
| `"zero"` types: new builders, `AccessRule`, `global`, hook ctx | tsc | `types/zero/tests/*.ts` extended (T) |

Not re-proven at e2e: codec edge cases, filter grammar, hook recursion — those
stay in `tests/php`.

### 9.2 WP harness contract (`tests/wp/`)

The harness (parent-provided, W extends) must expose:

```
tests/wp/harness.sh up [--plugin <dir>]   boots WP 7.1.x + MariaDB 11.4 + SCF 6.9.7 (cached zip), installs the plugin dir (copied into wp-content/plugins), activates it,
                                          creates users admin/editor/author/subscriber with application passwords, and prints ONE JSON line:
                                          {"url":"http://127.0.0.1:<port>","wp":"7.1.2","scf":"6.9.7","users":{"admin":{"id":1,"appPassword":"xxxx xxxx ..."},"editor":{...},"author":{...},"subscriber":{...}},"container":"zero-wp-<id>"}
tests/wp/harness.sh wp <args...>          runs WP-CLI inside the container (e.g. `wp cron event run --due-now`, `wp post update`)
tests/wp/harness.sh sql "<query>"         runs a query in MariaDB (postmeta/custom-table assertions, e.g. that a Zero create wrote exactly the expected meta rows)
tests/wp/harness.sh down
```

Env: `ZERO_WP_URL`, `ZERO_WP_ADMIN_APP_PASSWORD` etc. are also exported by
`up --env` for shells. Tests are Node 22 `.ts` (type-stripped) using
`node:test`, driven by the generated client with
`headers: { Authorization: "Basic " + btoa("admin:" + appPassword) }`. A
`tests/wp/run.sh` builds `examples/blog --target wp`, brings the harness up,
runs `node --test tests/wp/*.test.ts`, tears down; `cargo test` does not depend
on docker (the WP lane is separate: `tests/wp/run.sh`).

Credentials in the harness are disposable, docker-local, and may be committed
(they exist only inside a throwaway container).

---

## 10. Work partition

Disjoint file ownership; nobody edits another owner's files. Shared contracts
are this document; changes to it go through the parent.

### Freeze order

1. **Day 0 (this doc):** §2 schema.php v2, §3.2 `Store` interface + `Dialect`,
   §3.4 storage forms, §4.8 routes, §5.1 `User`, §7 client API. These are the
   seams; all four start immediately.
2. **First assembly point:** R lands the blog example's `schema.php` +
   `functions.php` as **checked-in fixtures** (`tests/fixtures/blog.schema.php`,
   `tests/fixtures/blog.functions.php`) within the first iteration, generated
   by hand if the compiler isn't there yet. P and W code against those files,
   not against the compiler.
3. P publishes `runtime/Zero/Store.php`, `Dialect.php`, `Sql.php` and
   `Schema.php` codecs early (they are mostly mechanical) so W's stores
   implement a real interface; until then W codes to this doc's signatures.
   W and P never share a file: W's stores are consumed by `App`/`Db` only
   through `Store`.
4. T's client runtime is schema-agnostic; it needs only `schema.ts`'s
   descriptor shape (§7), fixed here.

### (R) Rust compiler — `src/`, `tests/compiler.rs`, `tests/fixtures/`, `tests/differential/`

Deliverables: builders/modifiers/options/globals/access/`target`/`name` in
`value.rs`/`eval.rs`/`extract.rs`; `schema.rs` extended (ColType variants,
`Rules`, nested fields, `Access`, `Global`, flags); compile `access` fns,
`.validate` fns, hook/action `ctx` parameter; type-checker knows `status`/`publishedAt`,
`ctx`, nested field types, `has`; `schema_php.rs` v2; `migrate.rs` dual
dialect + `zero/migrations/{sqlite,wp}`; `zero/client/{types,schema}.ts`
emission; `--target`, `dev --wp`, `users/tokens` passthrough; embed
`runtime/Zero/Wp/*`, `runtime/wp-plugin/*`, `runtime/client/*`; every §1
rejection.
Acceptance: `cargo test` green including the blog golden and new rejections;
differential cases for access/validate pass; `zero build examples/blog --target wp`
produces the §4.9 layout and `php -l` passes.

### (P) Shared runtime + SQLite + standalone auth — `runtime/Zero/` (not `Wp/`), `runtime/bin/`, `tests/php/`, `tests/e2e/standalone.test.ts`

Deliverables: `Store.php`, `Dialect.php`, `Sql.php`, `Store/SqliteStore.php`,
`Auth.php`, `Identity.php`, `Media.php`, `Db.php` pipeline (§3.3), `Schema.php`
codecs (§3.4), `App.php` routes (§4.8) + viewer + lazy promotion + multipart,
CLI commands (§5.2, `publish-due`), system tables created by `SqliteStore`
on boot (`__zero_tokens/_users/_revisions/_globals/_media`); `Source`/`ColumnRef`
value objects and the §3.5 operator matrix in `Sql`, including the
`serialized-list` LIKE form and `json` rejections, pinned by `tests/php/sql_test.php`
against both a plain `Source` and a hand-built post-backed `Source` fixture
(so W's store only has to produce the mapping, not the operators).
Acceptance: `tests/php/run.sh` green (db, schema, sql, auth suites);
`tests/e2e/standalone.test.ts` green against `php -S` with the blog example
built from R's fixtures.

### (W) WP stores + plugin + SCF — `runtime/Zero/Wp/`, `runtime/wp-plugin/`, `tests/wp/`

Deliverables: `WpPostStore`, `WpTableStore`, `CompositeStore`, `WpAuth`,
`WpMedia`, `Scf` (groups, options pages, filters), `Rest` (catch-all route),
`Plugin` (hooks table §4.9), `Wp\Migrator` (MySQL, dbDelta-free DDL from the
generated SQL + ledger), the post-backed `Source` (§3.5.1) including the
serialized-list normalisation, meta-cache priming and `get_field` fill, meta
uniqueness check, editor-save hooks; harness extensions (`wp`, `sql`
subcommands, user creation), `tests/wp/*.test.ts`, `tests/wp/run.sh`.
Acceptance: `tests/wp/run.sh` green: plugin, tables, editor, postmeta, rest
(the shared scenario) suites.

### (T) Types + client + examples — `types/zero/`, `runtime/client/`, `examples/`, `tests/e2e/blog-scenario.ts`, `examples/blog/client-tests/`

Deliverables: `index.d.ts` additions (§1, exact surface), `types/zero/tests`
extensions; the client runtime (`runtime/client/index.ts`, `README.md`
template) implementing §7 against the generated `types.ts`/`schema.ts`;
`examples/blog` (config, `public/` minimal HTML page that uses the client,
hook bodies); the cross-target scenario function; the pantry example updated
(`title: "name"` or `editor: false` — pantry becomes `editor: false`
everywhere, it is an app not a CMS).
Acceptance: `tsc -p types/zero/tests` and `tsc -p examples/blog/client-tests`
green; the scenario passes on P's standalone lane (T runs it locally with P's
runtime once P lands; until then against a hand-written `php -S` stub is not
required — the scenario is pure client code).

---

## 11. Judgment calls (review these)

1. **CPT per collection instead of post + `zero_collection` taxonomy.** The
   ruling said keep the taxonomy model "unless a concrete reason": the reasons
   are per-collection admin menus/capabilities, no Space-sharing constraint,
   and native REST/`WP_Query` filtering (§4.1). Reusable verbatim from the
   original: the SCF field builder switch (`spacefast_content_scf_field`), the
   validate/update/load filter trio, the dbDelta notes; the Space-scoped
   keys/term slugs are dropped.
2. **Postmeta is queried directly** (ruling, rev 2): no duplicate data for
   post-backed collections. Cost: filtered/sorted lists on post-backed
   collections are O(postmeta for the key) with no `meta_value` index; `has`
   on multi-value fields is a serialized-substring LIKE; `group/repeater/blocks`
   can't be filtered on. One `Sql` compiler still covers every store through a
   per-column `Source` mapping. `editor: false` is the documented fast path and
   `zero build` hints at it.
3. **API-created rows default to `published`**, not `draft` (an app posting a
   row expects it to exist). wp-admin's own default (draft) still applies to
   editor-created posts.
4. **Hooks don't run on scheduled promotion** on either target, for parity
   with WP cron.
5. **`beforeCreate`/`beforeUpdate` don't run on wp-admin saves**; validation
   does (via SCF). Editors get the same validation messages, not the same
   mutation hooks.
6. **Revisions are in on both targets** (keep-all; no trimming).
7. **Media is a fixed built-in collection** with fixed access; not
   configurable this pass.
8. **Standalone auth = users + bearer tokens + optional password login**, no
   cookies, no rate limiting.
9. **Core `/wp/v2/zero_*` stays enabled** (Gutenberg needs it); it is governed
   by WP capabilities, not Zero access rules. The typed client never uses it.
10. **Unique text requires `.max(≤191)`** (MySQL index limit) on both targets,
    for one config.
11. **`drafts: false` with `editor: true` rejected**; WP posts always have a
    status, so pretending otherwise would diverge.
12. **FK actions are emulated in the pipeline** on every store (SQL FKs only
    where both sides are custom tables) so cross-kind references behave the
    same.
13. **No meta indexes added, timestamps stored in UTC in meta.** Zero never
    alters core tables; the price is the scan in item 2. Storing SCF
    `date_time_picker` values as UTC (converted in `acf/update_value`/`load_value`)
    is what makes `publishedAt`-style comparisons on meta timestamps correct in
    SQL; it deviates from SCF's default site-tz storage only for Zero fields.

Deliberately out of this pass: i18n/translatable fields, field-level access,
`auth: true` collections (user-backed collections), Sanity-style conditional
`hidden`, focal point, live preview, webhooks, revision trimming, upload size
policy beyond PHP's `upload_max_filesize`, rate limiting, `ilike` on SQLite
for non-ASCII case folding beyond PCRE `i`, nested `blocks`, SCF conditional
logic, taxonomy fields, `wp_kses` parity on standalone (richText is stored
verbatim there).
