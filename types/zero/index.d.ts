/**
 * Type declarations for the `"zero"` module.
 *
 * `zero build` evaluates `zero.config.ts` with its own Rust evaluator and
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
 *   9. Hooks, actions, config
 *  10. Errors
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
  | "json";

export type ReferentialAction = "cascade" | "restrict" | "set null" | "no action";

export interface ReferenceOptions {
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}

/** Values a `$onUpdate`/`$default` function may return: `Date` is accepted on time columns. */
type GeneratedValue<TKind extends ColumnKind, TData> =
  | TData
  | (TKind extends "timestamp" | "date" ? Date : never);

/**
 * A column definition inside `collection(...)` or `action({ input })`.
 * Builders are immutable: each modifier returns a new builder.
 *
 * - `TData`       — the TS value type (enum union, `$type<T>()`, ...)
 * - `TNotNull`    — `.notNull()` / `.primaryKey()` / `id()`
 * - `THasDefault` — any default (`.default`, `.defaultNow`, `$default`, `$onUpdate`, `id()`)
 */
export interface ColumnBuilder<
  TKind extends ColumnKind = ColumnKind,
  TData = unknown,
  TNotNull extends boolean = boolean,
  THasDefault extends boolean = boolean,
> {
  readonly [columnBrand]: {
    kind: TKind;
    data: TData;
    notNull: TNotNull;
    hasDefault: THasDefault;
  };

  notNull(): ColumnBuilder<TKind, TData, true, THasDefault>;
  /** SQL `DEFAULT value`. */
  default(value: TData): ColumnBuilder<TKind, TData, TNotNull, true>;
  /** Current time (timestamp) or today (date) as the SQL default. */
  defaultNow(
    this: ColumnBuilder<"timestamp" | "date", TData, TNotNull, THasDefault>,
  ): ColumnBuilder<TKind, TData, TNotNull, true>;
  /** Computed in PHP on insert. */
  $default(fn: () => GeneratedValue<TKind, TData>): ColumnBuilder<TKind, TData, TNotNull, true>;
  /** Alias of `$default`. */
  $defaultFn(fn: () => GeneratedValue<TKind, TData>): ColumnBuilder<TKind, TData, TNotNull, true>;
  /**
   * Computed in PHP on update (`() => new Date()` on a timestamp means "now").
   * Like Drizzle, it also counts as a default for inserts.
   */
  $onUpdate(fn: () => GeneratedValue<TKind, TData>): ColumnBuilder<TKind, TData, TNotNull, true>;
  /** Alias of `$onUpdate`. */
  $onUpdateFn(fn: () => GeneratedValue<TKind, TData>): ColumnBuilder<TKind, TData, TNotNull, true>;
  unique(): ColumnBuilder<TKind, TData, TNotNull, THasDefault>;
  /** Primary key: implies NOT NULL; an integer primary key is auto-assigned. */
  primaryKey(): ColumnBuilder<
    TKind,
    TData,
    true,
    TKind extends "integer" | "id" ? true : THasDefault
  >;
  /** Foreign key. The target column's type must match this column's type. */
  references(
    ref: () => Column<ColumnKind, NonNullable<TData>>,
    options?: ReferenceOptions,
  ): ColumnBuilder<TKind, TData, TNotNull, THasDefault>;
  /** Narrows the TS type only (no runtime effect), e.g. `json().$type<string[]>()`. */
  $type<T>(): ColumnBuilder<TKind, T, TNotNull, THasDefault>;
}

export type AnyColumnBuilder = ColumnBuilder<ColumnKind, unknown, boolean, boolean>;

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
export declare function id(): ColumnBuilder<"id", number, true, true>;
export declare function integer(): ColumnBuilder<"integer", number, false, false>;
export declare function real(): ColumnBuilder<"real", number, false, false>;
export declare function text(): ColumnBuilder<"text", string, false, false>;
/** `text({ enum: ["a", "b"] })` types the column as `"a" | "b"`. */
export declare function text<const TEnum extends readonly [string, ...string[]]>(config: {
  enum: TEnum;
}): ColumnBuilder<"text", TEnum[number], false, false>;
/** Stored as INTEGER 0/1. */
export declare function boolean(): ColumnBuilder<"boolean", boolean, false, false>;
/** TEXT `YYYY-MM-DD`. */
export declare function date(): ColumnBuilder<"date", string, false, false>;
/** TEXT, UTC ISO-8601 with milliseconds. */
export declare function timestamp(): ColumnBuilder<"timestamp", string, false, false>;
/** TEXT holding JSON; `unknown` until narrowed with `.$type<T>()`. */
export declare function json(): ColumnBuilder<"json", unknown, false, false>;

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

type InsertShape<TCols> = Simplify<
  { [K in RequiredInsertKeys<TCols>]: SelectValue<TCols[K]> } & {
    [K in Exclude<keyof TCols, RequiredInsertKeys<TCols>>]?: SelectValue<TCols[K]>;
  }
>;

type SelectShape<TCols> = Simplify<{ [K in keyof TCols]: SelectValue<TCols[K]> }>;

// ---------------------------------------------------------------------------
// 3. Collections
// ---------------------------------------------------------------------------

export type ColumnsConfig = Record<string, AnyColumnBuilder>;

export interface CollectionOptions {
  /** Which REST endpoints `/api/<name>` exposes. All default to `true`. */
  api?: {
    list?: boolean;
    get?: boolean;
    create?: boolean;
    update?: boolean;
    delete?: boolean;
  };
}

/** Metadata every collection carries alongside its column references. */
export interface CollectionMeta<TName extends string, TCols extends ColumnsConfig> {
  readonly [collectionBrand]: { name: TName; columns: TCols };
  /** Table name and REST path segment. */
  readonly $name: TName;
  /** Row type returned by queries. */
  readonly $inferSelect: SelectShape<TCols>;
  /** Shape accepted by `db.insert(...).values(...)`. */
  readonly $inferInsert: InsertShape<TCols>;
}

type ColumnRefs<TName extends string, TCols extends ColumnsConfig> = {
  readonly [K in keyof TCols & string]: TCols[K] extends ColumnBuilder<
    infer TKind,
    infer TData,
    infer TNotNull,
    infer THasDefault
  >
    ? Column<TKind, TData, TNotNull, THasDefault, TName, K>
    : never;
};

export type Collection<
  TName extends string = string,
  TCols extends ColumnsConfig = ColumnsConfig,
> = ColumnRefs<TName, TCols> & CollectionMeta<TName, TCols>;

export type AnyCollection = CollectionMeta<string, ColumnsConfig>;

/**
 * Defines a table. `name` is the SQL table and REST path segment; the key
 * under `schema` is what `db.query.<key>`, `hooks` and `relations` use.
 */
export declare function collection<
  const TName extends string,
  TCols extends ColumnsConfig,
>(name: TName, columns: TCols, options?: CollectionOptions): Collection<TName, TCols>;

type ColumnsOf<T> = T extends { readonly [collectionBrand]: { columns: infer C } } ? C : never;

export type InferSelectModel<T extends AnyCollection> = T["$inferSelect"];
export type InferInsertModel<T extends AnyCollection> = T["$inferInsert"];

/** `schema` in `defineConfig`: collection key -> collection. */
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

type ColumnFilters<TCols> = {
  [K in keyof TCols]?: FieldFilter<NonNullable<SelectValue<TCols[K]>>>;
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

export type OrderBy<T extends AnyCollection> = {
  [K in keyof ColumnsOf<T>]?: "asc" | "desc";
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
 * interface. `zero build` writes the augmentation into `zero.gen.ts`:
 *
 * ```ts
 * import type { relations } from "./zero.config";
 * declare module "zero" {
 *   interface Register { relations: typeof relations }
 * }
 * ```
 *
 * Without relations, register the schema instead: `schema: typeof schema`.
 */
export interface Register {}

type RegisteredSchema = Register extends { relations: Relations<infer S, any> }
  ? S
  : Register extends { schema: infer S extends Schema }
    ? S
    : never;

type RegisteredRelations = Register extends { relations: Relations<any, infer C> } ? C : {};

type UnregisteredQuery = {
  readonly [key: string]: "Schema not registered: add zero.gen.ts (run `zero build`) so `db.query` knows your collections";
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

// ---------------------------------------------------------------------------
// 8. Database API (hooks and actions only)
// ---------------------------------------------------------------------------

type Row<T extends AnyCollection> = T["$inferSelect"];
type Insert<T extends AnyCollection> = T["$inferInsert"];
/** Update patches: any subset of insertable fields. */
type Patch<T extends AnyCollection> = Partial<Insert<T>>;

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
  /** Relational queries, keyed by `schema` key. */
  readonly query: QueryApi;
  insert<T extends AnyCollection>(collection: T): InsertBuilder<T>;
  update<T extends AnyCollection>(collection: T): UpdateBuilder<T>;
  delete<T extends AnyCollection>(collection: T): DeleteQuery<T>;
}

/** Available inside hooks and actions; forbidden at build-time evaluation. */
export declare const db: Database;

// ---------------------------------------------------------------------------
// 9. Hooks, actions, config
// ---------------------------------------------------------------------------

/** Throwing from any hook aborts the request and rolls back its writes. */
export interface CollectionHooks<T extends AnyCollection> {
  /** Mutate `data` or return a replacement. */
  beforeCreate?: (data: Insert<T>) => Awaitable<Insert<T> | void>;
  afterCreate?: (row: Row<T>) => Awaitable<void>;
  /** Mutate `patch` or return a replacement. */
  beforeUpdate?: (patch: Patch<T>, existing: Row<T>) => Awaitable<Patch<T> | void>;
  afterUpdate?: (row: Row<T>, previous: Row<T>) => Awaitable<void>;
  beforeDelete?: (row: Row<T>) => Awaitable<void>;
  afterDelete?: (row: Row<T>) => Awaitable<void>;
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

/** `POST /api/actions/<name>`; the handler's return value is the response `data`. */
export declare function action<TInput extends ColumnsConfig, TResult>(definition: {
  input: TInput;
  handler: (input: InferActionInput<TInput>) => Awaitable<TResult>;
}): Action<TInput, TResult>;

export interface ConfigInput<TSchema extends Schema, TRelations extends Relations<TSchema, any>> {
  schema: TSchema;
  relations?: TRelations;
  /** `NoInfer`: the schema comes from `schema` only, so unknown hook keys are errors. */
  hooks?: NoInfer<Hooks<TSchema>>;
  actions?: Record<string, AnyAction>;
}

export interface ZeroConfig<
  TSchema extends Schema = Schema,
  TRelations extends Relations<TSchema, any> = Relations<TSchema, any>,
> {
  readonly [configBrand]: { schema: TSchema; relations: TRelations };
}

export declare function defineConfig<
  TSchema extends Schema,
  TRelations extends Relations<TSchema, any> = Relations<TSchema, {}>,
>(config: ConfigInput<TSchema, TRelations>): ZeroConfig<TSchema, TRelations>;

// ---------------------------------------------------------------------------
// 10. Errors
// ---------------------------------------------------------------------------

/** Throw from a hook or action to pick the HTTP response. */
export declare class HttpError extends Error {
  constructor(status: number, code: string, message: string);
  readonly status: number;
  readonly code: string;
}
