// @ts-check
// Turns the generated typed client (zero/client/*.ts) into browser JS for public/: Node's own type
// stripping, no bundler, no dependencies. Run after `zero build`: node build-client.mjs
import { stripTypeScriptTypes } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const here = (p) => new URL(p, import.meta.url);
mkdirSync(here("public/client/"), { recursive: true });
for (const name of ["index", "schema"]) {
  const ts = readFileSync(here(`zero/client/${name}.ts`), "utf8");
  // Type-only imports and re-exports erase; relative `.ts` specifiers become `.js`.
  const js = stripTypeScriptTypes(ts).replace(/(from\s+["']\.\/[\w-]+)\.ts(["'])/g, "$1.js$2");
  writeFileSync(here(`public/client/${name}.js`), js);
}
console.log("wrote public/client/{index,schema}.js");
