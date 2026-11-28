// Prints what the playground component needs for each app it can load: the sources, and what
// "Run in WordPress" needs (lib/blueprint.ts `ExampleRun`). The four featured examples come
// through www/lib; the hero's small app lives in examples/_hero.
// Run after `npm run wasm && npm run showcase` in www/.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRequest } from "../lib/blueprint.ts";
import { compileFiles, sources } from "../lib/examples.ts";
import { platformVersions } from "../lib/platform.ts";
import { exampleRun, isWritten, ledger, showcaseRoot } from "../lib/showcase.ts";
import { siteExamples } from "../lib/site-examples.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const examples: Record<string, unknown> = {};

// The hero has no committed migrations. Compile its original schema to get the baseline ledger
// so the first edit in the browser adds a migration to it.
{
  const dir = path.join(here, "../examples/_hero");
  const files = sources(dir);
  delete files["seed.php"];
  const history = ledger(dir);
  const output = await compileFiles(runRequest("tasks", files, history));
  Object.assign(history.files, Object.fromEntries(output.migrations));
  const lock = JSON.parse(readFileSync(path.join(dir, "sp/_generated/wp-plugins.lock.json"), "utf8")) as { plugins: { slug: string; version: string }[] };
  examples.tasks = {
    title: "Tasks",
    summary: "A whole app: a table, two actions, a page, and a live list you can tick and add to.",
    files,
    shown: ["sp/schema.ts", "sp/app/page.tsx", "sp/components/TaskList.tsx", "spacepress.config.ts"],
    run: { lock: lock.plugins.map(({ slug, version }) => ({ slug, version })), landing: "/", seed: readFileSync(path.join(dir, "seed.php"), "utf8"), syncSeed: {}, appPages: true, schemaPhp: output.schemaPhp, ledger: history },
  };
}

// This site itself: the same source that is serving the page, so a reader can change it and see
// what it compiles to. Leave out public/, which contains binary build assets.
{
  const dir = path.join(here, "..");
  const files = sources(dir, [
    "spacepress.config.ts", "tsconfig.json", "sp",
    "node_modules/@spacepress/docs/package.json", "node_modules/@spacepress/docs/src",
  ]);
  const history = ledger(dir, false);
  const output = await compileFiles(runRequest("spacepress-site", files, history));
  Object.assign(history.files, Object.fromEntries(output.migrations));
  const lock = JSON.parse(readFileSync(path.join(dir, "sp/_generated/wp-plugins.lock.json"), "utf8")) as { plugins: { slug: string; version: string }[] };
  const shown = Object.keys(files).filter((file) => isWritten(file) &&
    !file.startsWith("node_modules/") && !file.startsWith("sp/data/") &&
    file !== "tsconfig.json");
  examples.website = {
    title: "spacepress.dev (This website)",
    summary: "The official SpacePress site: its schema, mutations, background jobs, Markdown-synced docs & blog, and TSX pages.",
    files,
    shown,
    run: { lock: lock.plugins.map(({ slug, version }) => ({ slug, version })), landing: "/examples", seed: "", syncSeed: {}, appPages: true, schemaPhp: output.schemaPhp, ledger: history },
  };
}

for (const entry of siteExamples) {
  const { name, title, summary } = entry;
  const files = sources(path.join(showcaseRoot, name));
  // Shown for editing: what a developer writes. Installed packages still go to the compiler.
  const shown = Object.keys(files).filter((file) => !file.startsWith("node_modules/") && isWritten(file) && !/^(package\.json|build-client\.mjs)$/.test(file));
  examples[name] = { title, summary, files, shown, run: await exampleRun(entry, files) };
}
const { php, sqlite } = platformVersions();
// Where WordPress Playground fetches SpacePress's shared plugin zips (playground-plugins/<slug>.zip).
const plugins = new URL(process.env.PLUGINS_URL ?? "https://spacepress.dev").origin;
process.stdout.write(JSON.stringify({ platform: { php, sqlite }, plugins, examples }));
