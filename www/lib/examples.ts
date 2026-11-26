// The committed examples, compiled at site build time with the same browser build of the compiler
// visitors run (public/compiler.wasm). The tour and the example pages show what the compiler made of
// each config, and all of it comes from here, so a page never shows output the compiler would not emit.
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Compiler, type Output, type Request } from "./compiler.ts";
import { siteFiles } from "./site-examples.ts";

export const site = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const repo = path.dirname(site);

function wasmPath(): string {
  const cached = path.join(site, ".build/compiler.wasm");
  if (existsSync(cached)) return cached;
  return path.join(site, "public/compiler.wasm");
}

/**
 * Every file of an example a config can import (app code under `sp/` included; build output and
 * the blog's web page left out), plus the committed abilities lock, the one input in `_generated/`.
 * The example's own root `node_modules`, when installed, goes too, code and package.json only: the
 * compiler reads npm packages as sources. Nested ones (a web app's or a tool's) do not.
 */
export function sources(dir: string, roots = readdirSync(dir)): Request["files"] {
  // Skipped at the project root only (web page, tests, content), except `.sp` and `node_modules`
  // at any depth: app code under `sp/` may import from its own `sp/content/` or `sp/public/`.
  const skip = new Set([".sp", "node_modules", "public", "client-tests", "content", "sp/_generated", "sp/dist", ...siteFiles]);
  const anyDepth = new Set([".sp", "node_modules"]);
  const files: Request["files"] = {};
  const lock = path.join(dir, "sp/_generated/abilities.json");
  if (existsSync(lock)) files["sp/_generated/abilities.json"] = readFileSync(lock, "utf8");
  const walk = (sub: string, names: string[]) => {
    for (const name of [...names].sort()) {
      const rel = sub ? `${sub}/${name}` : name;
      const installed = rel === "node_modules" || rel.startsWith("node_modules/");
      if (!installed && (skip.has(rel) || anyDepth.has(name))) continue;
      // Of a package, the compiler reads its code and package.json; licenses and docs stay behind.
      if (installed && rel !== "node_modules" && !/\.(c?m?js|tsx?|css|json)$/.test(name) && !lstatSync(path.join(dir, rel)).isDirectory()) continue;
      const stat = lstatSync(path.join(dir, rel));
      if (stat.isDirectory()) walk(rel, readdirSync(path.join(dir, rel)));
      else if (stat.isFile()) files[rel] = readFileSync(path.join(dir, rel), "utf8");
    }
  };
  walk("", roots);
  return files;
}

let compiler: Promise<Compiler> | undefined;

/** The browser build of the compiler, loaded once. */
function loadCompiler(): Promise<Compiler> {
  compiler ??= Compiler.load(readFileSync(wasmPath()));
  return compiler;
}

/** Compile a playable example with the same Wasm compiler visitors use. */
export async function compileFiles(request: Request): Promise<Output> {
  const { check, output } = (await loadCompiler()).compile(request);
  if (!output) {
    const messages = check.diagnostics.map((d) => `${d.location?.file}:${d.location?.line}: ${d.message}`);
    throw new Error(`${request.name} does not compile in the browser compiler:\n${messages.join("\n")}`);
  }
  return output;
}
