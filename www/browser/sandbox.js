// <tp-sandbox>: compact, editable inline live compiler widget powered by compiler.wasm.
// Supports multiple <tp-preset> tabs, optional <tp-base> for real incremental SQL migration diffs,
// instant TS -> PHP / SQL / db.d.ts / OpenAPI / Client output tabs, unified diff toggle, and live diagnostics.
import { File, FileDiff } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
import { loadCompiler } from "./compiler-shared.js";

const theme = { light: "pierre-light", dark: "pierre-dark" };
const fileOptions = { theme, themeType: "dark", overflow: "scroll" };

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const TAB_LABELS = {
  "tp/app/schema.php": "schema.php",
  "tp/app/functions.php": "functions.php",
  "tp/_generated/db.d.ts": "db.d.ts",
  "tp/app/openapi.json": "openapi.json",
  "tp/_generated/client/types.ts": "client/types.ts",
};

function labelForOutput(path) {
  if (TAB_LABELS[path]) return TAB_LABELS[path];
  if (path.includes("/migrations/")) return path.split("/").pop();
  return path.split("/").pop();
}

function normalizeText(text) {
  return text.replace(/^\n+/, "").replace(/\n+$/, "");
}

class Sandbox extends HTMLElement {
  static observedAttributes = ["data-key"];

  connectedCallback() {
    this.scheduleMount();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "data-key" && oldValue !== null && oldValue !== newValue && this.isConnected) {
      this.scheduleMount(true);
    }
  }

  disconnectedCallback() {
    this.teardown();
  }

  scheduleMount(force = false) {
    if (this.mountQueued && !force) return;
    this.mountQueued = true;
    queueMicrotask(() => {
      this.mountQueued = false;
      if (!this.isConnected) return;
      const key = this.getAttribute("data-key") ?? "";
      if (!force && this.initialized && this.mountedKey === key && this.uiRoot?.isConnected) return;
      this.mount();
    });
  }

  teardown() {
    this.bootToken = (this.bootToken ?? 0) + 1;
    clearTimeout(this.timer);
    this.io?.disconnect();
    this.io = undefined;
    this.detachEditor?.();
    this.detachEditor = undefined;
    this.editor = undefined;
    this.sourceView?.cleanUp();
    this.sourceView = undefined;
    this.outView?.cleanUp();
    this.outView = undefined;
    this.uiRoot?.remove();
    this.uiRoot = undefined;
    this.booting = false;
    this.initialized = false;
    delete this.dataset.ready;
    this.classList.remove("sp-sb-ready");
  }

  mount() {
    this.teardown();
    this.initialized = true;
    this.mountedKey = this.getAttribute("data-key") ?? "";

    const defs = this.querySelector(":scope > .sp-sb-defs") ?? this;
    const baseNode = defs.querySelector(":scope > tp-base");
    this.baseSource = baseNode ? normalizeText(baseNode.textContent) : null;
    this.baseFile = baseNode?.getAttribute("file") ?? "typedpress.config.ts";

    const presetNodes = [...defs.querySelectorAll(":scope > tp-preset")];
    if (presetNodes.length === 0) {
      const text = normalizeText(defs.textContent);
      this.presets = [{
        label: this.getAttribute("label") ?? "typedpress.config.ts",
        file: this.getAttribute("file") ?? "typedpress.config.ts",
        description: this.getAttribute("description") ?? "",
        defaultOutput: this.getAttribute("output") ?? "",
        code: text,
      }];
    } else {
      this.presets = presetNodes.map((n, i) => ({
        label: n.getAttribute("label") ?? `Example ${i + 1}`,
        file: n.getAttribute("file") ?? "typedpress.config.ts",
        description: n.getAttribute("description") ?? "",
        defaultOutput: n.getAttribute("output") ?? "",
        code: normalizeText(n.textContent),
      }));
    }

    this.activePreset = 0;
    this.currentCode = this.presets[0].code;
    this.showDiff = this.hasAttribute("diff");
    this.selectedOutput = "";
    this.outputs = {};
    this.baselineOutputs = {};
    this.previousOutputs = {};
    this.baseSnapshot = null;
    this.baseMigrationFiles = [];
    this.compiler = null;

    // Remove any stale rendered UI while leaving .sp-sb-defs intact for Preact router morphing.
    for (const child of [...this.children]) {
      if (!child.classList.contains("sp-sb-defs")) child.remove();
    }
    this.uiRoot = el("div", { className: "sp-sb-root" });
    this.append(this.uiRoot);
    this.buildChrome();
    this.renderSourceEditor();

    if (this.hasAttribute("eager") || this.hasAttribute("open")) {
      this.bootCompiler();
    } else if ("IntersectionObserver" in window) {
      this.io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this.io?.disconnect();
          this.io = undefined;
          this.bootCompiler();
        }
      }, { rootMargin: "320px 0px" });
      this.io.observe(this);
    } else {
      this.bootCompiler();
    }
  }

  buildChrome() {
    const header = el("div", { className: "sp-sb-head" });
    const leftHead = el("div", { className: "sp-sb-presets" });

    if (this.presets.length > 1) {
      this.presetButtons = this.presets.map((preset, idx) => {
        const btn = el("button", {
          type: "button",
          className: `sp-sb-preset${idx === 0 ? " is-active" : ""}`,
          textContent: preset.label,
        });
        btn.onclick = () => this.selectPreset(idx);
        return btn;
      });
      leftHead.append(...this.presetButtons);
    } else {
      leftHead.append(el("span", { className: "sp-sb-title", textContent: this.getAttribute("title") ?? this.presets[0].label }));
    }

    const actions = el("div", { className: "sp-sb-actions" });
    this.statusBadge = el("button", { type: "button", className: "sp-sb-status", textContent: "Ready to compile", disabled: true });
    this.statusBadge.onclick = () => {
      const diag = this.uiRoot?.querySelector(".sp-inline-diag");
      if (diag) diag.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    this.diffBtn = el("button", { type: "button", className: "sp-sb-btn", textContent: "Diff", disabled: true });
    this.diffBtn.setAttribute("aria-pressed", String(this.showDiff));
    this.diffBtn.onclick = () => {
      this.showDiff = !this.showDiff;
      this.diffBtn.setAttribute("aria-pressed", String(this.showDiff));
      this.renderOutput();
    };
    this.resetBtn = el("button", { type: "button", className: "sp-sb-btn", textContent: "Reset", disabled: true });
    this.resetBtn.onclick = () => {
      this.currentCode = this.presets[this.activePreset].code;
      this.updateResetState();
      this.renderSourceEditor();
      if (this.compiler) this.compileCurrent(true);
    };
    actions.append(this.statusBadge, this.diffBtn, this.resetBtn);

    const playExample = this.getAttribute("play-example");
    if (playExample) {
      actions.append(el("a", {
        className: "sp-sb-link",
        href: `/play?example=${encodeURIComponent(playExample)}`,
        textContent: "Full Playground →",
      }));
    }

    header.append(leftHead, actions);

    this.descBar = el("div", { className: "sp-sb-desc" });
    this.updateDescription();

    this.problems = el("ul", { className: "sp-sb-problems", hidden: true });
    this.problems.setAttribute("role", "alert");

    this.warningsEl = el("ul", { className: "sp-sb-warnings", hidden: true });
    this.warningsEl.setAttribute("role", "status");

    const sourcePane = el("div", { className: "sp-sb-pane sp-sb-source" });
    const sourceHead = el("div", { className: "sp-sb-pane-bar" },
      el("span", { className: "sp-sb-file-label", textContent: this.presets[0].file }),
      el("span", { className: "sp-sb-edit-hint", textContent: "Editable TypeScript" }),
    );
    this.sourceFileLabel = sourceHead.querySelector(".sp-sb-file-label");
    this.sourceBox = el("div", { className: "sp-sb-code" });
    sourcePane.append(sourceHead, this.sourceBox);

    const outPane = el("div", { className: "sp-sb-pane sp-sb-out" });
    const outHead = el("div", { className: "sp-sb-pane-bar sp-sb-out-bar" });
    this.outTabs = el("div", { className: "sp-sb-tabs", role: "tablist" });
    this.outTabs.addEventListener("scroll", () => this.syncTabOverflow(), { passive: true });
    this.outTabs.addEventListener("wheel", (e) => {
      if (this.outTabs.scrollWidth > this.outTabs.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        this.outTabs.scrollLeft += e.deltaY;
      }
    }, { passive: false });
    this.outTabs.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const tabs = [...this.outTabs.querySelectorAll('[role="tab"]')];
      const idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      e.preventDefault();
      const next = tabs[(idx + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      next?.focus();
      next?.click();
    });
    this.copyOutBtn = el("button", { type: "button", className: "sp-sb-copy", textContent: "Copy" });
    this.copyOutBtn.onclick = () => {
      const content = this.outputs[this.selectedOutput];
      if (!content) return;
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
    };
    outHead.append(this.outTabs, this.copyOutBtn);
    this.outBox = el("div", { className: "sp-sb-code" });
    outPane.append(outHead, this.outBox);

    const divider = el("div", {
      className: "sp-split-handle",
      role: "separator",
      tabIndex: 0,
      title: "Drag to resize panes (double-click to reset)",
    });
    divider.setAttribute("aria-orientation", "vertical");

    const body = el("div", { className: "sp-sb-grid" }, sourcePane, divider, outPane);
    this.wireSplitDivider(body, divider);
    this.uiRoot.append(header, this.descBar, this.problems, this.warningsEl, body);
    this.classList.add("sp-sb-ready");
  }

  wireSplitDivider(grid, handle) {
    handle.ondblclick = () => grid.style.removeProperty("--split-left");
    handle.onkeydown = (e) => {
      if (window.innerWidth <= 920) return;
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
      if (e.button !== 0 || window.innerWidth <= 920) return;
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

  updateDescription() {
    const desc = this.presets[this.activePreset]?.description;
    if (desc) {
      this.descBar.textContent = desc;
      this.descBar.hidden = false;
    } else {
      this.descBar.hidden = true;
    }
  }

  updateResetState() {
    if (!this.resetBtn) return;
    const dirty = this.currentCode !== this.presets[this.activePreset]?.code;
    this.resetBtn.disabled = !dirty;
  }

  selectPreset(idx) {
    this.activePreset = idx;
    this.currentCode = this.presets[idx].code;
    this.presetButtons?.forEach((b, i) => b.classList.toggle("is-active", i === idx));
    this.sourceFileLabel.textContent = this.presets[idx].file;
    this.updateDescription();
    this.updateResetState();
    this.renderSourceEditor();
    if (this.compiler) this.compileCurrent(true);
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
    const preset = this.presets[this.activePreset];
    const lineCount = this.currentCode.split("\n").length;
    const clampLine = (n) => Math.max(1, Math.min(lineCount, n));

    const markers = [];
    const annotations = [];
    const unlocated = [];

    for (const d of diagnostics) {
      if (d.location && (!d.location.file || d.location.file === preset.file)) {
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
        unlocated.push(d);
      }
    }

    for (const w of lintWarnings) {
      if (w.file === preset.file) {
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
      }
    }

    if (this.editor) {
      try { this.editor.setMarkers(markers); } catch {}
    }
    if (this.sourceView) {
      const had = (this.activeAnnotationCount ?? 0) > 0;
      const has = annotations.length > 0;
      this.activeAnnotationCount = annotations.length;
      if (has || had) {
        this.sourceView.setLineAnnotations(annotations);
        this.sourceView.rerender();
      }
    }
    return unlocated;
  }

  renderSourceEditor() {
    this.detachEditor?.();
    this.detachEditor = undefined;
    this.editor = undefined;
    this.sourceView?.cleanUp();
    this.sourceBox.replaceChildren();
    this.activeAnnotationCount = 0;

    const preset = this.presets[this.activePreset];
    this.sourceView = new File({
      ...fileOptions,
      overflow: "wrap",
      disableFileHeader: true,
      renderAnnotation: (annotation) => this.renderInlineAnnotation(annotation),
    });
    this.sourceView.render({
      file: { name: preset.file, contents: this.currentCode },
      containerWrapper: this.sourceBox,
    });
    this.editor = new Editor("file", {
      onChange: ({ file }) => {
        if (this.currentCode === file.contents) return;
        this.currentCode = file.contents;
        this.updateResetState();
        this.setStatus("building", "Compiling…");
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          if (this.compiler) this.compileCurrent(false);
          else this.bootCompiler();
        }, 120);
      },
    });
    this.detachEditor = this.editor.edit(this.sourceView);
  }

  setStatus(state, text) {
    this.statusBadge.dataset.state = state;
    this.statusBadge.textContent = text;
    const clickable = state === "error" || state === "warn";
    this.statusBadge.disabled = !clickable;
    this.statusBadge.classList.toggle("is-clickable", clickable);
    this.statusBadge.title = clickable ? "Jump to diagnostic" : "";
  }

  syncTabOverflow() {
    if (!this.outTabs) return;
    const { scrollLeft, scrollWidth, clientWidth } = this.outTabs;
    this.outTabs.classList.toggle("has-overflow-left", scrollLeft > 2);
    this.outTabs.classList.toggle("has-overflow-right", scrollLeft + clientWidth < scrollWidth - 2);
  }

  updateDiffState() {
    if (!this.diffBtn) return;
    const hasChanges = Object.keys(this.outputs).some((k) => this.outputs[k] !== (this.previousOutputs[k] ?? ""));
    this.diffBtn.disabled = !hasChanges;
    this.diffBtn.title = hasChanges ? "Toggle unified diff against previous build" : "Edit code to inspect diff";
    if (!hasChanges && this.showDiff) {
      this.showDiff = false;
      this.diffBtn.setAttribute("aria-pressed", "false");
    }
  }

  async bootCompiler() {
    if (this.booting || this.compiler) return;
    const token = (this.bootToken = (this.bootToken ?? 0) + 1);
    this.booting = true;
    this.setStatus("loading", "Loading compiler…");
    try {
      const compiler = await loadCompiler();
      if (!this.isConnected || this.bootToken !== token) return;
      this.compiler = compiler;
      if (this.baseSource) {
        const baseRes = this.compiler.compile({
          name: "sandbox",
          files: this.buildFileMap(this.baseFile, this.baseSource),
          previous: null,
          migrationFiles: [],
        });
        if (baseRes.output) {
          this.baseSnapshot = baseRes.output.snapshot;
          this.baseMigrationFiles = baseRes.output.migrations.map(([name]) => name);
          this.baselineOutputs = this.extractOutputs(baseRes.output);
        }
      }
      this.compileCurrent(true);
      this.dataset.ready = "";
    } catch (err) {
      if (this.isConnected && this.bootToken === token) {
        this.setStatus("error", `Compiler failed: ${err.message ?? err}`);
      }
    } finally {
      if (this.bootToken === token) this.booting = false;
    }
  }

  buildFileMap(file, code) {
    if (file === "typedpress.config.ts") {
      return { "typedpress.config.ts": code };
    }
    return {
      "typedpress.config.ts": `import { defineConfig } from "typedpress";\nexport * from "./${file.replace(/\.tsx?$/, "")}";\nexport default defineConfig({ name: "sandbox" });\n`,
      [file]: code,
    };
  }

  extractOutputs(out) {
    const map = {};
    for (const [mName, sql] of out.migrations) {
      map[`tp/_generated/migrations/${mName}`] = sql;
    }
    if (out.schemaPhp) map["tp/app/schema.php"] = out.schemaPhp;
    if (out.functionsPhp && out.functionsPhp.trim().length > 0) map["tp/app/functions.php"] = out.functionsPhp;
    if (out.genTs) map["tp/_generated/db.d.ts"] = out.genTs;
    const openapi = Object.entries(out.appPlugin ?? {}).find(([f]) => f.endsWith("/tp/app/openapi.json"))?.[1];
    if (openapi) map["tp/app/openapi.json"] = openapi;
    if (out.client?.["types.ts"]) map["tp/_generated/client/types.ts"] = out.client["types.ts"];
    return map;
  }

  compileCurrent(isReset) {
    const preset = this.presets[this.activePreset];
    const started = performance.now();
    let result;
    try {
      result = this.compiler.compile({
        name: "sandbox",
        files: this.buildFileMap(preset.file, this.currentCode),
        previous: this.baseSnapshot,
        migrationFiles: this.baseMigrationFiles,
      });
    } catch (err) {
      this.setStatus("error", `Error: ${err.message ?? err}`);
      return;
    }

    this.problems.replaceChildren();
    this.problems.hidden = true;
    this.warningsEl.replaceChildren();
    this.warningsEl.hidden = true;
    if (!result.check.ok || !result.output) {
      const unlocated = this.applyInlineDiagnostics(result.check.diagnostics, []);
      if (unlocated.length > 0) {
        this.problems.hidden = false;
        for (const d of unlocated) {
          const loc = d.location ? `${d.location.file}:${d.location.line}:${d.location.column}` : d.code;
          const li = el("li", {}, el("code", { textContent: loc }), ` ${d.message}`);
          if (d.help) li.append(el("span", { className: "sp-sb-help", textContent: ` — ${d.help}` }));
          this.problems.append(li);
        }
      }
      const n = result.check.diagnostics.length;
      this.setStatus("error", `${n} diagnostic${n === 1 ? "" : "s"}`);
      return;
    }

    const lintWarnings = result.output.lintWarnings ?? [];
    this.applyInlineDiagnostics([], lintWarnings);

    const nextOutputs = this.extractOutputs(result.output);
    if (isReset) {
      this.previousOutputs = this.baseSource ? { ...this.baselineOutputs } : { ...nextOutputs };
      this.outputs = nextOutputs;
    } else {
      this.previousOutputs = this.outputs;
      this.outputs = nextOutputs;
    }

    const keys = Object.keys(this.outputs);
    const preferred = preset.defaultOutput || this.getAttribute("default-tab") || "";
    if (isReset || !this.selectedOutput || !(this.selectedOutput in this.outputs)) {
      const match = preferred
        ? keys.find((k) => k === preferred || labelForOutput(k) === preferred || k.includes(preferred))
        : null;
      this.selectedOutput = match ?? keys[0] ?? "";
    } else if (!isReset) {
      const newMig = keys.find((k) => k.includes("/migrations/") && !(k in this.previousOutputs));
      if (newMig) this.selectedOutput = newMig;
    }

    const ms = Math.max(1, Math.round(performance.now() - started));
    if (lintWarnings.length > 0) {
      this.setStatus("warn", `Compiled in ${ms} ms · ${lintWarnings.length} warning${lintWarnings.length === 1 ? "" : "s"}`);
    } else {
      this.setStatus("ok", `Compiled in ${ms} ms · ${keys.length} outputs`);
    }
    this.updateDiffState();
    this.renderOutputTabs();
    this.renderOutput();
  }

  applyLintFixes(warnings) {
    const preset = this.presets[this.activePreset];
    const applicable = warnings
      .filter((w) => w.file === preset.file)
      .sort((a, b) => b.utf16Start - a.utf16Start);
    if (applicable.length === 0) return;
    let next = this.currentCode;
    let lastStart = Infinity;
    for (const w of applicable) {
      if (w.utf16End > lastStart) continue;
      if (next.slice(w.utf16Start, w.utf16End) !== w.found) continue;
      next = next.slice(0, w.utf16Start) + w.replacement + next.slice(w.utf16End);
      lastStart = w.utf16Start;
    }
    if (next !== this.currentCode) {
      this.currentCode = next;
      this.updateResetState();
      this.renderSourceEditor();
      if (this.compiler) this.compileCurrent(false);
    }
  }

  renderOutputTabs() {
    this.outTabs.replaceChildren();
    const keys = Object.keys(this.outputs);
    for (const key of keys) {
      const changed = key in this.previousOutputs
        ? this.outputs[key] !== this.previousOutputs[key]
        : Object.keys(this.previousOutputs).length > 0;
      const btn = el("button", {
        type: "button",
        role: "tab",
        className: `sp-sb-tab${key === this.selectedOutput ? " is-active" : ""}${changed ? " is-changed" : ""}`,
        textContent: labelForOutput(key),
        title: key,
      });
      btn.setAttribute("aria-selected", String(key === this.selectedOutput));
      btn.onclick = () => {
        this.selectedOutput = key;
        this.renderOutputTabs();
        this.renderOutput();
        this.outTabs.querySelector(".is-active")?.scrollIntoView({ inline: "nearest", block: "nearest" });
      };
      this.outTabs.append(btn);
    }
    requestAnimationFrame(() => this.syncTabOverflow());
  }

  renderOutput() {
    this.outView?.cleanUp();
    this.outBox.replaceChildren();
    const name = this.selectedOutput;
    if (!name || !(name in this.outputs)) return;
    const contents = this.outputs[name];
    const prev = this.previousOutputs[name] ?? "";
    if (this.showDiff && prev !== contents) {
      this.outView = new FileDiff({ ...fileOptions, diffStyle: "unified", hunkSeparators: "simple", disableFileHeader: true });
      this.outView.render({
        oldFile: { name, contents: prev },
        newFile: { name, contents },
        containerWrapper: this.outBox,
      });
    } else {
      this.outView = new File({ ...fileOptions, disableFileHeader: true });
      this.outView.render({
        file: { name, contents },
        containerWrapper: this.outBox,
      });
    }
  }
}

if (!customElements.get("tp-sandbox")) customElements.define("tp-sandbox", Sandbox);
