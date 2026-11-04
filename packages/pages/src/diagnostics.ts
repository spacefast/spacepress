import type { Diagnostic as BlocksDiagnostic, SourceLocation } from "@spacefast/zero-blocks";

/**
 * Everything the pages build can refuse, by code. Errors mean nothing is
 * written and the previous output stays in place.
 */
export type PagesCode =
  | BlocksDiagnostic["code"]
  | "route_shape"
  | "route_collision"
  | "reserved_path"
  | "route_id"
  | "config"
  | "metadata"
  | "load"
  | "not_routable"
  | "unknown_collection"
  | "unknown_field"
  | "dynamic_value"
  | "dynamic_call"
  | "dynamic_operator"
  | "dynamic_attribute"
  | "dynamic_query"
  | "dynamic_region"
  | "static_condition"
  | "event_handler"
  | "async_component"
  | "query_value"
  | "rich_text"
  | "island"
  | "trusted_db"
  | "browser_global"
  | "css"
  | "output";

export interface PagesDiagnostic {
  code: PagesCode;
  severity: "error" | "warning" | "info";
  message: string;
  hint?: string;
  loc?: SourceLocation;
}

export function format(diagnostic: PagesDiagnostic, root: string): string {
  const where = diagnostic.loc === undefined ? "" : `${relative(diagnostic.loc.file, root)}:${diagnostic.loc.line}:${diagnostic.loc.column} `;
  const used = diagnostic.loc?.usedAt === undefined ? "" : ` (used at ${relative(diagnostic.loc.usedAt.file, root)}:${diagnostic.loc.usedAt.line}:${diagnostic.loc.usedAt.column})`;
  return `${where}${diagnostic.code}: ${diagnostic.message}${used}${diagnostic.hint === undefined ? "" : ` ${diagnostic.hint}`}`;
}

function relative(file: string, root: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

export function hasErrors(diagnostics: readonly PagesDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
