// Prints what the playground component needs for each app it can load: the sources, and what
// "Run in WordPress" needs (docs-site/lib/blueprint.ts `ExampleRun`). The four examples the docs
// site features come through docs-site/lib; the hero's small app lives in examples/_hero.
// Run with the working directory set to docs-site/, after `pnpm wasm` and `pnpm showcase` there.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { compileFiles, example, sources } from "../../docs-site/lib/examples.ts";
import { platformVersions } from "../../docs-site/lib/platform.ts";
import { exampleRun, isWritten, ledger } from "../../docs-site/lib/showcase.ts";
import { siteExamples } from "../../docs-site/lib/site-examples.ts";

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

// The committed migrations of a project. (`ledger()` in docs-site/lib also reads public/ as text,
// which this site's public/ is not: it holds the compiler and the plugin zips.)
const migrations = (dir: string) => {
  const folder = path.join(dir, "tp/_generated/migrations");
  return {
    snapshot: JSON.parse(readFileSync(path.join(folder, "snapshot.json"), "utf8")),
    files: Object.fromEntries(readdirSync(folder).filter((file) => file.endsWith(".sql")).sort().map((file) => [file, readFileSync(path.join(folder, file), "utf8")])),
    public: {},
  };
};

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
    title: "This website",
    summary: "The site you are on: its schema, its server functions and its pages.",
    files,
    shown,
    run: { lock: lock.plugins.map(({ slug, version }) => ({ slug, version })), landing: "/examples", seed: "", syncSeed: {}, appPages: true, schemaPhp: output.schemaPhp, ledger: migrations(dir) },
  };
}

for (const { name, title, summary } of siteExamples) {
  const { files } = await example(name);
  // Shown for editing: what a developer writes. Installed packages still go to the compiler.
  const shown = Object.keys(files).filter((file) => !file.startsWith("node_modules/") && isWritten(file) && !/^(package\.json|build-client\.mjs)$/.test(file));
  examples[name] = { title, summary, files, shown, run: await exampleRun(name) };
}
const { php, sqlite } = platformVersions();
// Where WordPress Playground fetches TypedPress's shared plugin zips (files/plugins/<slug>.zip).
const plugins = process.env.PLUGINS_URL ?? "https://typedpress-guide.space.fast";
process.stdout.write(JSON.stringify({ platform: { php, sqlite }, plugins, examples }));
