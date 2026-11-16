// Records the immutable source and checksums consumed by the spacefast npm release.
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { releaseVersion } from "./version.mjs";

const [directory, revision] = process.argv.slice(2);
if (!directory || !/^[a-f0-9]{40}$/.test(revision ?? "")) throw new Error("Usage: compiler-assets.mjs <assets-directory> <source-revision>");
const version = await releaseVersion();
const names = (await readdir(directory)).filter(name => name === "typedpress.wasm" || /^typedpress-v.+\.tar\.gz$/.test(name));
if (!names.includes("typedpress.wasm")) throw new Error("Missing wasm compiler");
const files = {};
for (const name of names.sort()) {
  files[name] = createHash("sha256").update(await readFile(path.join(directory, name))).digest("hex");
}
await writeFile(path.join(directory, "compiler-assets.json"), JSON.stringify({ version, revision, files }, null, 2) + "\n");
