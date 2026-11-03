// The committed examples, compiled at site build time with the same browser build of the compiler
// visitors run (public/zero.wasm). The tour shows pieces of a config beside pieces of what the compiler
// made of it, and both come from here, so a page can never show an output the compiler would not emit.
import { lstatSync, readFileSync, readdirSync } from "node:fs";
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

/** Every file of an example a config can import (build output and the blog's web page left out). */
export function sources(dir: string): Request["files"] {
  const skip = new Set(["zero", ".zero", "node_modules", "zero.gen.ts", "public", "client-tests", "content"]);
  const files: Request["files"] = {};
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
