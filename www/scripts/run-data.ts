// Prints what the playground component needs for each app it can load: the sources, and what
// "Run in WordPress" needs (lib/blueprint.ts `ExampleRun`). The four featured examples come
// through www/lib; the hero's small app lives in examples/_hero.
// Run after `npm run wasm && npm run showcase` in www/.
import { readFileSync } from "node:fs";
import path from "node:path";
import { compileFiles, example, sources } from "../lib/examples.ts";
import { platformVersions } from "../lib/platform.ts";
import { exampleRun, isWritten, ledger, migrationFiles } from "../lib/showcase.ts";
import { siteExamples } from "../lib/site-examples.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
const examples: Record<string, unknown> = {};

// The hero: built once by hand (`typedpress build` in a copy), so its migration ledger and plugin lock
// are committed beside it like any example's.
{
  const dir = path.join(here, "../examples/_hero");
  const files = sources(dir);
  delete files["seed.php"];
  const { check, output } = await compileFiles("tasks", files);
  if (!output) throw new Error(`examples/_hero does not compile:\n${check.diagnostics.map((d) => `${d.location?.file}:${d.location?.line}: ${d.message}`).join("\n")}`);
  const lock = JSON.parse(readFileSync(path.join(dir, "tp/_generated/wp-plugins.lock.json"), "utf8")) as { plugins: { slug: string; version: string }[] };
  examples.tasks = {
    title: "Tasks",
    summary: "A whole app: a table, two actions, a page, and a live list you can tick and add to.",
    files,
    shown: ["tp/schema.ts", "tp/app/page.tsx", "tp/components/TaskList.tsx", "typedpress.config.ts"],
    run: { lock: lock.plugins.map(({ slug, version }) => ({ slug, version })), landing: "/", seed: readFileSync(path.join(dir, "seed.php"), "utf8"), syncSeed: {}, appPages: true, schemaPhp: output.schemaPhp, ledger: ledger(dir) },
  };
}

// This site itself: the same source that is serving the page, so a reader can change it and see
// what it compiles to. The docs and the first post go with it as content.
{
  const dir = path.join(here, "..");
  const files = Object.fromEntries(Object.entries(sources(dir)).filter(([file]) => /^(typedpress\.config\.ts|tsconfig\.json|tp\/)/.test(file)));
  const { check, output } = await compileFiles("typedpress-site", files);
  if (!output) throw new Error(`the site does not compile in the browser compiler:\n${check.diagnostics.map((d) => `${d.location?.file}:${d.location?.line}: ${d.message}`).join("\n")}`);
  const lock = JSON.parse(readFileSync(path.join(dir, "tp/_generated/wp-plugins.lock.json"), "utf8")) as { plugins: { slug: string; version: string }[] };
  const shown = Object.keys(files).filter((file) => isWritten(file) && file !== "tp/data/sources.ts" && file !== "tsconfig.json");
  examples.website = {
    title: "spacepress.dev (This website)",
    summary: "The official SpacePress site: its schema, server actions, background jobs, Markdown-synced docs & blog, and TSX pages.",
    files,
    shown,
    run: { lock: lock.plugins.map(({ slug, version }) => ({ slug, version })), landing: "/examples", seed: "", syncSeed: {}, appPages: true, schemaPhp: output.schemaPhp, ledger: { files: migrationFiles(dir), public: {} } },
  };
}

for (const { name, title, summary } of siteExamples) {
  const { files } = await example(name);
  // Shown for editing: what a developer writes. Installed packages still go to the compiler.
  const shown = Object.keys(files).filter((file) => !file.startsWith("node_modules/") && isWritten(file) && !/^(package\.json|build-client\.mjs)$/.test(file));
  examples[name] = { title, summary, files, shown, run: await exampleRun(name) };
}
const { php, sqlite } = platformVersions();
// Where WordPress Playground fetches SpacePress's shared plugin zips (playground-plugins/<slug>.zip).
const plugins = process.env.PLUGINS_URL ?? "https://spacepress.dev";
process.stdout.write(JSON.stringify({ platform: { php, sqlite }, plugins, examples }));
