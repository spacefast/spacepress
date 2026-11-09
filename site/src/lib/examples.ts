// The committed examples, compiled at site build time with the same browser build of the compiler
// visitors run (public/zero.wasm). The tour shows pieces of a config beside pieces of what the compiler
// made of it, and both come from here, so a page can never show an output the compiler would not emit.
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { Compiler, type Output, type Request } from "./compiler.ts";
import type { playgroundExamples } from "./playground-catalog.ts";

// Astro bundles this module under dist/ at build time, so paths cannot come from import.meta.url;
// the build and the tests both run from site/.
export const site = process.cwd();
export const repo = path.dirname(site);

export type ExampleName = (typeof playgroundExamples)[number]["name"];

export interface Example {
  name: ExampleName;
  /** Sources by project-relative path, as committed. */
  files: Record<string, string>;
  output: Output;
}

/**
 * Every file of an example a config can import (app code under `zero/` included; build output and
 * the blog's web page left out), plus the committed abilities lock, the one input in `_generated/`.
 */
export function sources(dir: string): Request["files"] {
  // Skipped at the project root only (web page, tests, content), except `.zero` and `node_modules`
  // at any depth: app code under `zero/` may import from its own `zero/content/` or `zero/public/`.
  const skip = new Set([".zero", "node_modules", "public", "client-tests", "content", "zero/_generated", "zero/dist"]);
  const anyDepth = new Set([".zero", "node_modules"]);
  const files: Request["files"] = {};
  const lock = path.join(dir, "zero/_generated/abilities.json");
  if (existsSync(lock)) files["zero/_generated/abilities.json"] = readFileSync(lock, "utf8");
  const walk = (sub: string) => {
    for (const name of readdirSync(path.join(dir, sub))) {
      const rel = sub ? `${sub}/${name}` : name;
      if (skip.has(rel) || anyDepth.has(name)) continue;
      const stat = lstatSync(path.join(dir, rel));
      if (stat.isDirectory()) walk(rel);
      else if (stat.isFile()) files[rel] = readFileSync(path.join(dir, rel), "utf8");
    }
  };
  walk("");
  return files;
}

let compiler: Promise<Compiler> | undefined;

export async function example(name: ExampleName): Promise<Example> {
  compiler ??= Compiler.load(readFileSync(path.join(site, "public/zero.wasm")));
  const files = sources(path.join(repo, "examples", name));
  const { check, output } = (await compiler).compile({ name, files, previous: null });
  if (!output) {
    const messages = check.diagnostics.map((d) => `${d.location?.file}:${d.location?.line}: ${d.message}`);
    throw new Error(`examples/${name} does not compile:\n${messages.join("\n")}`);
  }
  return { name, files, output };
}
