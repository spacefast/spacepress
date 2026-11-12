// An example as the site shows it in the file explorer: the files a developer writes, and every
// file `first build` writes for them, the WordPress plugins included. scripts/build-showcase.ts
// builds each example and writes public/files/<name>.json plus one blob per distinct text file;
// the explorer fetches a blob when someone opens the file. Nothing is typed by hand.
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { repo, site } from "./examples.ts";
import { compilerEntry } from "./playground-catalog.ts";
import { siteFiles } from "./site-examples.ts";

export const showcaseRoot = path.join(site, ".showcase");
export const filesRoot = path.join(site, "public/files");

export interface Manifest {
  /** The config's `name`: the app plugin is `first-app-<app>`. */
  app: string;
  /** Every file, sorted, with First names. `blob` is null for a binary file. */
  files: { path: string; blob: string | null; size: number }[];
}

// Not app sources: the README is the page's own text, tsconfig.json is editor setup, and the
// lockfile is npm's. They are in the tree, and are not counted as files you write.
const notSources = new Set(["README.md", "tsconfig.json", "package-lock.json", ".gitignore"]);

/** A path `first build` writes: the generated files and the WordPress output under `first/`. */
export const isBuilt = (file: string) => file.startsWith("first/_generated/") || file.startsWith("first/dist/");

/** A path the developer writes: app code, under `first/` or not, that the build didn't write. */
export const isWritten = (file: string) => !isBuilt(file) && !notSources.has(file);

export function manifest(name: string): Manifest {
  const file = path.join(filesRoot, `${name}.json`);
  if (!existsSync(file)) throw new Error(`examples/${name} is not built for the site; run \`pnpm showcase\` in docs-site/`);
  const built = JSON.parse(readFileSync(file, "utf8")) as Manifest;
  // The build copied the example; a source added or edited since then would show stale output.
  const example = path.join(repo, "examples", name);
  const copy = path.join(showcaseRoot, name);
  const stale = sourcesOf(example).filter((file) => !existsSync(path.join(copy, file)) || readFileSync(path.join(example, file), "utf8") !== readFileSync(path.join(copy, file), "utf8"));
  if (stale.length) throw new Error(`examples/${name} changed since \`pnpm showcase\` built it (${stale.join(", ")}); run it again`);
  if (!built.files.some((file) => file.path === "first.config.ts")) throw new Error(`examples/${name} has no ${compilerEntry}`);
  return built;
}

/** The example's own files: everything but its build output and installed packages. */
function sourcesOf(dir: string, rel = ""): string[] {
  const found: string[] = [];
  for (const name of readdirSync(path.join(dir, rel))) {
    const sub = rel ? `${rel}/${name}` : name;
    // Build output: `first build` writes first/_generated/ and first/dist/. App code under first/ counts.
    if ([".first", "node_modules", "first/_generated", "first/dist", ...siteFiles].includes(sub)) continue;
    if (lstatSync(path.join(dir, sub)).isDirectory()) found.push(...sourcesOf(dir, sub));
    else found.push(sub);
  }
  return found;
}
