/**
 * `@spacefast/zero-blocks`: the authoring surface for `.tsx` content and themes.
 *
 * A file default-exports a component. Imports, loops and conditionals are real
 * code and run once, at build time; what ships is serialized Gutenberg block
 * markup that opens valid in the editor. Native HTML is the vocabulary (`<p>`
 * is `core/paragraph`), and this module adds only what HTML cannot spell:
 * naming a block directly.
 */
export { Fragment, createElement } from "./jsx-runtime.ts";
export type { JSX } from "./jsx-runtime.ts";
export type { BlockAttributes, BlockNode, BlockObjectAttribute, ContentNode, ElementNode, ElementProps, SourceLocation, TextNode } from "./nodes.ts";
export type { Diagnostic, DiagnosticCode, Severity } from "./diagnostics.ts";
export { blockComponent, type BlockComponent } from "./component.ts";
export { Core } from "./blocks.generated.ts";
export * from "./blocks-popular.ts";

import { namedBlock } from "./component.ts";
import { Core } from "./blocks.generated.ts";

/**
 * Name a block directly. `<Block name="vendor/thing" attrs={…}>` is the escape
 * hatch for a block the registry does not know, written as authored and
 * reported once as unverified. `Block.Core.<Name>` is every core block
 * WordPress 7.1 registers, with its attributes typed from the registry.
 */
export const Block: typeof namedBlock & { readonly Core: typeof Core } = Object.assign(namedBlock, { Core });
