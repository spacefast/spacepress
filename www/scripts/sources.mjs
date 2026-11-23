// Writes sp/data/sources.ts: the text of every file under examples/, for the guide's
// <Source>, <Diff> and <Example>. SpacePress's pages cannot read a file or import one as text, so this
// puts them in a TypeScript module the pages import. Run by scripts/build.mjs.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(site, "examples");
// The hero's app is compiled by the playground, not shown as a listing.
const skip = new Set(["_hero"]);
const walk = (dir) => readdirSync(dir).sort().flatMap((entry) => {
  const full = join(dir, entry);
  if (entry === "_meta.json") return [];
  return statSync(full).isDirectory() ? walk(full) : [full];
});
const literal = (text) => "`" + text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";

const entries = [];
for (const project of readdirSync(root).sort()) {
  if (skip.has(project) || !statSync(join(root, project)).isDirectory()) continue;
  const metaFile = join(root, project, "_meta.json");
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : {};
  for (const file of walk(join(root, project))) {
    const inProject = relative(join(root, project), file);
    // note: shown in the file's header. label: shown beside the file in the project's tree.
    entries.push({ path: `${project}/${inProject}`, note: meta.notes?.[inProject] ?? null, label: meta.treeNotes?.[inProject] ?? null, text: readFileSync(file, "utf8") });
  }
}
mkdirSync(join(site, "sp", "data"), { recursive: true });
writeFileSync(join(site, "sp", "data", "sources.ts"), `// Written by scripts/sources.mjs from examples/. Do not edit: change the file in examples/ and build again.
export const sources: { path: string; note: string | null; label: string | null; text: string }[] = [
${entries.map((e) => `  { path: ${JSON.stringify(e.path)}, note: ${JSON.stringify(e.note)}, label: ${JSON.stringify(e.label)}, text: ${literal(e.text)} },`).join("\n")}
];
`);
console.log(`${entries.length} example files -> sp/data/sources.ts`);
