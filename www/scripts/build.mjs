// Builds what the SpacePress site (www/) needs beside its hand-written source:
//
//   sp/data/sources.ts      the text of every file in examples/, for the guide (scripts/sources.mjs)
//   public/site.js             browser/site.js bundled: the code and tree drawing, and <sp-play>
//   public/compiler.wasm       the compiler built for the browser
//   public/play-data.json      the apps the playground can load (scripts/run-data.ts)
//   public/playground-plugins/ SpacePress's shared plugins as zips, for "Run in WordPress"
//
// All of it is git-ignored. Run `bun scripts/build.mjs` after changing browser/ or examples/;
// `spacepress dev` rebuilds the pages itself. Build the compiler wasm and showcase zips first
// with `npm run wasm && npm run showcase` in www/.
import { readFileSync, writeFileSync, statSync, mkdirSync, copyFileSync, existsSync, readdirSync, rmSync, renameSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAiAssets } from "./generate-ai-assets.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..");
const out = join(site, "public");
const buildDir = join(site, ".build");
const wasm = join(buildDir, "compiler.wasm");
const zips = join(buildDir, "files", "plugins");
if (!existsSync(wasm) || !existsSync(zips)) throw new Error("www/.build has no compiler.wasm or files/plugins; run `npm run build` in www/");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "playground-plugins"), { recursive: true });

const sources = Bun.spawnSync(["node", join(here, "sources.mjs")]);
if (sources.exitCode !== 0) throw new Error(`sources.mjs failed:\n${sources.stderr.toString()}`);

// Bun 1.3 links local dependencies back to their source tree. Stage this package's
// current files inside node_modules so both the native and browser compilers can read them.
const docsSource = join(site, "..", "packages", "docs");
const docsPackage = join(site, "node_modules", "@spacepress", "docs");
const packageFiles = ["package.json"];
for (const entry of readdirSync(join(docsSource, "src"), { recursive: true, withFileTypes: true })) {
  if (entry.isFile()) packageFiles.push(relative(docsSource, join(entry.parentPath, entry.name)));
}
for (const file of packageFiles) {
  const target = join(docsPackage, file);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.copy-${process.pid}`;
  copyFileSync(join(docsSource, file), temporary);
  renameSync(temporary, target);
}

const aiStats = generateAiAssets();
const runData = Bun.spawnSync(["node", join(here, "run-data.ts")], { cwd: site });
if (runData.exitCode !== 0) throw new Error(`run-data.ts failed:\n${runData.stderr.toString()}`);
writeFileSync(join(out, "play-data.json"), runData.stdout);
copyFileSync(wasm, join(out, "compiler.wasm"));
for (const slug of ["spacepress-runtime", "spacepress-identity", "spacepress-admin"]) copyFileSync(join(zips, `${slug}.zip`), join(out, "playground-plugins", `${slug}.zip`));

// One script file. The highlighter ships 240 grammars and 70 themes, each behind its own
// `import()`; under `spacepress dev` every file costs a WordPress request, and 28 of them delayed the
// code panes. So only the grammars these apps and their build output use, and the two themes, are
// kept, and without `splitting` Bun puts them in the same file. Any other language is shown as
// plain text by the library.
const keep = {
  "@shikijs/langs": ["typescript", "tsx", "javascript", "jsx", "json", "css", "sql", "php", "html", "xml", "markdown", "yaml", "shellscript"],
  "@pierre/theme": ["pierre-dark", "pierre-light"],
  "@shikijs/themes": [],
  "@pierre/highlights/themes": [],
};
// The library can also highlight with a second engine (oniguruma as 600 KB of wasm) and a second
// highlighter; this site asks for neither, so they are left out too.
const unused = ['import("shiki/wasm")', 'import("shiki/engine/oniguruma")', 'import("./backends/highlights.js")'];
const missing = (name) => `Promise.reject(new Error(${JSON.stringify(`${name} is not in this build`)}))`;
const onlyKept = {
  name: "only-kept-grammars",
  setup(build) {
    build.onLoad({ filter: /(shiki\/dist\/langs-bundle-full[^/]*\.mjs|@pierre\/theming\/dist\/collections\/(pierre|shiki)\.js|@pierre\/highlights\/dist\/themes\/loader\.js|@pierre\/diffs\/dist\/highlighter\/(backends\/shiki|shared_highlighter)\.js)$/ }, (args) => {
      let contents = readFileSync(args.path, "utf8").replace(/import\("(@shikijs\/langs|@shikijs\/themes|@pierre\/theme|@pierre\/highlights\/themes)\/([^"]+)"\)/g, (whole, pkg, name) => keep[pkg].includes(name) ? whole : missing(name));
      for (const call of unused) contents = contents.replaceAll(call, missing(call.slice(8, -2)));
      return { loader: "js", contents };
    });
  },
};
const play = await Bun.build({ entrypoints: [join(site, "browser", "site.js")], minify: true, target: "browser", format: "esm", plugins: [onlyKept] });
if (!play.success) throw new AggregateError(play.logs, "the site script did not bundle");
if (play.outputs.length !== 1) throw new Error(`the site's script came out as ${play.outputs.length} files, expected one`);
writeFileSync(join(out, "site.js"), await play.outputs[0].text());

const notice = ["@pierre/diffs", "@pierre/trees"].map((pkg) => {
  const dir = join(site, "node_modules", pkg);
  const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  return `${pkg} ${version}\n\n${readFileSync(join(dir, "LICENSE.md"), "utf8")}`;
}).join("\n\n----------------------------------------\n\n");
writeFileSync(join(out, "third-party-licenses.txt"), `This site renders code, file trees and diffs with these libraries.\nsite.js contains parts of them.\n\n${notice}\n`);

let ghStars = { repo: "spacefast/spacepress", public: false, stars: null };
if (process.env.WWW_FETCH_GITHUB_STARS === "1") try {
  const gh = Bun.spawnSync(["gh", "api", "repos/spacefast/spacepress", "--jq", "{public:(.visibility==\"public\"),stars:.stargazers_count}"]);
  if (gh.exitCode === 0) {
    const parsed = JSON.parse(gh.stdout.toString().trim());
    ghStars = {
      repo: "spacefast/spacepress",
      public: Boolean(parsed.public),
      stars: parsed.public && typeof parsed.stars === "number" ? parsed.stars : null,
    };
  }
} catch {}
writeFileSync(join(out, "gh-stars.json"), JSON.stringify(ghStars));
console.log(`   generated llms.txt, llms-full.txt, search-index.json (${aiStats.searchItems} items), and ${aiStats.docs + aiStats.posts + 3} markdown twins`);

const kb = (f) => `${String(Math.round(statSync(f).size / 1024)).padStart(7)} KB  ${relative(site, f)}`;
for (const f of [join(site, "sp", "data", "sources.ts"), join(out, "site.js"), join(out, "play-data.json"), join(out, "compiler.wasm"), join(out, "llms.txt"), join(out, "search-index.json")]) console.log(kb(f));
