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

function isFragmentNode(node: ContentNode): node is ElementNode {
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
    if (isFragmentNode(child)) into.push(...child.children);
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

/** Give nodes a component returned the call site's location when they have none. */
function locate(node: ContentNode, loc: SourceLocation | undefined): ContentNode {
  if (loc === undefined || node.kind === "text") return node;
  if (isFragmentNode(node)) {
    return { ...node, children: node.children.map((child) => locate(child, loc)) };
  }
  return node.loc === undefined ? { ...node, loc } : node;
}

/** What the TSX transform passes as the fifth argument of `jsxDEV`. */
interface JsxSource {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

function toLocation(source: JsxSource | undefined): SourceLocation | undefined {
  if (!source || typeof source.fileName !== "string") return undefined;
  return { file: source.fileName, line: source.lineNumber, column: source.columnNumber };
}

function create(type: unknown, props: ElementProps | null | undefined, loc: SourceLocation | undefined): ContentNode {
  const { children, ...rest } = props ?? {};

  if (type === Fragment) {
    return { kind: "element", tag: FRAGMENT_TAG, props: {}, children: toContentNodes(children, loc) };
  }

  if (typeof type === "function") {
    const rendered = (type as (props: ElementProps) => unknown)(props ?? {});
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
