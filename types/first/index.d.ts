import type { ServicesConfig } from "./services";
export type { ServicesConfig, ServiceForm, ServiceFormField, ServiceProduct } from "./services";

/**
 * Type declarations for the `"first"` module.
 *
 * `first build` evaluates `first.config.ts` with its own Rust evaluator and
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
  | "real"
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
  | "group"
  | "repeater"
  | "blocks";

export type ReferentialAction = "cascade" | "restrict" | "set null" | "no action";

export interface ReferenceOptions {
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}

/** Values a `$onUpdate`/`$default` function may return: `Date` is accepted on time columns. */
type GeneratedValue<TKind extends ColumnKind, TData> =
  | TData
  | (TKind extends "timestamp" | "date" ? Date : never);

// Which modifiers each kind allows (design §1.2). Enforced here through `this` parameters, and by
// the compiler regardless ("`.max()` isn't valid on a boolean column").
/** `.min/.max`: numeric bounds, string length in code points, or item count. */
type BoundedKind = "integer" | "real" | "text" | "email" | "url" | "slug" | "richText" | "mediaList" | "select" | "repeater" | "blocks";
/** `.pattern`: strings only. */
type PatternKind = "text" | "email" | "url" | "slug";
/** `.unique()`. */
type UniqueKind = "id" | "integer" | "real" | "text" | "email" | "url" | "slug" | "boolean" | "date" | "timestamp";
/** `.references()`. */
type ReferenceKind = "id" | "integer" | "real";
/** `.default()` and friends: every kind but media. */
type DefaultKind = Exclude<ColumnKind, "media">;

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
 * A column definition inside `collection(...)`, `global(...)`, a structured field, or `action({ input })`.
 * Builders are immutable: each modifier returns a new builder.
 *
 * - `TData`       — the TS value type (enum union, `$type<T>()`, sub-field shapes, ...)
 * - `TNotNull`    — `.notNull()` / `.primaryKey()` / `id()`
 * - `THasDefault` — any default (`.default`, `.defaultNow`, `$default`, `$onUpdate`, `id()`)
 * - `TPrimary`    — `.primaryKey()` / `id()`: row ids (`translationOf`, `translations`) take its type
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

  /** On a sub-field: required in every item. */
  notNull(): ColumnBuilder<TKind, TData, true, THasDefault, TLocalized, TPrimary>;
  /** Declares a rename: this field was stored as `old`. The deploy renames the column and keeps its values. */
  was(old: string): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;
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
  /** Alias of `$default`. */
  $defaultFn(
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
  /** Alias of `$onUpdate`. */
  $onUpdateFn(
    this: ColumnBuilder<DefaultKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>,
    fn: () => GeneratedValue<TKind, TData>,
  ): ColumnBuilder<TKind, TData, TNotNull, true, TLocalized, TPrimary>;
  /** Unique text columns also need `.max(n)` with n ≤ 191 (MySQL index limit). Not allowed on sub-fields or globals. */
  unique(this: ColumnBuilder<UniqueKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;
  /** Primary key: implies NOT NULL; an integer primary key is auto-assigned. */
  primaryKey(): ColumnBuilder<
    TKind,
    TData,
    true,
    TKind extends "integer" | "id" ? true : THasDefault,
    TLocalized,
    true
  >;
  /** Foreign key. The target column's type must match this column's type. */
  references(
    this: ColumnBuilder<ReferenceKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>,
    ref: () => Column<ColumnKind, NonNullable<TData>>,
    options?: ReferenceOptions,
  ): ColumnBuilder<TKind, TData, TNotNull, THasDefault, TLocalized, TPrimary>;
  /** Narrows the TS type only (no runtime effect), e.g. `json().$type<string[]>()`. */
  $type<T>(): ColumnBuilder<TKind, T, TNotNull, THasDefault, TLocalized, TPrimary>;

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

/** INTEGER PRIMARY KEY AUTOINCREMENT. */
export declare function id(): ColumnBuilder<"id", number, true, true, false, true>;
export declare function integer(): ColumnBuilder<"integer", number, false, false>;
export declare function real(): ColumnBuilder<"real", number, false, false>;
/** Single line by default; `multiline: true` is a textarea in editors. */
export declare function text(config?: { multiline?: boolean }): ColumnBuilder<"text", string, false, false>;
/** `text({ enum: ["a", "b"] })` types the column as `"a" | "b"`. */
export declare function text<const TEnum extends readonly [string, ...string[]]>(config: {
  enum: TEnum;
  multiline?: boolean;
}): ColumnBuilder<"text", TEnum[number], false, false>;
/** Stored as INTEGER 0/1. */
export declare function boolean(): ColumnBuilder<"boolean", boolean, false, false>;
/** TEXT `YYYY-MM-DD`. */
export declare function date(): ColumnBuilder<"date", string, false, false>;
/** TEXT, UTC ISO-8601 with milliseconds. */
export declare function timestamp(): ColumnBuilder<"timestamp", string, false, false>;
/** TEXT holding JSON; `unknown` until narrowed with `.$type<T>()`. */
export declare function json(): ColumnBuilder<"json", unknown, false, false>;

/** An email address (validated). TEXT. */
export declare function email(): ColumnBuilder<"email", string, false, false>;
/** An absolute `http(s)://` URL (validated). TEXT. */
export declare function url(): ColumnBuilder<"url", string, false, false>;
/**
 * URL-safe identifier: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 200 characters, unique. With `source`
 * (a text column of the same collection), an omitted slug is derived from it ("-2", "-3" ... until
 * unique). At most one per collection; not allowed in sub-fields or globals.
 */
export declare function slug(config?: { source?: undefined }): ColumnBuilder<"slug", string, false, false>;
/** With `source`, an omitted slug is derived, so it is optional on insert even when `.notNull()`. */
export declare function slug(config: { source: string }): ColumnBuilder<"slug", string, false, true>;
/** A private-file id in the named bucket. */
export declare function file(config: { bucket: string }): ColumnBuilder<"file", number, false, false>;

/** HTML. On WordPress the `content`-designated richText is the block editor's post_content. */
export declare function richText(): ColumnBuilder<"richText", string, false, false>;
/** A media id (the built-in `media` collection). `with: { <col>: true }` populates it in place. */
export declare function media(config?: { accept?: "image" | "any"; multiple?: false }): ColumnBuilder<"media", number, false, false>;
/** A list of media ids. */
export declare function media(config: { accept?: "image" | "any"; multiple: true }): ColumnBuilder<"mediaList", number[], false, false>;
/** One of `options`: exactly `text({ enum: options })`. */
export declare function select<const TOptions extends readonly [string, ...string[]]>(config: {
  options: TOptions;
  multiple?: false;
}): ColumnBuilder<"text", TOptions[number], false, false>;
/** Any number of distinct `options`, stored as a JSON array. Filter with `{ has: option }`. */
export declare function select<const TOptions extends readonly [string, ...string[]]>(config: {
  options: TOptions;
  multiple: true;
}): ColumnBuilder<"select", TOptions[number][], false, false>;

/**
 * Sub-fields of `group`/`repeater`/`blocks` layouts and globals. Builders are the column builders;
 * the compiler rejects id(), slug(), blocks(), .primaryKey(), .unique(), .references() and
 * .$onUpdate() inside them, and nesting deeper than 3.
 */
export type FieldsConfig = Record<string, AnyColumnBuilder>;

/** One object with fixed sub-fields (absent optional sub-fields read as null). */
export declare function group<F extends FieldsConfig>(config: { fields: F }): ColumnBuilder<"group", SelectShape<F>, false, false, HasLocalized<F>>;
/** A list of objects with the same sub-fields. `.min/.max` count items. */
export declare function repeater<F extends FieldsConfig>(config: { fields: F }): ColumnBuilder<"repeater", SelectShape<F>[], false, false, HasLocalized<F>>;
/** Flexible content: a list of items, each `{ layout, ...that layout's fields }`. */
export declare function blocks<L extends Record<string, FieldsConfig>>(config: {
  layouts: L;
}): ColumnBuilder<"blocks", BlockValue<L>[], false, false, HasLocalized<L[keyof L]>>;

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

/** Options shared by the `collection()` signatures; `T` is the collection being defined. */
export interface CollectionOptions<T extends AnyCollection = AnyCollection> {
  /** Physical resource name, without prefixes. Defaults to the registry key in snake_case.
   * Keep this binding when upgrading existing storage; changing it does not rename data. */
  storageName?: string;
  /** Bind table() to an already existing SQL table, without adding any prefix.
   * The first migration checks its columns; it never creates or copies this table. */
  existingTable?: string;
  /** Declares a rename: this table was stored as `old` (its name in first/_generated/migrations/snapshot.json).
   * The deploy renames the table and keeps its rows. table() only. */
  was?: string;
  /** Project-relative Markdown/JSON files; implies uid: true. */
  sync?: `${string}/*.md` | `${string}/*.json`;
  uid?: boolean;
  /** Expose through WordPress abilities/MCP. Default true. */
  agents?: boolean;
  /** Shown in wp-admin menus and the typed client docs. */
  label?: string;
  /** Native on collections; opt-in publication state on tables. */
  drafts?: boolean;
  /** Keep a revision per update. Default true for collections, false for tables. */
  revisions?: boolean;
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
export type StorageKind = "collection" | "table" | "userProjection";

export interface CollectionMeta<TName extends string, TCols extends ColumnsConfig, TAuth extends boolean = false, TStorage extends StorageKind = StorageKind> {
  readonly [collectionBrand]: { columns: TCols; auth: TAuth; storage: TStorage };
  /** Row type returned by queries. */
  readonly $inferSelect: SelectShape<TCols>;
  /** Shape accepted by `db.insert(...).values(...)`. */
  readonly $inferInsert: ("locale" extends keyof TCols ? TranslationInsert<TCols> : InsertShape<TCols>) & (TAuth extends true ? { password?: string } : {});
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
/** The primary key column of `TCols` (`id()` or `.primaryKey()`, whatever its name). */
type PrimaryKeyOf<TCols> = {
  [K in keyof TCols]: TCols[K] extends { readonly [columnBrand]: { primaryKey: true } } ? K : never;
}[keyof TCols];
/**
 * The row id type of a collection: its primary key's (a number for `id()`). A builder annotated without
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

/** `id: id()` is supplied unless a primary key (or an explicit id) is authored. */
type WithId<TCols extends ColumnsConfig> = [PrimaryKeyOf<TCols>] extends [never]
  ? "id" extends keyof TCols ? TCols : TCols & { id: ColumnBuilder<"id", number, true, true, false, true> }
  : TCols;
type StoredColumns<TCols extends ColumnsConfig, TUid extends boolean, TSync extends string | undefined> = WithId<TCols> & IdentityColumns<TUid, TSync> & TranslatedColumns<TCols>;

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

type ColumnsOf<T> = T extends { readonly [collectionBrand]: { columns: infer C } } ? C : never;

export type InferSelectModel<T extends AnyCollection> = T["$inferSelect"];
export type InferInsertModel<T extends AnyCollection> = T["$inferInsert"];

/** A flat relation graph assembled from the explicit registries. */
export type Schema = Record<string, AnyCollection>;

// ---------------------------------------------------------------------------
// 4. Relations
// ---------------------------------------------------------------------------

/** `r.<collectionKey>.<column>` inside `defineRelations`. */
export interface RelationColumn<TKey extends string = string> {
  readonly [relationBrand]: { collection: TKey };
}

type RelationColumns = RelationColumn | readonly [RelationColumn, ...RelationColumn[]];

export interface One<TTarget extends string = string, TOptional extends boolean = boolean> {
  readonly [relationBrand]: { kind: "one"; target: TTarget; optional: TOptional };
}

export interface Many<TTarget extends string = string> {
  readonly [relationBrand]: { kind: "many"; target: TTarget };
}

export type AnyRelation = One | Many;

export interface OneConfig {
  from: RelationColumns;
  to: RelationColumns;
  /** `false` when the related row always exists; the result then isn't nullable. Default `true`. */
  optional?: boolean;
}

export interface ManyConfig {
  from: RelationColumns;
  to: RelationColumns;
}

/** Overloads (not a generic) so `optional` isn't inferred from the contextual return type. */
export interface OneFn<TTarget extends string> {
  (config: OneConfig & { optional: false }): One<TTarget, false>;
  (config: OneConfig & { optional?: true }): One<TTarget, true>;
  (config: OneConfig): One<TTarget, boolean>;
}

export interface ManyFn<TTarget extends string> {
  /** With no config, inferred from the single `one` relation pointing back. */
  (config?: ManyConfig): Many<TTarget>;
}

export type RelationsBuilder<TSchema extends Schema> = {
  readonly [K in keyof TSchema & string]: {
    readonly [C in keyof ColumnsOf<TSchema[K]>]: RelationColumn<K>;
  };
} & {
  readonly one: { readonly [K in keyof TSchema & string]: OneFn<K> };
  readonly many: { readonly [K in keyof TSchema & string]: ManyFn<K> };
};

export type RelationsConfig<TSchema extends Schema> = {
  [K in keyof TSchema]?: Record<string, AnyRelation>;
};

/** Result of `defineRelations`. */
export interface Relations<
  TSchema extends Schema = Schema,
  TConfig extends RelationsConfig<TSchema> = RelationsConfig<TSchema>,
> {
  readonly [relationsBrand]: { schema: TSchema; config: TConfig };
}

export declare function defineRelations<TSchema extends Schema>(
  schema: TSchema,
): Relations<TSchema, {}>;
export declare function defineRelations<
  TSchema extends Schema,
  TConfig extends RelationsConfig<TSchema>,
>(schema: TSchema, relations: (r: RelationsBuilder<TSchema>) => TConfig): Relations<TSchema, TConfig>;

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

/** A field condition: a bare (non-object) value or an operator object. */
export type FieldFilter<T> = FieldOperators<T> | (T extends object ? never : T);

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
  ? K extends "mediaList" | "select"
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
> = ColumnFilters<ColumnsOf<TSchema[K]>> & {
  [R in keyof RelationsOf<TRels, K>]?:
    | boolean
    | RelationsFilter<TSchema, TRels, TargetOf<RelationsOf<TRels, K>[R]> & keyof TSchema>;
} & {
  OR?: RelationsFilter<TSchema, TRels, K>[];
  AND?: RelationsFilter<TSchema, TRels, K>[];
  NOT?: RelationsFilter<TSchema, TRels, K>;
};

/** Columns that can be ordered: everything but list and JSON-valued columns. */
type OrderableKeys<TCols> = {
  [K in keyof TCols]: ColumnKindOf<TCols[K]> extends "mediaList" | "select" | "json" | "group" | "repeater" | "blocks" ? never : K;
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

export type WithConfig<TSchema extends Schema, TRels, K extends keyof TSchema> = {
  [R in keyof RelationsOf<TRels, K>]?:
    | boolean
    | NestedQueryConfig<
        TSchema,
        TRels,
        TargetOf<RelationsOf<TRels, K>[R]> & keyof TSchema,
        RelationKind<RelationsOf<TRels, K>[R]> & ("one" | "many")
      >;
};

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
    : never;
};

/** One row of `db.query.<K>` given its `columns` and `with`. */
export type QueryRow<TSchema extends Schema, TRels, K extends keyof TSchema, TCols, TWith> = Simplify<
  PickColumns<TSchema[K]["$inferSelect"], TCols> & WithResult<TSchema, TRels, K, TWith>
>;

export interface CollectionQuery<TSchema extends Schema, TRels, K extends keyof TSchema> {
  findMany<
    TCols extends ColumnsSelection<TSchema[K]> = {},
    TWith extends WithConfig<TSchema, TRels, K> = {},
  >(config?: {
    locale?: Locale | "*";
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
 * interface. `first build` writes the augmentation into `first/_generated/db.d.ts`:
 *
 * ```ts
 * import type { relations } from "./first.config";
 * declare module "first" {
 *   interface Register { relations: typeof relations }
 * }
 * ```
 *
 * `first build` emits the structural relation graph even without authored relations,
 * so the config can keep every declaration private. Config registration supplies
 * globals and jobs; localized projects also register their locale union.
 */
export interface Register {}

type RegisteredSchema = Register extends { relations: Relations<infer S, any> } ? S : never;
type RegisteredRelations = Register extends { relations: Relations<any, infer C> } ? C : {};

type UnregisteredQuery = {
  readonly [key: string]: "Schema not registered: add first/_generated/db.d.ts (run `first build`) so `db.query` knows your collections";
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

type RegisteredGlobals = Register extends { config: { readonly [configBrand]: { globals: infer G } } } ? G : never;

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

/** Who is calling: the WordPress user (or the first-identity session's user). */
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
  op: "read" | "create" | "update" | "delete";
  /** create: the incoming row (after defaults, before beforeCreate). update: the patch. Absent otherwise. */
  data?: TData;
}

/**
 * A filter an access function may return: column conditions of the collection, plus relation
 * conditions (`{ author: { userId: ctx.user?.id } }`). Relation names aren't known where the
 * collection is defined, so the compiler checks those.
 */
export type AccessFilter<T extends AnyCollection> = TableFilter<T> & { [relation: string]: unknown };

/** `"anyone"` includes unauthenticated callers; `"authenticated"` is any user; a role admits itself and above. */
export type AccessShorthand = boolean | "anyone" | "authenticated" | "self" | Role;

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

/** Defaults: `read: "anyone"`, writes `"editor"`. Readers below editor only see published rows unless `read` is a function. */
export interface AccessConfig<T extends AnyCollection = AnyCollection> {
  read?: AccessRule<T>;
  create?: Exclude<CreateAccessRule<T>, "self">;
  update?: AccessRule<T>;
  delete?: AccessRule<T>;
}

/** Actions and globals have no rows to filter: a shorthand or a boolean function. */
export type GateRule<TData = Record<string, unknown>> = AccessShorthand | ((ctx: AccessCtx<TData>) => boolean);

// ---------------------------------------------------------------------------
// 10. Hooks, actions, globals, config
// ---------------------------------------------------------------------------

/**
 * Throwing from any hook aborts the request and rolls back its writes. Hooks are trusted: `db` calls
 * inside them skip access rules and see every status. On WordPress editor saves only the `after*`
 * hooks run.
 */
export interface CollectionHooks<T extends AnyCollection> {
  /** Mutate `data` or return a replacement. */
  beforeCreate?: (data: Insert<T>, ctx: BeforeHookCtx<Insert<T>>) => Awaitable<Insert<T> | void>;
  afterCreate?: (row: Row<T>, ctx: HookCtx) => Awaitable<void>;
  /** Mutate `patch` or return a replacement. */
  beforeUpdate?: (patch: Patch<T>, existing: Row<T>, ctx: BeforeHookCtx<Patch<T>>) => Awaitable<Patch<T> | void>;
  afterUpdate?: (row: Row<T>, previous: Row<T>, ctx: HookCtx) => Awaitable<void>;
  beforeDelete?: (row: Row<T>, ctx: HookCtx) => Awaitable<void>;
  afterDelete?: (row: Row<T>, ctx: HookCtx) => Awaitable<void>;
}

export type Hooks<TSchema extends Schema> = {
  [K in keyof TSchema]?: CollectionHooks<TSchema[K]>;
};

/** Action input after defaults: required when NOT NULL or defaulted. */
type ActionInputKeys<TInput> = {
  [K in keyof TInput]: TInput[K] extends {
    readonly [columnBrand]: { notNull: true } | { hasDefault: true };
  }
    ? K
    : never;
}[keyof TInput];

export type InferActionInput<TInput extends ColumnsConfig> = Simplify<
  { [K in ActionInputKeys<TInput>]: SelectValue<TInput[K]> } & {
    [K in Exclude<keyof TInput, ActionInputKeys<TInput>>]?: SelectValue<TInput[K]>;
  }
>;

export interface Action<TInput extends ColumnsConfig = ColumnsConfig, TResult = unknown> {
  readonly [actionBrand]: { input: TInput; result: TResult };
}

export type AnyAction = Action<ColumnsConfig, unknown>;

/** `POST <prefix>/actions/<name>`; the handler's return value is the response `data`. Default access `"editor"`. */
export declare function action<TInput extends ColumnsConfig, TResult>(definition: {
  input: TInput;
  access?: GateRule<InferActionInput<TInput>>;
  agents?: boolean;
  idempotent?: boolean;
  signature?: { secret: EnvValue; header: string; scheme: "first" | "hmac-sha256" };
  handler: (input: InferActionInput<TInput>, ctx: HookCtx) => Awaitable<TResult>;
}): Action<TInput, TResult>;

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
 * Defines a global. Fields use the column builders with the sub-field restrictions, and no
 * `.unique()`/`id()`/`slug()`/`blocks()`; NOT NULL fields need a default. Default access:
 * `read: "anyone"`, `update: "editor"`.
 */
export declare function global<const TName extends string, TFields extends FieldsConfig>(
  name: TName,
  fields: TFields,
  options?: {
    label?: string;
    agents?: boolean;
    access?: { read?: GateRule<never>; update?: GateRule<Partial<SelectShape<TFields>>> };
  },
): Global<TName, TFields>;

export interface ConfigInput<
  TSchema extends Schema,
  TRelations extends Relations<TSchema, any>,
  TGlobals extends Record<string, AnyGlobal> = {},
  TJobs extends Record<string, AnyJob> = {},
  TLocales extends LocalesConfig = LocalesConfig,
  TCollections extends Schema = Schema,
  TTables extends Schema = Schema,
  TUsers extends Schema = Schema,
> {
  /** Project name: plugin slug (`first-<name>`), wp-admin menu, client docs. Default: the project directory name. */
  name?: string;
  collections?: TCollections & Record<string, CollectionMeta<string, ColumnsConfig, false, "collection">>;
  tables?: TTables & Record<string, CollectionMeta<string, ColumnsConfig, false, "table">>;
  users?: TUsers & Record<string, CollectionMeta<string, ColumnsConfig, true, "userProjection">>;
  relations?: TRelations;
  /** Key = the name used in `db.globals.<key>` and `/globals/<key>`. */
  globals?: TGlobals;
  /** `NoInfer`: types come from the explicit registries, so unknown hook keys are errors. */
  hooks?: NoInfer<Hooks<TSchema>>;
  actions?: Record<string, AnyAction>;
  /** Custom HTTP endpoints on the site's own paths, outside `/wp-json`. */
  routes?: Record<string, Route>;
  jobs?: TJobs;
  webhooks?: Webhook[];
  /** Private native forms, queued mail, publication search and server-priced checkout. */
  services?: ServicesConfig;
  files?: Record<string, AnyFileBucket>;
  uploads?: UploadsConfig;
  media?: { sizes?: Record<string, { width: number; height?: number; fit?: "cover" | "inside" }> };
  locales?: TLocales;
  /** Build-only WordPress plugin dependencies. */
  plugins?: Readonly<Record<string, WordPressPlugin>>;
  /** Ship the optional admin screens (`first-admin`) with the build. Default `false`. */
  admin?: boolean;
  /**
   * Plugin packages, registered in order: `use: [seo({ ... })]`. Each one's capabilities are
   * inferred from its compiled code and granted by the committed `first/_generated/plugins.lock.json`.
   */
  use?: readonly Plugin[];
}

export interface FirstConfig<
  TSchema extends Schema = Schema,
  TRelations extends Relations<TSchema, any> = Relations<TSchema, any>,
  TGlobals extends Record<string, AnyGlobal> = Record<string, AnyGlobal>,
  TJobs extends Record<string, AnyJob> = Record<string, AnyJob>,
  TLocales extends LocalesConfig = LocalesConfig,
> {
  readonly [configBrand]: { schema: TSchema; relations: TRelations; globals: TGlobals; jobs: TJobs; locales: TLocales };
}

export declare function defineConfig<
  TCollections extends Schema = {}, TTables extends Schema = {}, TUsers extends Schema = {},
  TRelations extends Relations<TCollections & TTables & TUsers, any> = Relations<TCollections & TTables & TUsers, {}>,
  TGlobals extends Record<string, AnyGlobal> = {},
  TJobs extends Record<string, AnyJob> = {},
  const TLocales extends LocalesConfig = LocalesConfig,
>(config: ConfigInput<TCollections & TTables & TUsers, TRelations, TGlobals, TJobs, TLocales, TCollections, TTables, TUsers>): FirstConfig<TCollections & TTables & TUsers, TRelations, TGlobals, TJobs, TLocales>;

declare const pluginBrand: unique symbol;
/** A plugin package's definition: `export default (options) => definePlugin({ ... })`. */
export interface Plugin { readonly [pluginBrand]: true }
/**
 * Defines a plugin in an installed package. Its hooks keep app-hook semantics; its actions, jobs
 * and routes are registered as `<name>_<key>`, and `jobs.<key>` inside the plugin names its own.
 * There is no capability list: the compiler infers it, and the app's lock grants it.
 */
export declare function definePlugin<TSchema extends Schema = Schema>(definition: {
  /** A lowercase identifier, unique in the app: `"seo"`. */
  name: string;
  /** Keyed by the app's collection keys; the build checks them against the app's schema. */
  hooks?: Hooks<TSchema>;
  actions?: Record<string, AnyAction>;
  jobs?: Record<string, AnyJob>;
  routes?: Record<string, Route>;
}): Plugin;

// ---------------------------------------------------------------------------
// 11. Errors
// ---------------------------------------------------------------------------

/** Throw from a hook or action to pick the HTTP response. */
export declare class HttpError extends Error {
  constructor(status: number, code: string, message: string);
  readonly status: number;
  readonly code: string;
}


// Phase-2 runtime values are declarations only; lane D supplies their compilation.
export interface Job<TInput extends ColumnsConfig = ColumnsConfig> {
  readonly [jobBrand]: { input: TInput };
}
export type AnyJob = Job<ColumnsConfig>;
export interface JobCtx extends HookCtx { attempt: number; jobId: string }
export declare function job<TInput extends ColumnsConfig>(definition: {
  input: TInput;
  retries?: number;
  agents?: boolean;
  handler: (input: InferActionInput<TInput>, ctx: JobCtx) => Awaitable<void>;
}): Job<TInput>;
export interface EnqueueOptions { delay?: number; key?: string }

declare const routeBrand: unique symbol;
/** A custom HTTP endpoint: `routes: { feed: route({ ... }) }`. */
export interface Route { readonly [routeBrand]: true }
/** The request a route handler receives. Header names are lowercase; the body is the raw text. */
export interface RouteRequest {
  method: string;
  /**
   * The absolute URL: `https://`, the hostname (lowercase, no port), path and query, with share-link
   * secrets (`__`, `token`, `purchaseToken`, a `/__/<token>` segment) read as `[redacted]`.
   */
  url: string;
  path: string;
  /** `:name` segments of the route path, decoded. */
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
type RoutePath = `/${string}`;
/**
 * One method and path served by a compiled handler, in one transaction (`docs/config-api.md#http-routes`).
 * Exactly one of `access` (who may call) or `signature` (an HMAC over the raw body; the caller is anonymous).
 */
export declare function route(definition: {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: RoutePath;
  handler: (req: RouteRequest, ctx: HookCtx) => Awaitable<RouteResponse>;
} & (
  | { access: GateRule<Record<string, never>>; signature?: never }
  | { signature: { secret: EnvValue; header: string; scheme: "first" | "hmac-sha256" }; access?: never }
)): Route;
export interface JobHandle<TInput> {
  enqueue(input: TInput, opts?: EnqueueOptions): Promise<{ id: string }>;
}
type RegisteredJobs = Register extends { config: { readonly [configBrand]: { jobs: infer J extends Record<string, AnyJob> } } } ? J : never;
export type JobsApi = [RegisteredJobs] extends [never]
  ? Record<string, JobHandle<Record<string, unknown>>>
  : { readonly [K in keyof RegisteredJobs]: RegisteredJobs[K] extends Job<infer I> ? JobHandle<InsertShape<I>> : never };
export declare const jobs: JobsApi;
export declare function once<T>(key: string, fn: () => Awaitable<T>): Promise<T>;

export type MailAddress = string | { email: string; name?: string };
export interface MailMessage {
  /** Defaults to `noreply@` the site's host. On Spacefast it must use the Space's sending domain. */
  from?: MailAddress;
  to: MailAddress | MailAddress[];
  subject: string;
  text?: string;
  html?: string;
  cc?: MailAddress | MailAddress[];
  bcc?: MailAddress | MailAddress[];
  replyTo?: MailAddress;
  headers?: Record<string, string>;
}
/**
 * Email from hooks, actions, routes and jobs. `send` queues the message in the handler's
 * transaction and hands it to the site's mail transport after commit, retrying a refusal; a
 * rollback sends nothing. It resolves to the queued delivery's id.
 */
export declare const mail: {
  send(message: MailMessage): Promise<{ id: string }>;
};

export interface EnvValue { readonly [envBrand]: true }
export declare function env(name: string): EnvValue;
export interface Webhook { url: EnvValue | string; secret: EnvValue; events: WebhookEvent[] }
export type WebhookEvent = `${string}.created` | `${string}.updated` | `${string}.deleted` | "*";
export type FileRule = AccessShorthand | "owner" | ((ctx: AccessCtx) => boolean);
export interface FileBucket { readonly [fileBucketBrand]: true }
export type AnyFileBucket = FileBucket;
export declare function files(name: string, options: {
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
      /** Otherwise recorded in first/_generated/wp-plugins.lock.json on first acquisition. */
      sha256?: string;
    }
  | {
      pluginData: { resource: "url"; url: string };
      sha256: string;
    }
));
