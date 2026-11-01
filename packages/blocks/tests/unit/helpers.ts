import path from "node:path";
import { fileURLToPath } from "node:url";

import { withBlockApi } from "../../src/compiler/serialize.ts";
import type { Diagnostic } from "../../src/diagnostics.ts";
import type { BlockNode, ContentNode } from "../../src/nodes.ts";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string): string => path.join(here, "fixtures", name);

export function text(value: string): ContentNode {
  return { kind: "text", text: value };
}

export function block(blockName: string, attrs: Record<string, unknown> = {}, inner: ContentNode[] = []): BlockNode {
  return { kind: "block", blockName, attrs, inner };
}

/** The same node with a source location on a given line, for diagnostics tests. */
export function at(node: BlockNode, line: number, column = 5): BlockNode {
  return { ...node, loc: { file: "/t/page.tsx", line, column } };
}

/** Block names at one level; a non-block reports its kind so a failure says what it got. */
export function names(nodes: readonly ContentNode[]): string[] {
  return nodes.map((node) => (node.kind === "block" ? node.blockName : `<${node.kind}>`));
}

export function blockAt(nodes: readonly ContentNode[], index: number): BlockNode {
  const node = nodes[index];
  if (node?.kind !== "block") throw new TypeError(`expected a block at ${index}, found ${node?.kind ?? "nothing"}`);
  return node;
}

/** The parts of a diagnostic a test cares about. `file` is the full path, so a wrong root fails. */
export function brief(d: Diagnostic) {
  return { code: d.code, severity: d.severity, file: d.loc?.file ?? null, line: d.loc?.line ?? null, column: d.loc?.column ?? null };
}

export interface Parsed {
  name: string;
  isValid: boolean;
  attributes: Record<string, unknown>;
  innerContent: (string | null)[];
  inner: Parsed[];
}

/**
 * Parse markup the way the editor would, from the same pinned packages, and
 * report what it saw. Rich-text attributes come back as `RichTextData`; the
 * HTML string it stands for is what round-tripped.
 */
export function reparse(markup: string): Promise<Parsed[]> {
  return withBlockApi((api) => {
    const flatten = (blocks: ReturnType<typeof api.parse>): Parsed[] =>
      blocks.map((b) => ({
        name: b.name,
        isValid: b.isValid,
        attributes: Object.fromEntries(
          Object.entries(b.attributes).map(([k, v]) => [k, typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype ? String(v) : v]),
        ),
        innerContent: (b.innerContent ?? []).map((part) => (typeof part === "string" ? part : null)),
        inner: flatten(b.innerBlocks as ReturnType<typeof api.parse>),
      }));
    return flatten(api.parse(markup));
  });
}

/**
 * True when every block at every depth passed the editor's validation. A block
 * the editor could not recognise comes back as a valid `core/missing`, which is
 * the opposite of what a caller means by valid, so it fails too.
 */
export function allValid(blocks: readonly Parsed[]): boolean {
  return blocks.every((b) => b.isValid && b.name !== "core/missing" && allValid(b.inner));
}
