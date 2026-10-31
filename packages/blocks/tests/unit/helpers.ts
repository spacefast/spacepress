import { fileURLToPath } from "node:url";
import path from "node:path";

import type { BlockNode, ContentNode } from "../../src/nodes.ts";
import type { Diagnostic } from "../../src/diagnostics.ts";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string): string => path.join(here, "fixtures", name);

export function text(value: string): ContentNode {
  return { kind: "text", text: value };
}

export function block(blockName: string, attrs: Record<string, unknown> = {}, inner: ContentNode[] = []): BlockNode {
  return { kind: "block", blockName, attrs, inner };
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

/** The parts of a diagnostic a test cares about, with the file made relative to fixtures/. */
export function brief(d: Diagnostic) {
  return { code: d.code, severity: d.severity, file: d.loc ? path.basename(d.loc.file) : null, line: d.loc?.line ?? null, column: d.loc?.column ?? null };
}
