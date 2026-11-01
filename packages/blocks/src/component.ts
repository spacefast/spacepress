/**
 * The two ways to name a block directly: a typed component for one block
 * name, and the untyped escape hatch for any name.
 */
import { toContentNodes } from "./jsx-runtime.ts";
import type { BlockAttributes, BlockNode } from "./nodes.ts";

/** A block component: props are the block's attributes, children its inner content. */
export type BlockComponent<A extends object> = (props: A & { children?: unknown }) => BlockNode;

/**
 * Build a typed component for one block name. Props become the block's
 * attributes; children become its inner content.
 */
export function blockComponent<A extends object>(blockName: string): BlockComponent<A> {
  return (props) => {
    const { children, ...attrs } = props;
    return { kind: "block", blockName, attrs: attrs as BlockAttributes, inner: toContentNodes(children) };
  };
}

/**
 * The escape hatch: name any block, registered or not. A third-party block
 * serializes with its attributes and children as written; the compiler cannot
 * check those and says so once per build.
 */
export function namedBlock(props: { name: string; attrs?: BlockAttributes; children?: unknown }): BlockNode {
  return { kind: "block", blockName: props.name, attrs: props.attrs ?? {}, inner: toContentNodes(props.children) };
}
