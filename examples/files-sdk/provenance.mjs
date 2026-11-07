// Refresh provenance.json from the registry and the installed bytes. The harness
// itself stays offline after `npm ci` (raw-src.mjs downloads the pinned source
// tarball once and checks it against the hash recorded here).
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceFiles } from "./sources.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const commit = "fd304f1c38e71d184c13a6c317e19f270649fbae";
const tarball = `https://codeload.github.com/haydenbleasel/files-sdk/tar.gz/${commit}`;

async function registry(name, version) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`);
  if (!response.ok) throw new Error(`registry lookup failed: ${name} ${response.status}`);
  const metadata = await response.json();
  return {
    name,
    version: metadata.version,
    license: metadata.license,
    repository: metadata.repository ?? null,
    gitHead: metadata.gitHead ?? null,
    tarball: metadata.dist.tarball,
    integrity: metadata.dist.integrity,
    shasum: metadata.dist.shasum,
    unpackedBytes: metadata.dist.unpackedSize ?? null,
  };
}

const files = await sourceFiles(path.join(root, "node_modules"));
const packageNames = [...new Set(files.map((file) => file.package))].sort();
const packages = [];
for (const name of packageNames) {
  const locked = lock.packages[`node_modules/${name}`];
  const entry = await registry(name, locked.version);
  if (entry.integrity !== locked.integrity) throw new Error(`${name}: lockfile integrity differs from registry`);
  packages.push({
    ...entry,
    files: files
      .filter((file) => file.package === name)
      .map((file) => ({ path: file.path, bytes: file.bytes.length, sha256: sha256(file.bytes) })),
  });
}
const sourceResponse = await fetch(tarball);
if (!sourceResponse.ok) throw new Error(`source download failed: ${sourceResponse.status}`);
const sourceBytes = Buffer.from(await sourceResponse.arrayBuffer());
const filesSdk = packages.find((entry) => entry.name === "files-sdk");
if (filesSdk.gitHead !== commit) throw new Error(`npm gitHead ${filesSdk.gitHead} is not ${commit}`);

await writeFile(
  path.join(root, "provenance.json"),
  JSON.stringify(
    {
      fetchedAt: new Date().toISOString(),
      package: { name: "files-sdk", version: filesSdk.version },
      source: {
        repository: "https://github.com/haydenbleasel/files-sdk",
        tag: `files-sdk@${filesSdk.version}`,
        commit,
        packageDirectory: "packages/files-sdk",
        tarball,
        tarballSha256: sha256(sourceBytes),
      },
      packages,
    },
    null,
    2,
  ) + "\n",
);
