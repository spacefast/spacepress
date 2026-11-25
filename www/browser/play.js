// <sp-play>: full interactive SpacePress Playground component.
// Edits a real app, compiles it in-browser with compiler.wasm (src/wasm.rs), inspects every generated
// artifact and diff, shares edits via /__sp/api/v1/actions/share, and boots it in WordPress Playground.
import { File, FileDiff } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
import { FileTree } from "@pierre/trees";
import { editedBlueprint, migrationInputs, playgroundUrl, runRequest } from "../lib/blueprint.ts";
import { loadAll } from "./compiler-shared.js";

const theme = { light: "pierre-light", dark: "pierre-dark" };
const fileOptions = { theme, themeType: "dark", overflow: "scroll" };

const describe = (file, existed) => {
  if (file.endsWith("/schema.php")) return "Your collections, tables, fields, access rules, and routes as PHP arrays. WordPress registers post types, tables, and URLs from it.";
  if (file.endsWith("/functions.php")) return "Every hook, action, job, HTTP route, page, and component compiled to native PHP.";
  if (file.includes("/migrations/")) return existed ? "A file from the project's migration history." : "A migration file generated live for your schema change.";
  if (file.endsWith("db.d.ts")) return "Generated TypeScript definitions for spacepress:db and db.query so editors type-check your app.";
  if (file.endsWith("openapi.json")) return "OpenAPI 3.1 specification of the app's REST API.";
  if (file.includes("/client/")) return "Generated typed TypeScript client for browsers and external frontends.";
  return "Generated from your TypeScript source. Rebuilds automatically as you edit.";
};

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

class Play extends HTMLElement {
  static observedAttributes = ["data-open", "data-picker", "data-share", "open", "picker", "share", "example", "file", "shared", "hint"];

  hasFlag(name) {
    return this.hasAttribute(`data-${name}`) || this.hasAttribute(name);
  }

  connectedCallback() {
    this.scheduleInit();
  }

  attributeChangedCallback(_name, oldValue, newValue) {
    if (oldValue !== newValue && this.isConnected) {
      this.scheduleInit(true);
    }
  }

  disconnectedCallback() {
    this.teardown();
  }

  teardown() {
    this.startToken = (this.startToken ?? 0) + 1;
    clearTimeout(this.pending);
    this.detach?.();
    this.detach = undefined;
    this.editor = undefined;
    this.sourceView?.cleanUp();
    this.sourceView = undefined;
    this.outputView?.cleanUp();
    this.outputView = undefined;
    this.replaceChildren();
    this.started = false;
    this.classList.remove("sp-on", "is-fullscreen");
    document.body.classList.remove("sp-no-scroll");
    if (this.onEscKey) {
      window.removeEventListener("keydown", this.onEscKey);
      this.onEscKey = undefined;
    }
    delete this.dataset.ready;
  }

  signature() {
    return ["data-open", "data-picker", "data-share", "open", "picker", "share", "example", "file", "shared", "hint"]
      .map((a) => `${a}=${this.hasAttribute(a) ? this.getAttribute(a) : "∅"}`)
      .join("&");
  }

  scheduleInit(force = false) {
    if (this.initQueued && !force) return;
    this.initQueued = true;
    queueMicrotask(() => {
      this.initQueued = false;
      if (!this.isConnected) return;
      const sig = this.signature();
      if (this.started && this.lastSig === sig) return;
      this.teardown();
      this.started = true;
      this.lastSig = sig;
      if (this.hasFlag("open")) { this.start(); return; }
      const button = el("button", { type: "button", className: "sp-go", textContent: "Boot Live WordPress in Browser →" });
      button.onclick = () => { closed.remove(); this.start(); };
      const note = el("span", { className: "sp-hint", textContent: this.getAttribute("hint") ?? "Edit TypeScript, compile to PHP & SQL in your browser, and boot it inside WordPress Playground." });
      const closed = el("div", { className: "sp-closed" }, button, note);
      this.append(closed);
    });
  }

  async start() {
    const token = (this.startToken = (this.startToken ?? 0) + 1);
    this.classList.add("sp-on");
    this.status = el("p", { className: "sp-status", role: "status" });
    this.status.setAttribute("aria-live", "polite");
    this.say("loading", "Loading SpacePress WASM compiler (7 MB)…");
    this.append(this.status);
    try {
      const { compiler, data } = await loadAll();
      if (!this.isConnected || this.startToken !== token) return;
      this.compiler = compiler;
      this.data = data;
    } catch (error) {
      if (this.isConnected && this.startToken === token) {
        this.say("failed", `Could not load the compiler: ${error}`);
      }
      return;
    }
    this.build();
    const asked = this.hasFlag("picker") ? new URLSearchParams(location.search) : new URLSearchParams();
    const wanted = asked.get("example") ?? this.getAttribute("example");
    let shared = null;
    try { shared = JSON.parse(this.getAttribute("shared") ?? "null"); } catch { shared = null; }
    this.keepAddress = shared !== null;
    this.loadExample(wanted in this.data.examples ? wanted : Object.keys(this.data.examples)[0], asked.get("file") ?? this.getAttribute("file"));
    if (shared && typeof shared === "object") {
      for (const [file, text] of Object.entries(shared)) if (file in this.currentExample.files && typeof text === "string") this.files[file] = text;
      this.source = this.currentExample.shown.find((file) => this.files[file] !== this.currentExample.files[file]) ?? this.source;
      this.showSource();
      this.rebuild();
    }
    this.dataset.ready = "";
  }

  say(state, text) { this.status.dataset.state = state; this.status.textContent = text; }

  build() {
    const button = (text, onclick, className = "") => { const b = el("button", { type: "button", textContent: text, className }); b.onclick = onclick; return b; };
    this.pickerEl = el("select");
    this.pickerEl.setAttribute("aria-label", "Example");
    this.pickerEl.append(...Object.entries(this.data.examples).map(([name, e]) => new Option(e.title, name)));
    this.pickerEl.onchange = () => { this.keepAddress = false; this.loadExample(this.pickerEl.value); };
    this.summary = el("span", { className: "sp-summary" });
    const bar = el("div", { className: "sp-bar" });
    if (this.hasFlag("picker")) bar.append(this.pickerEl);
    this.resetBtn = button("Reset", () => { this.keepAddress = false; this.loadExample(this.name, this.source); });
    this.resetBtn.disabled = true;
    bar.append(this.summary, this.resetBtn);
    if (this.hasFlag("share")) bar.append(button("Share", () => this.shareEdit()));
    this.fullscreenBtn = button("Fullscreen", () => this.toggleFullscreen());
    this.fullscreenBtn.setAttribute("aria-pressed", "false");
    bar.append(this.fullscreenBtn);
    bar.append(button("Run in WordPress", () => this.runInWordPress(), "sp-go"));
    this.sharedNote = el("p", { className: "sp-shared", hidden: true });

    this.problems = el("ul", { className: "sp-problems" });
    this.problems.setAttribute("role", "alert");
    this.warningsEl = el("ul", { className: "sp-warnings", hidden: true });
    this.warningsEl.setAttribute("role", "status");
    this.wordpress = el("section", { className: "sp-wordpress", hidden: true });
    this.note = el("span");
    this.tab = el("a", { target: "_blank", rel: "noopener", textContent: "Open in a new tab" });
    this.frame = el("iframe", { title: "WordPress running your SpacePress app" });
    this.wordpress.append(el("p", {}, this.note, " ", this.tab, " ", button("Close", () => { this.wordpress.hidden = true; this.frame.removeAttribute("src"); })), this.frame);

    const pane = (title, hint, toggles) => {
      const tree = el("div", { className: "sp-tree" });
      const file = el("div", { className: "sp-file" });
      const head = el("h4", {}, title, el("small", { textContent: hint }), ...toggles);
      return { section: el("section", { className: "sp-pane" }, head, el("div", { className: "sp-split" }, tree, file)), tree, file };
    };
    this.sourceDiff = button("My changes", () => { this.showSourceDiff = !this.showSourceDiff; this.showSource(); });
    this.outputDiff = button("Diff previous build", () => { this.showOutputDiff = !this.showOutputDiff; this.showOutput(); });
    this.copyOutBtn = button("Copy", () => this.copyOutput());
    const left = pane("You write", "click in the file and edit", [this.sourceDiff]);
    const right = pane("SpacePress compiles", "rebuilt live via WASM", [this.outputDiff, this.copyOutBtn, button("Download", () => this.download())]);
    right.section.classList.add("sp-out");
    this.about = el("p", { className: "sp-about" });
    right.section.querySelector(".sp-split").before(this.about);
    this.sourceTree = left.tree; this.sourceBox = left.file; this.outputTree = right.tree; this.outputBox = right.file;
    this.status.remove();
    const divider = el("div", {
      className: "sp-split-handle",
      role: "separator",
      tabIndex: 0,
      title: "Drag to resize panes (double-click to reset)",
    });
    divider.setAttribute("aria-orientation", "vertical");
    const panes = el("div", { className: "sp-panes" }, left.section, divider, right.section);
    this.wireSplitDivider(panes, divider);
    this.append(bar, this.status, this.sharedNote, this.problems, this.warningsEl, this.wordpress, panes);
  }

  toggleFullscreen(force) {
    const next = typeof force === "boolean" ? force : !this.classList.contains("is-fullscreen");
    this.classList.toggle("is-fullscreen", next);
    document.body.classList.toggle("sp-no-scroll", next);
    if (this.fullscreenBtn) {
      this.fullscreenBtn.textContent = next ? "Exit fullscreen" : "Fullscreen";
      this.fullscreenBtn.setAttribute("aria-pressed", String(next));
    }
    if (next && !this.onEscKey) {
      this.onEscKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented) this.toggleFullscreen(false); };
      window.addEventListener("keydown", this.onEscKey);
    } else if (!next && this.onEscKey) {
      window.removeEventListener("keydown", this.onEscKey);
      this.onEscKey = undefined;
    }
  }

  wireSplitDivider(grid, handle) {
    handle.ondblclick = () => grid.style.removeProperty("--split-left");
    handle.onkeydown = (e) => {
      if (window.innerWidth <= 980) return;
      const cur = parseFloat(grid.style.getPropertyValue("--split-left")) || 50;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        grid.style.setProperty("--split-left", `${Math.max(25, cur - 5)}%`);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        grid.style.setProperty("--split-left", `${Math.min(75, cur + 5)}%`);
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        grid.style.removeProperty("--split-left");
      }
    };
    handle.onpointerdown = (e) => {
      if (e.button !== 0 || window.innerWidth <= 980) return;
      e.preventDefault();
      handle.setPointerCapture?.(e.pointerId);
      handle.classList.add("is-dragging");
      const rect = grid.getBoundingClientRect();
      const onMove = (ev) => {
        const pct = Math.max(25, Math.min(75, ((ev.clientX - rect.left) / rect.width) * 100));
        grid.style.setProperty("--split-left", `${pct.toFixed(2)}%`);
      };
      const onUp = () => {
        handle.classList.remove("is-dragging");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };
  }

  compile(sources) {
    const { check, output: out } = this.compiler.compile(runRequest(this.name, sources, this.currentExample.run.ledger));
    if (!check.ok || !out) return { check, out: null, files: {} };
    const committed = migrationInputs(Object.entries(this.currentExample.run.ledger.files));
    const openapi = Object.entries(out.appPlugin).find(([file]) => file.endsWith("/sp/app/openapi.json"))?.[1];
    return { check, out, files: {
      "sp/app/schema.php": out.schemaPhp,
      "sp/app/functions.php": out.functionsPhp,
      ...committed,
      ...migrationInputs(out.migrations),
      "sp/_generated/db.d.ts": out.genTs,
      ...Object.fromEntries(Object.entries(out.client).map(([file, text]) => [`sp/_generated/client/${file}`, text])),
      ...(openapi ? { "sp/app/openapi.json": openapi } : {}),
    } };
  }

  defaultFile() { return ["sp/schema.ts", "spacepress.config.ts"].find((file) => this.currentExample.shown.includes(file)) ?? this.currentExample.shown[0]; }

  remember() {
    if (!this.hasFlag("picker") || this.keepAddress) return;
    history.replaceState(null, "", `?example=${this.name}${this.source === this.defaultFile() ? "" : `&file=${encodeURIComponent(this.source)}`}`);
  }

  loadExample(name, file) {
    this.name = name; this.currentExample = this.data.examples[name];
    this.pickerEl.value = name;
    this.files = { ...this.currentExample.files };
    this.summary.textContent = this.currentExample.summary;
    this.source = file && this.currentExample.shown.includes(file) ? file : this.defaultFile();
    this.output = "sp/app/schema.php";
    this.showSourceDiff = false; this.showOutputDiff = false; this.picked = false;
    this.wordpress.hidden = true; this.frame.removeAttribute("src");
    this.outputs = this.compile(this.currentExample.files).files;
    this.previous = this.outputs;
    this.original = this.outputs;
    this.remember();
    this.showSource();
    this.rebuild(true);
  }

  tree(host, paths, selected, statuses, onSelect) {
    host.replaceChildren();
    const model = new FileTree({
      paths, initialExpansion: "open", flattenEmptyDirectories: true, density: "compact",
      icons: { set: "complete", colored: true }, initialSelectedPaths: [selected], gitStatus: statuses,
      onSelectionChange: (picked) => { if (picked.length === 1 && paths.includes(picked[0])) onSelect(picked[0]); },
    });
    model.render({ containerWrapper: host });
  }

  renderInlineAnnotation(annotation) {
    const item = annotation.metadata;
    if (!item) return undefined;
    const isWarn = item.severity === "warning";
    const row = el("div", { className: `sp-inline-diag ${isWarn ? "is-warning" : "is-error"}` });
    row.append(
      el("span", { className: "sp-inline-diag-tag", textContent: isWarn ? item.rule : (item.code ?? "error") }),
      el("span", { className: "sp-inline-diag-msg", textContent: item.message }),
    );
    if (item.help) {
      row.append(el("span", { className: "sp-inline-diag-help", textContent: `— ${item.help}` }));
    }
    if (isWarn && item.warning) {
      const fixBtn = el("button", { type: "button", className: "sp-sb-autofix", textContent: "Auto-fix" });
      fixBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.applyLintFixes([item.warning]);
      };
      row.append(fixBtn);
    }
    return row;
  }

  applyInlineDiagnostics(diagnostics, lintWarnings) {
    const active = this.source;
    const contents = this.files?.[active] ?? "";
    const lineCount = contents.split("\n").length;
    const clampLine = (n) => Math.max(1, Math.min(lineCount, n));

    const markers = [];
    const annotations = [];
    const externalDiags = [];
    const externalWarnings = [];

    for (const d of diagnostics) {
      if (!this.showSourceDiff && d.location && d.location.file === active) {
        const startLine = clampLine(d.location.line);
        const endLine = clampLine(d.location.endLine ?? d.location.line);
        const startChar = Math.max(0, (d.location.column ?? 1) - 1);
        const endChar = Math.max(startChar + 1, (d.location.endColumn ?? (d.location.column ?? 1) + 1) - 1);
        markers.push({
          severity: "error",
          start: { line: startLine - 1, character: startChar },
          end: { line: endLine - 1, character: endChar },
          source: d.code,
          message: d.help ? `${d.message}\n${d.help}` : d.message,
        });
        annotations.push({
          lineNumber: startLine,
          metadata: { severity: "error", code: d.code, message: d.message, help: d.help },
        });
      } else {
        externalDiags.push(d);
      }
    }

    for (const w of lintWarnings) {
      if (!this.showSourceDiff && w.file === active) {
        const line = clampLine(w.line);
        const startChar = Math.max(0, (w.column ?? 1) - 1);
        const endChar = startChar + (w.found?.length ?? 1);
        markers.push({
          severity: "warning",
          start: { line: line - 1, character: startChar },
          end: { line: line - 1, character: endChar },
          source: w.rule,
          message: w.message,
        });
        annotations.push({
          lineNumber: line,
          metadata: { severity: "warning", rule: w.rule, message: w.message, warning: w },
        });
      } else {
        externalWarnings.push(w);
      }
    }

    if (this.editor && !this.showSourceDiff) {
      try { this.editor.setMarkers(markers); } catch {}
    }
    if (this.sourceView && !this.showSourceDiff) {
      const had = (this.activeAnnotationCount ?? 0) > 0;
      const has = annotations.length > 0;
      this.activeAnnotationCount = annotations.length;
      if (has || had) {
        this.sourceView.setLineAnnotations(annotations);
        this.sourceView.rerender();
      }
    }
    return { externalDiags, externalWarnings };
  }

  showSource() {
    this.detach?.(); this.detach = undefined;
    this.editor = undefined;
    this.sourceView?.cleanUp();
    this.sourceBox.replaceChildren();
    this.activeAnnotationCount = 0;
    this.sourceDiff.setAttribute("aria-pressed", String(this.showSourceDiff));
    const name = this.source;
    if (this.showSourceDiff) {
      this.sourceView = new FileDiff({ ...fileOptions, diffStyle: "unified", hunkSeparators: "simple" });
      this.sourceView.render({ oldFile: { name, contents: this.currentExample.files[name] }, newFile: { name, contents: this.files[name] }, containerWrapper: this.sourceBox });
      return;
    }
    this.sourceView = new File({
      ...fileOptions,
      overflow: "wrap",
      renderAnnotation: (annotation) => this.renderInlineAnnotation(annotation),
    });
    this.sourceView.render({ file: { name, contents: this.files[name] }, containerWrapper: this.sourceBox });
    this.editor = new Editor("file", { onChange: ({ file }) => {
      if (file.name !== this.source || this.files[this.source] === file.contents) return;
      this.files[this.source] = file.contents;
      this.say("building", "Compiling…");
      clearTimeout(this.pending);
      this.pending = setTimeout(() => this.rebuild(), 150);
    } });
    this.detach = this.editor.edit(this.sourceView);
    if (this.lastDiagnostics || this.lastLintWarnings) {
      this.applyInlineDiagnostics(this.lastDiagnostics ?? [], this.lastLintWarnings ?? []);
    }
  }

  showOutput() {
    this.outputView?.cleanUp();
    this.outputBox.replaceChildren();
    this.outputDiff.setAttribute("aria-pressed", String(this.showOutputDiff));
    const name = this.output;
    this.about.textContent = name in this.outputs ? describe(name, name in this.original) : "";
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
    const edited = Object.keys(this.files).filter((file) => this.files[file] !== this.currentExample.files[file]);
    if (this.resetBtn) this.resetBtn.disabled = edited.length === 0;
    this.tree(this.sourceTree, this.currentExample.shown, this.source, edited.map((path) => ({ path, status: "modified" })), (path) => { this.source = path; this.showSource(); this.remember(); });
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
    this.warningsEl.replaceChildren();
    this.warningsEl.hidden = true;
    if (!result.out) {
      this.lastDiagnostics = result.check.diagnostics;
      this.lastLintWarnings = [];
      const { externalDiags } = this.applyInlineDiagnostics(result.check.diagnostics, []);
      for (const d of externalDiags) {
        const where = d.location ? `${d.location.file}:${d.location.line}:${d.location.column}` : d.code;
        const link = el("button", { type: "button", textContent: where });
        if (d.location && this.currentExample.shown.includes(d.location.file)) link.onclick = () => { this.source = d.location.file; this.showSourceDiff = false; this.showSource(); this.trees(); this.remember(); };
        const item = el("li", {}, link, ` ${d.message}`);
        if (d.help) item.append(el("span", { textContent: ` ${d.help}` }));
        this.problems.append(item);
      }
      const n = result.check.diagnostics.length;
      this.say("problems", `${n} problem${n === 1 ? "" : "s"}. Showing output from the last passing build.`);
      this.trees();
      return;
    }
    const same = Object.keys(result.files).length === Object.keys(this.outputs).length && Object.keys(result.files).every((file) => result.files[file] === this.outputs[file]);
    if (!same) { this.previous = this.outputs; this.outputs = result.files; }
    const differ = Object.keys(this.outputs).filter((file) => this.outputs[file] !== this.previous[file]);
    const ms = Math.round(performance.now() - started);
    const lintWarnings = result.out.lintWarnings ?? [];
    this.lastDiagnostics = [];
    this.lastLintWarnings = lintWarnings;
    const { externalWarnings } = this.applyInlineDiagnostics([], lintWarnings);
    if (externalWarnings.length > 0) {
      this.warningsEl.hidden = false;
      for (const w of externalWarnings) {
        const locBtn = el("button", { type: "button", className: "sp-warn-loc", textContent: `${w.file}:${w.line}:${w.column}` });
        if (this.currentExample.shown.includes(w.file)) {
          locBtn.onclick = () => { this.source = w.file; this.showSourceDiff = false; this.showSource(); this.trees(); this.remember(); };
        }
        const fixBtn = el("button", { type: "button", className: "sp-sb-autofix", textContent: "Auto-fix" });
        fixBtn.onclick = () => this.applyLintFixes([w]);
        this.warningsEl.append(
          el(
            "li",
            {},
            el("span", { className: "sp-sb-warn-rule", textContent: `warning[${w.rule}]` }),
            locBtn,
            el("span", { className: "sp-sb-warn-msg", textContent: w.message }),
            fixBtn,
          ),
        );
      }
    }
    const warnSuffix = lintWarnings.length > 0 ? ` · ${lintWarnings.length} warning${lintWarnings.length === 1 ? "" : "s"}` : "";
    this.say(lintWarnings.length > 0 ? "warn" : "ok", `Built in ${ms} ms: ${Object.keys(this.outputs).length} files${differ.length ? `, ${differ.length} changed` : ""}${warnSuffix}.`);
    for (const text of [...result.out.warnings, ...result.out.hints]) this.problems.append(el("li", { textContent: text }));
    if (!first && !same && differ.length) {
      const added = differ.find((file) => !(file in this.previous));
      const migration = differ.find((file) => file.endsWith("/migration.sql"));
      if (added) this.output = migration ?? added;
      else if (!differ.includes(this.output) || (migration && !this.picked)) this.output = migration ?? differ[0];
      this.showOutputDiff = true;
    }
    this.trees();
    this.showOutput();
  }

  applyLintFixes(warnings) {
    const byFile = new Map();
    for (const w of warnings) {
      if (!(w.file in this.files)) continue;
      if (!byFile.has(w.file)) byFile.set(w.file, []);
      byFile.get(w.file).push(w);
    }
    let changed = false;
    for (const [file, list] of byFile.entries()) {
      list.sort((a, b) => b.utf16Start - a.utf16Start);
      let next = this.files[file];
      let lastStart = Infinity;
      for (const w of list) {
        if (w.utf16End > lastStart) continue;
        if (next.slice(w.utf16Start, w.utf16End) !== w.found) continue;
        next = next.slice(0, w.utf16Start) + w.replacement + next.slice(w.utf16End);
        lastStart = w.utf16Start;
      }
      if (next !== this.files[file]) {
        this.files[file] = next;
        changed = true;
      }
    }
    if (changed) {
      this.showSource();
      this.rebuild();
    }
  }

  copyOutput() {
    const content = this.outputs[this.output];
    if (!content || !this.copyOutBtn) return;
    navigator.clipboard?.writeText(content).then(() => {
      this.copyOutBtn.dataset.origLabel ??= this.copyOutBtn.textContent;
      clearTimeout(this.copyOutBtn._copyTimer);
      this.copyOutBtn.textContent = "Copied";
      this.copyOutBtn.classList.add("is-copied");
      this.copyOutBtn._copyTimer = setTimeout(() => {
        this.copyOutBtn.textContent = this.copyOutBtn.dataset.origLabel;
        this.copyOutBtn.classList.remove("is-copied");
      }, 1400);
    }, () => {});
  }

  download() {
    if (!(this.output in this.outputs)) return;
    const link = el("a", { href: URL.createObjectURL(new Blob([this.outputs[this.output]], { type: "text/plain" })), download: this.output.split("/").pop() });
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async shareEdit() {
    const changed = Object.fromEntries(Object.entries(this.files).filter(([file, text]) => text !== this.currentExample.files[file]));
    this.sharedNote.hidden = false;
    if (Object.keys(changed).length === 0) { this.sharedNote.textContent = "Nothing to share yet — edit any file first."; return; }
    this.sharedNote.textContent = "Saving share link…";
    try {
      const response = await fetch("/wp-json/spacepress/v1/actions/share", { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify({ example: this.name, files: changed }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? body?.message ?? `HTTP ${response.status}`);
      const url = new URL(`/play?s=${body.data.key}`, location.href).href;
      this.keepAddress = true;
      history.replaceState(null, "", url);
      const link = el("a", { href: url, textContent: url });
      this.sharedNote.replaceChildren("Saved! Share this link to open your version: ", link);
      navigator.clipboard?.writeText(url).then(() => this.sharedNote.append(" (copied)"), () => {});
    } catch (error) { this.sharedNote.textContent = `Could not save share link: ${error.message}`; }
  }

  runInWordPress() {
    const { output: out } = this.compiler.compile(runRequest(this.name, this.files, this.currentExample.run.ledger));
    this.wordpress.hidden = false;
    const refuse = (text) => { this.note.textContent = text; this.frame.hidden = true; this.tab.hidden = true; };
    if (!out) { refuse("Fix the compiler diagnostics first to run this app in WordPress."); return; }
    const site = (this.getAttribute("plugins") ?? this.data.plugins).replace(/\/$/, "");
    const built = editedBlueprint({ output: out, example: this.currentExample.run, site, platform: this.data.platform });
    if ("refused" in built) { refuse(built.refused); return; }
    const url = playgroundUrl(built.blueprint);
    this.note.textContent = `Running your compiled SpacePress plugin inside WordPress Playground in this tab (~30 MB initial download).${!built.seeded && this.currentExample.run.seed ? " Your edit changed the schema, so sample seed data was skipped." : ""}`;
    this.frame.hidden = false; this.frame.src = url;
    this.tab.hidden = false; this.tab.href = url;
    this.wordpress.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

if (!customElements.get("sp-play")) customElements.define("sp-play", Play);
