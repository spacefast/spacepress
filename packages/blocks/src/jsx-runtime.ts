import { ContentError } from "./diagnostics.ts";
import { isContentNode, type ContentNode, type ElementNode, type ElementProps, type SourceLocation } from "./nodes.ts";

/**
 * The automatic-runtime entry point (`jsxImportSource: "@spacefast/zero-blocks"`).
 *
 * It has the shape of a JSX runtime and none of the machinery: no vdom, no
 * reconciliation, no keys. `jsx` runs once per element while the authored
 * module executes at build time and hands back a {@link ContentNode}.
 *
 * Function components are transparent: `jsx(Component, props)` calls the
 * component and returns what it returned. Nothing records that a component
 * was involved, which is what makes a `<Card>` a classed `<div>` by the time
 * the mapper sees it. The one thing kept from the call site is its location:
 * a node a component returned without one gets the location of the JSX that
 * used the component, so `<Block.Core.Cover>` on line 12 reports line 12.
 */

export const Fragment: unique symbol = Symbol.for("@spacefast/zero-blocks#Fragment");

/** The tag a fragment parks its children under until something splices them. */
const FRAGMENT_TAG = "";

// A plain boolean on purpose: a type predicate's false branch would exclude every ElementNode.
function isFragmentNode(node: ContentNode): boolean {
  return node.kind === "element" && node.tag === FRAGMENT_TAG;
}

function appendChild(into: ContentNode[], child: unknown, loc: SourceLocation | undefined): void {
  // Nullish and booleans are how JSX spells "nothing here". Numbers are
  // content and stringify; `0` is a real character, not a falsy hole.
  if (child === null || child === undefined || typeof child === "boolean") return;
  if (typeof child === "string") {
    into.push({ kind: "text", text: child });
    return;
  }
  if (typeof child === "number") {
    into.push({ kind: "text", text: String(child) });
    return;
  }
  if (Array.isArray(child)) {
    for (const entry of child) appendChild(into, entry, loc);
    return;
  }
  if (isContentNode(child)) {
    if (child.kind === "element" && isFragmentNode(child)) into.push(...child.children);
    else into.push(child);
    return;
  }
  const what = typeof child === "object" ? (Object.getPrototypeOf(child)?.constructor?.name ?? "object") : typeof child;
  throw new ContentError(
    "not_content",
    `A value that is not content reached the JSX tree: ${what}. Content is elements, blocks, strings and numbers.`,
    loc,
  );
}

/**
 * Normalize anything a component returned into a flat list of content nodes:
 * fragments splice, arrays flatten, text and numbers become text nodes, and
 * the JSX-nothing values drop.
 */
export function toContentNodes(value: unknown, loc?: SourceLocation): ContentNode[] {
  const nodes: ContentNode[] = [];
  appendChild(nodes, value, loc);
  return nodes;
}

/** Wrap a normalized list back into a single node, fragmenting when needed. */
function collapse(nodes: ContentNode[]): ContentNode {
  if (nodes.length === 1) return nodes[0]!;
  return { kind: "element", tag: FRAGMENT_TAG, props: {}, children: nodes };
}

/**
 * Record the call site on everything a component returned: as the location
 * of nodes that have none, and as `usedAt` on nodes that already have their
 * own (the JSX inside the component), so a diagnostic can name both.
 */
function locate(node: ContentNode, loc: SourceLocation | undefined): ContentNode {
  if (loc === undefined || node.kind === "text") return node;
  if (node.kind === "element" && isFragmentNode(node)) {
    return { ...node, children: node.children.map((child) => locate(child, loc)) };
  }
  if (node.loc !== undefined && (node.loc.usedAt !== undefined || sameLocation(node.loc, loc))) return node;
  // A root the component built without JSX (`Block({...})`) takes the call site as its own
  // location; the JSX under it still has positions of its own, which get the call site as `usedAt`.
  const at = node.loc === undefined ? loc : { ...node.loc, usedAt: loc };
  return node.kind === "element"
    ? { ...node, loc: at, children: node.children.map((child) => locate(child, loc)) }
    : { ...node, loc: at, inner: node.inner.map((child) => locate(child, loc)) };
}

function sameLocation(a: SourceLocation, b: SourceLocation): boolean {
  return a.file === b.file && a.line === b.line && a.column === b.column;
}

/**
 * A ContentError thrown while a component's own JSX was being built never
 * reached `locate`, so it carries the component's position but not the call
 * site. Give it the same two places a diagnostic from the returned tree has.
 */
function usedAt(error: unknown, loc: SourceLocation | undefined): unknown {
  if (loc === undefined || !(error instanceof ContentError)) return error;
  if (error.loc !== undefined && (error.loc.usedAt !== undefined || sameLocation(error.loc, loc))) return error;
  const relocated = new ContentError(error.code, error.message, error.loc === undefined ? loc : { ...error.loc, usedAt: loc });
  if (error.stack !== undefined) relocated.stack = error.stack;
  return relocated;
}

/** What the TSX transform passes as the fifth argument of `jsxDEV`. */
interface JsxSource {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

declare global {
  // Set by the compiler's bundler (see compiler/module.ts): the directory esbuild's relative fileNames are relative to.
  // eslint-disable-next-line no-var
  var __zeroBlocksSourceRoot: string | undefined;
}

function toLocation(source: JsxSource | undefined): SourceLocation | undefined {
  if (!source || typeof source.fileName !== "string") return undefined;
  const root = globalThis.__zeroBlocksSourceRoot;
  const file = root !== undefined && !source.fileName.startsWith("/") ? `${root.replace(/\/$/, "")}/${source.fileName}` : source.fileName;
  return { file, line: source.lineNumber, column: source.columnNumber };
}

function create(type: unknown, props: ElementProps | null | undefined, loc: SourceLocation | undefined): ContentNode {
  // `key` is React's reconciliation hint and never content; the transform usually lifts it out of
  // props, but a key after a spread stays in them, and it is ignored either way.
  const { children, key: _key, ...rest } = props ?? {};

  if (type === Fragment) {
    return { kind: "element", tag: FRAGMENT_TAG, props: {}, children: toContentNodes(children, loc) };
  }

  if (typeof type === "function") {
    let rendered: unknown;
    try {
      rendered = (type as (props: ElementProps) => unknown)(children === undefined ? rest : { ...rest, children });
    } catch (error) {
      throw usedAt(error, loc);
    }
    return locate(collapse(toContentNodes(rendered, loc)), loc);
  }

  if (typeof type !== "string") {
    throw new ContentError(
      "not_content",
      `${String(type)} was used as an element type. Use an HTML tag, a function component, or a block component.`,
      loc,
    );
  }

  const node: ElementNode = { kind: "element", tag: type, props: rest, children: toContentNodes(children, loc) };
  if (loc) node.loc = loc;
  return node;
}

/** The production transform's entry: no source positions. */
export function jsx(type: unknown, props: ElementProps, _key?: unknown): ContentNode {
  return create(type, props, undefined);
}

/**
 * The classic transform's entry. The automatic transform falls back to it for
 * one shape, a `key` written after a spread (`<p {...props} key="k">`), and
 * imports it from the `jsxImportSource` package itself.
 */
export function createElement(type: unknown, props: ElementProps | null | undefined, ...children: unknown[]): ContentNode {
  return create(type, children.length === 0 ? props : { ...props, children: children.length === 1 ? children[0] : children }, undefined);
}

export const jsxs = jsx;

/** The development transform's entry, which is what the compiler uses so every node has a location. */
export function jsxDEV(type: unknown, props: ElementProps, _key?: unknown, _isStatic?: boolean, source?: JsxSource): ContentNode {
  return create(type, props, toLocation(source));
}

/**
 * The JSX types an authored `.tsx` typechecks against. Intrinsics stay open:
 * the mapper, not the type system, tells an author that a `style` prop or an
 * unmappable tag is a mistake, with a diagnostic that names the fix.
 */
export declare namespace JSX {
  type Element = ContentNode;
  interface ElementChildrenAttribute {
    children: Record<string, never>;
  }
  /** `key` is accepted everywhere, as in React, and ignored: nothing here reconciles. */
  interface IntrinsicAttributes {
    key?: string | number | undefined;
  }
  interface IntrinsicElements {
    [tag: string]: ElementProps;
  }
}
