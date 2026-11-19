// An example as the site shows it in the file explorer: the files a developer writes, and every
// file `typedpress build` writes for them, the WordPress plugins included. scripts/build-showcase.ts
// builds each example and writes public/files/<name>.json plus one blob per distinct text file;
// the explorer fetches a blob when someone opens the file. Nothing is typed by hand.
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { ExampleRun, Ledger } from "./blueprint.ts";
import { example, repo, site } from "./examples.ts";
import { siteExamples, siteFiles } from "./site-examples.ts";

export const showcaseRoot = path.join(site, ".showcase");
export const filesRoot = path.join(site, "public/files");

export interface Manifest {
  /** The config's `name`: the app plugin is `typedpress-app-<app>`. */
  app: string;
  /** Every file, sorted, with First names. `blob` is null for a binary file. */
  files: { path: string; blob: string | null; size: number }[];
  /** The WordPress.org plugins in the lock `typedpress build` wrote, with their versions. */
  wordpressPlugins: { slug: string; version: string }[];
  /** The synced collections' content rows the blueprint seeds (scripts/build-showcase.ts `syncRecords`). */
  syncSeed: Record<string, unknown>;
  /** The example has `tp/app/` pages, which route on the path and need pretty permalinks. */
  appPages: boolean;
}

// Not app sources: the README is the page's own text, tsconfig.json is editor setup, and the
// lockfile is npm's. They are in the tree, and are not counted as files you write.
const notSources = new Set(["README.md", "tsconfig.json", "package-lock.json", ".gitignore"]);

/** A path `typedpress build` writes: the generated files and the WordPress output under `tp/`. */
export const isBuilt = (file: string) => file.startsWith("tp/_generated/") || file.startsWith("tp/dist/");

/** A path the developer writes: app code, under `tp/` or not, that the build didn't write. */
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
  if (!built.files.some((file) => file.path === "typedpress.config.ts")) throw new Error(`examples/${name} has no typedpress.config.ts`);
  return built;
}

/** The example's own files: everything but its build output and installed packages. */
function sourcesOf(dir: string, rel = ""): string[] {
  const found: string[] = [];
  for (const name of readdirSync(path.join(dir, rel))) {
    const sub = rel ? `${rel}/${name}` : name;
    // Build output: `typedpress build` writes tp/_generated/ and tp/dist/. App code under tp/ counts.
    if ([".tp", "node_modules", "tp/_generated", "tp/dist", ...siteFiles].includes(sub)) continue;
    if (lstatSync(path.join(dir, sub)).isDirectory()) found.push(...sourcesOf(dir, sub));
    else found.push(sub);
  }
  return found;
}

/** Files under `root`, by path below it, sorted. */
function walk(root: string, rel = ""): string[] {
  const found: string[] = [];
  for (const name of readdirSync(path.join(root, rel)).sort()) {
    const sub = rel ? `${rel}/${name}` : name;
    if (lstatSync(path.join(root, sub)).isDirectory()) found.push(...walk(root, sub));
    else found.push(sub);
  }
  return found;
}

/**
 * An example's committed migration ledger, `tp/_generated/migrations/` (the snapshot and the SQL
 * files), and its `public/` files, which `typedpress build` copies into the app plugin. The compiler
 * takes sources as text, so a `public/` file that is not UTF-8 text fails here rather than being
 * left out of the plugin unnoticed.
 */
export function ledger(dir: string): Ledger {
  const ledgerDir = path.join(dir, "tp/_generated/migrations");
  const publicDir = path.join(dir, "public");
  const publicFiles = existsSync(publicDir)
    ? Object.fromEntries(walk(publicDir).map((file) => [file, new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path.join(publicDir, file)))]))
    : {};
  if (!existsSync(ledgerDir)) return { snapshot: null, files: {}, public: publicFiles };
  const snapshot = path.join(ledgerDir, "snapshot.json");
  return {
    snapshot: existsSync(snapshot) ? JSON.parse(readFileSync(snapshot, "utf8")) : null,
    files: Object.fromEntries(readdirSync(ledgerDir).filter((file) => file.endsWith(".sql")).sort().map((file) => [file, readFileSync(path.join(ledgerDir, file), "utf8")])),
    public: publicFiles,
  };
}

/** What the playground page needs to run an edited copy of a site example (lib/blueprint.ts `editedBlueprint`). */
export async function exampleRun(name: (typeof siteExamples)[number]["name"]): Promise<ExampleRun> {
  const { landing, seed } = siteExamples.find((e) => e.name === name)!;
  const built = manifest(name);
  return {
    lock: built.wordpressPlugins,
    landing,
    seed,
    syncSeed: built.syncSeed,
    appPages: built.appPages,
    schemaPhp: (await example(name)).output.schemaPhp,
    ledger: ledger(path.join(repo, "examples", name)),
  };
}
