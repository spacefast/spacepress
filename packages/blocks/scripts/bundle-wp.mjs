// Bundle the pinned @wordpress packages into one CommonJS file the serializer loads.
//
// Why a bundle rather than plain imports: the ESM builds of @wordpress/* import JSON
// without import attributes (Node refuses them), the CJS builds work only when exactly
// one copy of every package exists (two copies of private-apis throw "Cannot unlock an
// object that was not locked before"), and bundling with NODE_ENV=production drops the
// editor UI's dev-only paths. The result loads in ~300 ms where a cold module graph took
// seconds. It is built by `prepare` (every install) and never committed.
//
// The bundle is GPL-2.0-or-later (the @wordpress packages are). Beside it this writes
// vendor/NOTICE.md, which lists every package esbuild put into it with its version,
// license and source, and vendor/licenses/, the full license file of each one.
import { build } from "esbuild";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const outdir = path.join(root, "vendor");
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const versions = Object.fromEntries(
  ["@wordpress/blocks", "@wordpress/block-library", "@wordpress/element"].map((name) => [
    name,
    require(`${name}/package.json`).version,
  ]),
);

const result = await build({
  stdin: {
    contents: [
      'export * as blocks from "@wordpress/blocks";',
      'export { registerCoreBlocks } from "@wordpress/block-library";',
      'export * as element from "@wordpress/element";',
    ].join("\n"),
    resolveDir: root,
    sourcefile: "wp-entry.mjs",
    loader: "js",
  },
  outfile: path.join(outdir, "wp.cjs"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  logLevel: "warning",
  metafile: true,
  // Keep the bundled packages' license headers; esbuild writes them beside the bundle as wp.cjs.LEGAL.txt.
  legalComments: "linked",
  define: { "process.env.NODE_ENV": '"production"' },
  banner: { js: `/* @wordpress bundle: ${JSON.stringify(versions)}. GPL-2.0-or-later; see NOTICE.md beside this file. */` },
});

/** The installed package a bundled input file belongs to: the directory right below its last node_modules. */
async function owner(file) {
  const parts = path.resolve(root, file).split(path.sep);
  const at = parts.lastIndexOf("node_modules");
  if (at < 0) throw new Error(`Bundled input ${file} is not from an installed package`);
  const dir = parts.slice(0, at + (parts[at + 1].startsWith("@") ? 3 : 2)).join(path.sep);
  const manifest = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
  if (!manifest.name || !manifest.version) throw new Error(`${dir}/package.json has no name or version`);
  return { dir, manifest };
}

// Notices for packages whose npm tarball ships no license file, with where each came from.
const supplied = JSON.parse(await readFile(path.join(root, "scripts/notices/SOURCES.json"), "utf8"));
const packages = new Map();
for (const file of Object.keys(result.metafile.inputs)) {
  if (file === "wp-entry.mjs") continue;
  const { dir, manifest } = await owner(file);
  const id = `${manifest.name}@${manifest.version}`;
  if (packages.has(id)) continue;
  const license = typeof manifest.license === "string" ? manifest.license
    : [manifest.licenses ?? []].flat().map((entry) => entry.type ?? entry).join(" OR ");
  if (!license) throw new Error(`${id} declares no license; add it to the notice by hand before shipping.`);
  const repository = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  let notices = (await readdir(dir)).filter((name) => /^(licen[cs]e|copying|notice)/i.test(name)).sort();
  let from = dir, provenance;
  if (!notices.length) {
    if (!supplied[id]) throw new Error(`${id} ships no license file. Add its original notice under scripts/notices/${id}/ and record its source in scripts/notices/SOURCES.json.`);
    ({ files: notices, source: provenance } = supplied[id]);
    from = path.join(root, "scripts/notices", id);
  }
  for (const name of notices) {
    const destination = path.join(outdir, "licenses", manifest.name, manifest.version, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(from, name), destination);
  }
  packages.set(id, { name: manifest.name, version: manifest.version, license, repository, notices, provenance });
}

const rows = [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
const cell = (text) => String(text ?? "").replaceAll("|", "\\|");
await writeFile(
  path.join(outdir, "NOTICE.md"),
  [
    "# vendor/wp.cjs",
    "",
    "`wp.cjs` is a build of the WordPress block packages and everything they import, made by",
    "`scripts/bundle-wp.mjs` with esbuild. It is distributed under the GNU General Public",
    "License, version 2 or later (`../LICENSE-GPL`), because the `@wordpress/*` packages in it",
    "are GPL-2.0-or-later. The rest of `@spacepress/blocks` is MIT (`../LICENSE`).",
    "",
    "Corresponding source: each package below, at the exact version listed, from the npm",
    "registry or its repository; `scripts/bundle-wp.mjs` in https://github.com/spacefast/spacepress",
    "(`packages/blocks/`) rebuilds the bundle from them. Each package's own license file is",
    "under `licenses/<name>/<version>/`; where the package's tarball ships none, the notice was",
    "recovered from its upstream repository or README, listed under the table with its source.",
    "`wp.cjs.LEGAL.txt` keeps the license comments esbuild found in the bundled sources.",
    "",
    `${rows.length} packages:`,
    "",
    "| Package | Version | License | Source | License files |",
    "|---|---|---|---|---|",
    ...rows.map((row) => `| ${cell(row.name)} | ${cell(row.version)} | ${cell(row.license)} | ${cell(row.repository ?? `https://www.npmjs.com/package/${row.name}/v/${row.version}`)} | ${row.notices.map((name) => `licenses/${row.name}/${row.version}/${name}`).join(", ")}${row.provenance ? " (recovered, see below)" : ""} |`),
    "",
    "Recovered notices:",
    "",
    ...rows.filter((row) => row.provenance).map((row) => `- ${row.name}@${row.version}: ${row.provenance}`),
    "",
  ].join("\n"),
);
