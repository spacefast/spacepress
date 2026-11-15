// <tp-play>: the one playground component. Edit an app, build it in the browser with the real
// compiler (compiler.wasm, built from src/wasm.rs), read every file the build wrote, see the
// diff from the previous build, and run the edited app in WordPress Playground.
//
//   <tp-play example="tasks"></tp-play>                 an app, closed until someone presses Edit and build
//   <tp-play example="tasks" open></tp-play>            started at once (the hero)
//   <tp-play example="full-site" picker file="…">       with an example menu (the playground page)
//
// Files, trees and diffs are @pierre/diffs and @pierre/trees. The compiler wrapper and the
// blueprint are docs-site/lib, the same modules the docs site's playground uses.
import { File, FileDiff } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
import { FileTree } from "@pierre/trees";
import { Compiler } from "../../docs-site/lib/compiler.ts";
import { editedBlueprint, playgroundUrl, runRequest } from "../../docs-site/lib/blueprint.ts";

const theme = { light: "pierre-light", dark: "pierre-dark" };
const fileOptions = { theme, themeType: "system", overflow: "scroll" };
const base = new URL(".", import.meta.url);

// The compiler (7 MB) and the examples are fetched once, on the first component that needs them.
let shared;
const load = () => (shared ??= Promise.all([
  Compiler.load(fetch(new URL("compiler.wasm", base))),
  fetch(new URL("play-data.json", base)).then((r) => r.json()),
]).then(([compiler, data]) => ({ compiler, data })));

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

class Play extends HTMLElement {
  connectedCallback() {
    if (this.started) return;
    this.started = true;
    if (this.hasAttribute("open")) { this.start(); return; }
    const button = el("button", { type: "button", className: "tp-go", textContent: "Edit and build this" });
    button.onclick = () => { button.remove(); note.remove(); this.start(); };
    const note = el("span", { className: "tp-hint", textContent: this.getAttribute("hint") ?? "Change the code, build it in your browser, and run it in WordPress." });
    this.append(el("div", { className: "tp-closed" }, button, note));
  }

  async start() {
    this.classList.add("tp-on");
    this.status = el("p", { className: "tp-status", role: "status" });
    this.status.setAttribute("aria-live", "polite");
    this.say("loading", "Loading the compiler (7 MB)…");
    this.append(this.status);
    try {
      const { compiler, data } = await load();
      this.compiler = compiler; this.data = data;
    } catch (error) { this.say("failed", `Could not load the compiler: ${error}`); return; }
    this.build();
    // On the playground page the address picks the example and the file (see remember()).
    const asked = this.hasAttribute("picker") ? new URLSearchParams(location.search) : new URLSearchParams();
    const wanted = asked.get("example") ?? this.getAttribute("example");
    this.open(wanted in this.data.examples ? wanted : Object.keys(this.data.examples)[0], asked.get("file") ?? this.getAttribute("file"));
    this.dataset.ready = "";
  }

  say(state, text) { this.status.dataset.state = state; this.status.textContent = text; }

  // The component's own markup, built once.
  build() {
    const button = (text, onclick, className = "") => { const b = el("button", { type: "button", textContent: text, className }); b.onclick = onclick; return b; };
    this.picker = el("select");
    this.picker.setAttribute("aria-label", "Example");
    this.picker.append(...Object.entries(this.data.examples).map(([name, e]) => new Option(e.title, name)));
    this.picker.onchange = () => this.open(this.picker.value);
    this.summary = el("span", { className: "tp-summary" });
    const bar = el("div", { className: "tp-bar" });
    if (this.hasAttribute("picker")) bar.append(this.picker);
    bar.append(this.summary, button("Reset", () => this.open(this.name, this.source)), button("Run in WordPress", () => this.run(), "tp-go"));

    this.problems = el("ul", { className: "tp-problems" });
    this.wordpress = el("section", { className: "tp-wordpress", hidden: true });
    this.note = el("span");
    this.tab = el("a", { target: "_blank", rel: "noopener", textContent: "Open in a new tab" });
    this.frame = el("iframe", { title: "WordPress running your version of the app" });
    this.wordpress.append(el("p", {}, this.note, " ", this.tab, " ", button("Close", () => { this.wordpress.hidden = true; this.frame.removeAttribute("src"); })), this.frame);

    const pane = (title, hint, toggles) => {
      const tree = el("div", { className: "tp-tree" });
      const file = el("div", { className: "tp-file" });
      const head = el("h4", {}, title, el("small", { textContent: hint }), ...toggles);
      return { section: el("section", { className: "tp-pane" }, head, el("div", { className: "tp-split" }, tree, file)), tree, file };
    };
    this.sourceDiff = button("My changes", () => { this.showSourceDiff = !this.showSourceDiff; this.showSource(); });
    this.outputDiff = button("Diff from the previous build", () => { this.showOutputDiff = !this.showOutputDiff; this.showOutput(); });
    const left = pane("You write", "click in the file and type", [this.sourceDiff]);
    const right = pane("The build writes", "rebuilt as you type", [this.outputDiff]);
    right.section.classList.add("tp-out");
    this.sourceTree = left.tree; this.sourceBox = left.file; this.outputTree = right.tree; this.outputBox = right.file;
    this.status.remove();
    this.append(bar, this.status, this.problems, this.wordpress, el("div", { className: "tp-panes" }, left.section, right.section));
  }

  // Every file a successful build writes, by the path `first build` writes it to.
  compile(sources) {
    const { check, output: out } = this.compiler.compile(runRequest(this.name, sources, this.example.run.ledger));
    if (!check.ok || !out) return { check, out: null, files: {} };
    const committed = Object.fromEntries(Object.entries(this.example.run.ledger.files).map(([file, sql]) => [`first/_generated/migrations/${file}`, sql]));
    const openapi = Object.entries(out.appPlugin).find(([file]) => file.endsWith("/first/app/openapi.json"))?.[1];
    return { check, out, files: {
      "first/app/schema.php": out.schemaPhp,
      "first/app/functions.php": out.functionsPhp,
      ...committed,
      ...Object.fromEntries(out.migrations.map(([file, sql]) => [`first/_generated/migrations/${file}`, sql])),
      "first/_generated/db.d.ts": out.genTs,
      ...Object.fromEntries(Object.entries(out.client).map(([file, text]) => [`first/_generated/client/${file}`, text])),
      ...(openapi ? { "first/app/openapi.json": openapi } : {}),
    } };
  }

  defaultFile() { return this.example.shown.includes("first.config.ts") ? "first.config.ts" : this.example.shown[0]; }

  // On the playground page the address names the example and the open file, so either can be linked.
  remember() {
    if (!this.hasAttribute("picker")) return;
    history.replaceState(null, "", `?example=${this.name}${this.source === this.defaultFile() ? "" : `&file=${encodeURIComponent(this.source)}`}`);
  }

  open(name, file) {
    this.name = name; this.example = this.data.examples[name];
    this.picker.value = name;
    this.files = { ...this.example.files };
    this.summary.textContent = this.example.summary;
    this.source = file && this.example.shown.includes(file) ? file : this.defaultFile();
    this.output = "first/app/schema.php";
    this.showSourceDiff = false; this.showOutputDiff = false; this.picked = false;
    this.wordpress.hidden = true; this.frame.removeAttribute("src");
    // Two builds are kept: the last one, and the one before it. The diff compares them.
    this.outputs = this.compile(this.example.files).files;
    this.previous = this.outputs;
    this.original = this.outputs;
    this.remember();
    this.showSource();
    this.rebuild(true);
  }

  tree(host, paths, selected, statuses, onSelect) {
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
  }

  showSource() {
    this.detach?.(); this.detach = undefined;
    this.sourceView?.cleanUp();
    this.sourceBox.replaceChildren();
    this.sourceDiff.setAttribute("aria-pressed", String(this.showSourceDiff));
    const name = this.source;
    if (this.showSourceDiff) {
      this.sourceView = new FileDiff({ ...fileOptions, diffStyle: "unified", hunkSeparators: "simple" });
      this.sourceView.render({ oldFile: { name, contents: this.example.files[name] }, newFile: { name, contents: this.files[name] }, containerWrapper: this.sourceBox });
      return;
    }
    // Long lines wrap in the editor: the pane is narrow, and a sideways scroll hides the line starts.
    this.sourceView = new File({ ...fileOptions, overflow: "wrap" });
    this.sourceView.render({ file: { name, contents: this.files[name] }, containerWrapper: this.sourceBox });
    const editor = new Editor("file", { onChange: ({ file }) => {
      if (file.name !== this.source || this.files[this.source] === file.contents) return;
      this.files[this.source] = file.contents;
      this.say("building", "Building…");
      clearTimeout(this.pending);
      this.pending = setTimeout(() => this.rebuild(), 150);
    } });
    this.detach = editor.edit(this.sourceView);
  }

  showOutput() {
    this.outputView?.cleanUp();
    this.outputBox.replaceChildren();
    this.outputDiff.setAttribute("aria-pressed", String(this.showOutputDiff));
    const name = this.output;
    if (!(name in this.outputs)) return;
    if (this.showOutputDiff) {
      this.outputView = new FileDiff({ ...fileOptions, diffStyle: "unified", hunkSeparators: "simple" });
      this.outputView.render({ oldFile: { name, contents: this.previous[name] ?? "" }, newFile: { name, contents: this.outputs[name] }, containerWrapper: this.outputBox });
    } else {
      this.outputView = new File(fileOptions);
      this.outputView.render({ file: { name, contents: this.outputs[name] }, containerWrapper: this.outputBox });
    }
  }

  trees() {
    const edited = Object.keys(this.files).filter((file) => this.files[file] !== this.example.files[file]);
    this.tree(this.sourceTree, this.example.shown, this.source, edited.map((path) => ({ path, status: "modified" })), (path) => { this.source = path; this.showSource(); this.remember(); });
    const paths = Object.keys(this.outputs);
    if (!paths.includes(this.output)) this.output = paths[0];
    const statuses = paths.filter((path) => this.outputs[path] !== this.previous[path]).map((path) => ({ path, status: path in this.previous ? "modified" : "added" }));
    this.tree(this.outputTree, paths, this.output, statuses, (path) => { this.output = path; this.picked = true; this.showOutput(); });
  }

  rebuild(first = false) {
    const started = performance.now();
    let result;
    try { result = this.compile(this.files); } catch (error) { this.say("failed", `The compiler stopped: ${error}`); return; }
    this.problems.replaceChildren();
    if (!result.out) {
      for (const d of result.check.diagnostics) {
        const where = d.location ? `${d.location.file}:${d.location.line}:${d.location.column}` : d.code;
        const link = el("button", { type: "button", textContent: where });
        if (d.location && this.example.shown.includes(d.location.file)) link.onclick = () => { this.source = d.location.file; this.showSourceDiff = false; this.showSource(); this.trees(); this.remember(); };
        const item = el("li", {}, link, ` ${d.message}`);
        if (d.help) item.append(el("span", { textContent: ` ${d.help}` }));
        this.problems.append(item);
      }
      const n = result.check.diagnostics.length;
      this.say("problems", `${n} problem${n === 1 ? "" : "s"}. The files below are from the last build that worked.`);
      this.trees();
      return;
    }
    // A build that changed nothing keeps the previous one, so the diff still shows the last change.
    const same = Object.keys(result.files).length === Object.keys(this.outputs).length && Object.keys(result.files).every((file) => result.files[file] === this.outputs[file]);
    if (!same) { this.previous = this.outputs; this.outputs = result.files; }
    const differ = Object.keys(this.outputs).filter((file) => this.outputs[file] !== this.previous[file]);
    const ms = Math.round(performance.now() - started);
    this.say("ok", `Built in ${ms} ms: ${Object.keys(this.outputs).length} files${differ.length ? `, ${differ.length} differ from the previous build` : ""}.`);
    for (const text of [...result.out.warnings, ...result.out.hints]) this.problems.append(el("li", { textContent: text }));
    // After an edit, show what it changed without the reader looking for it: a file the build
    // added (a new migration), else a changed migration, else stay if this file changed, else the
    // first changed file. The reader's own pick is kept for later builds that change that file.
    if (!first && !same && differ.length) {
      const added = differ.find((file) => !(file in this.previous));
      const migration = differ.find((file) => file.includes("/migrations/"));
      if (added) this.output = added;
      else if (!differ.includes(this.output) || (migration && !this.picked)) this.output = migration ?? differ[0];
      this.showOutputDiff = true;
    }
    this.trees();
    this.showOutput();
  }

  run() {
    const { output: out } = this.compiler.compile(runRequest(this.name, this.files, this.example.run.ledger));
    this.wordpress.hidden = false;
    const refuse = (text) => { this.note.textContent = text; this.frame.hidden = true; this.tab.hidden = true; };
    if (!out) { refuse("It does not build, so there is nothing to run. Fix the problems first."); return; }
    // WordPress Playground runs on another origin and fetches First's shared plugin zips from
    // `site`, which must answer with Access-Control-Allow-Origin. `first dev` does not send that
    // header on public/ files, so the zips come from the published site unless told otherwise.
    const site = (this.getAttribute("plugins") ?? this.data.plugins).replace(/\/$/, "");
    const built = editedBlueprint({ output: out, example: this.example.run, site, platform: this.data.platform });
    if ("refused" in built) { refuse(built.refused); return; }
    const url = playgroundUrl(built.blueprint);
    this.note.textContent = `Your version of the app, built here and installed in a WordPress that runs in this tab. It downloads WordPress and PHP first, about 30 MB.${!built.seeded && this.example.run.seed ? " Your edit changed the schema, so the sample data is not loaded." : ""}`;
    this.frame.hidden = false; this.frame.src = url;
    this.tab.hidden = false; this.tab.href = url;
    this.wordpress.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

if (!customElements.get("tp-play")) customElements.define("tp-play", Play);
