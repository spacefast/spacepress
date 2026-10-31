// Builds the hosted (/identity) and admin screens of zero-identity into
// ../build. Output is deterministic: the same sources and lockfile produce
// byte-identical files. build/.manifest.json records a hash of every source
// file under apps/ (node_modules excluded) so a check can tell whether the
// committed build is stale.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const apps = dirname(fileURLToPath(import.meta.url));
const out = resolve(apps, "../build");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const result = await build({
  absWorkingDir: apps,
  entryPoints: {
    hosted: "hosted/src/index.tsx",
    admin: "admin/src/index.tsx",
  },
  bundle: true,
  metafile: true,
  outdir: out,
  format: "iife",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  charset: "utf8",
  loader: { ".woff2": "file", ".woff": "file", ".svg": "file" },
  assetNames: "assets/[name]-[hash]",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

const licenses = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes("node_modules/")) continue;
  let dir = dirname(resolve(apps, input));
  while (dir !== dirname(dir)) {
    let meta;
    try {
      meta = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    } catch {
      dir = dirname(dir);
      continue;
    }
    if (meta.name) {
      const key = meta.name + "@" + meta.version;
      if (!licenses.has(key)) {
        let text = "";
        for (const name of [
          "LICENSE",
          "LICENSE.md",
          "LICENSE.txt",
          "LICENCE",
          "LICENCE.md",
          "LICENCE.txt",
          "license",
          "license.md",
          "license.txt",
          "COPYING",
        ]) {
          try {
            text = await readFile(join(dir, name), "utf8");
            break;
          } catch {}
        }
        licenses.set(
          key,
          key +
            " (" +
            JSON.stringify(meta.license ?? "See upstream package") +
            ")\n" +
            text,
        );
      }
      break;
    }
    dir = dirname(dir);
  }
}
await writeFile(
  join(out, "THIRD-PARTY-LICENSES.txt"),
  [...licenses.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, text]) => text)
    .join("\n\n---\n\n"),
);

// sources = sha256 of "<sha256 hex>  <path>\n" lines (sha256sum format),
// one per file under apps/ except node_modules, sorted by POSIX path.
async function files(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const lines = [];
for (const path of await files(apps)) {
  lines.push([
    relative(apps, path).split(sep).join("/"),
    sha256(await readFile(path)),
  ]);
}
lines.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const sources = sha256(lines.map(([p, h]) => h + "  " + p + "\n").join(""));
await writeFile(
  join(out, ".manifest.json"),
  JSON.stringify({ sources }, null, 2) + "\n",
);

for (const [file, { bytes }] of Object.entries(result.metafile.outputs).sort()) {
  console.log(relative(apps, resolve(apps, file)).padEnd(40), bytes);
}
