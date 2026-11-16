// Builds the admin's script modules into ../build with the vendored wp-build, then
// adds what the committed bundle needs beyond the modules themselves:
//   THIRD-PARTY-LICENSES.txt  every npm package the modules bundle (from the esbuild
//                             metafiles and the files Sass loaded) plus every notice
//                             that lives in this workspace
//   .manifest.json            a hash of the sources, so tests/php/vendor_drift.php can
//                             tell a stale bundle from a fresh one
// Output is deterministic: the same sources and lockfile produce byte-identical files.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const apps = dirname(fileURLToPath(import.meta.url));
const out = resolve(apps, "../build");
const staging = join(apps, "build");
const meta = join(apps, ".build-meta.json");

// wp-build writes to ./build; the committed bundle lives one level up, beside the plugin's PHP.
// Start from nothing on both sides so an interrupted run leaves nothing behind in the bundle.
await rm(out, { recursive: true, force: true });
await rm(staging, { recursive: true, force: true });
await rm(meta, { force: true });
const built = spawnSync(
  process.execPath,
  [join(apps, "packages/wp-build/bin/wp-build.js"), "--meta", "--meta-out", meta, "build"],
  { cwd: apps, stdio: ["ignore", "inherit", "inherit"] },
);
if (built.status !== 0) process.exit(built.status ?? 1);
await rename(staging, out);

// Generated trees and files that are not sources. Mirrors this workspace's .gitignore;
// tests/php/vendor_drift.php skips the same names, so the two digests agree on a fresh
// checkout and after a local typecheck alike.
const generated = (name) =>
  name === "node_modules" || name === ".tsout" || name === "build" || name === ".build-meta.json" || name.endsWith(".tsbuildinfo");

// Regular files below dir, depth first. Symlinks are neither files nor directories here.
async function files(dir, skip = () => false) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path, skip)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}
// Per-module metafiles land beside their outputs; drop them, they are build-time only.
for (const file of await files(out)) {
  if (file.endsWith(".meta.json")) await rm(file);
}

// Licences of everything bundled from node_modules, by package@version. wp-build records
// inputs relative to each module's own directory, mostly straight into the pnpm store and
// sometimes through a module's own node_modules symlink; the store path after
// `node_modules/.pnpm/` identifies the package either way.
const recorded = JSON.parse(await readFile(meta, "utf8"));
await rm(meta, { force: true });
// Every script in the bundle must be accounted for by a metafile, or the inventory is partial.
const scripts = (await files(out)).filter((f) => f.endsWith(".js")).map((f) => relative(out, f).split(sep).join("/")).sort();
const recordedScripts = Object.keys(recorded.outputs)
  .filter((o) => o.endsWith(".js"))
  .map((o) => o.slice(o.lastIndexOf("build/") + "build/".length))
  .sort();
if (JSON.stringify(scripts) !== JSON.stringify(recordedScripts)) {
  throw new Error(`metafiles cover ${recordedScripts.length} scripts but the bundle has ${scripts.length}`);
}
const store = join(apps, "node_modules", ".pnpm");
const inputs = [];
for (const input of [...Object.keys(recorded.inputs), ...recorded.sassInputs]) {
  if (input.includes("node_modules/.pnpm/") || !input.includes("node_modules/")) {
    inputs.push(input);
    continue;
  }
  // The recorded path is relative to a module directory we no longer know; the part from the
  // last `node_modules/` on is the package path, which every module's node_modules links into
  // the same store entry.
  const linked = join(apps, "node_modules", input.slice(input.lastIndexOf("node_modules/") + "node_modules/".length));
  inputs.push(await realpath(linked));
}
const licenses = new Map();
const isNotice = (name) => /^(LICEN[CS]E|COPYING|NOTICE)(\b|[.\-_])/i.test(name);
// The "License" section of a Markdown README: from its heading to the next heading of the
// same or higher level, or the end of the file.
function readmeLicence(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#+\s*licen[cs]e\b/i.test(line));
  if (start === -1) return "";
  const level = lines[start].match(/^#+/)[0].length;
  let end = lines.findIndex((line, i) => i > start && /^#+\s/.test(line) && line.match(/^#+/)[0].length <= level);
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join("\n").trim() + "\n";
}
// What package.json itself declares when the package ships no notice at all.
function manifestTerms(pkg) {
  const who = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const parts = [`Licence declared in package.json: ${pkg.license ?? "none"}.`];
  if (who) parts.push(`Author: ${who}.`);
  if (repo) parts.push(`Source: ${repo}.`);
  return parts.join(" ") + "\n";
}
for (const input of inputs) {
  const marker = input.indexOf("node_modules/.pnpm/");
  if (marker === -1) continue;
  let dir = dirname(join(store, input.slice(marker + "node_modules/.pnpm/".length)));
  while (dir.startsWith(store) && dir !== store) {
    // The nearest manifest with a name is the package; nested manifests that only set
    // "type" or "sideEffects" (Babel's helpers, Emotion's sub-paths) are not.
    let pkg;
    try {
      pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    } catch {
      pkg = {};
    }
    if (!pkg.name) {
      dir = dirname(dir);
      continue;
    }
    if (!pkg.name.startsWith("@typedpress-admin/")) {
      const key = pkg.name + "@" + pkg.version;
      if (!licenses.has(key)) {
        const entries = await readdir(dir);
        const texts = [];
        for (const name of entries.filter(isNotice).sort()) texts.push(await readFile(join(dir, name), "utf8"));
        if (texts.length === 0) {
          // No licence file: the README's licence section, else the manifest's own terms.
          const readme = entries.find((name) => /^readme(\.|$)/i.test(name));
          const section = readme && readmeLicence(await readFile(join(dir, readme), "utf8"));
          texts.push(section || manifestTerms(pkg));
        }
        licenses.set(key, `${key} (${JSON.stringify(pkg.license ?? "see notice")})\n${texts.join("\n")}`);
      }
    }
    break;
  }
}
// Notices that live in this workspace rather than in node_modules.
const workspaceNotices = [];
for (const root of ["packages", "routes", "fields"]) {
  for (const file of await files(join(apps, root), generated)) {
    if (isNotice(file.slice(file.lastIndexOf(sep) + 1))) workspaceNotices.push(file);
  }
}
workspaceNotices.sort();
const sections = [...licenses.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, text]) => text);
for (const file of workspaceNotices) {
  sections.push(`${relative(apps, file).split(sep).join("/")}\n${await readFile(file, "utf8")}`);
}
await writeFile(join(out, "THIRD-PARTY-LICENSES.txt"), sections.join("\n\n---\n\n"));

// sources = sha256 of "<sha256 hex>  <path>\n" lines (sha256sum format), one per source file
// under apps/, sorted by POSIX path. tests/php/vendor_drift.php recomputes it.
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const lines = [];
for (const path of await files(apps, generated)) {
  lines.push([relative(apps, path).split(sep).join("/"), sha256(await readFile(path))]);
}
lines.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
await writeFile(
  join(out, ".manifest.json"),
  JSON.stringify({ sources: sha256(lines.map(([p, h]) => h + "  " + p + "\n").join("")) }, null, 2) + "\n",
);
