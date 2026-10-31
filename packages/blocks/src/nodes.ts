/**
 * The content tree a `.tsx` file compiles to.
 *
 * This is not a vdom. The compiler executes the authored module once at build
 * time, walks the tree it returned, and serializes it to Gutenberg block
 * markup. Three node kinds are enough: an HTML element as the author wrote it
 * (before the mapper decides whether it becomes a block or folds into rich
 * text), a block by name, and a run of text. Every element and block carries
 * the source location the JSX transform handed the runtime, which is what
 * lets a diagnostic say `templates/index.tsx:14:9`.
 */

/** Where in the author's file a node was written. 1-based line and column. */
export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

/**
 * Props as an author wrote them in JSX, before anything looked at them. Open
 * by construction: the mapper, not the type system, decides which of them a
 * block can carry and reports the rest.
 */
export type ElementProps = Record<string, unknown>;

/** A block's attribute bag. Whose keys and shapes belong to the block. */
export type BlockAttributes = Record<string, unknown>;

/** An HTML tag as authored, pre-mapping. */
export interface ElementNode {
  kind: "element";
  /** Lowercase tag name. */
  tag: string;
  /** Authored props minus `children`. */
  props: ElementProps;
  children: ContentNode[];
  loc?: SourceLocation;
}

/** A Gutenberg block, named and attributed. */
export interface BlockNode {
  kind: "block";
  /** Namespaced block name: `core/paragraph`, `acme/thing`. */
  blockName: string;
  attrs: BlockAttributes;
  /** Inner blocks, rich-text elements, or both. */
  inner: ContentNode[];
  loc?: SourceLocation;
}

/** A run of author text. Unescaped: the serializer owns escaping. */
export interface TextNode {
  kind: "text";
  text: string;
}

export type ContentNode = ElementNode | BlockNode | TextNode;

export function isContentNode(value: unknown): value is ContentNode {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "element" || kind === "block" || kind === "text";
}
