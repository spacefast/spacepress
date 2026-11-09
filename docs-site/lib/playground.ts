import { Compiler } from "./compiler.ts";
import { highlightHtml, languageOf } from "./highlight.ts";
import { toFirst } from "./names.ts";

const dark = () => document.documentElement.dataset.theme === "dark";
import { playgroundExamples, wordpressFiles } from "./playground-catalog.ts";

function readFiles(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid source files");
  const files: Record<string, string> = {};
  for (const [file, source] of Object.entries(value)) {
    if (typeof source !== "string") throw new Error(`Invalid source: ${file}`);
    files[file] = source;
  }
  return files;
}

function readExamples(value: unknown): Map<string, Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Missing examples");
  return new Map(Object.entries(value).map(([name, files]) => [name, readFiles(files)]));
}

const root = document.querySelector<HTMLElement>(".playground");
const compilerEntry = root?.dataset.entry ?? "first.config.ts";
const compilerModule = root?.dataset.module ?? "first";
const example = document.querySelector<HTMLSelectElement>("#example");
const sourceFile = document.querySelector<HTMLSelectElement>("#source-file");
const source = document.querySelector<HTMLTextAreaElement>("#source");
const generatedFile = document.querySelector<HTMLSelectElement>("#generated-file");
const generated = document.querySelector<HTMLTextAreaElement>("#generated");
const status = document.querySelector<HTMLElement>("#compile-status");
const diagnostics = document.querySelector<HTMLElement>("#diagnostics");
const reset = document.querySelector<HTMLButtonElement>("#reset");
const download = document.querySelector<HTMLButtonElement>("#download");
const data = document.querySelector<HTMLScriptElement>("#playground-examples");
const runtimeData = document.querySelector<HTMLScriptElement>("#playground-runtime");
const fileDescription = document.querySelector<HTMLElement>("#file-description");
const exampleDescription = document.querySelector<HTMLElement>("#example-description");
const sourceView = document.querySelector<HTMLElement>("#source-view");
const generatedView = document.querySelector<HTMLElement>("#generated-view");
if (!root || !example || !sourceFile || !source || !generatedFile || !generated || !status || !diagnostics || !reset || !download || !data || !runtimeData || !fileDescription || !exampleDescription || !sourceView || !generatedView) {
  throw new Error("Missing playground elements");
}

const examples = readExamples(JSON.parse(data.textContent ?? "null"));
// The editor shows First names: `first.config.ts` and `import ... from "first"`. The compiler is
// handed the names it reads, which the page states in data-entry and data-module.
const entry = "first.config.ts";
const toCompiler = (sources: Record<string, string>) =>
  Object.fromEntries(Object.entries(sources).map(([file, text]) => [
    file === entry ? compilerEntry : file,
    text.replace(/(from |import\()(["'])first\2/g, `$1$2${compilerModule}$2`),
  ]));
const runtime = readFiles(JSON.parse(runtimeData.textContent ?? "null"));
const drafts = new Map<string, Record<string, string>>();
let files: Record<string, string> = {};
let outputs: Record<string, string> = {};
let compiler: Compiler | undefined;
let pending: number | undefined;

/** Paints the highlighted copy of a textarea's text behind it; until it is ready, the textarea shows its own text. */
const paint = (area: HTMLTextAreaElement, view: HTMLElement, file: string) => {
  const editor = view.closest<HTMLElement>(".code-editor");
  if (!editor) return;
  fit(area);
  const text = area.value;
  delete editor.dataset.highlighted;
  void highlightHtml(text, languageOf(file), dark()).then((html) => {
    if (area.value !== text) return;
    view.innerHTML = html;
    editor.dataset.highlighted = "";
  }, () => undefined);
};
const showSource = () => {
  source.value = files[sourceFile.value] ?? "";
  paint(source, sourceView, sourceFile.value);
};
/** Grows a textarea to its whole text, so the file never scrolls inside its box. */
const fit = (area: HTMLTextAreaElement) => {
  area.style.height = "auto";
  area.style.height = `${area.scrollHeight}px`;
};
addEventListener("resize", () => { fit(source); fit(generated); });

const showGenerated = () => {
  generated.value = outputs[generatedFile.value] ?? runtime[generatedFile.value] ?? "";
  paint(generated, generatedView, generatedFile.value);
  fileDescription.textContent = wordpressFiles.find(({ path }) => path === generatedFile.value)?.description
    ?? "Generated from your config. Changes as you edit.";
  download.disabled = !(generatedFile.value in outputs || generatedFile.value in runtime);
};

const updateFileMenu = (selected: string) => {
  const generatedGroup = document.createElement("optgroup");
  generatedGroup.label = "Generated from config";
  generatedGroup.append(...Object.keys(outputs).map((name) => new Option(name, name)));
  const runtimeGroup = document.createElement("optgroup");
  runtimeGroup.label = "Shared WordPress runtime";
  const templateGroup = document.createElement("optgroup");
  templateGroup.label = "Plugin templates";
  for (const { path } of wordpressFiles) {
    const group = path.startsWith("runtime/wp-plugin/") ? templateGroup : runtimeGroup;
    group.append(new Option(path, path));
  }
  generatedFile.replaceChildren(generatedGroup, runtimeGroup, templateGroup);
  if (Object.keys(outputs).length === 0) generatedFile.prepend(new Option("No generated files", ""));
  generatedFile.value = selected in outputs || selected in runtime ? selected : Object.keys(outputs)[0] ?? "";
  generatedFile.disabled = false;
  showGenerated();
};

const clearOutputs = () => {
  const selected = generatedFile.value;
  outputs = {};
  updateFileMenu(selected);
};

const compile = () => {
  if (!compiler) return;
  diagnostics.hidden = true;
  diagnostics.textContent = "";
  try {
    const { check, output } = compiler.compile({ name: example.value, files: toCompiler(files), previous: null });
    if (!check.ok || !output) {
      clearOutputs();
      status.dataset.state = "diagnostics";
      status.textContent = "Fix the config to generate files.";
      diagnostics.textContent = check.diagnostics.map((d) => {
        const location = d.location ? `${d.location.file}:${d.location.line}:${d.location.column}: ` : "";
        return `${location}${d.message}${d.help ? `\n${d.help}` : ""}`;
      }).join("\n\n");
      diagnostics.hidden = false;
      return;
    }
    const selected = generatedFile.value;
    // Generated files read with First names, like every other file on the site.
    outputs = {
      "first/app/functions.php": toFirst(output.functionsPhp),
      "first/app/schema.php": toFirst(output.schemaPhp),
      ...Object.fromEntries(output.migrations.map(([name, sql]) => [`first/_generated/migrations/${name}`, toFirst(sql)])),
      ...Object.fromEntries(Object.entries(output.client).map(([name, text]) => [`first/_generated/client/${name}`, toFirst(text)])),
      "first/_generated/db.d.ts": toFirst(output.genTs),
      "first/_generated/migrations/snapshot.json": JSON.stringify(output.snapshot, null, 2) + "\n",
    };
    updateFileMenu(selected);
    status.dataset.state = "ok";
    status.textContent = `Compiled ${example.value}. ${Object.keys(outputs).length} generated files.`;
    const notes = [...output.warnings, ...output.hints];
    if (notes.length > 0) {
      diagnostics.textContent = notes.join("\n");
      diagnostics.hidden = false;
    }
  } catch (error) {
    clearOutputs();
    status.dataset.state = "failed";
    status.textContent = "Compilation failed.";
    diagnostics.textContent = String(error);
    diagnostics.hidden = false;
  }
};

const loadExample = () => {
  const original = examples.get(example.value);
  if (!original) throw new Error(`Unknown example: ${example.value}`);
  files = drafts.get(example.value) ?? { ...original };
  drafts.set(example.value, files);
  exampleDescription.textContent = playgroundExamples.find(({ name }) => name === example.value)?.description ?? "";
  const paths = Object.keys(files).sort((a, b) => {
    if (a === entry) return -1;
    if (b === entry) return 1;
    return a.localeCompare(b);
  });
  sourceFile.replaceChildren(...paths.map((name) => new Option(name, name)));
  showSource();
  compile();
};

sourceFile.addEventListener("change", showSource);
generatedFile.addEventListener("change", showGenerated);
document.querySelectorAll<HTMLButtonElement>("[data-runtime-file]").forEach((button) => {
  button.addEventListener("click", () => {
    const file = wordpressFiles.find(({ path }) => path === button.dataset.runtimeFile);
    if (!file) return;
    updateFileMenu(file.path);
    const start = generated.value.indexOf(file.find);
    if (start < 0) return;
    generated.focus();
    generated.setSelectionRange(start, start + file.find.length);
    const line = generated.value.slice(0, start).split("\n").length - 1;
    generated.scrollTop = Math.max(0, line * parseFloat(getComputedStyle(generated).lineHeight) - generated.clientHeight / 3);
  });
});
example.addEventListener("change", loadExample);
reset.addEventListener("click", () => {
  drafts.delete(example.value);
  loadExample();
});
source.addEventListener("input", () => {
  files[sourceFile.value] = source.value;
  paint(source, sourceView, sourceFile.value);
  status.dataset.state = "compiling";
  status.textContent = "Compiling…";
  if (pending !== undefined) cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    pending = undefined;
    compile();
  });
});
source.addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || event.shiftKey) return;
  event.preventDefault();
  source.setRangeText("  ", source.selectionStart, source.selectionEnd, "end");
  source.dispatchEvent(new Event("input"));
});
download.addEventListener("click", () => {
  const text = outputs[generatedFile.value] ?? runtime[generatedFile.value];
  if (text === undefined) return;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = generatedFile.value.split("/").at(-1) ?? "generated.txt";
  link.click();
  URL.revokeObjectURL(url);
});

const requested = new URLSearchParams(location.search).get("example");
if (requested && examples.has(requested)) example.value = requested;
loadExample();
try {
  const wasm = root.dataset.wasm;
  if (!wasm) throw new Error("Missing compiler URL");
  compiler = await Compiler.load(fetch(wasm));
  source.disabled = false;
  compile();
} catch (error) {
  status.dataset.state = "failed";
  status.textContent = "Could not load the compiler.";
  diagnostics.textContent = String(error);
  diagnostics.hidden = false;
}
