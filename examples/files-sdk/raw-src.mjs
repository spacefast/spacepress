// Build the raw-src variant: the TypeScript source of files-sdk at the commit
// npm 3.1.2 was published from, installed with every export pointing at
// ./src/<entry>/index.ts. Dependencies are the locked copies in ./node_modules.
//
//   node raw-src.mjs            writes .work/raw (network on spacepress run, then cached)
//   FILES_SDK_SRC_TARBALL=path  use an already downloaded GitHub tarball
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const provenance = JSON.parse(await readFile(path.join(root, "provenance.json"), "utf8"));
const { commit, tarball: url, tarballSha256, packageDirectory } = provenance.source;

export async function buildRawSrc({ work = path.join(root, ".work") } = {}) {
  await mkdir(work, { recursive: true });
  const archive = process.env.FILES_SDK_SRC_TARBALL ?? path.join(work, `files-sdk-${commit}.tar.gz`);
  if (!existsSync(archive)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`download failed: ${url} ${response.status}`);
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  }
  const bytes = await readFile(archive);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    tarballSha256,
    `${archive} differs from provenance.json source.tarballSha256`,
  );
  const extracted = path.join(work, "src-extract");
  await rm(extracted, { recursive: true, force: true });
  await mkdir(extracted, { recursive: true });
  const tar = spawnSync("tar", ["-xzf", archive, "-C", extracted], { encoding: "utf8" });
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
  const packageRoot = path.join(extracted, `files-sdk-${commit}`, packageDirectory);

  const project = path.join(work, "raw");
  await rm(project, { recursive: true, force: true });
  const modules = path.join(project, "node_modules");
  const target = path.join(modules, "files-sdk");
  await mkdir(target, { recursive: true });
  await cp(path.join(packageRoot, "src"), path.join(target, "src"), { recursive: true });
  await cp(path.join(packageRoot, "LICENSE"), path.join(target, "LICENSE"));
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.version, provenance.package.version, "source tag must match the npm version");
  const exports = {};
  for (const key of Object.keys(manifest.exports)) {
    const entry = key === "." ? "./src/index.ts" : `./src/${key.slice(2)}/index.ts`;
    assert.ok(existsSync(path.join(target, entry)), `${key} has no ${entry}`);
    exports[key] = { types: entry, import: entry };
  }
  await writeFile(
    path.join(target, "package.json"),
    JSON.stringify({ ...manifest, exports, main: undefined, types: undefined }, null, 2) + "\n",
  );
  // Every other installed package is shared with the dist variant.
  for (const name of await readdir(path.join(root, "node_modules"))) {
    if (name === "files-sdk" || name.startsWith(".")) continue;
    await symlink(path.join(root, "node_modules", name), path.join(modules, name), "dir");
  }
  await cp(path.join(root, "app"), path.join(project, "app"), { recursive: true });
  return path.join(project, "app");
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await buildRawSrc());
}
