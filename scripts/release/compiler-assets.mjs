// Records the immutable source and checksums of a release's compiler assets, after checking that
// every target the release workflow builds has its archive and a matching .sha256 under the name
// the npm launcher downloads (packages/cli/lib/release.mjs).
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assetName, releaseTargets } from "../../packages/cli/lib/release.mjs";
import { releaseVersion } from "./version.mjs";

const [directory, revision] = process.argv.slice(2);
if (!directory || !/^[a-f0-9]{40}$/.test(revision ?? "")) throw new Error("Usage: compiler-assets.mjs <assets-directory> <source-revision>");
const version = await releaseVersion();
const present = new Set(await readdir(directory));
const expected = releaseTargets.map((target) => assetName({ version, target }));
const missing = ["typedpress.wasm", ...expected.flatMap((name) => [name, `${name}.sha256`])].filter((name) => !present.has(name));
if (missing.length) throw new Error(`Release assets missing: ${missing.join(", ")}`);
const stray = [...present].filter((name) => /^typedpress-v.+\.tar\.gz$/.test(name) && !expected.includes(name));
if (stray.length) throw new Error(`Unexpected compiler archives (wrong version or target): ${stray.join(", ")}`);
const files = {};
for (const name of ["typedpress.wasm", ...expected].sort()) {
  files[name] = createHash("sha256").update(await readFile(path.join(directory, name))).digest("hex");
  if (name === "typedpress.wasm") continue;
  const receipt = (await readFile(path.join(directory, `${name}.sha256`), "utf8")).trim();
  if (receipt !== `${files[name]}  ${name}`) throw new Error(`${name}.sha256 does not match the archive.`);
}
await writeFile(path.join(directory, "compiler-assets.json"), JSON.stringify({ version, revision, files }, null, 2) + "\n");
