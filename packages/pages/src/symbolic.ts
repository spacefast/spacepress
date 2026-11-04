/**
 * Build-time stand-ins for request data.
 *
 * A page runs once, at build time, but its data exists only per request in
 * WordPress. Every value that comes from a query, the item or the route params
 * is therefore a *symbolic* value: a proxy that records the path it was read
 * from (`item.title`). Reading a field extends the path and is checked against
 * the app's schema; using the value as JSX content, an attribute or inside a
 * template string turns it into a token the PHP runtime replaces per request;
 * `.map(fn)` becomes a server-rendered loop and `<Show when>` a server-side
 * condition. Anything else (calling a method, comparing, spreading, branching)
 * cannot be answered at build time and is refused: `check.ts` reports the
 * static cases with a location before the page runs, and the proxy throws for
 * the rest rather than guessing.
 *
 * This module is bundled into every route's build, so each route gets a fresh
 * registry. It imports nothing.
 */

/** Private-use code points: no author text or JSON spelling produces them by accident, and PHP neutralizes them in data. */
export const TOKEN_START = "\u{E000}";
export const TOKEN_END = "\u{E001}";
/** The asset base token, resolved by PHP to the pages plugin's `assets/` URL. */
export const ASSET_TOKEN = `${TOKEN_START}asset${TOKEN_END}`;
export const TOKEN_PATTERN = /\u{E000}([a-z][a-z0-9]*)\u{E001}/gu;

/** A path segment. `@href:<collection>` is the derived permalink of a routed collection's row. */
export type PathSegment = string | number;

/** How a token becomes text: as a JSX child or attribute (nullish and booleans render nothing) or through `String()`. */
export type TokenMode = "child" | "string";

export interface TokenSpec {
  path: PathSegment[];
  mode: TokenMode;
  /** `orElse(value, fallback)`: rendered when the value is null or missing. */
  fallback?: string | number;
}

/** A per-request read through the viewer-bound content API. Values `{ $zp: path }` are filled from item or params. */
export interface QuerySpec {
  collection: string;
  op: "many" | "first";
  options: Record<string, unknown>;
}

export type RegionSpec =
  | { kind: "each"; of: PathSegment[]; loop: number }
  | { kind: "show"; when: PathSegment[]; negate: boolean; equals?: string | number | boolean; fallback?: string | number }
  | { kind: "island"; namespace: string; module: string; from: string; context: Record<string, unknown>; actions: string[] }
  | { kind: "rich-text"; value: PathSegment[] };

/** What the schema knows about one collection or table. */
export interface CollectionInfo {
  /** Post-backed (a WordPress content type) rather than a SQL table. */
  editor: boolean;
  slug: string | null;
  columns: Record<string, { type: string }>;
}
export type SchemaInfo = Record<string, CollectionInfo>;

/** What a symbolic value stands for, so a typo is a build error instead of an empty page. */
export type Shape =
  | { kind: "row"; collection: string }
  | { kind: "rows"; collection: string }
  | { kind: "record"; fields: Record<string, Shape>; label: string }
  | { kind: "scalar"; label: string; type?: string }
  | { kind: "open"; label: string };

/** One route's tokens, regions and the schema its paths are checked against. */
export class Registry {
  readonly tokens = new Map<string, TokenSpec>();
  readonly regions = new Map<string, RegionSpec>();
  readonly queries = new Map<string, QuerySpec>();
  private readonly byKey = new Map<string, string>();
  loops = 0;
  readonly schema: SchemaInfo;
  /** Collections with an item route: their rows carry a derived `href`. Set once every page module is loaded. */
  routed: ReadonlySet<string>;
  /** Actions the app declares, for island wiring. */
  readonly actions: ReadonlySet<string>;
  /** Static route patterns, for link(). */
  readonly staticRoutes: ReadonlySet<string>;
  /** The source file of the JSX call being rendered, relative to the project, while a component runs. */
  callSite: string | undefined;

  constructor(build: BuildInput | undefined) {
    this.schema = build?.schema ?? {};
    this.routed = new Set(build?.routed ?? []);
    this.actions = new Set(build?.actions ?? []);
    this.staticRoutes = new Set(build?.staticRoutes ?? []);
  }

  token(spec: TokenSpec): string {
    const key = JSON.stringify(spec);
    let id = this.byKey.get(key);
    if (id === undefined) {
      id = `v${this.tokens.size + 1}`;
      this.tokens.set(id, spec);
      this.byKey.set(key, id);
    }
    return `${TOKEN_START}${id}${TOKEN_END}`;
  }

  region(prefix: "e" | "s" | "i" | "r", region: RegionSpec): string {
    const id = `${prefix}${this.regions.size + 1}`;
    this.regions.set(id, region);
    return id;
  }
}

/** What the build hands a route's bundle before it is imported. */
export interface BuildInput {
  schema: SchemaInfo;
  routed: string[];
  actions: string[];
  staticRoutes: string[];
}

declare global {
  // eslint-disable-next-line no-var
  var __zeroPagesBuild: BuildInput | undefined;
}

/** One per bundle: each route is bundled and imported separately, so each route starts empty. */
export const registry = new Registry(globalThis.__zeroPagesBuild);

/** An error an author caused, with the code a diagnostic carries. */
export class PagesError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "PagesError";
  }
}

const PATH = Symbol.for("@spacefast/zero-pages#path");
const SHAPE = Symbol.for("@spacefast/zero-pages#shape");
const FALLBACK = Symbol.for("@spacefast/zero-pages#fallback");

interface Target {
  [PATH]: PathSegment[];
  [SHAPE]: Shape;
  [FALLBACK]: string | number | undefined;
}

export function describePath(path: readonly PathSegment[]): string {
  const [root, ...rest] = path;
  const head = String(root).startsWith("loop") ? "item" : String(root).startsWith("index") ? "index" : String(root);
  return [head, ...rest.map((segment) => (typeof segment === "string" && segment.startsWith("@href:") ? "href" : String(segment)))].join(".");
}

/** The closest name by edit distance, for "did you mean". */
function suggest(name: string, candidates: readonly string[]): string {
  let best: string | null = null;
  let bestScore = Math.max(2, Math.floor(name.length / 3)) + 1;
  for (const candidate of candidates) {
    const score = distance(name.toLowerCase(), candidate.toLowerCase());
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best === null ? "" : ` Did you mean "${best}"?`;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** Column types whose values are structured; reading into them is not checked further. */
const OPEN_TYPES = new Set(["json", "group", "repeater", "blocks", "mediaList", "select"]);

function fieldShape(collection: string, field: string, path: readonly PathSegment[]): { shape: Shape; segment: PathSegment } {
  const info = registry.schema[collection];
  if (info === undefined) throw new PagesError("unknown_collection", `There is no collection or table named "${collection}".`);
  if (field === "href") {
    if (!registry.routed.has(collection)) {
      throw new PagesError("unknown_field", `${describePath(path)}.href exists only for a collection with a collectionPage() route; "${collection}" has none.`);
    }
    return { shape: { kind: "scalar", label: `${describePath(path)}.href` }, segment: `@href:${collection}` };
  }
  const column = Object.hasOwn(info.columns, field) ? info.columns[field] : undefined;
  if (column === undefined) {
    throw new PagesError("unknown_field", `${collection} has no field "${field}".${suggest(field, Object.keys(info.columns))}`);
  }
  const label = `${describePath(path)}.${field}`;
  return { shape: OPEN_TYPES.has(column.type) ? { kind: "open", label } : { kind: "scalar", label, type: column.type }, segment: field };
}

function child(path: PathSegment[], shape: Shape, prop: string): unknown {
  switch (shape.kind) {
    case "open":
      return symbolic([...path, prop], { kind: "open", label: `${shape.label}.${prop}` });
    case "row": {
      const { shape: next, segment } = fieldShape(shape.collection, prop, path);
      return symbolic([...path, segment], next);
    }
    case "rows":
      if (prop === "length") return symbolic([...path, "length"], { kind: "scalar", label: `${describePath(path)}.length` });
      throw new PagesError(
        "dynamic_value",
        `${describePath(path)} is a list of ${shape.collection} rows per request; read rows with .map() (or .length), not .${prop}.`,
      );
    case "record": {
      const next = Object.hasOwn(shape.fields, prop) ? shape.fields[prop] : undefined;
      if (next === undefined) {
        throw new PagesError("unknown_field", `${shape.label} has no "${prop}".${suggest(prop, Object.keys(shape.fields))}`);
      }
      return symbolic([...path, prop], next);
    }
    case "scalar":
      throw new PagesError(
        "dynamic_call",
        `${shape.label} is a per-request value, so .${prop} cannot be computed while the page builds. Use the value directly, in a template string, or in <Show>.`,
      );
  }
}

const handler: ProxyHandler<Target> = {
  get(target, prop) {
    if (prop === PATH) return target[PATH];
    if (prop === SHAPE) return target[SHAPE];
    if (prop === FALLBACK) return target[FALLBACK];
    const path = target[PATH];
    if (prop === Symbol.toPrimitive || prop === "toString" || prop === "valueOf") {
      if (target[SHAPE].kind === "rows" || target[SHAPE].kind === "row" || target[SHAPE].kind === "record") {
        return () => {
          throw new PagesError("dynamic_value", `${describePath(path)} is a record per request; read one of its fields instead of turning it into text.`);
        };
      }
      return (hint?: string) => {
        // Template literals and String() ask for a string. `+`, `==`, `<` and arithmetic ask for
        // "default" or "number": those would compare or add a placeholder at build time, never the value.
        if (prop === Symbol.toPrimitive && hint !== "string") {
          throw new PagesError(
            "dynamic_operator",
            `${describePath(path)} is a per-request value; comparing it or using it in arithmetic or \`+\` cannot be answered at build time. Use a template string, <Show>, or orElse().`,
          );
        }
        return registry.token(spec(path, "string", target[FALLBACK]));
      };
    }
    if (prop === "toJSON") {
      return () => {
        throw new PagesError("dynamic_value", `${describePath(path)} is request data; it has no value at build time to serialize.`);
      };
    }
    // Probes from runtimes and the JSX normalizer: a symbolic value is never a thenable, iterator or React element.
    if (typeof prop === "symbol" || prop === "then" || prop === "$$typeof" || prop === "kind") return undefined;
    if (prop === "map" && target[SHAPE].kind === "rows") {
      const shape = target[SHAPE];
      return (fn: unknown) => {
        if (typeof fn !== "function") throw new PagesError("dynamic_call", `${describePath(path)}.map() needs a function.`);
        return loop(path, shape.collection, fn as (item: unknown, index: unknown) => unknown);
      };
    }
    return child(path, target[SHAPE], prop);
  },
  apply(target) {
    throw new PagesError(
      "dynamic_call",
      `${describePath(target[PATH])}() runs per request in PHP, so it cannot be called while the page builds.`,
    );
  },
  set(target, prop) {
    throw new PagesError("dynamic_value", `${describePath(target[PATH])}.${String(prop)} is request data and is read-only.`);
  },
  ownKeys(target) {
    throw new PagesError(
      "dynamic_value",
      `${describePath(target[PATH])} is request data; its keys are not known at build time. Read named fields instead of spreading or listing it.`,
    );
  },
  has(target) {
    throw new PagesError("dynamic_value", `${describePath(target[PATH])} is request data; \`in\` cannot be answered at build time.`);
  },
  deleteProperty(target, prop) {
    throw new PagesError("dynamic_value", `${describePath(target[PATH])}.${String(prop)} is request data and is read-only.`);
  },
  defineProperty(target, prop) {
    throw new PagesError("dynamic_value", `${describePath(target[PATH])}.${String(prop)} is request data and is read-only.`);
  },
};

function spec(path: PathSegment[], mode: TokenMode, fallback: string | number | undefined): TokenSpec {
  return fallback === undefined ? { path, mode } : { path, mode, fallback };
}

export function symbolic(path: PathSegment[], shape: Shape, fallback?: string | number): unknown {
  // A function target so `apply` can refuse a call with a clear message instead of "not a function".
  const target = Object.assign(function symbolicValue() {}, { [PATH]: path, [SHAPE]: shape, [FALLBACK]: fallback }) as unknown as Target;
  return new Proxy(target, handler);
}

export function fallbackOf(value: unknown): string | number | undefined {
  if (pathOf(value) === undefined) return undefined;
  return (value as unknown as Record<symbol, string | number | undefined>)[FALLBACK];
}

/** The path a symbolic value was read from, or undefined for an ordinary value. */
export function pathOf(value: unknown): PathSegment[] | undefined {
  if (typeof value !== "function") return undefined;
  const path = (value as unknown as Record<symbol, unknown>)[PATH];
  return Array.isArray(path) ? (path as PathSegment[]) : undefined;
}

export function shapeOf(value: unknown): Shape | undefined {
  if (pathOf(value) === undefined) return undefined;
  return (value as unknown as Record<symbol, Shape>)[SHAPE];
}

/** Block names the compiler turns into server-rendered regions. Never editor-inserted. */
export const EACH_BLOCK = "zero-pages/each";
export const SHOW_BLOCK = "zero-pages/show";
export const ISLAND_BLOCK = "zero-pages/island";
export const RICH_TEXT_BLOCK = "zero-pages/rich-text";

function loop(of: PathSegment[], collection: string, fn: (item: unknown, index: unknown) => unknown): unknown {
  registry.loops += 1;
  const n = registry.loops;
  const content = fn(symbolic([`loop${n}`], { kind: "row", collection }), symbolic([`index${n}`], { kind: "scalar", label: "index" }));
  const id = registry.region("e", { kind: "each", of, loop: n });
  return { kind: "block", blockName: EACH_BLOCK, attrs: { region: id }, inner: contentList(tokenize(content)) };
}

/** Normalize like the JSX runtime does, without importing it (this module stays dependency-free). */
export function contentList(value: unknown): unknown[] {
  if (value === null || value === undefined || typeof value === "boolean") return [];
  if (Array.isArray(value)) return value.flatMap(contentList);
  if (typeof value === "string") return [{ kind: "text", text: value }];
  if (typeof value === "number") return [{ kind: "text", text: String(value) }];
  if (typeof value === "object" && (value as { kind?: unknown }).kind === "element" && (value as { tag?: unknown }).tag === "") {
    return contentList((value as { children: unknown[] }).children);
  }
  return [value];
}

/**
 * Replace every symbolic value in a tree of plain data and content nodes
 * with its token. Functions stay (a render callback is not data).
 */
export function tokenize(value: unknown): unknown {
  const path = pathOf(value);
  if (path !== undefined) {
    const shape = shapeOf(value);
    if (shape?.kind === "row" || shape?.kind === "rows" || shape?.kind === "record") {
      throw new PagesError("dynamic_value", `${describePath(path)} is a record per request; render one of its fields, not the whole record.`);
    }
    return registry.token(spec(path, "child", fallbackOf(value)));
  }
  if (Array.isArray(value)) return value.map(tokenize);
  if (value !== null && typeof value === "object") {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = tokenize(entry);
    return out;
  }
  return value;
}

export function hasToken(value: unknown): boolean {
  if (typeof value === "string") return value.includes(TOKEN_START);
  if (Array.isArray(value)) return value.some(hasToken);
  if (value !== null && typeof value === "object") return Object.values(value).some(hasToken);
  return false;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (text: string): string => text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!);
const VOID = new Set(["area", "br", "col", "hr", "img", "input", "source", "track", "wbr"]);
/** Tags whose content is not ordinary text: a token there could not be escaped for its context. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "iframe", "noscript", "template", "xmp", "noembed", "noframes", "plaintext", "object", "embed"]);
const TAG = /^[a-z][a-z0-9-]*$/;
const ATTRIBUTE = /^[a-zA-Z_:][a-zA-Z0-9_.:-]*$/;

/**
 * An island's children as HTML. Any ordinary tag and `data-wp-*` attribute is
 * allowed (the Interactivity API reads them), every text and attribute value is
 * escaped here, and per-request values stay tokens that PHP fills and escapes
 * for their own context. Event-handler props, `style` and raw-text elements are
 * refused: the browser module owns behavior.
 */
export function islandHtml(value: unknown): string {
  return contentList(tokenize(value)).map((node) => islandNode(node)).join("");
}

function islandNode(node: unknown): string {
  const n = node as { kind?: unknown; text?: unknown; tag?: unknown; props?: Record<string, unknown>; children?: unknown[]; blockName?: unknown };
  if (n.kind === "text" && typeof n.text === "string") return escape(n.text);
  if (n.kind === "element" && typeof n.tag === "string") {
    if (n.tag === "") return (n.children ?? []).map(islandNode).join("");
    if (!TAG.test(n.tag) || RAW_TEXT.has(n.tag)) throw new PagesError("island", `<${n.tag}> cannot be part of an island; use ordinary elements and a client module.`);
    let attributes = "";
    for (const [name, raw] of Object.entries(n.props ?? {})) {
      const attribute = name === "className" ? "class" : name === "htmlFor" ? "for" : name;
      if (!ATTRIBUTE.test(attribute) || /^on/i.test(attribute) || attribute === "style" || attribute === "srcdoc") {
        throw new PagesError("island", `<${n.tag} ${name}> is not allowed in an island; behavior belongs in the client module (data-wp-on--click) and styling in CSS.`);
      }
      if (raw === null || raw === undefined || raw === false) continue;
      if (raw === true) {
        attributes += ` ${attribute}`;
        continue;
      }
      if (typeof raw !== "string" && !(typeof raw === "number" && Number.isFinite(raw))) {
        throw new PagesError("island", `<${n.tag} ${name}> must be a string or number.`);
      }
      if (/^(href|src|action|formaction|xlink:href)$/i.test(attribute) && !hasToken(String(raw)) && /^\s*(javascript|data|vbscript):/i.test(String(raw))) {
        throw new PagesError("island", `<${n.tag} ${name}> uses a scriptable URL scheme.`);
      }
      attributes += ` ${attribute}="${escape(String(raw))}"`;
    }
    if (VOID.has(n.tag)) return `<${n.tag}${attributes}>`;
    return `<${n.tag}${attributes}>${(n.children ?? []).map(islandNode).join("")}</${n.tag}>`;
  }
  if (n.kind === "block") throw new PagesError("island", `${String(n.blockName)} is a block; an island holds plain HTML.`);
  throw new PagesError("island", "An island holds elements and text.");
}
