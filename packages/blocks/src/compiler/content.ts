import { hasErrors, type Diagnostic } from "../diagnostics.ts";
import { toContentNodes } from "../jsx-runtime.ts";
import { mapToBlocks } from "../mapping.ts";
import type { BlockNode } from "../nodes.ts";
import { renderModule } from "./module.ts";
import { serializeBlocks } from "./serialize.ts";

export interface ContentResult {
  /** Serialized block markup; empty when any diagnostic is an error. */
  markup: string;
  blocks: BlockNode[];
  diagnostics: Diagnostic[];
}

/**
 * Compile one `.tsx` file to block markup: execute, map, serialize. Each
 * stage runs only when the previous one produced no error, and every stage
 * reports everything it found rather than the first thing.
 */
export async function compileContent(file: string): Promise<ContentResult> {
  const executed = await renderModule(file);
  if (hasErrors(executed.diagnostics)) return { markup: "", blocks: [], diagnostics: executed.diagnostics };
  const mapped = mapToBlocks(toContentNodes(executed.rendered));
  if (hasErrors(mapped.diagnostics)) return { markup: "", blocks: mapped.blocks, diagnostics: mapped.diagnostics };
  const serialized = await serializeBlocks(mapped.blocks);
  return { markup: serialized.markup, blocks: mapped.blocks, diagnostics: [...mapped.diagnostics, ...serialized.diagnostics] };
}
