/// <reference path="./db.d.cts" />
import type { ServicesConfig } from "./services";
export type { ServicesConfig, ServiceForm, ServiceFormField, ServiceProduct } from "./services";

/**
 * Type declarations for the `"typedpress"` module.
 *
 * `typedpress build` evaluates `typedpress.config.ts` with its own Rust evaluator and
 * compiles hooks/actions to PHP; nothing here exists at runtime in a JS
 * engine. These types exist so editors autocomplete and `tsc --noEmit`
 * catches mistakes. Shapes mirror Drizzle ORM 1.0 (beta.22).
 *
 * Layout:
 *   1. Utilities
 *   2. Columns (builders, modifiers, references)
 *   3. Collections and model inference
 *   4. Relations
 *   5. Filters, ordering, column selection
 *   6. Relational query results
 *   7. Registry (how `db` learns your schema)
 *   8. Database API
 *   9. Identity and access
 *  10. Hooks, actions, globals, config
 *  11. Errors
 */

// ---------------------------------------------------------------------------
// 1. Utilities
// ---------------------------------------------------------------------------

/** Flattens intersections so hovers show a plain object. */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** Branded primary-key / reference ID for a kind (e.g. `Id<"posts">`). Assignable to `number`, prevents cross-kind ID mixups. */
export type Id<Kind extends string = string> = number & { readonly __tp_kind?: Kind };

/** Retention duration: `"forever"` (default, never auto-purge) or a duration like `"30d"`, `"90d"`, `"1y"`. */
export type RetentionDuration = "forever" | `${number}${"s" | "m" | "h" | "d" | "w" | "y"}`;

/** Revision pruning policy: keep the latest `keepLast` revisions and/or prune revisions older than `maxAge`. */
export interface RevisionRetention {
  keepLast?: number;
  maxAge?: RetentionDuration;
}

/** Retention policy for soft-deleted rows and revisions. Default is `"forever"` (never auto-purge). */
export type RetentionConfig =
  | "forever"
  | {
      deleted?: RetentionDuration;
      revisions?: "forever" | RevisionRetention;
    };

/** Which rows a query includes when soft deletes are enabled. Default: `"exclude"`. */
export type DeletedMode = "exclude" | "include" | "only";

type Awaitable<T> = T | Promise<T>;

/** Phantom keys: carry type information without showing up in autocomplete. */
declare const columnBrand: unique symbol;
declare const collectionBrand: unique symbol;
declare const relationsBrand: unique symbol;
declare const relationBrand: unique symbol;
declare const actionBrand: unique symbol;
declare const configBrand: unique symbol;
declare const globalBrand: unique symbol;
declare const jobBrand: unique symbol;
declare const fileBucketBrand: unique symbol;
declare const envBrand: unique symbol;

// ---------------------------------------------------------------------------
// 2. Columns
// ---------------------------------------------------------------------------

export type ColumnKind =
  | "id"
  | "integer"
  | "number"
  | "text"
  | "boolean"
  | "date"
  | "timestamp"
  | "json"
  | "email"
  | "url"
  | "slug"
  | "richText"
  | "media"
  | "file"
  | "mediaList"
  | "select"
  | "refList"
  | "group"
  | "repeater"
  | "blocks";

/** Values a `$onUpdate`/`$default` function may return: `Date` is accepted on time columns. */
type GeneratedValue<TKind extends ColumnKind, TData> =
  | TData
  | (TKind extends "timestamp" | "date" ? Date : never);

// Which modifiers each kind allows (design §1.2). Enforced here through `this` parameters, and by
// the compiler regardless ("`.max()` isn't valid on a boolean column").
/** `.min/.max`: numeric bounds, string length in code points, or item count. */
type BoundedKind = "integer" | "number" | "text" | "email" | "url" | "slug" | "richText" | "mediaList" | "select" | "refList" | "repeater" | "blocks";
/** `.pattern`: strings only. */
type PatternKind = "text" | "email" | "url" | "slug";
/** `.unique()`. */
type UniqueKind = "id" | "integer" | "number" | "text" | "email" | "url" | "slug" | "boolean" | "date" | "timestamp";
/** `.default()` and friends: every kind but media. */
type DefaultKind = Exclude<ColumnKind, "media" | "refList">;

/** What `.validate` sees besides the value. */
export interface ValidateCtx {
  /** The whole row being written (insert: data after defaults; update: existing merged with patch). Sub-field validators see the enclosing row. */
  data: Record<string, unknown>;
  user: User | null;
}

/** Editor presentation, independent of stored data and access rules. */
export interface FieldUi {
  label?: string;
  /** Plain text. */
  help?: string;
  placeholder?: string;
  /** Integer percentage, from 1 to 100. */
  width?: number;
}

/**
 * A column definition inside `collection(...)`, `global(...)`, or a structured field.
 * Builders are immutable: each modifier returns a new builder.
 *
 * - `TData`       — the TS value type (select union, `json<T>()`, sub-field shapes, ...)
 * - `TNotNull`    — required: every field is, unless `.optional()`
 * - `THasDefault` — any default (`.default`, `.defaultNow`, `$default`, `$onUpdate`): omittable on create
 * - `TPrimary`    — only the implicit `id`: row ids (`translationOf`, `translations`) take its type
 */
export interface ColumnBuilder<
  TKind extends ColumnKind = ColumnKind,
  TData = unknown,
  TNotNull extends boolean = boolean,
  THasDefault extends boolean = boolean,
  TLocalized extends boolean = false,
  TPrimary extends boolean = boolean,
> {
  readonly [columnBrand]: {
    kind: TKind;
    data: TData;
    notNull: TNotNull;
    hasDefault: THasDefault;
    localized: TLocalized;
    primaryKey: TPrimary;
  };

  /** Replace this field's presentation metadata. Does not affect storage or authorization. */
  ui(options: FieldUi): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;

  /** Per-viewer field rules; omitted operations inherit collection access. */
  access(
    this: ColumnBuilder<Exclude<ColumnKind, "id">, TData, TNotNull, THasDefault, TLocalized, TPrimary>,
    rules: { read?: FieldRule; create?: FieldRule; update?: FieldRule },
  ): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;
  /** Editor visibility only; the compiler checks scalar siblings and operators. */
  showIf(
    this: ColumnBuilder<Exclude<ColumnKind, "id">, TData, TNotNull, THasDefault, TLocalized, TPrimary>,
    condition: SiblingFilter,
  ): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;
  /** Translate this field per locale; other fields sync across the translation group. */
  localized(
    this: ColumnBuilder<"text" | "richText" | "json" | "select" | "group" | "repeater" | "blocks", TData, TNotNull, THasDefault, TLocalized, TPrimary>,
  ): ColumnBuilder<TKind, TData, TNotNull, THasDefault, true, TPrimary>;

  /** The value may be null or left out. Fields are required otherwise. */
  optional(): ColumnBuilder<TKind, TData, false, THasDefault, TLocalized, TPrimary>;
  /**
   * A list: any number of distinct `select()` options, of `media()` ids, or of `ref()` targets. A
   * many-ref holds the target ids in write order; writes replace the whole list.
   */
  many(
    this: ColumnBuilder<"text" | "media" | "integer", TData, TNotNull, THasDefault, TLocalized, TPrimary>,
  ): TKind extends "media"
    ? ColumnBuilder<"mediaList", number[], TNotNull, THasDefault, TLocalized, TPrimary>
    : TKind extends "integer"
      ? ColumnBuilder<"refList", number[], TNotNull, THasDefault, TLocalized, TPrimary>
      : ColumnBuilder<"select", TData[], TNotNull, THasDefault, TLocalized, TPrimary>;
  /** Maps this TypeScript field to an existing physical SQL column name with zero DDL. */
  column(physicalName: string): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;
  /** Accepts an old API/filter field name as an alias during field renames. */
  alias(oldName: string): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;
  /** SQL `DEFAULT value` (a constant; arrays/objects for list and structured columns). */
  default(
    this: ColumnBuilder<DefaultKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>,
    value: TData,
  ): ColumnBuilder<TKind, TData, TNotNull, true, TLocalized, TPrimary>;
  /** Current time (timestamp) or today (date) as the SQL default. */
  defaultNow(
    this: ColumnBuilder<"timestamp" | "date", TData, TNotNull, THasDefault, TLocalized, TPrimary>,
  ): ColumnBuilder<TKind, TData, TNotNull, true, TLocalized, TPrimary>;
  /** Computed in PHP on insert. */
  $default(
    this: ColumnBuilder<DefaultKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>,
    fn: () => GeneratedValue<TKind, TData>,
  ): ColumnBuilder<TKind, TData, TNotNull, true, TLocalized, TPrimary>;
  /**
   * Computed in PHP on update (`() => new Date()` on a timestamp means "now").
   * Like Drizzle, it also counts as a default for inserts. Not allowed on sub-fields.
   */
  $onUpdate(
    this: ColumnBuilder<DefaultKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>,
    fn: () => GeneratedValue<TKind, TData>,
  ): ColumnBuilder<TKind, TData, TNotNull, true, TLocalized, TPrimary>;
  /** Unique text columns also need `.max(n)` with n ≤ 191 (MySQL index limit). Not allowed on sub-fields or globals. */
  unique(this: ColumnBuilder<UniqueKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;
  /**
   * What deleting the referenced row does: `restrict` (the default when required), `setNull` (the
   * default when optional) or `cascade`. On `ref().many()`: `cascade` (the default) removes the link,
   * `restrict` refuses the delete while links exist. `ref()` fields only.
   */
  onDelete(
    action: TKind extends "refList" ? "cascade" | "restrict" : "cascade" | "restrict" | "setNull",
  ): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;
  /** The name of the list of referencing rows on the target. Default: the referencing kind's name. `ref()` fields only. */
  reverse(name: string): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;

  /** Numbers: inclusive lower bound. text/email/url/slug/richText: length in code points. repeater/mediaList/select(multiple)/blocks: item count. */
  min(this: ColumnBuilder<BoundedKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>, n: number): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;
  /** Numbers: inclusive upper bound. text/email/url/slug/richText: length in code points. repeater/mediaList/select(multiple)/blocks: item count. */
  max(this: ColumnBuilder<BoundedKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>, n: number): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;
  /** Strings only. A RegExp literal; compiled to PCRE at build time. */
  pattern(this: ColumnBuilder<PatternKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>, re: RegExp): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;
  /**
   * Custom validation, compiled to PHP, run after type coercion on every write (REST, db, CLI, wp-admin).
   * Return `true`/nothing to accept, or a string to reject with that message (422 invalid_input, pointer /<col>).
   * Throwing `HttpError` also works.
   */
  validate(
    fn: (value: NonNullable<TData>, ctx: ValidateCtx) => true | string | void,
  ): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;
}

export type AnyColumnBuilder = ColumnBuilder<ColumnKind, unknown, boolean, boolean, boolean, boolean>;

/**
 * A column of a defined collection, e.g. `locations.id`.
 * Used as the target of `.references(() => locations.id)`.
 * Annotate a self/circular reference as `(): AnyColumn => table.col`.
 */
export interface Column<
  TKind extends ColumnKind = ColumnKind,
  TData = unknown,
  TNotNull extends boolean = boolean,
  THasDefault extends boolean = boolean,
  TTable extends string = string,
  TName extends string = string,
> {
  readonly [columnBrand]: {
    kind: TKind;
    data: TData;
    notNull: TNotNull;
    hasDefault: THasDefault;
  };
  /** Table name. */
  readonly table: TTable;
  /** Column (SQL) name. */
  readonly name: TName;
}

export type AnyColumn = Column<ColumnKind, unknown, boolean, boolean, string, string>;

/**
 * A reference to a row of `kind` (its `id`): the field holds the id, `with: { field: true }` loads the
 * row in its place, and `kind` gets a list of the referencing rows named after this kind. Pass
 * `() => kind` for a kind declared later or for the kind itself.
 */
export declare function ref(kind: AnyCollection | (() => AnyCollection)): ColumnBuilder<"integer", number, true, false>;
/** Every field is required unless `.optional()`; `.default()` or `.defaultNow()` make it omittable on create. */
export declare function integer(): ColumnBuilder<"integer", number, true, false>;
/** Any finite number (a double). */
export declare function number(): ColumnBuilder<"number", number, true, false>;
/** Single line by default; `multiline: true` is a textarea in editors. */
export declare function text(config?: { multiline?: boolean }): ColumnBuilder<"text", string, true, false>;
/** Stored as INTEGER 0/1. */
export declare function boolean(): ColumnBuilder<"boolean", boolean, true, false>;
/** TEXT `YYYY-MM-DD`. */
export declare function date(): ColumnBuilder<"date", string, true, false>;
/** TEXT, UTC ISO-8601 with milliseconds. */
export declare function timestamp(): ColumnBuilder<"timestamp", string, true, false>;
/** TEXT holding JSON of type `T`: `json<string[]>()`. */
export declare function json<T = unknown>(): ColumnBuilder<"json", T, true, false>;

/** An email address (validated). TEXT. */
export declare function email(): ColumnBuilder<"email", string, true, false>;
/** An absolute `http(s)://` URL (validated). TEXT. */
export declare function url(): ColumnBuilder<"url", string, true, false>;
/**
 * URL-safe identifier: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 200 characters, unique. With `source`
 * (a text column of the same collection), an omitted slug is derived from it ("-2", "-3" ... until
 * unique). At most one per collection; not allowed in sub-fields or globals.
 */
export declare function slug(config?: { source?: undefined }): ColumnBuilder<"slug", string, true, false>;
/** With `source`, an omitted slug is derived, so it may be left out on create. */
export declare function slug(config: { source: string }): ColumnBuilder<"slug", string, true, true>;
/** A private-file id in the named bucket. */
export declare function file(bucket: FileBucket): ColumnBuilder<"file", number, true, false>;

/** HTML. On WordPress the `content`-designated richText is the block editor's post_content. */
export declare function richText(): ColumnBuilder<"richText", string, true, false>;
/** A media id (the built-in `media` collection); `.many()` for a list. `with: { <col>: true }` populates it in place. */
export declare function media(config?: { accept?: "image" | "any" }): ColumnBuilder<"media", number, true, false>;
/** One of `options`; `.many()` for any number of them, stored as a JSON array and filtered with `{ has: option }`. */
export declare function select<const TOptions extends readonly [string, ...string[]]>(
  options: TOptions,
): ColumnBuilder<"text", TOptions[number], true, false>;

/**
 * Sub-fields of `group`/`repeater`/`blocks` layouts and globals. Builders are the column builders;
 * the compiler rejects slug(), blocks(), .unique(), .references() and .$onUpdate() inside them,
 * and nesting deeper than 3.
 */
export type FieldsConfig = Record<string, AnyColumnBuilder>;

/** One object with fixed sub-fields (absent optional sub-fields read as null). */
export declare function group<F extends FieldsConfig>(fields: F): ColumnBuilder<"group", SelectShape<F>, true, false, HasLocalized<F>>;
/** A list of objects with the same sub-fields. `.min/.max` count items. */
export declare function repeater<F extends FieldsConfig>(fields: F): ColumnBuilder<"repeater", SelectShape<F>[], true, false, HasLocalized<F>>;
/** Flexible content: a list of items, each `{ layout, ...that layout's fields }`, one entry per layout. */
export declare function blocks<L extends Record<string, FieldsConfig>>(
  layouts: L,
): ColumnBuilder<"blocks", BlockValue<L>[], true, false, HasLocalized<L[keyof L]>>;

/** One `blocks()` item: discriminated by `layout`. */
export type BlockValue<L extends Record<string, FieldsConfig>> = {
  [K in keyof L & string]: Simplify<{ layout: K } & SelectShape<L[K]>>;
}[keyof L & string];

/** Select type of one column: nullable unless NOT NULL. */
type SelectValue<C> = C extends { readonly [columnBrand]: { data: infer D; notNull: infer N } }
  ? N extends true
    ? D
    : D | null
  : never;

/** Keys whose value must be provided on insert. */
type RequiredInsertKeys<TCols> = {
  [K in keyof TCols]: TCols[K] extends {
    readonly [columnBrand]: { notNull: true; hasDefault: false };
  }
    ? K
    : never;
}[keyof TCols];

/**
 * Write form of a structured value (group/repeater/blocks): sub-fields that read as nullable may be
 * omitted (they are stored as null, or their default). NOT NULL sub-fields with a default stay
 * required here; the runtime would accept them absent.
 */
type WriteStructured<D> = D extends readonly (infer I)[]
  ? WriteStructured<I>[]
  : D extends object
    ? Simplify<
        { [K in keyof D as null extends D[K] ? never : K]: WriteStructured<D[K]> } & {
          [K in keyof D as null extends D[K] ? K : never]?: WriteStructured<D[K]>;
        }
      >
    : D;

/** Insert/patch type of one column. */
type InsertValue<C> = C extends { readonly [columnBrand]: { kind: "group" | "repeater" | "blocks" } }
  ? WriteStructured<SelectValue<C>>
  : SelectValue<C>;

type InsertShape<TCols> = Simplify<
  { [K in RequiredInsertKeys<TCols>]: InsertValue<TCols[K]> } & {
    [K in Exclude<keyof TCols, RequiredInsertKeys<TCols>>]?: InsertValue<TCols[K]>;
  }
>;

type SelectShape<TCols> = Simplify<{ [K in keyof TCols]: SelectValue<TCols[K]> }>;

// ---------------------------------------------------------------------------
// 3. Collections
// ---------------------------------------------------------------------------

export type ColumnsConfig = Record<string, AnyColumnBuilder>;

/** Lifecycle of a row in a drafts collection. */
export type Status = "draft" | "published" | "scheduled";

/**
 * System columns added to every drafts collection (`drafts` defaults to `editor !== false`).
 * Plain columns to hooks, `db`, filters and `orderBy`. API-created rows default to `published`.
 */
export type DraftColumns = {
  status: ColumnBuilder<"text", Status, true, true>;
  publishedAt: ColumnBuilder<"timestamp", string, false, false>;
};

type ColumnKindOf<C> = C extends { readonly [columnBrand]: { kind: infer K } } ? K : never;
type ColumnNotNull<C> = C extends { readonly [columnBrand]: { notNull: infer N } } ? N : never;
/** Column names of `TCols` whose builder is `kind` (and NOT NULL when `notNull`). */
type ColumnsOfKind<TCols, TKind extends ColumnKind, TNotNull extends boolean = boolean> = {
  [K in keyof TCols]: [ColumnKindOf<TCols[K]>] extends [TKind]
    ? [ColumnNotNull<TCols[K]>] extends [TNotNull]
      ? K
      : never
    : never;
}[keyof TCols] &
  string;

/** How comments behave on a collection (`comments: true` is every default). */
export interface CommentOptions {
  /** Anonymous visitors may comment, with a name and email. Default `false`: signed-in users only. */
  guests?: boolean;
  /** `"none"` approves at once; `"first-time"` (default) holds a commenter's first comment; `"all"` holds every one. */
  moderation?: "none" | "first-time" | "all";
  /** Reply depth: `true` (default) is 3 levels, `false` is flat, or a depth from 1 to 10. */
  threaded?: boolean | number;
  /** Close comments this many days after the item was published. Default: never. */
  closeAfterDays?: number | null;
  /** Comment types allowed besides normal comments. Not built yet: leave it out. */
  types?: readonly [];
}

/** Admin presentation options for a collection or table. */
export interface KindUi<TCol extends string = string> {
  /** Icon name (e.g. `"post"`, `"page"`, `"table"`, `"store"`, `"globe"`) or a `dashicons-*` name. */
  icon?: string;
  /** Singular label used on create buttons (e.g. `"Doc"` → `"New Doc"`). */
  singularLabel?: string;
  /** Short subtitle shown under the collection title in TypedPress Admin. */
  description?: string;
  /** Optional sidebar section/group override. */
  group?: string;
  /** Default visible columns in the admin table view (excluding the primary title column). */
  defaultColumns?: readonly TCol[];
  /** Hide this kind from the default admin sidebar (route remains accessible). */
  hidden?: boolean;
}

/** Admin presentation options for a global. */
export interface GlobalUi {
  icon?: string;
  description?: string;
  group?: string;
  hidden?: boolean;
}

/** Options shared by the `collection()` signatures; `T` is the collection being defined. */
export interface CollectionOptions<T extends AnyCollection = AnyCollection> {
  /** Physical resource name, without prefixes. Defaults to the registry key in snake_case.
   * Keep this binding when upgrading existing storage; changing it does not rename data. */
  storageName?: string;
  /** Bind table() to an already existing SQL table, without adding any prefix.
   * The first migration checks its columns; it never creates or copies this table. */
  existingTable?: string;
  /** Project-relative Markdown/JSON files; implies uid: true. A `**` folder before the file pattern (`content/docs/` then `**` then `/*.md`) reads a folder tree into a hierarchical collection. */
  sync?: `${string}/*.md` | `${string}/*.json`;
  /** Items nest like WordPress Pages: adds `parent` and `order`, and `:path` in `url` is the parent chain. collection() only. */
  hierarchical?: boolean;
  uid?: boolean;
  /** Expose through WordPress abilities/MCP. Default true. */
  agents?: boolean;
  /** Shown in wp-admin menus and the typed client docs. */
  label?: string;
  /** Admin presentation options (icon, singularLabel, description, group, defaultColumns, hidden). */
  ui?: KindUi<keyof ColumnsOf<T> & string>;
  /**
   * The item URL, one pattern for incoming URLs and outgoing links: `"/blog/:slug"`. It starts with a
   * literal segment. Placeholders are `:slug`, `:id`, `:year`/`:month`/`:day`/`:publishedAt`, a required
   * field everyone can read (`:topic`), or the slug of a referenced collection anyone reads
   * (`:byline.slug`), each used once; it must include `:slug` or `:id`, and can't overlap another
   * kind's pattern. collection() only.
   */
  url?: `/${string}`;
  /** Native on collections; opt-in publication state on tables. */
  drafts?: boolean;
  /** Keep a revision per write. Default true for collections and tables. */
  revisions?: boolean;
  /** Native soft deletes (Trash on collections, `_live`/`deletedAt` on tables). Default true; set `false` to hard-delete immediately. */
  softDelete?: boolean;
  /** Per-kind retention override (inherits config `retention`, default `"forever"`). */
  retention?: RetentionConfig;
  /**
   * Staged versions: a change to an item saved beside the live one, then compared, promoted or
   * discarded. Default true for collections; `false` turns them off. collection() only.
   */
  staged?: boolean;
  /**
   * WordPress comments on this collection's post type: `true` for the defaults, or `CommentOptions`.
   * Default false: comments are closed on every kind that doesn't turn them on.
   */
  comments?: boolean | CommentOptions;
  /** The WordPress post title: a NOT NULL `text()` column. Default: a text column named `title`. Required for collections. */
  title?: ColumnsOfKind<ColumnsOf<T>, "text", true>;
  /** The WordPress post_content (block editor): a `richText()` column. Default: a richText column named `content`. */
  content?: ColumnsOfKind<ColumnsOf<T>, "richText">;
  /** Who may read and write through the REST API / typed client. Hooks, actions' `db` calls and the CLI are trusted. */
  access?: AccessConfig<T>;
  /** Which REST endpoints exist. All default to `true`. */
  api?: {
    list?: boolean;
    get?: boolean;
    create?: boolean;
    update?: boolean;
    delete?: boolean;
  };
}

/** Metadata every collection carries alongside its column references. */
export type StorageKind = "collection" | "table" | "userProjection" | "taxonomy" | "product" | "order";

export interface CollectionMeta<TName extends string, TCols extends ColumnsConfig, TAuth extends boolean = false, TStorage extends StorageKind = StorageKind> {
  readonly [collectionBrand]: { columns: TCols; auth: TAuth; storage: TStorage };
  /** Row type returned by queries. */
  readonly $inferSelect: SelectShape<TCols>;
  /** Shape accepted by `db.insert(...).values(...)`. */
  readonly $inferInsert: TStorage extends "order" ? never : ("locale" extends keyof TCols ? TranslationInsert<TCols> : InsertShape<TCols>) & (TAuth extends true ? { password?: string } : {});
  /**
   * Hooks on this kind (spec §2.8), in the file that declares it. Returns the kind, so calls chain;
   * several handlers for one event run in order.
   */
  on<TSelf extends AnyCollection>(this: TSelf, hooks: CollectionHooks<TSelf>): TSelf;
  /**
   * A compound index (spec §2.9), on SQL tables; `unique: true` also refuses a second row with the same
   * values. Fields a compiled `where` or `orderBy` names get one each without this.
   */
  index(fields: readonly [keyof TCols & string, ...(keyof TCols & string)[]], options?: { unique?: boolean }): this;
}

type ColumnRefs<TName extends string, TCols extends ColumnsConfig> = {
  readonly [K in keyof TCols & string]: TCols[K] extends ColumnBuilder<
    infer TKind,
    infer TData,
    infer TNotNull,
    infer THasDefault,
    boolean,
    boolean
  >
    ? Column<TKind, TData, TNotNull, THasDefault, TName, K>
    : never;
};

export type Collection<
  TName extends string = string,
  TCols extends ColumnsConfig = ColumnsConfig,
  TAuth extends boolean = false,
  TStorage extends StorageKind = "collection",
> = ColumnRefs<TName, TCols> & CollectionMeta<TName, TCols, TAuth, TStorage>;

export type AnyCollection = CollectionMeta<string, ColumnsConfig, boolean>;

type HasLocalized<TCols> = true extends (TCols extends unknown ? {
  [K in keyof TCols]: TCols[K] extends { readonly [columnBrand]: { localized: infer L } } ? L : false;
}[keyof TCols] : never) ? true : false;

/** Keys of columns translated per locale (`.localized()`); every other column is synced across a group. */
type LocalizedKeys<TCols> = {
  [K in keyof TCols]: TCols[K] extends { readonly [columnBrand]: { localized: true } } ? K : never;
}[keyof TCols];
/** Per-row columns a translation doesn't copy: slugs and the primary key. */
type PerRowKeys<TCols> = {
  [K in keyof TCols]: TCols[K] extends { readonly [columnBrand]: { kind: "slug" } | { primaryKey: true } } ? K : never;
}[keyof TCols];
/** A localized insert: a new row, or a translation (`translationOf`) that copies every synced column, so those may be omitted. */
type TranslationInsert<TCols> =
  | (InsertShape<Omit<TCols, "translations">> & { translationOf?: undefined })
  | Simplify<
      InsertShape<Pick<TCols, (LocalizedKeys<TCols> | "locale") & keyof TCols>> &
        InsertShape<Pick<TCols, PerRowKeys<TCols>>> &
        Partial<InsertShape<Omit<TCols, LocalizedKeys<TCols> | PerRowKeys<TCols> | "locale" | "translations">>> & { translationOf: RowId<TCols> }
    >;
/** The primary key column of `TCols`: the implicit `id`. */
type PrimaryKeyOf<TCols> = {
  [K in keyof TCols]: TCols[K] extends { readonly [columnBrand]: { primaryKey: true } } ? K : never;
}[keyof TCols];
/**
 * The row id type of a collection: its primary key's (a number for the implicit `id`). A builder annotated without
 * the primary-key flag hides which column it is, so then an `id` column's type, else number; `unknown`
 * for an unknown collection.
 */
type RowId<TCols> = string extends keyof TCols
  ? unknown
  : [PrimaryKeyOf<TCols>] extends [never]
    ? "id" extends keyof TCols ? NonNullable<SelectValue<TCols["id"]>> : number
    : NonNullable<SelectValue<TCols[PrimaryKeyOf<TCols>]>>;
type LocaleColumns<TCols> = {
  locale: ColumnBuilder<"text", Locale, true, true>;
  translations: ColumnBuilder<"json", Partial<Record<Locale, RowId<TCols>>>, true, true>;
};
type AuthColumns = { role: ColumnBuilder<"text", Role, true, true> };
type IdentityOptions<TUid extends boolean, TSync extends string | undefined> = { uid?: TUid; sync?: TSync };
type IdentityColumns<TUid extends boolean, TSync extends string | undefined> = TUid extends true
  ? { uid: ColumnBuilder<"text", string, true, true> }
  : TSync extends string ? { uid: ColumnBuilder<"text", string, true, true> } : {};
type TranslatedColumns<TCols> = HasLocalized<TCols> extends true ? LocaleColumns<TCols> : {};

/** Automatic system fields present on every collection() and table() unless declared explicitly. */
export type SystemColumns = {
  author: ColumnBuilder<"integer", number, false, true>;
  createdAt: ColumnBuilder<"timestamp", string, true, true>;
  updatedAt: ColumnBuilder<"timestamp", string, true, true>;
};

/** Soft-delete system fields present when `softDelete !== false` (the default). */
export type SoftDeleteColumns = {
  deletedAt: ColumnBuilder<"timestamp", string, false, true>;
  deletedBy: ColumnBuilder<"integer", number, false, true>;
};

/** The implicit integer `id` every kind has. */
type WithId<TCols extends ColumnsConfig> = [PrimaryKeyOf<TCols>] extends [never]
  ? "id" extends keyof TCols ? TCols : TCols & { id: ColumnBuilder<"id", number, true, true, false, true> }
  : TCols;
type WithSystem<TCols extends ColumnsConfig> = TCols & Omit<SystemColumns, keyof TCols> & Omit<SoftDeleteColumns, keyof TCols>;
type StoredColumns<TCols extends ColumnsConfig, TUid extends boolean, TSync extends string | undefined> = WithId<TCols> & Omit<SystemColumns, keyof TCols> & Omit<SoftDeleteColumns, keyof TCols> & IdentityColumns<TUid, TSync> & TranslatedColumns<TCols>;

/** WordPress posts, native editor, drafts and revisions. Registry key supplies identity. */
export declare function collection<
  TCols extends ColumnsConfig, TUid extends boolean = false, TSync extends string | undefined = undefined,
>(fields: TCols,
  options?: NoInfer<CollectionOptions<Collection<string, StoredColumns<TCols, TUid, TSync> & DraftColumns>>> & { drafts?: true; revisions?: true } & IdentityOptions<TUid, TSync>,
): Collection<string, StoredColumns<TCols, TUid, TSync> & DraftColumns>;

/** Relational application data in its own SQL table, regardless of field names. */
export declare function table<
  TCols extends ColumnsConfig, TUid extends boolean = false, TSync extends string | undefined = undefined,
>(fields: TCols,
  options: NoInfer<CollectionOptions<Collection<string, StoredColumns<TCols, TUid, TSync> & DraftColumns, false, "table">>> & { drafts: true } & IdentityOptions<TUid, TSync>,
): Collection<string, StoredColumns<TCols, TUid, TSync> & DraftColumns, false, "table">;
export declare function table<
  TCols extends ColumnsConfig, TUid extends boolean = false, TSync extends string | undefined = undefined,
>(fields: TCols,
  options?: NoInfer<CollectionOptions<Collection<string, StoredColumns<TCols, TUid, TSync>, false, "table">>> & { drafts?: false } & IdentityOptions<TUid, TSync>,
): Collection<string, StoredColumns<TCols, TUid, TSync>, false, "table">;

/** One projection over existing wp_users/wp_usermeta, never a post or a second user table. */
export declare function userProjection<TCols extends ColumnsConfig, TUid extends boolean = false>(fields: TCols,
  options?: NoInfer<CollectionOptions<Collection<string, WithId<TCols> & AuthColumns & IdentityColumns<TUid, undefined>, true, "userProjection">>> & { drafts?: false; revisions?: false; uid?: TUid },
): Collection<string, WithId<TCols> & AuthColumns & IdentityColumns<TUid, undefined>, true, "userProjection">;

/** The fields every `wp.posts` kind has, stored in the post itself. `slug` follows `title` until set. */
type PostColumns = {
  title: ColumnBuilder<"text", string, true, false>;
  slug: ColumnBuilder<"slug", string, true, true>;
  content: ColumnBuilder<"richText", string, false, false>;
  excerpt: ColumnBuilder<"text", string, false, false>;
};
/** An authored field may not take a name posts already have. */
type PostFields = ColumnsConfig & { [K in keyof PostColumns | keyof DraftColumns | "id"]?: never };
type PostKind<TCols extends ColumnsConfig, TUid extends boolean, TSync extends string | undefined> =
  Collection<string, StoredColumns<PostColumns & TCols, TUid, TSync> & DraftColumns>;
/** Options a `wp.posts` kind takes: comments are on unless `comments: false`. */
type PostOptions<T extends AnyCollection> = Pick<CollectionOptions<T>, "url" | "comments" | "access" | "label" | "ui" | "sync" | "uid" | "agents" | "api" | "staged" | "softDelete" | "retention">;

/**
 * WordPress's own kinds. `wp.posts` is WordPress's posts: the block editor, comments, drafts, revisions,
 * categories and tags are WordPress's, and its capabilities decide who writes; `access` only narrows them.
 */
export declare const wp: {
  readonly posts: {
    /**
     * WordPress's posts with the app's fields (post meta `tp_<field>`), exported as `posts`:
     * `export const posts = wp.posts.extend({ cover: media().optional() }, { url: "/blog/:slug" })`.
     * `url` is required: it is each post's address, through WordPress's `post_link`.
     */
    extend<TCols extends PostFields = {}, TSync extends string | undefined = undefined>(
      fields: TCols,
      options: NoInfer<PostOptions<PostKind<TCols, TSync extends string ? true : false, TSync>>> & { url: `/${string}`; sync?: TSync },
    ): PostKind<TCols, TSync extends string ? true : false, TSync>;
    /**
     * Another kind shaped like posts, with its own rows (post type `tp_<name>`): title, slug, content,
     * excerpt, comments, drafts and revisions, plus the given fields.
     */
    clone<TCols extends PostFields = {}, TSync extends string | undefined = undefined>(
      fields: TCols,
      options?: NoInfer<PostOptions<PostKind<TCols, TSync extends string ? true : false, TSync>>> & { sync?: TSync; storageName?: string },
    ): PostKind<TCols, TSync extends string ? true : false, TSync>;
  };
};

/** A term's own fields (docs/decisions/2026-11-11-authoring-surface.md, ruling 27). */
type TermColumns<THierarchical extends boolean> = {
  name: ColumnBuilder<"text", string, true, false>;
  slug: ColumnBuilder<"slug", string, true, true>;
  description: ColumnBuilder<"text", string, true, true>;
  count: ColumnBuilder<"integer", number, true, true>;
  url: ColumnBuilder<"text", string, false, true>;
} & (THierarchical extends true ? { parent: ColumnBuilder<"integer", number, false, false> } : {});

/** Field builders a term field takes in this release: no containers, rich text, files or lists of refs. */
type TermFieldKind = Exclude<ColumnKind, "richText" | "file" | "group" | "repeater" | "blocks" | "slug" | "mediaList" | "refList">;
type TermFields = Record<string, ColumnBuilder<TermFieldKind, any, boolean, boolean, false, boolean>>;

/** `taxonomy()` options (rulings 25-32). */
export interface TaxonomyOptions<T extends AnyCollection = AnyCollection, THierarchical extends boolean = boolean> {
  /** Markdown/JSON source with persistent term UIDs, using the normal seed and sync workflow. */
  sync?: string;
  agents?: boolean;
  /** Stored as `tp_<storageName>`: at most 26 characters. Defaults to the export name in snake_case. */
  storageName?: string;
  /** Shown in wp-admin. */
  label?: string;
  /** Terms nest: adds `parent`, and `:path` in `url` is the chain of ancestor slugs. */
  hierarchical?: THierarchical;
  /** The term URL: `:slug`, `:id` and, hierarchical, `:path`. With one, core's sitemap lists the terms and a term has an archive. */
  url?: `/${string}`;
  /** The app's collections whose items carry these terms, in a field named after this export. */
  on?: readonly AnyCollection[];
  /** With `locales` set, `false` is required: one vocabulary shared by every locale. */
  translations?: false;
  /** Default: anyone reads, `editor` creates, updates and deletes. Assigning terms is a write to the item. */
  access?: AccessConfig<T>;
}

/** A taxonomy: terms in WordPress's term tables, with term meta fields, attached to collections. */
export declare function taxonomy<TFields extends TermFields = {}, THierarchical extends boolean = false, TSync extends string | undefined = undefined>(
  fields?: TFields,
  options?: NoInfer<TaxonomyOptions<Collection<string, WithId<TFields> & TermColumns<THierarchical> & IdentityColumns<false, TSync>, false, "taxonomy">>> & { hierarchical?: THierarchical; sync?: TSync },
): Collection<string, WithId<TFields> & TermColumns<THierarchical> & IdentityColumns<false, TSync>, false, "taxonomy">;

/**
 * An item's terms of `taxonomy`: the term ids in write order (`[]` when none), kept as WordPress's
 * term relationships. `with: { field: true }` loads the term rows, and the taxonomy gets a list of the
 * items named after this kind. The same field `on` adds, under another name or with `.access()`,
 * `.ui()` or `.reverse()`; the build refuses any other modifier.
 */
export declare function terms(taxonomy: CollectionMeta<string, ColumnsConfig, false, "taxonomy"> | (() => CollectionMeta<string, ColumnsConfig, false, "taxonomy">)): ColumnBuilder<"refList", number[], true, true, false, false>;

type ColumnsOf<T> = T extends { readonly [collectionBrand]: { columns: infer C } } ? C : never;

export type InferSelectModel<T extends AnyCollection> = T["$inferSelect"];
export type InferInsertModel<T extends AnyCollection> = T["$inferInsert"];

/** A flat relation graph assembled from the explicit registries. */
export type Schema = Record<string, AnyCollection>;

// ---------------------------------------------------------------------------
// 4. Relations
// ---------------------------------------------------------------------------


export interface One<TTarget extends string = string, TOptional extends boolean = boolean> {
  readonly [relationBrand]: { kind: "one"; target: TTarget; optional: TOptional };
}

export interface Many<TTarget extends string = string> {
  readonly [relationBrand]: { kind: "many"; target: TTarget };
}

export type AnyRelation = One | Many;



export type RelationsConfig<TSchema extends Schema> = {
  [K in keyof TSchema]?: Record<string, AnyRelation>;
};

/** The kinds and their relations, as `typedpress build` registers them in tp/_generated/db.d.ts. */
export interface Relations<
  TSchema extends Schema = Schema,
  TConfig extends RelationsConfig<TSchema> = RelationsConfig<TSchema>,
> {
  readonly [relationsBrand]: { schema: TSchema; config: TConfig };
}


/** Relations declared for collection `K` (empty when none). */
type RelationsOf<TRels, K> = K extends keyof TRels
  ? NonNullable<TRels[K]> extends infer R extends Record<string, AnyRelation>
    ? R
    : {}
  : {};

type TargetOf<R> = R extends { readonly [relationBrand]: { target: infer T } } ? T : never;

// ---------------------------------------------------------------------------
// 5. Filters, ordering, column selection (Drizzle 1.0 object filters)
// ---------------------------------------------------------------------------

/** Operators for one field. A bare value means `eq`. */
export interface FieldOperators<T> {
  eq?: T;
  ne?: T;
  gt?: T;
  gte?: T;
  lt?: T;
  lte?: T;
  in?: T[];
  notIn?: T[];
  like?: string;
  ilike?: string;
  notLike?: string;
  notIlike?: string;
  isNull?: true;
  isNotNull?: true;
  NOT?: FieldFilter<T>;
  OR?: FieldFilter<T>[];
  AND?: FieldFilter<T>[];
}

/** Unwrap branded Id<Kind> in filters so plain numbers (e.g. `Number(params.id)`) match. */
type FilterValue<T> = T extends Id<any> ? number : T;

/** A field condition: a bare (non-object) value or an operator object. */
export type FieldFilter<T> = FieldOperators<FilterValue<T>> | (FilterValue<T> extends object ? never : FilterValue<T>);

/** List columns (`mediaList`, `select({ multiple })`): membership, emptiness, null. No `in`/`like`/ordering. */
export interface ListOperators<TItem> {
  /** Rows whose list contains this item. */
  has?: TItem;
  /** Only the empty list. */
  eq?: [];
  isNull?: true;
  isNotNull?: true;
}

/** JSON-valued columns (`json`, `group`, `repeater`, `blocks`): whole-value equality and null only. */
export interface JsonOperators<T> {
  eq?: T;
  ne?: T;
  isNull?: true;
  isNotNull?: true;
}

/** The filter one column accepts, by kind (design §3.5). */
type ColumnFilter<C> = C extends { readonly [columnBrand]: { kind: infer K; data: infer D } }
  ? K extends "mediaList" | "select" | "refList"
    ? ListOperators<D extends readonly (infer I)[] ? I : never>
    : K extends "json" | "group" | "repeater" | "blocks"
      ? JsonOperators<NonNullable<D>>
      : FieldFilter<NonNullable<D>>
  : never;

type ColumnFilters<TCols> = {
  [K in keyof TCols]?: ColumnFilter<TCols[K]>;
};

/** Column-only filter (used by `update().where` / `delete().where`). */
export type TableFilter<T extends AnyCollection> = ColumnFilters<ColumnsOf<T>> & {
  OR?: TableFilter<T>[];
  AND?: TableFilter<T>[];
  NOT?: TableFilter<T>;
};

/** Relational filter for `findMany`/`findFirst`: columns, relations, OR/AND/NOT. */
export type RelationsFilter<
  TSchema extends Schema,
  TRels,
  K extends keyof TSchema,
> = Omit<ColumnFilters<ColumnsOf<TSchema[K]>>, keyof RelationsOf<TRels, K>> & {
  // A `ref()` field filters its id, or the row it refers to.
  [R in keyof RelationsOf<TRels, K>]?:
    | boolean
    | (R extends keyof ColumnFilters<ColumnsOf<TSchema[K]>> ? ColumnFilters<ColumnsOf<TSchema[K]>>[R] : never)
    | RelationsFilter<TSchema, TRels, TargetOf<RelationsOf<TRels, K>[R]> & keyof TSchema>;
} & {
  OR?: RelationsFilter<TSchema, TRels, K>[];
  AND?: RelationsFilter<TSchema, TRels, K>[];
  NOT?: RelationsFilter<TSchema, TRels, K>;
};

/** Columns that can be ordered: everything but list and JSON-valued columns. */
type OrderableKeys<TCols> = {
  [K in keyof TCols]: ColumnKindOf<TCols[K]> extends "mediaList" | "select" | "refList" | "json" | "group" | "repeater" | "blocks" ? never : K;
}[keyof TCols];

export type OrderBy<T extends AnyCollection> = {
  [K in OrderableKeys<ColumnsOf<T>>]?: "asc" | "desc";
};

/** `columns: { name: true }` picks; all-`false` omits. */
export type ColumnsSelection<T extends AnyCollection> = {
  [K in keyof ColumnsOf<T>]?: boolean;
};

// ---------------------------------------------------------------------------
// 6. Relational query config and results
// ---------------------------------------------------------------------------

/** Config for a nested `with` entry. */
export interface NestedQueryConfig<
  TSchema extends Schema,
  TRels,
  K extends keyof TSchema,
  TKind extends "one" | "many",
> {
  locale?: Locale | "*";
  columns?: ColumnsSelection<TSchema[K]>;
  with?: WithConfig<TSchema, TRels, K>;
  where?: RelationsFilter<TSchema, TRels, K>;
  orderBy?: OrderBy<TSchema[K]>;
  offset?: number;
  limit?: TKind extends "many" ? number : never;
}

type RelationKind<R> = R extends { readonly [relationBrand]: { kind: infer K } } ? K : never;

/** The `media()` and `file()` columns of kind `K`: `with` puts each one's row in place of its id. */
type LoadableColumns<TSchema extends Schema, K extends keyof TSchema> = ColumnsOfKind<ColumnsOf<TSchema[K]>, "media" | "mediaList" | "file">;

export type WithConfig<TSchema extends Schema, TRels, K extends keyof TSchema> = {
  [R in keyof RelationsOf<TRels, K> | LoadableColumns<TSchema, K>]?: R extends keyof RelationsOf<TRels, K>
    ?
        | boolean
        | NestedQueryConfig<
            TSchema,
            TRels,
            TargetOf<RelationsOf<TRels, K>[R]> & keyof TSchema,
            RelationKind<RelationsOf<TRels, K>[R]> & ("one" | "many")
          >
    : boolean;
};

/** A media item, as `with: { cover: true }` loads it in place of a `media()` column's id. */
export interface MediaRow {
  id: number;
  url: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  filename: string;
  createdAt: string;
  /** The sizes `media.sizes` in `defineConfig` names; empty for a file that is no image. */
  sizes: Record<string, { url: string; width: number; height: number }>;
}

/** A private file, as `with` loads it in place of a `file()` column's id. `url` is signed and valid for five minutes. */
export interface FileRow {
  id: number;
  bucket: string;
  filename: string;
  mime: string;
  size: number;
  ownerId: number | null;
  createdAt: string;
  url: string;
}

/** What `with` puts in place of a media or file column. A file stays its id for a visitor the bucket's read rule refuses. */
type LoadedColumn<C> = ColumnKindOf<C> extends "mediaList"
  ? MediaRow[]
  : ColumnKindOf<C> extends "media"
    ? MediaRow | (ColumnNotNull<C> extends true ? never : null)
    : ColumnKindOf<C> extends "file"
      ? FileRow | number | (ColumnNotNull<C> extends true ? never : null)
      : never;

type TrueKeys<T> = { [K in keyof T]-?: T[K] extends true ? K : never }[keyof T];
type FalseKeys<T> = { [K in keyof T]-?: T[K] extends false ? K : never }[keyof T];

/** Applies a `columns` selection to a row (Drizzle semantics). */
type PickColumns<TRow, TCols> = [TrueKeys<TCols>] extends [never]
  ? Omit<TRow, FalseKeys<TCols>>
  : Pick<TRow, TrueKeys<TCols> & keyof TRow>;

type ColumnsArg<V> = V extends { columns: infer C } ? C : {};
type WithArg<V> = V extends { with: infer W } ? W : {};

type RelationResult<TSchema extends Schema, TRels, TRel, V> =
  TRel extends One<infer T, infer TOptional>
    ?
        | QueryRow<TSchema, TRels, T & keyof TSchema, ColumnsArg<V>, WithArg<V>>
        | (TOptional extends false ? never : null)
    : TRel extends Many<infer T>
      ? QueryRow<TSchema, TRels, T & keyof TSchema, ColumnsArg<V>, WithArg<V>>[]
      : never;

type WithResult<TSchema extends Schema, TRels, K extends keyof TSchema, TWith> = {
  [W in keyof TWith as TWith[W] extends false | undefined ? never : W]: W extends keyof RelationsOf<
    TRels,
    K
  >
    ? RelationResult<TSchema, TRels, RelationsOf<TRels, K>[W], TWith[W]>
    : W extends keyof ColumnsOf<TSchema[K]>
      ? LoadedColumn<ColumnsOf<TSchema[K]>[W]>
      : never;
};

/** One row of `db.query.<K>` given its `columns` and `with`. */
/** A `ref()` field loaded by `with` holds the row in place of its id. */
export type QueryRow<TSchema extends Schema, TRels, K extends keyof TSchema, TCols, TWith> = Simplify<
  Omit<PickColumns<TSchema[K]["$inferSelect"], TCols>, keyof WithResult<TSchema, TRels, K, TWith>> &
    WithResult<TSchema, TRels, K, TWith>
>;

export interface CollectionQuery<TSchema extends Schema, TRels, K extends keyof TSchema> {
  findMany<
    TCols extends ColumnsSelection<TSchema[K]> = {},
    TWith extends WithConfig<TSchema, TRels, K> = {},
  >(config?: {
    locale?: Locale | "*";
    deleted?: DeletedMode;
    where?: RelationsFilter<TSchema, TRels, K>;
    orderBy?: OrderBy<TSchema[K]>;
    limit?: number;
    offset?: number;
    columns?: TCols;
    with?: TWith;
  }): Promise<QueryRow<TSchema, TRels, K, TCols, TWith>[]>;

  findFirst<
    TCols extends ColumnsSelection<TSchema[K]> = {},
    TWith extends WithConfig<TSchema, TRels, K> = {},
  >(config?: {
    locale?: Locale | "*";
    deleted?: DeletedMode;
    where?: RelationsFilter<TSchema, TRels, K>;
    orderBy?: OrderBy<TSchema[K]>;
    offset?: number;
    columns?: TCols;
    with?: TWith;
  }): Promise<QueryRow<TSchema, TRels, K, TCols, TWith> | undefined>;
}

// ---------------------------------------------------------------------------
// 7. Registry
// ---------------------------------------------------------------------------

/**
 * `db` is imported, not constructed, so it learns your schema through this
 * interface. `typedpress build` writes the augmentation into `tp/_generated/db.d.ts`:
 *
 * ```ts
 * import type { relations } from "./typedpress.config";
 * declare module "typedpress" {
 *   interface Register { relations: typeof relations }
 * }
 * ```
 *
 * `typedpress build` emits the kinds and globals structurally, with the relation graph, so
 * nothing imports the sources that export them; localized projects also register their locale
 * union.
 */
export interface Register {}

type RegisteredSchema = Register extends { relations: Relations<infer S, any> } ? S : never;

type RegisteredRelations = Register extends { relations: Relations<any, infer C> } ? C : {};

type KindListOptions<TSchema extends Schema, TRels, K extends keyof TSchema, TCols, TWith> = {
  locale?: Locale | "*";
  /** Soft-delete filter: `"exclude"` (default), `"include"`, or `"only"`. Non-default modes require `restore` or `delete` access. */
  deleted?: DeletedMode;
  where?: RelationsFilter<TSchema, TRels, K>;
  orderBy?: OrderBy<TSchema[K]>;
  /** A case-insensitive match on the kind's title, content and text fields the visitor may read. */
  search?: string;
  limit?: number;
  columns?: TCols;
  with?: TWith;
};

export type RevisionOp = "create" | "update" | "delete" | "restore" | "purge";

export interface RevisionSummary {
  id: number;
  version: number;
  op: RevisionOp;
  at: string;
  user: { id: number; name: string } | null;
  schemaMigration: string | null;
  changed: string[] | null;
}

export interface RevisionDiff<TRow = Record<string, unknown>> {
  from: number;
  to: number;
  changes: { field: keyof TRow & string; from: unknown; to: unknown }[];
}

/**
 * The query API of one kind (spec §3), on what `import { posts } from "typedpress:db"` gives you. Every
 * call runs as the visitor the request runs as: access rules, draft visibility and field masks
 * apply. Jobs and signed webhooks run as the system. `posts.system` makes the same calls trusted.
 */
export interface KindApi<TSchema extends Schema, TRels, K extends keyof TSchema> {
  list<TCols extends ColumnsSelection<TSchema[K]> = {}, TWith extends WithConfig<TSchema, TRels, K> = {}>(
    q?: KindListOptions<TSchema, TRels, K, TCols, TWith> & { offset?: number },
  ): Promise<QueryRow<TSchema, TRels, K, TCols, TWith>[]>;
  /** `limit` rows (20 by default, at most 100) after `cursor`; `cursor` is null on the last page. */
  paginate<TCols extends ColumnsSelection<TSchema[K]> = {}, TWith extends WithConfig<TSchema, TRels, K> = {}>(
    q?: KindListOptions<TSchema, TRels, K, TCols, TWith> & { cursor?: string | null },
  ): Promise<{ rows: QueryRow<TSchema, TRels, K, TCols, TWith>[]; cursor: string | null }>;
  /** One row by id or by a filter (`{ slug: "hello" }`); null when no row the visitor may read matches. A kind they may not read at all throws the API's 401/403. */
  get<TCols extends ColumnsSelection<TSchema[K]> = {}, TWith extends WithConfig<TSchema, TRels, K> = {}>(
    target: TSchema[K]["$inferSelect"] extends { id: infer Id } ? Id | RelationsFilter<TSchema, TRels, K> : RelationsFilter<TSchema, TRels, K>,
    q?: { locale?: Locale | "*"; deleted?: DeletedMode; columns?: TCols; with?: TWith },
  ): Promise<QueryRow<TSchema, TRels, K, TCols, TWith> | null>;
  count(q?: { locale?: Locale | "*"; deleted?: DeletedMode; where?: RelationsFilter<TSchema, TRels, K>; search?: string }): Promise<number>;
  create(data: TSchema[K]["$inferInsert"]): Promise<TSchema[K]["$inferSelect"]>;
  /** The updated row; a 404 when no row has that id or the visitor's update rule doesn't cover it. */
  update(id: TSchema[K]["$inferSelect"] extends { id: infer Id } ? Id : never, patch: Partial<TSchema[K]["$inferInsert"]>): Promise<TSchema[K]["$inferSelect"]>;
  /** Soft-deletes the row (when `softDelete` is on, the default) or hard-deletes it; a 404 when no row has that id or the visitor's delete rule doesn't cover it. */
  delete(id: TSchema[K]["$inferSelect"] extends { id: infer Id } ? Id : never): Promise<TSchema[K]["$inferSelect"]>;
  /** Restores a soft-deleted row and any cascade-deleted children sharing its `deletedGroup`. Throws 409 on unique collision. */
  restore(id: TSchema[K]["$inferSelect"] extends { id: infer Id } ? Id : never): Promise<TSchema[K]["$inferSelect"]>;
  /** Permanently deletes a row (active or soft-deleted). Default access is `"system"`. */
  purge(id: TSchema[K]["$inferSelect"] extends { id: infer Id } ? Id : never): Promise<TSchema[K]["$inferSelect"]>;
  /** Native revision history (default ON for both `collection()` and `table()`). */
  readonly revisions: {
    list(id: TSchema[K]["$inferSelect"] extends { id: infer Id } ? Id : never): Promise<RevisionSummary[]>;
    get(id: TSchema[K]["$inferSelect"] extends { id: infer Id } ? Id : never, version: number): Promise<TSchema[K]["$inferSelect"]>;
    diff(id: TSchema[K]["$inferSelect"] extends { id: infer Id } ? Id : never, fromVersion: number, toVersion: number): Promise<RevisionDiff<TSchema[K]["$inferSelect"]>>;
    restore(id: TSchema[K]["$inferSelect"] extends { id: infer Id } ? Id : never, version: number): Promise<TSchema[K]["$inferSelect"]>;
  };
}

/** The app's kinds by registered name: what `import { posts } from "typedpress:db"` gives you. */
export type RegisteredKinds = [RegisteredSchema] extends [never]
  ? {}
  : { readonly [K in keyof RegisteredSchema]: RegisteredSchema[K] & KindApi<RegisteredSchema, RegisteredRelations, K> & { readonly system: KindApi<RegisteredSchema, RegisteredRelations, K> } };

type UnregisteredQuery = {
  readonly [key: string]: "Schema not registered: add tp/_generated/db.d.ts (run `typedpress build`) so `db.query` knows your collections";
};

export type QueryApi = [RegisteredSchema] extends [never]
  ? UnregisteredQuery
  : {
      readonly [K in keyof RegisteredSchema]: CollectionQuery<
        RegisteredSchema,
        RegisteredRelations,
        K
      >;
    };

type RegisteredGlobals = Register extends { globals: infer G } ? G : never;

/** `db.globals.<key>`: trusted reads and writes of one global. Never-written globals read as their defaults. */
export interface GlobalApi<G extends AnyGlobal> {
  get(): Promise<G["$inferSelect"]>;
  update(patch: G["$inferUpdate"]): Promise<G["$inferSelect"]>;
}

export type GlobalsApi = [RegisteredGlobals] extends [never]
  ? { readonly [key: string]: GlobalApi<AnyGlobal> }
  : { readonly [K in keyof RegisteredGlobals]: GlobalApi<RegisteredGlobals[K] & AnyGlobal> };

// ---------------------------------------------------------------------------
// 8. Database API (hooks and actions only)
// ---------------------------------------------------------------------------

type Row<T extends AnyCollection> = T["$inferSelect"];
type Insert<T extends AnyCollection> = T["$inferInsert"];
/** Update patches: any subset of insertable fields. */
type Patch<T extends AnyCollection> = Partial<Omit<Insert<T>, "locale" | "translationOf">>;

/** Awaiting runs the write; `.returning()` yields the affected rows instead. */
export interface WriteQuery<T extends AnyCollection> extends PromiseLike<void> {
  returning(): Promise<Row<T>[]>;
}

export interface InsertBuilder<T extends AnyCollection> {
  values(values: Insert<T> | Insert<T>[]): WriteQuery<T>;
}

export interface UpdateBuilder<T extends AnyCollection> {
  set(patch: Patch<T>): UpdateSetQuery<T>;
}

export interface UpdateSetQuery<T extends AnyCollection> extends WriteQuery<T> {
  where(filter: TableFilter<T>): WriteQuery<T>;
}

export interface DeleteQuery<T extends AnyCollection> extends WriteQuery<T> {
  where(filter: TableFilter<T>): WriteQuery<T>;
}

export interface Database {
  /** Relational queries, keyed by registered logical key. Trusted: every status visible, no access rules. */
  readonly query: QueryApi;
  /** Globals, keyed by the `globals` key in `defineConfig`. */
  readonly globals: GlobalsApi;
  insert<T extends AnyCollection>(collection: T): InsertBuilder<T>;
  update<T extends AnyCollection>(collection: T): UpdateBuilder<T>;
  delete<T extends AnyCollection>(collection: T): DeleteQuery<T>;
}

/** Available inside hooks and actions; forbidden at build-time evaluation. */
export declare const db: Database;

// ---------------------------------------------------------------------------
// 9. Identity and access
// ---------------------------------------------------------------------------

/** The role ladder, lowest first. A role rule admits that role and every role above it. */
export type Role = "guest" | "subscriber" | "author" | "editor" | "admin";

/** Who is calling: the WordPress user (or the typedpress-identity session's user). */
export interface User {
  id: number;
  name: string;
  role: Role;
}

/** The trailing argument of every hook and action handler. */
export type FieldRule = AccessShorthand | ((ctx: FieldAccessCtx) => boolean);
export interface FieldAccessCtx {
  user: User | null;
  op: "read" | "create" | "update";
  data: Record<string, unknown>;
}
/** Scalar sibling conditions (eq/ne/in/isNull/isNotNull), ANDed; top-level OR supported. */
export type SiblingFilter = Record<string, unknown>;

export interface HookCtx<TData = Record<string, unknown>> {
  /** Before-hooks share their data or patch with this value. */
  data?: TData;
  user: User | null;
}

export interface BeforeHookCtx<TData> extends HookCtx<TData> {
  data: TData;
}

export interface AccessCtx<TData = Record<string, unknown>> {
  user: User | null;
  op: "read" | "create" | "update" | "delete" | "restore" | "purge";
  /** create: the incoming row (after defaults, before beforeCreate). update: the patch. Absent otherwise. */
  data?: TData;
}

/**
 * A filter an access function may return: column conditions of the collection, plus relation
 * conditions (`{ author: { userId: ctx.user?.id } }`). A `ref()` field is an integer column and its
 * relation at once, so an integer column also takes a filter on the row it refers to. Relation names
 * and targets aren't known where the collection is defined, so the compiler checks those.
 */
export type AccessFilter<T extends AnyCollection> = {
  [K in keyof ColumnsOf<T>]?: ColumnKindOf<ColumnsOf<T>[K]> extends "integer"
    ? ColumnFilter<ColumnsOf<T>[K]> | { [field: string]: unknown }
    : ColumnFilter<ColumnsOf<T>[K]>;
} & {
  OR?: AccessFilter<T>[];
  AND?: AccessFilter<T>[];
  NOT?: AccessFilter<T>;
} & { [relation: string]: unknown };

/** `"anyone"` includes unauthenticated callers; `"authenticated"` is any user; `"system"` allows trusted/system callers only; a role admits itself and above. */
export type AccessShorthand = boolean | "anyone" | "authenticated" | "self" | "system" | Role;

/**
 * Who may perform an operation. Functions are compiled to PHP; they may read `ctx` and constants,
 * not `db`. Returning a filter restricts the operation to matching rows (other rows 404).
 */
export type AccessRule<T extends AnyCollection = AnyCollection> =
  | AccessShorthand
  | ((ctx: AccessCtx<Partial<Insert<T>>>) => boolean | AccessFilter<T>);

/** Create rules decide on the incoming row: a boolean, never a filter. */
export type CreateAccessRule<T extends AnyCollection = AnyCollection> =
  | AccessShorthand
  | ((ctx: AccessCtx<Partial<Insert<T>>>) => boolean);

/** Defaults: `read: "anyone"`, writes `"editor"`, `restore` inherits `delete`, `purge: "system"`. Readers below editor only see published rows unless `read` is a function. */
export interface AccessConfig<T extends AnyCollection = AnyCollection> {
  read?: AccessRule<T>;
  create?: Exclude<CreateAccessRule<T>, "self">;
  update?: AccessRule<T>;
  delete?: AccessRule<T>;
  restore?: AccessRule<T>;
  purge?: AccessRule<T>;
}

/** Actions and globals have no rows to filter: a shorthand or a boolean function. */
export type GateRule<TData = Record<string, unknown>> = AccessShorthand | ((ctx: AccessCtx<TData>) => boolean);

// ---------------------------------------------------------------------------
// 10. Hooks, actions, globals, config
// ---------------------------------------------------------------------------

/**
 * Throwing from any hook aborts the request and rolls back its writes. Hooks are trusted: `db` calls
 * inside them skip access rules and see every status. The kind API (`posts.create`) runs as the caller
 * only when the write came from an action or a route; on API, editor, CLI and job writes it is trusted
 * too. On WordPress editor saves only the `after*` hooks run. Both rules change
 * (docs/decisions/2026-11-14-api-direction.md, rulings 3 and 4).
 */
export interface CollectionHooks<T extends AnyCollection> {
  /** Mutate `data` or return a replacement. */
  beforeCreate?: (data: Insert<T>, ctx: BeforeHookCtx<Insert<T>>) => Awaitable<Insert<T> | void>;
  afterCreate?: (row: Row<T>, ctx: HookCtx) => Awaitable<void>;
  /** Mutate `patch` or return a replacement. */
  beforeUpdate?: (patch: Patch<T>, existing: Row<T>, ctx: BeforeHookCtx<Patch<T>>) => Awaitable<Patch<T> | void>;
  afterUpdate?: (row: Row<T>, previous: Row<T>, ctx: HookCtx) => Awaitable<void>;
  /**
   * Before a permanent delete; a throw refuses it. Moving an item to WordPress's trash is not a
   * delete (it is an unpublish and runs the update hooks); emptying the trash is. `ctx.user` can be
   * null: WordPress empties its trash on a schedule, with nobody signed in.
   */
  beforeDelete?: (row: Row<T>, ctx: HookCtx) => Awaitable<void>;
  /** After a delete (soft delete when `softDelete` is on, permanent otherwise), in its transaction. */
  afterDelete?: (row: Row<T>, ctx: HookCtx) => Awaitable<void>;
  /** Before a soft-deleted row is restored; a throw refuses it. */
  beforeRestore?: (row: Row<T>, ctx: HookCtx) => Awaitable<void>;
  /** After a soft-deleted row is restored, in its transaction. */
  afterRestore?: (row: Row<T>, ctx: HookCtx) => Awaitable<void>;
  /** Before a row is permanently purged; a throw refuses it. */
  beforePurge?: (row: Row<T>, ctx: HookCtx) => Awaitable<void>;
  /** After a row is permanently purged, in its transaction. */
  afterPurge?: (row: Row<T>, ctx: HookCtx) => Awaitable<void>;
  /** A collection's item became published: created published, updated into it, or its scheduled time came. */
  afterPublish?: (row: Row<T>, ctx: HookCtx) => Awaitable<void>;
}

export type Hooks<TSchema extends Schema> = {
  [K in keyof TSchema]?: CollectionHooks<TSchema[K]>;
};

/** A query's or mutation's input: its handler's first parameter type, `{}` when it takes none. */
type HandlerInput<F> = F extends (input: infer I, ...rest: any[]) => any ? (unknown extends I ? {} : I) : {};

/** A `query()` or `mutation()`: called from the browser by its export name, and from server code. */
export interface Action<TInput = any, TResult = unknown> {
  readonly [actionBrand]: { input: TInput; result: TResult };
  /**
   * From a `"use client"` component: a `fetch` to the function's endpoint, with the REST nonce. From
   * server code: a call as the current caller, with its access check.
   */
  (input: TInput): Promise<Awaited<TResult>>;
}

export type AnyAction = Action<any, unknown>;

/** What `query()` and `mutation()` share. */
interface FunctionOptions<TInput> {
  /** Who may call it. Default `"editor"`. */
  access?: GateRule<TInput>;
  /** Published as an Ability, so agents can call it. Default true. */
  agents?: boolean;
  /**
   * At most this many calls per period, per user (per address when signed out): `"10/min"`, with
   * sec, min, hour or day. A mutation open to `"anyone"` defaults to `"30/min"`; `false` turns it off.
   */
  rateLimit?: `${number}/${"s" | "sec" | "second" | "m" | "min" | "minute" | "h" | "hour" | "d" | "day"}` | false;
}

/**
 * A server function that reads. The input is the handler's parameter type; it may not write (the
 * build refuses a write, in it or in anything it calls), and its Ability is marked read-only.
 * `POST` or `GET <prefix>/actions/<name>`.
 */
export declare function query<F extends (input: any, ctx: HookCtx) => unknown>(
  options: FunctionOptions<HandlerInput<F>>,
  handler: F,
): Action<HandlerInput<F>, Awaited<ReturnType<F>>>;

/**
 * A server function that writes, in one transaction. The input is the handler's parameter type.
 * `POST <prefix>/actions/<name>`.
 */
export declare function mutation<F extends (input: any, ctx: HookCtx) => unknown>(
  options: FunctionOptions<HandlerInput<F>> & {
    idempotent?: boolean;
    /** Deletes or overwrites data: the Ability is annotated `destructive`, so agents confirm first. */
    destructive?: boolean;
    /** Signed webhooks: the caller proves the request with an HMAC instead of an access rule. */
    signature?: { secret: EnvValue; header: string; scheme: "typedpress" | "hmac-sha256" };
  },
  handler: F,
): Action<HandlerInput<F>, Awaited<ReturnType<F>>>;

/** A singleton record (site settings, footer links): `GET/PATCH <prefix>/globals/<name>`, `db.globals.<key>`. */
export interface Global<TName extends string = string, TFields extends FieldsConfig = FieldsConfig> {
  readonly [globalBrand]: { name: TName; fields: TFields };
  readonly $name: TName;
  /** What reads return: unset fields read as their defaults (or null). */
  readonly $inferSelect: SelectShape<TFields>;
  /** What updates accept: any subset of fields. */
  readonly $inferUpdate: Partial<SelectShape<TFields>>;
}

export type AnyGlobal = Global<string, FieldsConfig>;

/**
 * Defines a global, named by its export: `export const settings = global({ ... })`. Fields use the
 * column builders with the sub-field restrictions, and no `.unique()`/`slug()`/`blocks()`; a
 * required field needs a default. Default access: `read: "anyone"`, `update: "editor"`.
 */
export declare function global<TFields extends FieldsConfig>(
  fields: TFields,
  options?: {
    label?: string;
    ui?: GlobalUi;
    agents?: boolean;
    access?: { read?: GateRule<never>; update?: GateRule<Partial<SelectShape<TFields>>> };
  },
): Global<string, TFields>;

/**
 * What `defineConfig` takes. Kinds, globals, file buckets, actions and jobs aren't listed here: each
 * registers by its export, from `typedpress.config.ts` or any file under `tp/` (docs/spec/spec.md §1.1).
 */
export interface ConfigInput<TLocales extends LocalesConfig = LocalesConfig> {
  /** Project name: plugin slug (`typedpress-<name>`), wp-admin menu, client docs. Default: the project directory name. */
  name?: string;
  webhooks?: Webhook[];
  /** Private native forms, queued mail, publication search and server-priced checkout. */
  services?: ServicesConfig;
  /** Import synced content when the standalone plugin starts. Existing editorial content is preserved. */
  seed?: boolean;
  uploads?: UploadsConfig;
  media?: { sizes?: Record<string, { width: number; height?: number; fit?: "cover" | "inside" }> };
  /** Turned off for now: setting it fails the build. */
  locales?: TLocales;
  /** Build-only WordPress plugin dependencies. */
  plugins?: Readonly<Record<string, WordPressPlugin>>;
  /**
   * Ship TypedPress Admin (`typedpress-admin`), the default admin at `/wp-admin/new/`, with the build. Default `true`;
   * `false` leaves only classic wp-admin.
   */
  admin?: boolean;
  /**
   * Keep the site's authors public as WordPress ships them: author archives, `?author=N`, the users
   * sitemap, author names in oEmbed and unauthenticated `/wp/v2/users`. Default `false`: closed, unless
   * the users kind's read rule lets anyone read users.
   */
  publicAuthors?: boolean;
  /**
   * XML-RPC (`xmlrpc.php`, its RSD link and the pingback endpoint) as WordPress ships it. Default `true`.
   * `false` turns it off: every call answers 403 and nothing advertises it, except Jetpack's own
   * `jetpack.*` methods while its connection is loaded.
   */
  xmlrpc?: boolean;
  /**
   * Pingbacks and trackbacks as WordPress ships them: the site's Discussion settings decide whether
   * new posts accept them and whether publishing notifies the sites a post links to. Default `true`.
   * `false` closes them in and out, whatever those settings say.
   */
  pings?: boolean;
  /**
   * Sealed mode: the only code that runs as a plugin is TypedPress's own plugins, the platform plugins,
   * the `plugins` declared here (exact versions, checksums in the committed lock) and `use` plugin
   * packages. Activating anything else is refused; anything else already loaded is reported. A host
   * that mounts TypedPress through the build store can enforce the list before any plugin loads.
   * Default `false`. See docs/sealed.md for what is and isn't guaranteed.
   */
  sealed?: boolean;
  /**
   * Let the running site add collections, globals and fields, each change stored there as a numbered
   * schema version. The build declares the changes listed in `tp/_generated/runtime-schema.json`. Default `false`.
   */
  runtimeSchema?: boolean;
  /**
   * Who renders the public site. Leave it out for the theme (or `tp/app` when it exists); `false`
   * for backend only; an external site's `https://` address to point links, previews and feeds there.
   */
  frontend?: false | `https://${string}` | `http://localhost${string}` | `http://127.0.0.1${string}`;
  /**
   * `"server"` (the default): `tp/app/` pages render on WordPress per request, and a page that
   * exports `prerender = true` is prebuilt. `"static"`: every page is prebuilt, and `typedpress export`
   * writes a site that needs no WordPress to serve it.
   */
  output?: "server" | "static";
  /**
   * Global retention policy for soft-deleted rows and revisions. Default `"forever"` (never auto-purge;
   * WordPress's 30-day `wp_scheduled_delete` is unhooked for TypedPress post types unless configured).
   */
  retention?: RetentionConfig;
  /**
   * Plugin packages, registered in order: `use: [seo({ ... })]`. Each one's capabilities are
   * inferred from its compiled code and granted by the committed `tp/_generated/plugins.lock.json`.
   */
  use?: readonly Plugin[];
}

export interface TypedPressConfig<TLocales extends LocalesConfig = LocalesConfig> {
  readonly [configBrand]: { locales: TLocales };
}

export declare function defineConfig<const TLocales extends LocalesConfig = LocalesConfig>(
  config: ConfigInput<TLocales>,
): TypedPressConfig<TLocales>;

declare const screenBrand: unique symbol;
declare const itemBrand: unique symbol;

/** An `adminScreen()` value: registered by its export, like a kind or an action. */
export interface AdminScreen { readonly [screenBrand]: true }

/** `item("id")`: the field of the row a screen action runs on, compiled to the `{item.id}` placeholder. */
export type ItemRef<P extends string = string> = `{item.${P}}` & { readonly [itemBrand]: P };
export declare function item<const P extends string>(path: P): ItemRef<P>;

/** A DataViews field (docs/admin-screens.md). Its id is its key in `fields`. */
export interface ScreenField {
  label?: string;
  type?: "text" | "integer" | "number" | "boolean" | "datetime" | "array";
  elements?: readonly { value: string | number; label: string }[];
  description?: string;
}

type ScreenFields<F extends string> = { [K in F]: ScreenField };
type ActionInputOf<A> = A extends Action<infer I, any> ? I : never;
/** An action's input where any value may also be `item("field")`. */
type WithItems<T> =
  | ItemRef
  | (T extends readonly (infer E)[] ? readonly WithItems<E>[] : T extends object ? { [K in keyof T]: WithItems<T[K]> } : T);
type ScreenActionInput<A> = { [K in keyof ActionInputOf<A>]: WithItems<ActionInputOf<A>[K]> };

/** One action a screen runs, as the Ability the runtime registers for it (`<app>/<kebab name>`). */
export interface ScreenAction<A extends AnyAction = AnyAction> {
  id: string;
  label: string;
  action: A;
  /** The action's input; `item("field")` takes the row's value with its type. */
  input?: ScreenActionInput<A>;
  /** Defaults to the action's own `destructive`. */
  destructive?: boolean;
  /** A sentence asked before the action runs. */
  confirm?: string;
}

/** A DataViews view: which fields show, and how. */
export interface ScreenViewLayout<F extends string> {
  type?: "table" | "grid" | "list";
  fields?: readonly F[];
  titleField?: F;
  mediaField?: F;
  descriptionField?: F;
  sort?: { field: F; direction: "asc" | "desc" };
  perPage?: number;
  layout?: Record<string, unknown>;
}

/** A DataForm form: fields, or groups of them. */
export interface ScreenFormLayout<F extends string> {
  type?: "regular" | "panel" | "card";
  fields?: readonly (F | { id: string; label?: string; children: readonly F[] })[];
  labelPosition?: "top" | "side" | "none";
}

/** A list: a query whose output holds the rows. */
export interface ScreenView<A extends AnyAction, F extends string> {
  /** A `query()`; the build refuses a mutation here. */
  action: A;
  input?: ActionInputOf<A>;
  /** Dot path to the rows in the action's output; leave it out when the output is the list. */
  items?: string;
  /** The row key. Default `"id"`. */
  id?: string;
  fields: ScreenFields<F>;
  layout?: ScreenViewLayout<NoInfer<F>>;
}

/** A form: a query returns the values; `submit` runs with the edited ones as `item("field")`. */
export interface ScreenForm<A extends AnyAction, F extends string, S extends AnyAction> {
  action: A;
  input?: ActionInputOf<A>;
  /** Dot path to the values in the output. */
  item?: string;
  fields: ScreenFields<F>;
  layout?: ScreenFormLayout<NoInfer<F>>;
  submit?: ScreenAction<S>;
}

/** Who may open the screen: a TypedPress role, or a WordPress capability. Default administrators. */
type ScreenAccess =
  | { access?: "admin" | "editor" | "author" | "subscriber" | "authenticated"; capability?: never }
  | { capability: string; access?: never };

interface ScreenBase<TActions extends readonly AnyAction[]> {
  title: string;
  description?: string;
  /** Where wp-admin lists it (`parent`: a menu slug such as `"tools.php"`); `false` keeps it out of wp-admin. */
  classic?: false | { parent?: string; icon?: string; position?: number };
  /** Where TypedPress Admin's sidebar lists it; `false` keeps it out (its route still works). */
  menu?: false | { parent?: string; icon?: string; section?: string };
  /** Item actions, each one a TypedPress action run as its Ability. */
  actions?: { [K in keyof TActions]: ScreenAction<TActions[K]> };
  /** Fixed lines shown above the body. */
  data?: string | readonly string[];
}

export type AdminScreenDefinition<
  F extends string = string,
  TSource extends AnyAction = AnyAction,
  TActions extends readonly AnyAction[] = readonly AnyAction[],
  TSubmit extends AnyAction = AnyAction,
> = ScreenBase<TActions> & ScreenAccess & (
  | { view: ScreenView<TSource, F>; form?: never }
  | { form: ScreenForm<TSource, F, TSubmit>; view?: never }
);

/**
 * A TypedPress Admin screen, named by its export: `export const pendingOrders = adminScreen({ ... })` is
 * `/wp-admin/new/screens/pending-orders` and a wp-admin page. One React component draws it in both
 * admins; its actions run as Abilities, which check each action's own `access` (docs/admin-screens.md).
 */
export declare function adminScreen<
  F extends string,
  TSource extends AnyAction,
  const TActions extends readonly AnyAction[] = [],
  TSubmit extends AnyAction = AnyAction,
>(definition: AdminScreenDefinition<F, TSource, TActions, TSubmit>): AdminScreen;

declare const widgetBrand: unique symbol;
declare const dashboardBrand: unique symbol;

/** An `adminWidget()` value: registered by its export and placeable on any admin dashboard. */
export interface AdminWidget { readonly [widgetBrand]: true }

/** An `adminDashboard()` value: registered by its export as a custom dashboard or Home layout. */
export interface AdminDashboard { readonly [dashboardBrand]: true }

/** Built-in SpacePress / TypedPress dashboard widget types. */
export type BuiltinWidgetId =
  | "tp/content-overview"
  | "tp/recent-activity"
  | "tp/drafts-queue"
  | "tp/app-status"
  | "tp/store-pulse";

export interface WidgetMetric {
  id?: string;
  label: string;
  /** Dot path into the readonly action's response (e.g. `"totals.orders"`). */
  path: string;
  format?: "number" | "currency" | "percent" | "text";
}

export interface WidgetField {
  label?: string;
  type?: "text" | "integer" | "number" | "boolean" | "datetime";
  description?: string;
}

export type AdminWidgetDefinition<A extends AnyAction = AnyAction> = ScreenAccess & {
  title: string;
  description?: string;
  info?: string;
  /** A `readonly: true` action that supplies the widget's data. */
  action: A;
  input?: ActionInputOf<A>;
  display?: "metrics" | "list" | "table" | "summary";
  /** Dot path to the list rows in the action's response (for `list` / `table` widgets). */
  items?: string;
  fields?: Record<string, WidgetField>;
  metrics?: readonly WidgetMetric[];
  /** Default grid column span (1–4). */
  width?: 1 | 2 | 3 | 4;
  /** Default grid row span (1–4). */
  height?: 1 | 2 | 3 | 4;
  link?: { label: string; to: string };
};

/** Declare a reusable dashboard widget backed by a readonly action. */
export declare function adminWidget<A extends AnyAction>(definition: AdminWidgetDefinition<A>): AdminWidget;

export type DashboardWidgetPlacement =
  | AdminWidget
  | BuiltinWidgetId
  | {
      widget: AdminWidget | BuiltinWidgetId;
      width?: 1 | 2 | 3 | 4;
      height?: 1 | 2 | 3 | 4;
      fullWidth?: boolean;
    };

export type AdminDashboardDefinition = ScreenAccess & {
  title: string;
  description?: string;
  /** Set `home: true` to customize the default Home (`/`) dashboard instead of adding a new route. */
  home?: boolean;
  /** Where TypedPress Admin's sidebar lists it; `false` hides it from the sidebar. */
  menu?: false | { icon?: string; section?: string };
  widgets: readonly [DashboardWidgetPlacement, ...DashboardWidgetPlacement[]];
};

/** Declare a custom admin dashboard (or override the default Home dashboard with `home: true`). */
export declare function adminDashboard(definition: AdminDashboardDefinition): AdminDashboard;

declare const pluginBrand: unique symbol;
/** A plugin package's definition: `export default (options) => definePlugin({ ... })`. */
export interface Plugin { readonly [pluginBrand]: true }
export interface MigrationProviderConfig {
  /** Stable identifier of the opt-in migration provider (e.g. `"destructive-migrations"`). */
  id: string;
  /** When true (default), the provider only runs from CLI and never during HTTP requests. */
  cliOnly?: boolean;
  /** When true, every destructive operation requires `--archive-to=<path>`. */
  requireArchive?: boolean;
  /** When true, allows explicit raw destructive SQL via CLI. */
  allowRawSql?: boolean;
}

/**
 * Defines a plugin in an installed package. Its hooks keep app-hook semantics; its queries,
 * mutations and jobs are registered as `<name>_<key>`, and `x.enqueue()` on one of its jobs queues it.
 * There is no capability list: the compiler infers it, and the app's lock grants it.
 */
export declare function definePlugin<TSchema extends Schema = Schema>(definition: {
  /** A lowercase identifier, unique in the app: `"seo"`. */
  name: string;
  /** Keyed by the app's collection keys; the build checks them against the app's schema. */
  hooks?: Hooks<TSchema>;
  actions?: Record<string, AnyAction>;
  jobs?: Record<string, AnyJob>;
  /** Optional CLI-only migration provider (e.g. `@typedpress/destructive-migrations`). */
  migrationProvider?: MigrationProviderConfig;
}): Plugin;

// ---------------------------------------------------------------------------
// 11. Errors
// ---------------------------------------------------------------------------

/** Throw from a hook or action to pick the HTTP response. */
export declare class HttpError extends Error {
  /** `pointer` names the input field the error is about (`"/email"`), so a form shows it beside that field. */
  constructor(status: number, code: string, message: string, pointer?: string);
  readonly status: number;
  readonly code: string;
}


/** A `job()` or `cron()`: queued with `enqueue`, run off the request by Action Scheduler. */
export interface Job<TInput = any> {
  readonly [jobBrand]: { input: TInput };
  /** Queue a run inside the current transaction; it runs after commit. `key` collapses duplicates still waiting. */
  enqueue(input: TInput, opts?: EnqueueOptions): Promise<{ id: string }>;
}
export type AnyJob = Job<any>;
export interface JobCtx extends HookCtx { attempt: number; jobId: string }
/**
 * A background job. The input is the handler's parameter type. `every: "1h"` also runs it on that
 * repeat (s, m, h, d or w; at least a minute), with no input.
 */
export declare function job<F extends (input: any, ctx: JobCtx) => Awaitable<void>>(
  options: { retries?: number; agents?: boolean; every?: `${number}${"s" | "m" | "h" | "d" | "w"}` },
  handler: F,
): Job<HandlerInput<F>>;
/** A job Action Scheduler runs on a five-field cron schedule in UTC: `cron("0 3 * * *", async () => { ... })`. */
export declare function cron(schedule: string, handler: (input: {}, ctx: JobCtx) => Awaitable<void>): Job<{}>;
export interface EnqueueOptions { delay?: number; key?: string }

/** The request a `route.ts` (or page) HTTP handler under `tp/app/` receives. Header names are lowercase; the body is the raw text. */
export interface RouteRequest {
  method: string;
  /**
   * The absolute URL: `https://`, the hostname (lowercase, no port), path and query, with share-link
   * secrets (`__`, `token`, `purchaseToken`, a `/__/<token>` segment) read as `[redacted]`.
   */
  url: string;
  path: string;
  /** The `[name]` and `[...name]` folders of the route, decoded (catch-all segments joined with `/`). */
  params: Record<string, string>;
  /**
   * The query string as URLSearchParams reads it: names byte-exact (`a.b`, `x[]`), every value
   * kept in order. `get` answers the first value or null.
   */
  query: RouteQuery;
  headers: Record<string, string>;
  body: string;
}
export interface RouteQuery {
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string): boolean;
  entries(): [string, string][];
}
/** What a route handler returns. Status defaults to 200, body to "", Content-Type to text/plain; charset=utf-8. */
export interface RouteResponse { status?: number; headers?: Record<string, string>; body?: string }
export declare function once<T>(key: string, fn: () => Awaitable<T>): Promise<T>;

export type MailAddress = string | { email: string; name?: string | null };
/**
 * An optional field may be left out, `undefined` or `null`; all three send without it. An optional
 * column reads as `string | null`, so `replyTo: settings.replyTo` needs no conversion.
 */
export interface MailMessage {
  /**
   * Defaults to `noreply@` the site's host (or `TP_MAIL_SENDER_DOMAIN`). On Spacefast it must use
   * the Space's sending domain. A local site on `127.0.0.1` or `localhost` sends as
   * `noreply@typedpress.localhost`.
   */
  from?: MailAddress | null;
  to: MailAddress | MailAddress[];
  subject: string;
  text?: string | null;
  html?: string | null;
  cc?: MailAddress | MailAddress[] | null;
  bcc?: MailAddress | MailAddress[] | null;
  replyTo?: MailAddress | null;
  headers?: Record<string, string> | null;
}
/**
 * Email from hooks, actions, routes and jobs. `send` queues the message in the handler's
 * transaction and hands it to the site's mail transport after commit, retrying a refusal; a
 * rollback sends nothing. It resolves to the queued delivery's id. `render` turns a React Email
 * template from `emails/` into the `html` and `text` a message carries.
 */
export declare const mail: {
  send(message: MailMessage): Promise<{ id: string }>;
  /** The HTML and plain text of an `emails/` template's default export, rendered with `props`. */
  render<P>(template: (props: P) => unknown, props: P): { html: string; text: string };
};

export interface EnvValue { readonly [envBrand]: true }
export declare function env(name: string): EnvValue;
export interface Webhook { url: EnvValue | string; secret: EnvValue; events: WebhookEvent[] }
export type WebhookEvent = `${string}.created` | `${string}.updated` | `${string}.deleted` | "*";
export type FileRule = AccessShorthand | "owner" | ((ctx: AccessCtx) => boolean);
export interface FileBucket { readonly [fileBucketBrand]: true }
export type AnyFileBucket = FileBucket;
/** A private file bucket, named by its export: `export const decks = files({ accept, maxBytes })`. */
export declare function files(options: {
  accept: string[];
  maxBytes: number;
  access?: { read?: FileRule; create?: FileRule; delete?: FileRule };
}): FileBucket;
/** One durable backend for private files and all standard WordPress media uploads. */
export type UploadsConfig = { backend: "local" } | {
  backend: "s3";
  bucket: string | EnvValue;
  region?: string | EnvValue;
  endpoint?: string | EnvValue;
  pathStyle?: boolean;
  prefix?: string | EnvValue;
  credentials: { accessKeyId: EnvValue; secretAccessKey: EnvValue; sessionToken?: EnvValue };
};
export interface LocalesConfig { default: string; all: readonly string[]; fallback?: boolean }
export type Locale = Register extends { locales: infer L extends string } ? L : string;
export type LocalizedColumns = { locale: Locale; translations: Partial<Record<Locale, number>> };


/** Supported Blueprint v1 resource references; WordPress.org uses an exact ZIP slug. */
export type WordPressPluginResource =
  | { resource: "wordpress.org/plugins"; slug: string }
  | { resource: "url"; url: string };

/** Additional deployable plugin; never activated or executed during the Rust build. */
export type WordPressPlugin = string | ({
  /** Exact plugin header version, including WordPress suffixes. */
  version: string;
  /** Dependency identities, each declared here or supplied by the platform. */
  requires?: readonly string[];
} & (
  | {
      /** Defaults to the exact WordPress.org ZIP for the map key and version. */
      pluginData?: { resource: "wordpress.org/plugins"; slug: string };
      /** Otherwise recorded in tp/_generated/wp-plugins.lock.json on first acquisition. */
      sha256?: string;
    }
  | {
      pluginData: { resource: "url"; url: string };
      sha256: string;
    }
));

/** Native WooCommerce runtime. Source owns only the declared store keys. */
export interface StoreOptions {
  currency: string;
  country: string;
  address?: { line1: string; line2?: string; city: string; postcode: string };
  sellTo?: "all" | readonly string[];
  units?: { weight: "kg" | "g" | "lbs" | "oz"; dimension: "m" | "cm" | "mm" | "in" | "yd" };
  shipping?: readonly { name: string; countries: readonly string[] | "rest"; methods: readonly (
    { type: "flatRate"; title: string; cost: string } |
    { type: "freeShipping"; title: string; minimum?: string } |
    { type: "localPickup"; title: string; cost?: string }
  )[] }[];
  payments?: readonly string[];
  email?: { fromName: string; fromAddress: string };
  checkout?: `/${string}`;
}
declare const storeBrand: unique symbol;
export interface CommerceStore { readonly [storeBrand]: true }
export declare function store(options: StoreOptions): CommerceStore;
export interface CommerceOptions { sync?: string; url?: `/${string}`; agents?: boolean; label?: string; api?: false | { list?: boolean; get?: boolean; create?: boolean; update?: boolean; delete?: boolean } }
type ProductColumns = {
  uid: ColumnBuilder<"text", string, true, true>;
  name: ColumnBuilder<"text", string, true, false>;
  slug: ColumnBuilder<"slug", string, true, true>;
  description: ColumnBuilder<"richText", string, true, true>;
  shortDescription: ColumnBuilder<"text", string, false, false>;
  sku: ColumnBuilder<"text", string, false, false>;
  status: ColumnBuilder<"text", "draft" | "pending" | "scheduled" | "published" | "private", true, true>;
  price: ColumnBuilder<"text", string, false, false>;
  images: ColumnBuilder<"mediaList", number[], true, true>;
  categories: ColumnBuilder<"refList", number[], true, true>;
  tags: ColumnBuilder<"refList", number[], true, true>;
  virtual: ColumnBuilder<"boolean", boolean, true, true>;
  downloadable: ColumnBuilder<"boolean", boolean, true, true>;
  downloads: ColumnBuilder<"json", { id: string; name: string; file: string }[], true, true>;
  type: ColumnBuilder<"text", string, true, true>;
  purchasable: ColumnBuilder<"boolean", boolean, true, true>;
  availability: ColumnBuilder<"text", string, true, true>;
  url: ColumnBuilder<"text", string, false, true>;
};
type ProductFields = Record<string, ColumnBuilder<"text" | "integer" | "number" | "boolean" | "date" | "email" | "url", unknown, false, false>> & {
  [K in keyof ProductColumns | "id" | "stockQuantity"]?: never;
};
export declare function product<F extends ProductFields = {}, I extends boolean = false>(
  options?: CommerceOptions & { fields?: F; inventory?: I; reviews?: boolean },
): Collection<string, WithId<ProductColumns & F & (I extends true ? {
  stockQuantity: ColumnBuilder<"integer", number, false, true>;
} : {})>, false, "product">;
export declare function productCategory(options?: CommerceOptions): Collection<string, WithId<TermColumns<true> & { uid: ColumnBuilder<"text", string, true, true> }>, false, "taxonomy">;
export declare function productTag(options?: CommerceOptions): Collection<string, WithId<TermColumns<false> & { uid: ColumnBuilder<"text", string, true, true> }>, false, "taxonomy">;
export interface OrderAddress {
  first_name: string; last_name: string; company: string; address_1: string; address_2: string;
  city: string; state: string; postcode: string; country: string; email?: string; phone?: string;
}
export interface OrderLine {
  id: number; name: string; product: number; variation: number | null; quantity: number;
  subtotal: string; subtotalTax: string; total: string; totalTax: string;
  taxes: { total: Record<string, string>; subtotal: Record<string, string> };
}
export declare function order(options?: Pick<CommerceOptions, "agents" | "label"> & { api?: false | { list?: boolean; get?: boolean } }): Collection<string, WithId<{
  status: ColumnBuilder<"text", string, true, true>;
  currency: ColumnBuilder<"text", string, true, true>;
  total: ColumnBuilder<"text", string, true, true>;
  subtotal: ColumnBuilder<"text", string, true, true>;
  discountTotal: ColumnBuilder<"text", string, true, true>;
  shippingTotal: ColumnBuilder<"text", string, true, true>;
  taxTotal: ColumnBuilder<"text", string, true, true>;
  precision: ColumnBuilder<"integer", number, true, true>;
  createdAt: ColumnBuilder<"timestamp", string, true, true>;
  updatedAt: ColumnBuilder<"timestamp", string, true, true>;
  paidAt: ColumnBuilder<"timestamp", string, false, true>;
  completedAt: ColumnBuilder<"timestamp", string, false, true>;
  customer: ColumnBuilder<"integer", number, false, true>;
  paymentMethod: ColumnBuilder<"text", string, true, true>;
  paymentTitle: ColumnBuilder<"text", string, true, true>;
  billing: ColumnBuilder<"json", OrderAddress, true, true>;
  shipping: ColumnBuilder<"json", OrderAddress, true, true>;
  lines: ColumnBuilder<"json", OrderLine[], true, true>;
  shippingLines: ColumnBuilder<"json", { id: number; name: string; method_id: string; instance_id: string; total: string; total_tax: string; taxes: unknown }[], true, true>;
  taxLines: ColumnBuilder<"json", { id: number; name: string; rate_id: number; label: string; compound: boolean; tax_total: string; shipping_tax_total: string }[], true, true>;
  feeLines: ColumnBuilder<"json", { id: number; name: string; total: string; total_tax: string; taxes: unknown }[], true, true>;
  couponLines: ColumnBuilder<"json", { id: number; name: string; code: string; discount: string; discount_tax: string }[], true, true>;
  refunds: ColumnBuilder<"json", { id: number; amount: string; reason: string; createdAt: string }[], true, true>;
}>, false, "order">;
