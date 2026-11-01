// Bundle the pinned @wordpress packages into one CommonJS file the serializer loads.
//
// Why a bundle rather than plain imports: the ESM builds of @wordpress/* import JSON
// without import attributes (Node refuses them), the CJS builds work only when exactly
// one copy of every package exists (two copies of private-apis throw "Cannot unlock an
// object that was not locked before"), and bundling with NODE_ENV=production drops the
// editor UI's dev-only paths. The result loads in ~300 ms where a cold module graph took
// seconds. It is built by `prepare` (every install) and never committed.
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const outdir = path.join(root, "vendor");
await mkdir(outdir, { recursive: true });

const entry = path.join(outdir, "wp-entry.mjs");
await writeFile(
  entry,
  [
    'export * as blocks from "@wordpress/blocks";',
    'export { registerCoreBlocks } from "@wordpress/block-library";',
    'export * as element from "@wordpress/element";',
    "",
  ].join("\n"),
);

const versions = Object.fromEntries(
  ["@wordpress/blocks", "@wordpress/block-library", "@wordpress/element"].map((name) => [
    name,
    require(`${name}/package.json`).version,
  ]),
);

await build({
  entryPoints: [entry],
  outfile: path.join(outdir, "wp.cjs"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  logLevel: "warning",
  // Keep the bundled packages' license headers; esbuild writes them beside the bundle as wp.cjs.LEGAL.txt.
  legalComments: "linked",
  define: { "process.env.NODE_ENV": '"production"' },
  banner: { js: `/* @wordpress bundle: ${JSON.stringify(versions)} */` },
});
await writeFile(path.join(outdir, "versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
