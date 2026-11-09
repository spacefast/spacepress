// The committed examples, compiled at site build time with the same browser build of the compiler
// visitors run (public/compiler.wasm). The tour and the example pages show what the compiler made of
// each config, and all of it comes from here, so a page never shows output the compiler would not emit.
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { Compiler, type Compiled, type Output, type Request } from "./compiler.ts";
import type { playgroundExamples } from "./playground-catalog.ts";

// Astro bundles this module at build time, so paths cannot come from import.meta.url. The build,
// the generator and the tests all run from docs-site/.
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
 * Every file of an example a config can import (build output and the blog's web page left out),
 * plus the committed abilities lock, the one compiler input under `zero/`.
 */
export function sources(dir: string): Request["files"] {
  const skip = new Set(["zero", ".zero", "node_modules", "public", "client-tests", "content"]);
  const files: Request["files"] = {};
  const lock = path.join(dir, "zero/_generated/abilities.json");
  if (existsSync(lock)) files["zero/_generated/abilities.json"] = readFileSync(lock, "utf8");
  const walk = (sub: string) => {
    for (const name of readdirSync(path.join(dir, sub))) {
      if (skip.has(name)) continue;
      const rel = sub ? `${sub}/${name}` : name;
      const stat = lstatSync(path.join(dir, rel));
      if (stat.isDirectory()) walk(rel);
      else if (stat.isFile()) files[rel] = readFileSync(path.join(dir, rel), "utf8");
    }
  };
  walk("");
  return files;
}

let compiler: Promise<Compiler> | undefined;

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
