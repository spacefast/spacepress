// Resolves a tour against the compiled example: every pane's anchors are cut from the real sources
// and outputs at build time, so a stop that no longer matches fails the build. Text is shown with
// First names (lib/names.ts).
import { type Example } from "./examples.ts";
import { excerpt } from "./excerpt.ts";
import { toFirst } from "./names.ts";
import type { Artifact, Pane, Stop, Tour } from "../tour/stops.ts";

export interface ResolvedPane {
  /** What the visitor sees as the file name. */
  label: string;
  lang: "ts" | "php" | "sql";
  code: string;
}

export interface ResolvedStop extends Omit<Stop, "config" | "inputs" | "outputs"> {
  config: ResolvedPane;
  inputs: ResolvedPane[];
  outputs: ResolvedPane[];
}

export function artifactText(example: Example, artifact: Artifact): { label: string; lang: ResolvedPane["lang"]; text: string } {
  const { output } = example;
  switch (artifact) {
    case "schema.php":
      return { label: "first/app/schema.php", lang: "php", text: output.schemaPhp };
    case "functions.php":
      return { label: "first/app/functions.php", lang: "php", text: output.functionsPhp };
    case "migration": {
      const [name, sql] = output.migrations[0] ?? ["0001_init.sql", ""];
      return { label: `first/_generated/migrations/${name}`, lang: "sql", text: sql };
    }
    case "types.ts":
      return { label: "first/client/types.ts", lang: "ts", text: output.client["types.ts"] ?? "" };
    case "schema.ts":
      return { label: "first/client/schema.ts", lang: "ts", text: output.client["schema.ts"] ?? "" };
    case "zero.gen.ts":
      return { label: "first.gen.ts", lang: "ts", text: output.genTs };
  }
}

export function resolvePane(example: Example, pane: Pane): ResolvedPane {
  if (typeof pane.file === "string") {
    const text = example.files[pane.file];
    if (text === undefined) throw new Error(`examples/${example.name} has no ${pane.file}`);
    return { label: toFirst(pane.file), lang: "ts", code: toFirst(cut(text, pane, `examples/${example.name}/${pane.file}`)) };
  }
  const { label, lang, text } = artifactText(example, pane.file.artifact);
  return { label, lang, code: toFirst(cut(text, pane, `${example.name} ${label}`)) };
}

function cut(text: string, pane: Pane, where: string): string {
  try {
    return excerpt(text, pane.lines);
  } catch (error) {
    throw new Error(`${where}: ${(error as Error).message}`, { cause: error });
  }
}

export function resolveTour(tour: Tour, example: Example): ResolvedStop[] {
  return tour.stops.map((stop) => ({
    ...stop,
    title: toFirst(stop.title),
    prose: stop.prose.map(toFirst),
    config: resolvePane(example, stop.config),
    inputs: (stop.inputs ?? []).map((pane) => resolvePane(example, pane)),
    outputs: stop.outputs.map((pane) => resolvePane(example, pane)),
  }));
}
