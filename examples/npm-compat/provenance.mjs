// Refresh registry provenance; compilation/verification itself needs no network.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { probes } from "./cases.mjs";
const entries = [];
for (const probe of probes) {
  const encoded = encodeURIComponent(probe.name);
  const metadataResponse = await fetch(`https://registry.npmjs.org/${encoded}/${probe.version}`);
  if (!metadataResponse.ok)
    throw new Error(`registry lookup failed: ${probe.name} ${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  const downloadsUrl = `https://api.npmjs.org/downloads/point/last-week/${encoded}`;
  const downloadsResponse = await fetch(downloadsUrl);
  const downloads = downloadsResponse.ok
    ? await downloadsResponse.json()
    : { error: downloadsResponse.status };
  const source = await readFile(
    new URL(`./node_modules/${probe.name}/${probe.entry}`, import.meta.url),
  );
  entries.push({
    name: probe.name,
    version: metadata.version,
    license: metadata.license,
    repository: metadata.repository,
    exports: metadata.exports ?? null,
    module: metadata.module ?? null,
    main: metadata.main ?? null,
    unpackedBytes: metadata.dist.unpackedSize ?? null,
    tarball: metadata.dist.tarball,
    integrity: metadata.dist.integrity ?? null,
    shasum: metadata.dist.shasum,
    selectedSource: probe.entry,
    selectedSourceBytes: source.length,
    selectedSourceSha256: createHash("sha256").update(source).digest("hex"),
    downloads: { url: downloadsUrl, ...downloads },
  });
}
await writeFile(
  new URL("./provenance.json", import.meta.url),
  JSON.stringify({ fetchedAt: new Date().toISOString(), packages: entries }, null, 2) + "\n",
);
