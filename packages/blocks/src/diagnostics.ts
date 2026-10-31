import type { SourceLocation } from "./nodes.ts";

/**
 * Everything the compiler can refuse, warn about, or mention, by code.
 *
 * Errors mean nothing is written. The list is closed on purpose: a tool that
 * reads `--json` output can switch on it.
 */
export type DiagnosticCode =
  // mapper
  | "style_prop_unsupported"
  | "unmappable_element"
  // serializer
  | "unknown_block"
  | "unknown_attribute"
  | "attribute_type"
  | "local_attribute"
  | "content_and_children"
  | "save_failed"
  | "unverified_block"
  // module execution
  | "module_failed"
  | "default_export_missing"
  | "not_content";

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  /** What went wrong, in one sentence. */
  message: string;
  /** What to write instead, when there is an answer. */
  hint?: string | undefined;
  loc?: SourceLocation | undefined;
}

/** `templates/index.tsx:14:9 unknown_attribute: … Did you mean "format"?` */
export function formatDiagnostic(diagnostic: Diagnostic, relativeTo?: string): string {
  const where = diagnostic.loc ? `${displayPath(diagnostic.loc.file, relativeTo)}:${diagnostic.loc.line}:${diagnostic.loc.column} ` : "";
  const hint = diagnostic.hint ? ` ${diagnostic.hint}` : "";
  return `${where}${diagnostic.code}: ${diagnostic.message}${hint}`;
}

function displayPath(file: string, relativeTo?: string): string {
  if (relativeTo && file.startsWith(relativeTo.endsWith("/") ? relativeTo : `${relativeTo}/`)) {
    return file.slice(relativeTo.length + (relativeTo.endsWith("/") ? 0 : 1));
  }
  return file;
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

/**
 * Thrown by the JSX runtime at the author's call site when a value that is not
 * content reaches it. The module executor turns it into a `not_content`
 * diagnostic; the location comes from the enclosing element when there is one.
 */
export class ContentError extends Error {
  readonly code: DiagnosticCode;
  readonly loc: SourceLocation | undefined;
  constructor(code: DiagnosticCode, message: string, loc?: SourceLocation) {
    super(message);
    this.name = "ContentError";
    this.code = code;
    this.loc = loc;
  }
}

/** The closest registered name to what the author typed, for hints. */
export function nearest(name: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = levenshtein(name.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best !== null && bestDistance <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
}

function levenshtein(a: string, b: string): number {
  const previous = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j]!;
      previous[j] = Math.min(above + 1, previous[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length]!;
}
