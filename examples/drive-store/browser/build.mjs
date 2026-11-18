import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = await realpath(resolve(import.meta.dir, ".."));
const out = resolve(root, "public/drive-source");

// This list is the public snapshot. Adding a file here opts it into publication.
const paths = [
  "README.md",
  "browser/build.mjs",
  "browser/source.js",
  "content/drives/crucial-p3-2tb.md",
  "content/drives/samsung-870-evo-1tb.md",
  "content/drives/seagate-exos-x16.md",
  "content/drives/wd-red-plus-4tb.md",
  "package.json",
  "tp/app/_lib/format.ts",
  "tp/app/drives/[slug]/page.tsx",
  "tp/app/layout.tsx",
  "tp/app/login.tsx",
  "tp/app/not-found.tsx",
  "tp/app/orders/layout.tsx",
  "tp/app/orders/page.tsx",
  "tp/app/page.tsx",
  "tp/app/site.css",
  "tp/app/source/page.tsx",
  "tp/app/source/source.css",
  "tp/app/staff/layout.tsx",
  "tp/app/staff/page.tsx",
  "tp/lib/catalog.ts",
  "tp/schema.ts",
  "tp/server.ts",
  "tsconfig.json",
  "typedpress.config.ts",
];
const files = await Promise.all(paths.map(async (path) => {
  const file = resolve(root, path);
  if (await realpath(file) !== file) throw new Error(`Source file is a symlink: ${path}`);
  return [path, await readFile(file, "utf8")];
}));

// Bundle the grammars the example uses. Markdown needs its embedded languages too.
const packages = {
  "@shikijs/langs": new Set(["typescript", "tsx", "javascript", "css", "json", "markdown", "shellscript"]),
  "@shikijs/themes": new Set(),
  "@pierre/theme": new Set(["pierre-light", "pierre-dark"]),
  "@pierre/highlights/themes": new Set(),
};
const unavailable = `Promise.reject(new Error("Highlighter option is not bundled"))`;
const sourceHighlighter = {
  name: "source-highlighter",
  setup(build) {
    build.onLoad({
      filter: /(shiki\/dist\/langs-bundle-full[^/]*\.mjs|@pierre\/theming\/dist\/collections\/(pierre|shiki)\.js|@pierre\/highlights\/dist\/themes\/loader\.js|@pierre\/diffs\/dist\/highlighter\/(backends\/shiki|shared_highlighter)\.js)$/,
    }, async ({ path }) => {
      const original = await readFile(path, "utf8");
      const contents = original
        .replace(/import\("(@shikijs\/langs|@shikijs\/themes|@pierre\/theme|@pierre\/highlights\/themes)\/([^"]+)"\)/g,
          (call, pkg, name) => packages[pkg].has(name) ? call : unavailable)
        .replace(/import\("(shiki\/wasm|shiki\/engine\/oniguruma|\.\/backends\/highlights\.js)"\)/g, unavailable);
      return { contents, loader: "js" };
    });
  },
};

const build = await Bun.build({
  entrypoints: [resolve(root, "browser/source.js")],
  format: "esm",
  target: "browser",
  minify: true,
  plugins: [sourceHighlighter],
});
const [bundle] = build.outputs;
if (!build.success || build.outputs.length !== 1) {
  throw new AggregateError(build.logs, "Expected one Drive Store source viewer bundle");
}

const notices = await Promise.all(["@pierre/diffs/LICENSE.md", "@pierre/trees/LICENSE.md", "@pierre/trees/NOTICE.md"]
  .map(async (path) => `${path}\n\n${await readFile(resolve(root, "node_modules", path), "utf8")}`));

await mkdir(out, { recursive: true });
await Promise.all([
  writeFile(resolve(out, "source.js"), await bundle.text()),
  writeFile(resolve(out, "files.json"), JSON.stringify(Object.fromEntries(files))),
  writeFile(resolve(out, "licenses.txt"), notices.join("\n\n")),
]);
