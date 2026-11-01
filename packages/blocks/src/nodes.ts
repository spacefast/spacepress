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
  /**
   * When the node came out of a component, where that component was used.
   * A diagnostic inside `Card` then reads `card.tsx:2:3 … (used at page.tsx:12:7)`.
   */
  usedAt?: SourceLocation | undefined;
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

/**
 * Whether a value is a well-formed content node, all the way down. Values
 * cross from authored code, so each kind's required fields are checked at
 * every depth, not just the tag at the top.
 */
/** A dense array of content nodes: `every()` would skip a hole, and a hole is not content. */
function isContentList(value: unknown): value is ContentNode[] {
  return Array.isArray(value) && Array.from(value).every(isContentNode);
}

export function isContentNode(value: unknown): value is ContentNode {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case "text":
      return typeof v.text === "string";
    case "element":
      return typeof v.tag === "string" && isRecord(v.props) && isContentList(v.children);
    case "block":
      return typeof v.blockName === "string" && isRecord(v.attrs) && isContentList(v.inner);
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
