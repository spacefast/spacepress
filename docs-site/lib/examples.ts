// The committed examples, compiled at site build time with the same browser build of the compiler
// visitors run (public/compiler.wasm). The tour and the example pages show what the compiler made of
// each config, and all of it comes from here, so a page never shows output the compiler would not emit.
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { Compiler, type Compiled, type Output, type Request } from "./compiler.ts";
import { siteFiles, type SiteExampleName } from "./site-examples.ts";

// Astro bundles this module at build time, so paths cannot come from import.meta.url. The build,
// the generator and the tests all run from docs-site/.
export const site = process.cwd();
export const repo = path.dirname(site);

export type ExampleName = SiteExampleName;

export interface Example {
  name: ExampleName;
  /** Sources by project-relative path, as committed. */
  files: Record<string, string>;
  output: Output;
}

/**
 * Every file of an example a config can import (app code under `tp/` included; build output and
 * the blog's web page left out), plus the committed abilities lock, the one input in `_generated/`.
 * The example's own root `node_modules`, when installed, goes too, code and package.json only: the
 * compiler reads npm packages as sources. Nested ones (a web app's or a tool's) do not.
 */
export function sources(dir: string): Request["files"] {
  // Skipped at the project root only (web page, tests, content), except `.tp` and `node_modules`
  // at any depth: app code under `tp/` may import from its own `tp/content/` or `tp/public/`.
  const skip = new Set([".tp", "node_modules", "public", "client-tests", "content", "tp/_generated", "tp/dist", ...siteFiles]);
  const anyDepth = new Set([".tp", "node_modules"]);
  const files: Request["files"] = {};
  const lock = path.join(dir, "tp/_generated/abilities.json");
  if (existsSync(lock)) files["tp/_generated/abilities.json"] = readFileSync(lock, "utf8");
  const walk = (sub: string) => {
    for (const name of readdirSync(path.join(dir, sub))) {
      const rel = sub ? `${sub}/${name}` : name;
      const installed = rel === "node_modules" || sub.startsWith("node_modules");
      if (!installed && (skip.has(rel) || anyDepth.has(name))) continue;
      // Of a package, the compiler reads its code and package.json; licenses and docs stay behind.
      if (installed && rel !== "node_modules" && !/\.(c?m?js|json)$/.test(name) && !lstatSync(path.join(dir, rel)).isDirectory()) continue;
      const stat = lstatSync(path.join(dir, rel));
      if (stat.isDirectory()) walk(rel);
      else if (stat.isFile()) files[rel] = readFileSync(path.join(dir, rel), "utf8");
    }
  };
  walk("");
  return files;
}

let compiler: Promise<Compiler> | undefined;

/** The browser build of the compiler, loaded once. */
export function loadCompiler(): Promise<Compiler> {
  compiler ??= Compiler.load(readFileSync(path.join(site, "public/compiler.wasm")));
  return compiler;
}

/** Sources compiled from memory, with the compiler's diagnostics whether or not they compile. */
export async function compileFiles(name: string, files: Record<string, string>): Promise<Compiled> {
  compiler ??= Compiler.load(readFileSync(path.join(site, "public/compiler.wasm")));
  return (await compiler).compile({ name, files, previous: null });
}

/** An example compiled as committed, with the compiler's diagnostics whether or not it compiles. */
export async function compileExample(name: string): Promise<Compiled> {
  return compileFiles(name, sources(path.join(repo, "examples", name)));
}

export async function example(name: ExampleName): Promise<Example> {
  compiler ??= Compiler.load(readFileSync(path.join(site, "public/compiler.wasm")));
  const files = sources(path.join(repo, "examples", name));
  const { check, output } = (await compiler).compile({ name, files, previous: null });
  if (!output) {
    const messages = check.diagnostics.map((d) => `${d.location?.file}:${d.location?.line}: ${d.message}`);
    throw new Error(`examples/${name} does not compile:\n${messages.join("\n")}`);
  }
  return { name, files, output };
}
