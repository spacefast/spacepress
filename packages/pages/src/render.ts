/**
 * One route, executed at build time inside its own bundle.
 *
 * The build bundles each route (its layouts, its page and everything they
 * import, plus this module and the runtime) into a single ES module, so every
 * route starts with an empty registry. `renderRoute` runs the loader with
 * symbolic request data, renders the page and wraps it in its layouts, and
 * returns plain data: content trees, metadata, and the tokens, regions and
 * queries PHP will evaluate per request.
 */
import { toContentNodes } from "@spacefast/first-blocks/jsx-runtime";

import { content } from "./index.ts";
import {
  PagesError, describePath, pathOf, registry, shapeOf, symbolic, tokenize,
  type QuerySpec, type RegionSpec, type TokenSpec,
} from "./symbolic.ts";

export type Module = Readonly<Record<string, unknown>>;

export interface MetadataOut {
  title?: string;
  titleTemplate?: { default: string; template: string };
  description?: string;
  canonical?: string;
  robots?: { index?: boolean; follow?: boolean };
}

export interface RenderInput {
  page: Module;
  layouts: Module[];
  /** The `[param]` name of an item route, else null. */
  param: string | null;
  /** True for `not-found.tsx`: no loader, no item, no params. */
  notFound: boolean;
}

export interface Rendered {
  explicitId: string | null;
  collection: string | null;
  body: unknown[];
  document: unknown[];
  /** Outermost layout first, the page last. */
  metadata: MetadataOut[];
  tokens: Record<string, TokenSpec>;
  regions: Record<string, RegionSpec>;
  queries: Record<string, QuerySpec>;
}

const PAGE_EXPORTS = new Set(["default", "load", "metadata", "generateMetadata", "page", "route"]);
const LAYOUT_EXPORTS = new Set(["default", "metadata"]);
const METADATA_KEYS = new Set(["title", "description", "canonical", "robots"]);
const EXPLICIT_ID = /^[a-z][a-z0-9._-]{0,63}$/;

function isPlain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (pathOf(value) !== undefined) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function metaText(value: unknown, at: string): string | undefined {
  if (value === undefined) return undefined;
  if (pathOf(value) !== undefined) {
    const kind = shapeOf(value)?.kind;
    if (kind !== "scalar" && kind !== "open") throw new PagesError("metadata", `${at} must be text, not the record ${describePath(pathOf(value)!)}.`);
    return tokenize(value) as string;
  }
  if (typeof value === "string") return value;
  throw new PagesError("metadata", `${at} must be a string or a per-request field.`);
}

function metadataOf(value: unknown, where: string, layout: boolean): MetadataOut {
  if (value === undefined) return {};
  if (!isPlain(value)) throw new PagesError("metadata", `${where} metadata must be a plain object.`);
  const out: MetadataOut = {};
  for (const key of Object.keys(value)) {
    if (!METADATA_KEYS.has(key)) {
      throw new PagesError("metadata", `${where} metadata has "${key}"; this release supports ${[...METADATA_KEYS].join(", ")}.`);
    }
  }
  const title = value.title;
  if (isPlain(title)) {
    if (typeof title.default !== "string" || typeof title.template !== "string" || !title.template.includes("%s")) {
      throw new PagesError("metadata", `${where} title { default, template } takes two strings, and the template contains %s.`);
    }
    if (!layout) throw new PagesError("metadata", "A title template belongs in a layout; a page sets its own title.");
    out.titleTemplate = { default: title.default, template: title.template };
  } else {
    const text = metaText(title, `${where} title`);
    if (text !== undefined) out.title = text;
  }
  const description = metaText(value.description, `${where} description`);
  if (description !== undefined) out.description = description;
  const canonical = metaText(value.canonical, `${where} canonical`);
  if (canonical !== undefined) out.canonical = canonical;
  if (value.robots !== undefined) {
    const robots = value.robots;
    if (!isPlain(robots) || Object.keys(robots).some((key) => key !== "index" && key !== "follow")
      || Object.values(robots).some((flag) => typeof flag !== "boolean")) {
      throw new PagesError("metadata", `${where} robots is { index?: boolean, follow?: boolean } with literal booleans.`);
    }
    out.robots = robots as { index?: boolean; follow?: boolean };
  }
  return out;
}

function component(module: Module, where: string): (props: Record<string, unknown>) => unknown {
  const fn = module.default;
  if (typeof fn !== "function") throw new PagesError("default_export_missing", `${where} has no default export component.`);
  return fn as (props: Record<string, unknown>) => unknown;
}

function nodes(rendered: unknown, where: string): unknown[] {
  if (rendered !== null && typeof rendered === "object" && typeof (rendered as { then?: unknown }).then === "function") {
    throw new PagesError("async_component", `${where} is async; components render synchronously at build time. Read data in load().`);
  }
  return toContentNodes(tokenize(rendered));
}

export async function renderRoute(input: RenderInput): Promise<Rendered> {
  const { page, layouts, param, notFound } = input;
  const pageWhere = notFound ? "not-found.tsx" : "The page";
  for (const key of Object.keys(page)) {
    if (!PAGE_EXPORTS.has(key) || (notFound && key !== "default" && key !== "metadata")) {
      throw new PagesError("route_shape", `${pageWhere} exports "${key}", which ${notFound ? "not-found.tsx" : "a page"} cannot have.`);
    }
  }
  layouts.forEach((layout, index) => {
    for (const key of Object.keys(layout)) {
      if (!LAYOUT_EXPORTS.has(key)) {
        throw new PagesError("route_shape", `Layout ${index + 1} exports "${key}"; a layout has a default component and optional metadata.`);
      }
    }
  });

  let explicitId: string | null = null;
  if (page.route !== undefined) {
    const id = isPlain(page.route) ? page.route.id : undefined;
    if (typeof id !== "string" || !EXPLICIT_ID.test(id) || Object.keys(page.route as object).some((key) => key !== "id")) {
      throw new PagesError("route_id", "route is { id } with an ID matching [a-z][a-z0-9._-]{0,63}.");
    }
    explicitId = id;
  }

  let collection: string | null = null;
  if (page.page !== undefined) {
    const marker = page.page as { kind?: unknown; collection?: unknown };
    if (marker === null || typeof marker !== "object" || marker.kind !== "collectionPage" || typeof marker.collection !== "string") {
      throw new PagesError("not_routable", "export const page = collectionPage(\"<collection>\") is the only page declaration.");
    }
    collection = marker.collection;
  }
  if (param !== null && collection === null) {
    throw new PagesError("not_routable", `A [${param}] route serves a collection's items: export const page = collectionPage("<collection>").`);
  }
  if (param === null && collection !== null) {
    throw new PagesError("not_routable", "collectionPage() belongs in a [param] directory, such as pages/notes/[slug]/page.tsx.");
  }

  const context: Record<string, unknown> = {};
  if (!notFound) {
    context.content = content();
    const fields: Record<string, { kind: "scalar"; label: string }> = {};
    if (param !== null) fields[param] = { kind: "scalar", label: `params.${param}` };
    context.params = symbolic(["params"], { kind: "record", fields, label: "params" });
    if (collection !== null) context.item = symbolic(["item"], { kind: "row", collection });
  }

  let props: Record<string, unknown> = {};
  if (typeof page.load === "function") {
    const loaded: unknown = await (page.load as (ctx: unknown) => unknown)(context);
    if (loaded !== undefined) {
      if (!isPlain(loaded)) throw new PagesError("load", "load() returns a plain object of props (or nothing).");
      props = { ...loaded };
    }
  } else if (page.load !== undefined) {
    throw new PagesError("load", "load must be a function.");
  }
  if (collection !== null) {
    if ("item" in props || "href" in props) throw new PagesError("load", "load() cannot return item or href; the route supplies them.");
    const item = context.item as Record<string, unknown>;
    props = { ...props, item, href: item.href };
  }

  if (page.metadata !== undefined && page.generateMetadata !== undefined) {
    throw new PagesError("metadata", "Export metadata or generateMetadata, not both.");
  }
  const pageMetadata = typeof page.generateMetadata === "function"
    ? metadataOf((page.generateMetadata as (p: unknown) => unknown)(props), "generateMetadata()", false)
    : metadataOf(page.metadata, "The page's", false);

  const body = nodes(component(page, pageWhere)(props), pageWhere);
  let document = body;
  const metadata: MetadataOut[] = [pageMetadata];
  for (let index = layouts.length - 1; index >= 0; index -= 1) {
    const layout = layouts[index]!;
    document = nodes(component(layout, `Layout ${index + 1}`)({ children: document }), `Layout ${index + 1}`);
    metadata.unshift(metadataOf(layout.metadata, `Layout ${index + 1}`, true));
  }

  return {
    explicitId,
    collection,
    body,
    document,
    metadata,
    tokens: Object.fromEntries(registry.tokens),
    regions: Object.fromEntries(registry.regions),
    queries: Object.fromEntries(registry.queries),
  };
}
