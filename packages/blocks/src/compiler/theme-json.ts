/**
 * Validate a `theme.json` document against the official WordPress 7.1 schema
 * committed at `schemas/theme-7.1.json`, the same file the generated
 * `ThemeJson` type comes from.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";

export const THEME_JSON_SCHEMA_URL = "https://schemas.wp.org/wp/7.1/theme.json";

const require = createRequire(import.meta.url);
let compiled: ValidateFunction | null = null;

function validator(): ValidateFunction {
  if (compiled !== null) return compiled;
  const schema = JSON.parse(readFileSync(require.resolve("../../schemas/theme-7.1.json"), "utf8")) as object;
  // Strict, except that the schema's `styles.blocks` uses a pattern property (`core/*`) beside
  // named ones, which ajv's strict mode flags unless told the overlap is intended.
  const ajv = new Ajv({ strict: true, allowMatchingProperties: true, allErrors: true });
  compiled = ajv.compile(schema);
  return compiled;
}

export interface SchemaProblem {
  /** A JSON pointer into the document (`/settings/color/palette/0`). Empty for the root. */
  pointer: string;
  message: string;
}

/**
 * The problems in a document, deepest first and without the noise ajv's
 * `anyOf`/`enum` combinators add above the real one. Empty when valid.
 */
export function validateThemeJson(document: unknown): SchemaProblem[] {
  const validate = validator();
  if (validate(document)) return [];
  const errors = (validate.errors ?? []) as ErrorObject[];
  // The schema spells "no unknown keys" as `propertyNames: { enum: [...] }` on `settings` and
  // `styles`, which reports the whole object; ajv puts the offending key in `propertyName`.
  const problems = new Map<string, SchemaProblem>();
  for (const error of errors) {
    if (error.keyword === "anyOf" || error.keyword === "oneOf" || error.keyword === "if") continue;
    let pointer = error.instancePath;
    let message = error.message ?? error.keyword;
    if (error.keyword === "enum" && typeof error.propertyName === "string") {
      pointer = `${error.instancePath}/${error.propertyName.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      message = "is not a key WordPress 7.1's theme.json knows";
    } else if (error.keyword === "propertyNames") continue;
    else if (error.keyword === "additionalProperties") {
      const extra = (error.params as { additionalProperty?: string }).additionalProperty ?? "";
      pointer = `${error.instancePath}/${extra.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      message = "is not a key WordPress 7.1's theme.json knows";
    } else if (error.keyword === "enum") {
      message = `must be one of ${((error.params as { allowedValues?: unknown[] }).allowedValues ?? []).map((v) => JSON.stringify(v)).join(", ")}`;
    } else if (error.keyword === "const") {
      message = `must be ${JSON.stringify((error.params as { allowedValue?: unknown }).allowedValue)}`;
    }
    problems.set(`${pointer} ${message}`, { pointer, message });
  }
  const list = [...problems.values()];
  // Deepest pointers first: a bad palette entry is the finding, `/settings` failing is its echo.
  list.sort((a, b) => b.pointer.split("/").length - a.pointer.split("/").length || (a.pointer < b.pointer ? -1 : 1));
  const deepest = list[0]?.pointer.split("/").length ?? 0;
  return list.filter((p) => p.pointer.split("/").length === deepest || !list.some((q) => q !== p && q.pointer.startsWith(`${p.pointer}/`)));
}
