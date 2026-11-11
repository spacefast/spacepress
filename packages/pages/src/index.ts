/**
 * `@spacefast/first-pages`: optional TSX pages for a First app, rendered by WordPress.
 *
 * Pages run once, at build time, and compile to Gutenberg block markup through
 * First Blocks' serializer. Data is never read at build time: a loader's
 * `content.query`, a collection item and route params are symbolic values that
 * PHP fills per request with the viewer's own, access-checked rows. The subset
 * is small on purpose: render a field, loop over rows with `.map`, branch with
 * `<Show>`, render stored rich text with `<RichText>`, and attach one
 * Interactivity API island. Anything a build cannot answer honestly is refused
 * with the file, line and column.
 */
import type { Register, Relations } from "first";
import type { ContentNode } from "@spacefast/first-blocks";

import {
  ISLAND_BLOCK, PagesError, RICH_TEXT_BLOCK, SHOW_BLOCK, contentList, describePath, fallbackOf, islandHtml, pathOf, registry, shapeOf,
  symbolic, tokenize, type PathSegment,
} from "./symbolic.ts";

export { PagesError } from "./symbolic.ts";

// ---------------------------------------------------------------------------
// Types an author writes against

/** A value that exists only per request. Render it, put it in an attribute or a template string, or test it with `<Show>`. */
export interface Dynamic<T> {
  readonly " firstDynamic": T;
}

type Entities = Register extends { relations: Relations<infer S, infer _C> } ? S : Record<string, { $inferSelect: Record<string, unknown> }>;

/** Registered collection and table names (from `first/_generated/db.d.ts`). */
export type CollectionName = keyof Entities & string;

type RowOf<K extends CollectionName> = Entities[K] extends { $inferSelect: infer R } ? R : never;

/** One row, field by field, as per-request values. `href` is the item route's URL when the collection has one. */
export type DynamicRow<K extends CollectionName> = {
  readonly [F in keyof RowOf<K>]-?: Dynamic<RowOf<K>[F]>;
} & { readonly href: Dynamic<string>; readonly " firstRow": K };

/** Rows of one query. `.map` becomes a server-rendered loop. */
export interface DynamicRows<K extends CollectionName> {
  readonly " firstRows": K;
  map(render: (row: DynamicRow<K>, index: Dynamic<number>) => unknown): ContentNode;
}

/** Literal JSON, or a per-request value read from `item` or `params`. */
export type QueryValue = string | number | boolean | null | Dynamic<unknown> | QueryValue[] | { [key: string]: QueryValue };

export interface QueryOptions {
  where?: Record<string, QueryValue>;
  orderBy?: Record<string, "asc" | "desc">;
  limit?: number;
  offset?: number;
}

export interface CollectionQueryApi<K extends CollectionName> {
  findMany(options?: QueryOptions): DynamicRows<K>;
  /** One row or nothing. Fields of a missing row render as nothing; use `orElse` for a fallback. */
  findFirst(options?: Omit<QueryOptions, "limit">): DynamicRow<K>;
}

/** The read-only, viewer-bound query API. Every read runs per request as the visitor, with their access rules and field masks. */
export interface Content {
  readonly query: { readonly [K in CollectionName]: CollectionQueryApi<K> };
}

export interface PageContext {
  content: Content;
  params: Readonly<Record<string, Dynamic<string>>>;
}

export interface CollectionPageContext<K extends CollectionName> extends PageContext {
  item: DynamicRow<K>;
}

/** The marker an item route exports as `page`. */
export interface CollectionPage<K extends CollectionName> {
  readonly kind: "collectionPage";
  readonly collection: K;
}

/** Props of a collection item page: the loader's return value plus `item` and `href`. */
export type CollectionPageProps<P, Extra = {}> = P extends CollectionPage<infer K> ? Extra & { item: DynamicRow<K>; href: Dynamic<string> } : never;

/** Props of a static page: whatever `load()` returned. */
export type PageProps<L extends (...args: never[]) => unknown> = Awaited<ReturnType<L>>;

export interface LayoutProps {
  children: unknown;
}

/** Text a metadata field can hold: literal text or a template string over per-request values. */
export type MetaText = string | Dynamic<string> | Dynamic<string | null>;

export interface Metadata {
  /** A page title, or a layout's `{ default, template }` where `%s` is the page title. */
  title?: MetaText | { default: string; template: string };
  description?: MetaText;
  /** Absolute or root-relative. Defaults to the route's own URL under the site's home URL. */
  canonical?: MetaText;
  robots?: { index?: boolean; follow?: boolean };
}

export interface RouteOptions {
  /** A stable ID that survives moving the route to another URL. `[a-z][a-z0-9._-]{0,63}`. */
  id?: string;
}

// ---------------------------------------------------------------------------
// Runtime

/** Declare an item route: `[slug]` binds the collection's slug column, and WordPress finds the row as the visitor. */
export function collectionPage<K extends CollectionName>(collection: K): CollectionPage<K> {
  const info = registry.schema[collection];
  if (info === undefined) throw new PagesError("unknown_collection", `There is no collection named "${collection}".`);
  if (!info.editor) throw new PagesError("not_routable", `"${collection}" is a table; only collections (WordPress content types) can have item routes. Query tables from a loader instead.`);
  if (info.slug === null) throw new PagesError("not_routable", `"${collection}" has no slug() column, so its rows have no URL.`);
  return { kind: "collectionPage", collection };
}

function jsonQuery(value: unknown, at: string): unknown {
  const path = pathOf(value);
  if (path !== undefined) {
    const root = String(path[0]);
    if (root !== "item" && root !== "params") {
      throw new PagesError("dynamic_query", `${at} reads ${describePath(path)}; a query may use only item and params values, not another query's rows.`);
    }
    const shape = shapeOf(value);
    if (shape?.kind !== "scalar") throw new PagesError("dynamic_query", `${at} must be a field value, not a whole record.`);
    const fallback = fallbackOf(value);
    return fallback === undefined ? { $zp: path } : { $zp: path, fallback };
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PagesError("query_value", `${at} is ${value}, which a query cannot hold.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => jsonQuery(entry, `${at}[${index}]`));
  if (typeof value === "object") {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonQuery(entry, `${at}.${key}`)]));
    }
  }
  throw new PagesError("query_value", `${at} must be JSON data (a string, number, boolean, null, array or plain object).`);
}

const QUERY_KEYS = new Set(["where", "orderBy", "limit", "offset"]);

function checkQuery(collection: string, options: unknown, many: boolean): Record<string, unknown> {
  if (options === undefined) return {};
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new PagesError("query_value", `query.${collection} options must be an object.`);
  }
  const info = registry.schema[collection]!;
  for (const key of Object.keys(options)) {
    if (!QUERY_KEYS.has(key) || (!many && key === "limit")) {
      throw new PagesError("query_value", `query.${collection} has no option "${key}"; use ${[...QUERY_KEYS].filter((k) => many || k !== "limit").join(", ")}.`);
    }
  }
  const { where, orderBy } = options as QueryOptions;
  for (const [label, record] of [["where", where], ["orderBy", orderBy]] as const) {
    if (record === undefined) continue;
    for (const field of Object.keys(record)) {
      if (["OR", "AND", "NOT"].includes(field) && label === "where") continue;
      if (!Object.hasOwn(info.columns, field)) {
        throw new PagesError("unknown_field", `query.${collection} ${label} names "${field}", which ${collection} does not have.`);
      }
    }
  }
  return jsonQuery(options, `query.${collection}`) as Record<string, unknown>;
}

/** The viewer-bound query API handed to `load()`. Each call registers one per-request query. */
export function content(): Content {
  const query = new Proxy({}, {
    get(_target, collection) {
      if (typeof collection !== "string") return undefined;
      if (registry.schema[collection] === undefined) {
        throw new PagesError("unknown_collection", `content.query.${collection}: there is no collection or table named "${collection}".`);
      }
      const register = (op: "many" | "first", options: unknown): unknown => {
        const id = `q${registry.queries.size + 1}`;
        registry.queries.set(id, { collection, op, options: checkQuery(collection, options, op === "many") });
        return symbolic([id], op === "many" ? { kind: "rows", collection } : { kind: "row", collection });
      };
      return {
        findMany: (options?: unknown) => register("many", options),
        findFirst: (options?: unknown) => register("first", options),
      };
    },
  });
  return { query } as unknown as Content;
}

function regionBlock(blockName: string, region: string, children: unknown): ContentNode {
  return { kind: "block", blockName, attrs: { region }, inner: contentList(tokenize(children)) as ContentNode[] } as ContentNode;
}

function dynamicPath(value: unknown, component: string, prop: string): PathSegment[] {
  const path = pathOf(value);
  if (path === undefined) {
    throw new PagesError("static_condition", `<${component} ${prop}> needs a per-request value; a value known at build time is ordinary code, so use it directly.`);
  }
  return path;
}

/**
 * Render children only when a per-request value is truthy (JavaScript truthiness:
 * `0`, `""`, `null` and `false` are not), or equals `is` when given.
 */
export function Show(props: { when: unknown; is?: string | number | boolean; not?: boolean; children?: unknown }): ContentNode {
  const when = dynamicPath(props.when, "Show", "when");
  if (props.is !== undefined && !["string", "number", "boolean"].includes(typeof props.is)) {
    throw new PagesError("static_condition", "<Show is> compares with a literal string, number or boolean.");
  }
  const spec = props.is === undefined
    ? { kind: "show" as const, when, negate: props.not === true }
    : { kind: "show" as const, when, negate: props.not === true, equals: props.is };
  const fallback = fallbackOf(props.when);
  const id = registry.region("s", fallback === undefined ? spec : { ...spec, fallback });
  return regionBlock(SHOW_BLOCK, id, props.children);
}

/** Stored rich text (a collection's `content` field) rendered through WordPress's content pipeline for the visitor. */
export function RichText(props: { value: unknown }): ContentNode {
  const value = dynamicPath(props.value, "RichText", "value");
  if (fallbackOf(props.value) !== undefined) {
    throw new PagesError("rich_text", "<RichText> takes the stored field directly; render fallback text separately with <Show not>.");
  }
  const shape = shapeOf(props.value);
  if (shape?.kind !== "scalar" || shape.type !== "richText") {
    throw new PagesError("rich_text", `<RichText value> takes a richText field; ${describePath(value)} is not one.`);
  }
  if (value[0] !== "item") {
    throw new PagesError("rich_text", "<RichText> renders the routed item's body only; a listing renders fields as text.");
  }
  const id = registry.region("r", { kind: "rich-text", value });
  return { kind: "block", blockName: RICH_TEXT_BLOCK, attrs: { region: id }, inner: [] } as ContentNode;
}

/**
 * An Interactivity API island. `children` is written as plain HTML (any tag,
 * `data-wp-*` directives) with every text and attribute escaped; `context`
 * becomes `data-wp-context`; `module` is a browser module, bundled separately,
 * that calls `store(namespace, ...)`. `actions` names app actions the module
 * may call: their URLs and a REST nonce arrive through `getConfig()`.
 */
export function Island(props: {
  namespace: string;
  module: string;
  context?: Record<string, unknown>;
  actions?: readonly string[];
  children?: unknown;
}): ContentNode {
  if (typeof props.namespace !== "string" || !/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(props.namespace)) {
    throw new PagesError("island", `Island namespace "${String(props.namespace)}" must look like app/island.`);
  }
  if (typeof props.module !== "string" || !/^\.\.?\//.test(props.module)) {
    throw new PagesError("island", "Island module is a path relative to the file that uses the island, starting with ./ or ../");
  }
  const actions = [...(props.actions ?? [])];
  for (const action of actions) {
    if (!registry.actions.has(action)) {
      throw new PagesError("island", `Island action "${action}" is not an action of this app; declared: ${[...registry.actions].join(", ") || "none"}.`);
    }
  }
  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props.context ?? {})) {
    const path = pathOf(value);
    if (path !== undefined) {
      if (shapeOf(value)?.kind !== "scalar") throw new PagesError("island", `Island context.${key} must be a field value, not a record.`);
      const fallback = fallbackOf(value);
      context[key] = fallback === undefined ? { $zp: path } : { $zp: path, fallback };
    } else if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      context[key] = value;
    } else {
      throw new PagesError("island", `Island context.${key} must be a string, number, boolean, null or a per-request field.`);
    }
  }
  const from = registry.callSite;
  if (from === undefined) throw new PagesError("island", "<Island> must be used as JSX so its module path can be resolved.");
  const id = registry.region("i", { kind: "island", namespace: props.namespace, module: props.module, from, context, actions });
  const html = islandHtml(props.children);
  const inner = html === "" ? [] : [{ kind: "block", blockName: "core/html", attrs: { content: html }, inner: [] }];
  return { kind: "block", blockName: ISLAND_BLOCK, attrs: { region: id }, inner } as ContentNode;
}

/** A per-request value, or `fallback` when it is null or missing (`value ?? fallback`, decided per request). */
export function orElse<T, F extends string | number>(value: Dynamic<T>, fallback: F): Dynamic<NonNullable<T> | F> {
  const path = pathOf(value);
  const shape = shapeOf(value);
  if (path === undefined || shape === undefined) throw new PagesError("static_condition", "orElse() takes a per-request value.");
  if (shape.kind !== "scalar") throw new PagesError("static_condition", `orElse() takes a field value; ${describePath(path)} is a record.`);
  if (typeof fallback !== "string" && !(typeof fallback === "number" && Number.isFinite(fallback))) {
    throw new PagesError("static_condition", "orElse() falls back to a literal string or finite number.");
  }
  return symbolic(path, shape, fallbackOf(value) ?? fallback) as Dynamic<NonNullable<T> | F>;
}

/** The length of a viewer-bound query result, evaluated per request. */
export function count<K extends CollectionName>(rows: DynamicRows<K>): Dynamic<number> {
  const path = pathOf(rows);
  if (path === undefined || shapeOf(rows)?.kind !== "rows") {
    throw new PagesError("dynamic_value", "count() takes the result of content.query.<collection>.findMany().");
  }
  return symbolic([...path, "length"], { kind: "scalar", label: "query row count", type: "integer" }) as Dynamic<number>;
}

/**
 * The URL of one of this app's static pages, resolved per request under the
 * site's home URL (so a site installed in a subdirectory still links right).
 */
export function link(pattern: string): Dynamic<string> {
  if (!registry.staticRoutes.has(pattern)) {
    const known = [...registry.staticRoutes].join(", ");
    throw new PagesError("unknown_route", `link("${pattern}") names no static page; pages: ${known}.`);
  }
  return symbolic(["@url", pattern], { kind: "scalar", label: `link("${pattern}")` }) as Dynamic<string>;
}
