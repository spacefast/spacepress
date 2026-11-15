// Prints what the playground page needs for each example the docs site features: its sources as
// committed, and what "Run in WordPress" needs (docs-site/lib/blueprint.ts `ExampleRun`).
// Run with the working directory set to docs-site/, after `pnpm wasm` and `pnpm showcase` there.
import { example } from "../../docs-site/lib/examples.ts";
import { platformVersions } from "../../docs-site/lib/platform.ts";
import { exampleRun, isWritten } from "../../docs-site/lib/showcase.ts";
import { siteExamples } from "../../docs-site/lib/site-examples.ts";

const examples: Record<string, unknown> = {};
for (const { name, title, summary } of siteExamples) {
  const { files } = await example(name);
  // Shown for editing: what a developer writes. Installed packages still go to the compiler.
  const shown = Object.keys(files).filter((file) => !file.startsWith("node_modules/") && isWritten(file) && !/^(package\.json|build-client\.mjs)$/.test(file));
  examples[name] = { title, summary, files, shown, run: await exampleRun(name) };
}
const { php, sqlite } = platformVersions();
process.stdout.write(JSON.stringify({ platform: { php, sqlite }, examples }));
