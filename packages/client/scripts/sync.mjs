#!/usr/bin/env node
// Generates packages/client/src/index.mjs from runtime/client/index.ts using Node's built-in
// stripTypeScriptTypes so @spacepress/client stays in lockstep with the canonical WordPress
// Abilities + SpacePress REST client runtime with zero build dependencies.
import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");

let source = readFileSync(join(repo, "runtime/client/index.ts"), "utf8");

// Remove generated-client-only relative imports/exports.
source = source
  .replace(/^import \{ SCHEMA \} from "\.\/schema\.ts";\n/m, "")
  .replace(/^import type .* from "\.\/types\.ts";\n/m, "")
  .replace(/^export type \* from "\.\/types\.ts";\n/m, "")
  .replace(/^export \{ SCHEMA \};\n/m, "");

// Parameterize createClient(schema, options) and bind(schema), passing schema into dependencies().
source = source.replace(
  "export function createClient(options: ClientOptions = {}): Client {",
  `export function bind(schema: any) {
  return (options: ClientOptions = {}) => createClient(schema, options);
}

export function createClient(SCHEMA: any, options: ClientOptions = {}): Client {
  if (!SCHEMA || typeof SCHEMA !== "object" || !SCHEMA.collections) {
    throw new TypeError("createClient(schema, options?) requires a SpacePress SCHEMA descriptor (or use bind(SCHEMA))");
  }`,
);

// Thread SCHEMA into dependencies(...) calls inside createClient.
source = source
  .replaceAll("dependencies(", "dependencies(SCHEMA, ")
  .replace(
    "function dependencies(SCHEMA, key: string, w: unknown, where?: unknown, seen = new Set<string>()): string[] {",
    "function dependencies(SCHEMA: any, key: string, w: unknown, where?: unknown, seen = new Set<string>()): string[] {",
  );

const stripped = stripTypeScriptTypes(source, { mode: "transform" });
// Clean up excessive blank lines left where interface/type declarations were stripped.
const cleaned = stripped.replace(/\n{3,}/g, "\n\n").trimStart();

const header = `// Generated from runtime/client/index.ts by packages/client/scripts/sync.mjs.
// @spacepress/client: zero-dependency fetch client supporting WordPress Abilities and SpacePress REST.

`;

writeFileSync(join(here, "..", "src", "index.mjs"), header + cleaned + "\n");
console.log("Wrote packages/client/src/index.mjs");
