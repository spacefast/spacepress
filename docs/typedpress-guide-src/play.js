// The playground: edit an example, compile it in the browser with the real compiler
// (compiler.wasm, built from src/wasm.rs), read what it wrote, and run it in WordPress Playground.
// Files, trees and diffs are @pierre/diffs and @pierre/trees. The compiler wrapper and the
// blueprint come from docs-site/lib, the same modules the docs site's playground uses.
import { File, FileDiff } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
import { FileTree } from "@pierre/trees";
import { Compiler } from "../../docs-site/lib/compiler.ts";
import { editedBlueprint, playgroundUrl, runRequest } from "../../docs-site/lib/blueprint.ts";

const $ = (id) => document.getElementById(id);
const theme = { light: "pierre-light", dark: "pierre-dark" };
const fileOptions = { theme, themeType: "system", overflow: "scroll" };
const root = $("play");
const site = root.dataset.site;

const data = await (await fetch(root.dataset.examples)).json();
const names = Object.keys(data.examples);
const picker = $("example");
picker.replaceChildren(...names.map((name) => new Option(data.examples[name].title, name)));

let compiler, name, example, files, baseline = {}, outputs = {}, source, output, pending;
let sourceView, detach, outputView, sourceTree, outputTree, showSourceDiff = false, showOutputDiff = false;

const status = (state, text) => { $("status").dataset.state = state; $("status").textContent = text; };

function compile(sources) {
  const { check, output: out } = compiler.compile(runRequest(name, sources, example.run.ledger));
  if (!check.ok || !out) return { check, out: null, files: {} };
  const committed = Object.fromEntries(Object.entries(example.run.ledger.files).map(([file, sql]) => [`first/_generated/migrations/${file}`, sql]));
  return { check, out, files: {
    "first/app/schema.php": out.schemaPhp,
    "first/app/functions.php": out.functionsPhp,
    ...committed,
    ...Object.fromEntries(out.migrations.map(([file, sql]) => [`first/_generated/migrations/${file}`, sql])),
    "first/_generated/db.d.ts": out.genTs,
    ...Object.fromEntries(Object.entries(out.client).map(([file, text]) => [`first/_generated/client/${file}`, text])),
    ...(out.appPlugin[Object.keys(out.appPlugin).find((file) => file.endsWith("/first/app/openapi.json")) ?? ""] ? { "first/app/openapi.json": out.appPlugin[Object.keys(out.appPlugin).find((file) => file.endsWith("/first/app/openapi.json"))] } : {}),
  } };
}

// The address names the example and the open file, so a link to either can be shared.
const remember = () => history.replaceState(null, "", `?example=${name}${source === defaultFile() ? "" : `&file=${encodeURIComponent(source)}`}`);
const defaultFile = () => (example.shown.includes("first.config.ts") ? "first.config.ts" : example.shown[0]);

const changed = (now, then) => Object.keys(now).filter((file) => now[file] !== then[file]);

function tree(host, paths, selected, statuses, onSelect) {
  host.replaceChildren();
  // The tree draws only the rows that fit its height, so the box gets one row per file and folder.
  const rows = new Set();
  for (const p of paths) { const parts = p.split("/"); for (let i = 1; i <= parts.length; i++) rows.add(parts.slice(0, i).join("/")); }
  host.style.height = `${rows.size * 24 + 8}px`;
  const model = new FileTree({ paths, initialExpansion: "open", flattenEmptyDirectories: true, density: "compact", icons: { set: "complete", colored: true }, initialSelectedPaths: [selected], gitStatus: statuses,
    onSelectionChange: (picked) => { if (picked.length === 1 && paths.includes(picked[0])) onSelect(picked[0]); } });
  model.render({ containerWrapper: host });
  // Folders with one child are shown on one row, so the real row count is known only now.
  requestAnimationFrame(() => {
    const drawn = host.querySelector("file-tree-container")?.shadowRoot?.querySelectorAll('[role="treeitem"]').length;
    if (drawn) host.style.height = `${drawn * 24 + 8}px`;
  });
  return model;
}

function showSource() {
  detach?.(); detach = undefined;
  sourceView?.cleanUp();
  $("source").replaceChildren();
  $("source-diff").setAttribute("aria-pressed", String(showSourceDiff));
  const original = example.files[source];
  if (showSourceDiff) {
    sourceView = new FileDiff({ ...fileOptions, diffStyle: "unified", hunkSeparators: "simple" });
    sourceView.render({ oldFile: { name: source, contents: original }, newFile: { name: source, contents: files[source] }, containerWrapper: $("source") });
    return;
  }
  // Long lines wrap in the editor: the pane is narrow, and a sideways scroll hides the line starts.
  sourceView = new File({ ...fileOptions, overflow: "wrap" });
  sourceView.render({ file: { name: source, contents: files[source] }, containerWrapper: $("source") });
  const editor = new Editor("file", { onChange: ({ file }) => {
    if (file.name !== source || files[source] === file.contents) return;
    files[source] = file.contents;
    status("compiling", "Compiling…");
    clearTimeout(pending);
    pending = setTimeout(build, 120);
  } });
  detach = editor.edit(sourceView);
}

function showOutput() {
  outputView?.cleanUp();
  $("output").replaceChildren();
  $("output-diff").setAttribute("aria-pressed", String(showOutputDiff));
  if (!(output in outputs)) return;
  if (showOutputDiff) {
    outputView = new FileDiff({ ...fileOptions, diffStyle: "unified", hunkSeparators: "simple" });
    outputView.render({ oldFile: { name: output, contents: baseline[output] ?? "" }, newFile: { name: output, contents: outputs[output] }, containerWrapper: $("output") });
  } else {
    outputView = new File(fileOptions);
    outputView.render({ file: { name: output, contents: outputs[output] }, containerWrapper: $("output") });
  }
}

function trees() {
  const edited = changed(files, example.files);
  sourceTree = tree($("source-tree"), example.shown, source, edited.map((path) => ({ path, status: "modified" })), (path) => { source = path; showSource(); remember(); });
  const paths = Object.keys(outputs);
  if (paths.length === 0) { $("output-tree").replaceChildren(); return; }
  if (!paths.includes(output)) output = paths[0];
  const statuses = paths.filter((path) => outputs[path] !== baseline[path]).map((path) => ({ path, status: path in baseline ? "modified" : "added" }));
  outputTree = tree($("output-tree"), paths, output, statuses, (path) => { output = path; showOutput(); });
}

function build() {
  const started = performance.now();
  let result;
  try { result = compile(files); } catch (error) { status("failed", `The compiler stopped: ${error}`); return; }
  const problems = $("problems");
  problems.replaceChildren();
  if (!result.out) {
    for (const d of result.check.diagnostics) {
      const item = document.createElement("li");
      const where = d.location ? `${d.location.file}:${d.location.line}:${d.location.column}` : "";
      const link = document.createElement("button");
      link.type = "button"; link.textContent = where || d.code;
      if (d.location && example.shown.includes(d.location.file)) link.onclick = () => { source = d.location.file; showSourceDiff = false; showSource(); trees(); remember(); };
      item.append(link, ` ${d.message}`);
      if (d.help) { const help = document.createElement("span"); help.textContent = ` ${d.help}`; item.append(help); }
      problems.append(item);
    }
    status("problems", `${result.check.diagnostics.length} problem${result.check.diagnostics.length === 1 ? "" : "s"}. The output below is from the last version that compiled.`);
    trees();
    return;
  }
  outputs = result.files;
  const ms = Math.round(performance.now() - started);
  const differ = changed(outputs, baseline).length;
  status("ok", `Compiled in ${ms} ms: ${Object.keys(outputs).length} files${differ ? `, ${differ} changed by your edit` : ""}.`);
  for (const note of [...result.out.warnings, ...result.out.hints]) { const item = document.createElement("li"); item.textContent = note; problems.append(item); }
  trees();
  showOutput();
}

function load(next, file) {
  name = next; example = data.examples[name];
  picker.value = name;
  files = { ...example.files };
  $("summary").textContent = example.summary;
  source = file && example.shown.includes(file) ? file : defaultFile();
  output = "first/app/schema.php";
  showSourceDiff = false; showOutputDiff = false;
  $("wordpress").hidden = true; $("frame").removeAttribute("src");
  remember();
  if (!compiler) return;
  baseline = compile(example.files).files;
  outputs = baseline;
  showSource();
  build();
}

picker.onchange = () => load(picker.value);
$("reset").onclick = () => load(name, source);
$("source-diff").onclick = () => { showSourceDiff = !showSourceDiff; showSource(); };
$("output-diff").onclick = () => { showOutputDiff = !showOutputDiff; showOutput(); };
$("run").onclick = () => {
  const { output: out } = compiler.compile(runRequest(name, files, example.run.ledger));
  const note = $("wordpress-note");
  $("wordpress").hidden = false;
  if (!out) { note.textContent = "It does not compile, so there is nothing to run. Fix the problems above first."; $("frame").hidden = true; $("tab").hidden = true; return; }
  const built = editedBlueprint({ output: out, example: example.run, site, platform: data.platform });
  if ("refused" in built) { note.textContent = built.refused; $("frame").hidden = true; $("tab").hidden = true; return; }
  const url = playgroundUrl(built.blueprint);
  note.textContent = `Your version of the app, compiled here and installed in a WordPress that runs in this tab. It downloads WordPress and PHP first, about 30 MB.${!built.seeded && example.run.seed ? " Your edit changed the schema, so the sample data is not loaded." : ""}`;
  $("frame").hidden = false; $("frame").src = url;
  $("tab").hidden = false; $("tab").href = url;
  $("wordpress").scrollIntoView({ behavior: "smooth", block: "start" });
};

const query = new URLSearchParams(location.search);
load(names.includes(query.get("example")) ? query.get("example") : "full-site", query.get("file"));
status("loading", "Loading the compiler (7 MB)…");
try {
  compiler = await Compiler.load(fetch(root.dataset.wasm));
  load(name, source);
  root.dataset.ready = "";
} catch (error) {
  status("failed", `Could not load the compiler: ${error}`);
}
