import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { preloadFile } from "@pierre/diffs/ssr";

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
  "public/drive-cart.js",
  "tp/app/cart/page.tsx",
  "tp/app/checkout/page.md",
  "tp/app/page.tsx",
  "tp/app/site.css",
  "tp/app/source/page.tsx",
  "tp/app/source/source.css",
  "tp/app/staff/layout.tsx",
  "tp/app/staff/page.tsx",
  "tp/lib/catalog.ts",
  "tp/schema.ts",
  "tp/server.ts",
  "tp/wp-hooks/typedpress_woo_order_stock.ts",
  "tsconfig.json",
  "typedpress.config.ts",
];
const files = await Promise.all(paths.map(async (path) => {
  const file = resolve(root, path);
  if (await realpath(file) !== file) throw new Error(`Source file is a symlink: ${path}`);
  return [path, await readFile(file, "utf8")];
}));

const options = {
  theme: { light: "pierre-light", dark: "pierre-dark" },
  themeType: "system",
  overflow: "scroll",
};
const defaultPath = "tp/schema.ts";
const rendered = await Promise.all(files.map(async ([name, contents]) => {
  const { prerenderedHTML } = await preloadFile({ file: { name, contents }, options });
  return [name, prerenderedHTML];
}));
const [, initialHTML] = rendered.find(([name]) => name === defaultPath);

// Pierre renders the same sprite and styles for every file. Store them once
// with the default file so subsequent opens transfer only their highlighted code.
const headerStart = '<div data-diffs-header=';
const headerIndex = initialHTML.indexOf(headerStart);
if (headerIndex === -1) throw new Error("Could not find the source preview header");
const sharedHTML = initialHTML.slice(0, headerIndex);
const previews = rendered.map(([name, html]) => {
  if (!html.startsWith(sharedHTML + headerStart)) {
    throw new Error(`Source preview has different styles: ${name}`);
  }
  const contents = `export default ${JSON.stringify(html.slice(headerIndex))};\n`;
  const hash = createHash("sha256").update(contents).digest("hex").slice(0, 16);
  return { name, contents, filename: `preview-${hash}.js` };
});
const otherPreviews = previews.filter(({ name }) => name !== defaultPath);
const loaders = previews.map(({ name, filename }) => {
  const path = JSON.stringify(name);
  return name === defaultPath
    ? `[${path}, null]`
    : `[${path}, () => import(${JSON.stringify(`./${filename}`)})]`;
});

const build = await Bun.build({
  entrypoints: [resolve(root, "browser/source.js")],
  format: "esm",
  target: "browser",
  minify: true,
  external: otherPreviews.map(({ filename }) => `./${filename}`),
  define: {
    __DRIVE_SOURCE_DEFAULT__: JSON.stringify(defaultPath),
    __DRIVE_SOURCE_SHARED_HTML__: JSON.stringify(sharedHTML),
    __DRIVE_SOURCE_DEFAULT_HTML__: JSON.stringify(initialHTML.slice(headerIndex)),
  },
  plugins: [{
    name: "drive-source-previews",
    setup(build) {
      build.onResolve({ filter: /^drive-source-previews$/ }, () => ({
        path: "drive-source-previews",
        namespace: "drive-source",
      }));
      build.onLoad({ filter: /.*/, namespace: "drive-source" }, () => ({
        contents: `export const files = new Map([${loaders.join(",")}]);`,
        loader: "js",
      }));
    },
  }],
});
const [bundle] = build.outputs;
if (!build.success || build.outputs.length !== 1) {
  throw new AggregateError(build.logs, "Expected one Drive Store source viewer bundle");
}

const notices = await Promise.all(["@pierre/diffs/LICENSE.md", "@pierre/trees/LICENSE.md", "@pierre/trees/NOTICE.md"]
  .map(async (path) => `${path}\n\n${await readFile(resolve(root, "node_modules", path), "utf8")}`));

await mkdir(out, { recursive: true });
await Promise.all([
  ...otherPreviews.map(({ filename, contents }) => writeFile(resolve(out, filename), contents)),
  writeFile(resolve(out, "licenses.txt"), notices.join("\n\n")),
]);
await writeFile(resolve(out, "source.js"), await bundle.text());

// An incremental build must stop publishing previews of files that changed or were removed.
const current = new Set(otherPreviews.map(({ filename }) => filename));
const generated = /^(?:preview-[0-9a-f]{16}|(?:javascript|css|json|markdown|shellscript)-[a-z0-9]{8})\.js$/;
for (const entry of await readdir(out, { withFileTypes: true })) {
  if (entry.isFile() && !current.has(entry.name) && (entry.name === "files.json" || generated.test(entry.name))) {
    await unlink(resolve(out, entry.name));
  }
}
