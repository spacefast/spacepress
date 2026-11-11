/**
 * `@spacefast/first-blocks`: the authoring surface for `.tsx` content and themes.
 *
 * A file default-exports a component. Imports, loops and conditionals are real
 * code and run once, at build time; what ships is serialized Gutenberg block
 * markup that opens valid in the editor. Native HTML is the vocabulary (`<p>`
 * is `core/paragraph`), and this module adds only what HTML cannot spell:
 * naming a block directly.
 */
import { toContentNodes } from "./jsx-runtime.ts";
import type { BlockAttributes, BlockNode } from "./nodes.ts";

export { Fragment, createElement } from "./jsx-runtime.ts";
export type { JSX } from "./jsx-runtime.ts";
export type { BlockAttributes, BlockNode, ContentNode, ElementNode, ElementProps, SourceLocation, TextNode } from "./nodes.ts";
export type { Diagnostic, DiagnosticCode, Severity } from "./diagnostics.ts";

/**
 * Build a typed component for one block name. Props become the block's
 * attributes; children become its inner content.
 */
export function blockComponent<A extends BlockAttributes>(blockName: string): (props: A & { children?: unknown }) => BlockNode {
  return (props) => {
    const { children, ...attrs } = props;
    return { kind: "block", blockName, attrs, inner: toContentNodes(children) };
  };
}

/**
 * The escape hatch: name any block, registered or not. A third-party block
 * serializes with its attributes and children as written; the compiler cannot
 * check those and says so once per build.
 */
export function Block(props: { name: string; attrs?: BlockAttributes; children?: unknown }): BlockNode {
  return { kind: "block", blockName: props.name, attrs: props.attrs ?? {}, inner: toContentNodes(props.children) };
}
