import path from "node:path";

import { buildPages } from "./build.ts";
import { format } from "./diagnostics.ts";

const USAGE = "usage: first-pages build [project-dir] [--out <wp-content-dir>] [--json]";

/** Exit codes: 0 built (or nothing to build), 1 diagnostics, 2 usage. */
export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== "build") {
    console.error(USAGE);
    return 2;
  }
  let project = ".";
  let out: string | null = null;
  let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (arg === "--json") json = true;
    else if (arg === "--out") {
      const value = rest[index + 1];
      if (value === undefined) {
        console.error(USAGE);
        return 2;
      }
      out = value;
      index += 1;
    } else if (arg.startsWith("-")) {
      console.error(USAGE);
      return 2;
    } else project = arg;
  }
  const root = path.resolve(project);
  const result = await buildPages({ project: root, out: out ?? path.join(root, ".first/wp-content") });
  if (json) {
    console.log(JSON.stringify({ ok: result.ok, pages: result.pages, plugin: result.plugin ?? null, diagnostics: result.diagnostics }));
  } else {
    for (const diagnostic of result.diagnostics) console.error(format(diagnostic, root));
    if (!result.pages) console.log("No pages/ directory; nothing to build.");
    else if (result.ok) console.log(`Built ${result.manifest!.routes.length} routes -> ${path.relative(process.cwd(), result.plugin!) || result.plugin}`);
    else console.error("Pages were not built; the previous output was left in place.");
  }
  return result.ok ? 0 : 1;
}
