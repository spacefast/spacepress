/**
 * The one PHP file this package writes: a pattern's header comment, in the
 * exact form `WP_Theme::get_block_patterns()` reads with `get_file_data()`,
 * followed by the markup. Nothing executable.
 */
import type { PatternMeta } from "../theme/define.ts";

/** The header lines, in WordPress's order; only the fields set, `Title` and `Slug` always. */
export function patternHeader(meta: PatternMeta, slug: string): string[] {
  const list = (values: readonly string[] | undefined) => (values && values.length > 0 ? values.join(", ") : undefined);
  const fields: [string, string | undefined][] = [
    ["Title", meta.title],
    ["Slug", slug],
    ["Description", meta.description],
    ["Viewport Width", meta.viewportWidth === undefined ? undefined : String(meta.viewportWidth)],
    ["Inserter", meta.inserter === undefined ? undefined : meta.inserter ? "yes" : "no"],
    ["Categories", list(meta.categories)],
    ["Keywords", list(meta.keywords)],
    ["Block Types", list(meta.blockTypes)],
    ["Post Types", list(meta.postTypes)],
    ["Template Types", list(meta.templateTypes)],
  ];
  return fields.flatMap(([name, value]) => (value === undefined || value === "" ? [] : [`${name}: ${value}`]));
}

/** A header value cannot contain a newline (`get_file_data` reads one line) or close the comment. */
export function headerValueProblem(value: string): string | null {
  if (/[\r\n]/.test(value)) return "contains a line break";
  const closer = "*" + "/";
  if (value.includes(closer) || value.includes("?>")) return `contains "${closer}" or "?>", which ends the header`;
  return null;
}

export function renderPatternFile(meta: PatternMeta, slug: string, markup: string): string {
  const header = patternHeader(meta, slug).map((line) => ` * ${line}`).join("\n");
  const close = " " + "*" + "/";
  return `<?php\n/**\n${header}\n${close}\n?>\n${markup.endsWith("\n") ? markup : `${markup}\n`}`;
}

/**
 * Read a pattern file's header the way WordPress does: the first 8 KB, one
 * `Name: value` per line after optional comment punctuation, the value cut at
 * the comment closer or `?>` and trimmed; lists split on commas and whitespace. For tests,
 * so the writer is checked by a reader and not by the text it wrote.
 */
export function readPatternHeader(file: string): Record<string, string | string[]> {
  const head = file.slice(0, 8 * 1024).replace(/\r/g, "\n");
  const names = ["Title", "Slug", "Description", "Viewport Width", "Inserter", "Categories", "Keywords", "Block Types", "Post Types", "Template Types"];
  const lists = new Set(["Categories", "Keywords", "Block Types", "Post Types", "Template Types"]);
  const out: Record<string, string | string[]> = {};
  for (const name of names) {
    const match = new RegExp(`^(?:[ \\t]*<\\?(?:php)?)?[ \\t/*#@]*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(.*)$`, "mi").exec(head);
    const value = match?.[1] ? match[1].replace(/\s*(?:\*\/|\?>).*/, "").trim() : "";
    if (value === "") continue;
    out[name] = lists.has(name) ? value.split(/[\s,]+/).filter((s) => s !== "") : value;
  }
  return out;
}
