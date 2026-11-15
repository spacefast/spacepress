// Builds the TypedPress site as a First app, in the folder above this one (website/):
//
//   first/app/layout.tsx, page.tsx, play/page.tsx, site.css    the pages, written from guide.html
//   public/                                                    scripts, the compiler, example data, plugin zips
//
// `first dev` in website/ serves it (website/README.md). Everything this script writes is
// git-ignored; edit guide.html, play.js, the examples and this script, never the output.
//
// Code, file trees and diffs are rendered at build time with @pierre/diffs and @pierre/trees
// (https://diffs.com), so a page shows them without waiting for a script.
//
//   bun install && bun build.mjs
//
// Source tags in guide.html:
//   <tp-code file="tp/schema.ts" note="…">escaped code</tp-code>     a file, with its path in the header
//   <tp-code lang="ts">escaped code</tp-code>                        a snippet with no file
//   <tp-tree>indented listing, "name   note" per line</tp-tree>      a file tree
//   <tp-diff old="examples/a.ts" new="examples/b.ts" old-name="first/a.ts" new-name="tp/b.ts"></tp-diff>
//   <tp-example dir="examples/notes" open="tp/schema.ts"></tp-example>   a whole project: tree and files
//   <tp-play example="tasks" open></tp-play>                         the playground component (play.js)
import { preloadFile, preloadMultiFileDiff } from "@pierre/diffs/ssr";
import { preloadFileTree } from "@pierre/trees/ssr";
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..");
const out = join(site, "public");
const app = join(site, "first", "app");
rmSync(out, { recursive: true, force: true });
rmSync(app, { recursive: true, force: true });
mkdirSync(join(app, "play"), { recursive: true });
mkdirSync(out, { recursive: true });

const THEME = { dark: "pierre-dark", light: "pierre-light" };
const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attrsOf = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], unescape(m[2])]));

// One copy of each library stylesheet, linked from every shadow root, instead of one copy per block.
const sheets = new Map();
function shareStyles(html, attribute, file) {
  return html.replace(new RegExp(`<style ${attribute}[^>]*>([\\s\\S]*?)</style>`), (_, css) => {
    const known = sheets.get(file);
    if (known !== undefined && known !== css) throw new Error(`${file}: two different stylesheets`);
    sheets.set(file, css);
    return `<link rel="stylesheet" href="/${file}">`;
  });
}
// Keep only the icons a block uses; the full sprite is 16 to 38 KB per block.
function trimSprite(html) {
  const sprite = html.match(/<svg[^>]*data-icon-sprite[\s\S]*?<\/svg>/);
  if (!sprite) return html;
  const rest = html.replace(sprite[0], "");
  const used = new Set([...rest.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]));
  const symbols = [...sprite[0].matchAll(/<symbol id="([\w-]+)"[\s\S]*?<\/symbol>/g)].filter((m) => used.has(m[1])).map((m) => m[0]);
  const open = sprite[0].match(/<svg[^>]*>/)[0];
  return symbols.length ? `${open}${symbols.join("")}</svg>${rest}` : rest;
}
const diffsShadow = (html) => trimSprite(shareStyles(html, "data-core-css", "pierre-diffs.css"));

const LANG = { sh: "shellscript", ts: "typescript", tsx: "tsx", php: "php", html: "html", sql: "sql", md: "markdown", json: "json", css: "css", astro: "astro", txt: "text" };
const EXT = { shellscript: "sh", typescript: "ts", text: "txt", markdown: "md" };

async function renderFile({ name, contents, lang, note, header = true, cls = "" }) {
  const options = { theme: THEME, themeType: "system", disableFileHeader: !header, disableLineNumbers: !header, overflow: "scroll" };
  const file = { name, contents: contents.replace(/\n+$/, "") };
  if (lang) file.lang = LANG[lang] ?? lang;
  const { prerenderedHTML } = await preloadFile({ file, options });
  const meta = note ? `<span slot="header-metadata" class="tp-note">${escape(note)}</span>` : "";
  return `<diffs-container class="tp-file ${cls}" data-path="${escape(name)}"><template shadowrootmode="open">${diffsShadow(prerenderedHTML)}</template>${meta}</diffs-container>`;
}

async function renderDiff({ oldName, newName, oldContents, newContents, style = "unified", full = false }) {
  const { prerenderedHTML } = await preloadMultiFileDiff({
    oldFile: { name: oldName, contents: oldContents },
    newFile: { name: newName, contents: newContents },
    options: { theme: THEME, themeType: "system", diffStyle: style, overflow: "scroll", expandUnchanged: full, hunkSeparators: "simple" },
  });
  return `<diffs-container class="tp-file tp-diff"><template shadowrootmode="open">${diffsShadow(prerenderedHTML)}</template></diffs-container>`;
}

let treeCount = 0;
const treeConfigs = {};
function renderTree({ paths, notes = {}, status = [], selected, example }) {
  const id = `tp-tree-${++treeCount}`;
  const rows = new Set();
  for (const p of paths) { const parts = p.replace(/\/$/, "").split("/"); for (let i = 1; i <= parts.length; i++) rows.add(parts.slice(0, i).join("/")); }
  const config = { id, paths, notes, gitStatus: status, initialExpansion: "open", initialVisibleRowCount: rows.size, flattenEmptyDirectories: true, icons: { set: "complete", colored: true }, density: "compact" };
  if (selected) config.initialSelectedPaths = [selected];
  const payload = preloadFileTree({ ...config, renderRowDecoration: ({ item }) => (notes[item.path] ? { text: notes[item.path] } : null) });
  treeConfigs[id] = { ...config, example: example ?? null };
  const shadow = trimSprite(shareStyles(payload.shadowHtml, "data-file-tree-style", "pierre-trees.css"));
  const itemHeight = Number(payload.outerStart.match(/--trees-item-height:(\d+)px/)?.[1] ?? 30);
  const outer = payload.outerStart
    .replace("<file-tree-container", `<file-tree-container class="tp-tree"`)
    .replace('style="', `style="height:${(payload.shadowHtml.match(/role="treeitem"/g) ?? []).length * itemHeight + 2}px;`);
  return `${outer}${shadow}${payload.outerEnd}`;
}

// "name   note" lines, two spaces per level, folders end with "/".
function parseListing(text) {
  const paths = [], notes = {}, stack = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^(\s*)(\S+)(?:\s{2,}(.*))?$/);
    const depth = m[1].length / 2, name = m[2], note = m[3]?.trim();
    stack.length = depth;
    const path = stack.join("") + name;
    if (name.endsWith("/")) stack.push(name);
    paths.push(path);
    if (note) notes[path] = note;
  }
  return { paths, notes };
}

function walk(dir, base = dir) {
  return readdirSync(dir).sort().flatMap((entry) => {
    const full = join(dir, entry);
    if (entry.startsWith("_")) return [];
    return statSync(full).isDirectory() ? walk(full, base) : [relative(base, full)];
  });
}

async function renderExample({ dir, open }) {
  const root = join(here, dir);
  const meta = existsSync(join(root, "_meta.json")) ? JSON.parse(readFileSync(join(root, "_meta.json"), "utf8")) : {};
  const files = walk(root);
  const first = open ?? files[0];
  const name = dir.split("/").pop();
  const panels = [];
  for (const path of files) {
    const html = await renderFile({ name: path, contents: readFileSync(join(root, path), "utf8"), note: meta.notes?.[path], cls: path === first ? "tp-open" : "" });
    panels.push(html);
  }
  const tree = renderTree({ paths: files, notes: meta.treeNotes ?? {}, selected: first, example: name });
  return `<div class="tp-example wide" data-example="${name}"><div class="tp-example-tree">${tree}</div><div class="tp-example-files">${panels.join("")}</div></div>`;
}

let page = readFileSync(join(here, "guide.html"), "utf8");
const jobs = [];
const queue = (re, fn) => { page = page.replace(re, (...m) => { const key = `\u0000${jobs.length}\u0000`; jobs.push(fn(...m)); return key; }); };

queue(/<tp-code([^>]*)>([\s\S]*?)<\/tp-code>/g, (_, a, body) => {
  const at = attrsOf(a);
  const contents = at.src ? readFileSync(join(here, at.src), "utf8") : unescape(body).replace(/^\n/, "");
  if (at.file) return renderFile({ name: at.file, contents, note: at.note, lang: at.lang });
  const lang = at.lang ?? "ts";
  return renderFile({ name: `snippet.${EXT[LANG[lang] ?? lang] ?? lang}`, contents, lang, header: false });
});
queue(/<tp-tree([^>]*)>([\s\S]*?)<\/tp-tree>/g, (_, a, body) => Promise.resolve(renderTree(parseListing(unescape(body)))));
queue(/<tp-diff([^>]*)><\/tp-diff>/g, (_, a) => {
  const at = attrsOf(a);
  return renderDiff({ oldName: at["old-name"] ?? at.old, newName: at["new-name"] ?? at.new, oldContents: readFileSync(join(here, at.old), "utf8"), newContents: readFileSync(join(here, at.new), "utf8"), style: at.style, full: at.full === "true" });
});
queue(/<tp-example([^>]*)><\/tp-example>/g, (_, a) => renderExample(attrsOf(a)));

// Section numbers, the table of contents and "section N" references come from the order of the <h2>s.
const numbers = {};
let count = 0;
page = page.replace(/<h2 id="([\w-]+)">([\s\S]*?)<\/h2>/g, (_, id, title) => {
  numbers[id] = { n: ++count, title };
  return `<h2 id="${id}"><span class="n">${count}</span>${title}</h2>`;
});
page = page.replace(/\{\{sec:([\w-]+)\}\}/g, (_, id) => { if (!numbers[id]) throw new Error(`no section ${id}`); return String(numbers[id].n); });
page = page.replace("<!--tp-toc-->", `<ul class="toc">\n${Object.entries(numbers).map(([id, s]) => `  <li><a href="#${id}"><span class="n">${s.n}</span>${s.title.replace(/<[^>]+>/g, "")}</a></li>`).join("\n")}\n</ul>`);

const rendered = await Promise.all(jobs);
page = page.replace(/\u0000(\d+)\u0000/g, (_, i) => rendered[Number(i)]);
page = page.replace("<!--tp-trees-->", `<script type="application/json" id="tp-trees">${JSON.stringify(treeConfigs).replace(/</g, "\\u003c")}</script>`);

// ---- The First app ---------------------------------------------------------------------------
// A page's markup is one literal handed to <Html>, which places a literal as written. First's TSX
// refuses <script> and has no text imports, so the pre-rendered shadow roots, the scripts and the
// inline JSON all travel inside that literal. (Sent to the First thread as a gap, 2026-11-15.)
const literal = (html) => "`" + html.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
const between = (text, start, end, last = false) => { const from = text.indexOf(start) + start.length; return text.slice(from, last ? text.lastIndexOf(end) : text.indexOf(end, from)); };
const pageFile = (name, title, description, html) => `// Written by src/build.mjs. Do not edit: change src/guide.html or src/build.mjs and build again.
import { Html } from "first/app";

export const metadata = { title: ${JSON.stringify(title)}, description: ${JSON.stringify(description)} };

export default function ${name}() {
  return <Html value={${literal(html)}} />;
}
`;

const css = between(page, "<style>", "</style>");
const body = between(page, "<body>", "</body>", true);
writeFileSync(join(app, "site.css"), `/* Written by src/build.mjs from the <style> of src/guide.html. */\n${css}`);
writeFileSync(join(app, "layout.tsx"), `// Written by src/build.mjs. Do not edit.
import type { LayoutProps } from "first/app";
import "./site.css";

export const metadata = {
  title: { default: "TypedPress", template: "%s · TypedPress" },
  description: "Describe your data and pages in TypeScript. TypedPress compiles them into a WordPress plugin.",
  // Browser code is a script module in public/, named here. First loads each once, as a module.
  scripts: ["/guide.js", "/play.js"],
};

export default function Root({ children }: LayoutProps) {
  return (
    <div className="site">
      <header className="top">
        <a className="brand" href="/">TypedPress</a>
        <nav>
          <a href="/">Guide</a>
          <a href="/#examples">Examples</a>
          <a href="/#compare">Compare</a>
          <a className="play" href="/play">Playground</a>
        </nav>
      </header>
      {children}
    </div>
  );
}
`);
writeFileSync(join(app, "page.tsx"), pageFile("Home", "Building a TypedPress app", "Every feature of TypedPress and how to use it, with examples you can edit, build and run in your browser.", body.replace('<script type="module" src="guide.js"></script>', "")));
// The playground page is ordinary TSX: the component is a custom element, and its code is the
// layout's script module. It reads ?example= and &file= from the address itself.
writeFileSync(join(app, "play", "page.tsx"), `// Written by src/build.mjs. Do not edit.
export const metadata = {
  title: "Playground",
  description: "Edit a TypedPress app and build it in your browser. See the PHP, SQL and types the build writes, then run the app in WordPress.",
};

export default function Playground() {
  return (
    <main className="playpage">
      <h1>Playground</h1>
      <p className="lede">Pick an app, change its code and it is built in your browser by the same compiler the command line uses. Then run your version in WordPress, also in your browser. Nothing is sent to a server.</p>
      <div className="note">These are the example apps as they are in the code today, so they use the current names: <code>first.config.ts</code>, <code>first/</code>, <code>action()</code>. The guide describes the names they are moving to.</div>
      <tp-play example="full-site" picker="" open="" />
    </main>
  );
}
`);

for (const [file, sheet] of sheets) writeFileSync(join(out, file), sheet);
const bundle = await Bun.build({ entrypoints: [join(here, "client.js")], minify: true, target: "browser", format: "esm" });
if (!bundle.success) throw new AggregateError(bundle.logs, "client bundle failed");
writeFileSync(join(out, "guide.js"), await bundle.outputs[0].text());

// ---- The playground component's files, in public/ ---------------------------------------------
// The compiler built for the browser, the apps it can load with what "Run in WordPress" needs, and
// the plugin zips WordPress Playground installs. They come from docs-site/: run
// `pnpm wasm && pnpm showcase` there first (docs-site/README.md).
const docs = join(site, "..", "docs-site");
const wasm = join(docs, "public", "compiler.wasm");
const zips = join(docs, "public", "files", "plugins");
if (!existsSync(wasm) || !existsSync(zips)) throw new Error("docs-site/public has no compiler.wasm or files/plugins; run `pnpm wasm && pnpm showcase` in docs-site/");
const runData = Bun.spawnSync(["node", join(here, "run-data.ts")], { cwd: docs });
if (runData.exitCode !== 0) throw new Error(`run-data.ts failed:\n${runData.stderr.toString()}`);
writeFileSync(join(out, "play-data.json"), runData.stdout);
copyFileSync(wasm, join(out, "compiler.wasm"));
mkdirSync(join(out, "files", "plugins"), { recursive: true });
for (const slug of ["first-runtime", "first-identity", "first-admin"]) copyFileSync(join(zips, `${slug}.zip`), join(out, "files", "plugins", `${slug}.zip`));
// Bun names a chunk after its entry; one that starts with a dot would not be served by every host.
const play = await Bun.build({ entrypoints: [join(here, "play.js")], minify: true, target: "browser", format: "esm", splitting: true, outdir: join(out, "play"), naming: { entry: "[name].[ext]", chunk: "c-[hash].[ext]" } });
if (!play.success) throw new AggregateError(play.logs, "playground bundle failed");
writeFileSync(join(out, "play.js"), 'import "./play/play.js";\n');

const notice = ["@pierre/diffs", "@pierre/trees"].map((pkg) => {
  const dir = join(here, "node_modules", pkg);
  const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  return `${pkg} ${version}\n\n${readFileSync(join(dir, "LICENSE.md"), "utf8")}`;
}).join("\n\n----------------------------------------\n\n");
writeFileSync(join(out, "third-party-licenses.txt"), `This site renders code, file trees and diffs with these libraries.\npierre-diffs.css, pierre-trees.css, guide.js and play/ contain parts of them.\n\n${notice}\n`);

const kb = (f) => `${String(Math.round(statSync(f).size / 1024)).padStart(7)} KB  ${relative(site, f)}`;
console.log(`${jobs.length} blocks, ${treeCount} trees`);
for (const f of [join(app, "page.tsx"), join(app, "play", "page.tsx"), join(app, "site.css"), join(out, "play-data.json"), join(out, "compiler.wasm")]) console.log(kb(f));
console.log(`${String(readdirSync(join(out, "play")).length).padStart(7)} files in public/play/ (the playground script and the highlighter grammars it loads on demand)`);
