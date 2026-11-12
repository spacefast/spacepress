import { File } from "@pierre/diffs";

import { editedBlueprint, playgroundUrl, runRequest, type ExampleRun } from "./blueprint.ts";
import { Compiler } from "./compiler.ts";
import { highlightHtml, languageOf } from "./highlight.ts";
import { toFirst } from "./names.ts";

const dark = () => document.documentElement.dataset.theme === "dark";
import { compilerFiles, playgroundExamples, wordpressFiles } from "./playground-catalog.ts";

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
// The editor shows First names (`first.config.ts`, `first/`, `import ... from "first"`); the compiler
// is handed the names it reads (lib/playground-catalog.ts).
const entry = "first.config.ts";
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
addEventListener("resize", () => fit(source));
new MutationObserver(() => {
  viewer?.setThemeType(dark() ? "dark" : "light");
  paint(source, sourceView, sourceFile.value);
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

// The output pane renders with the diffs File component, the same renderer as every other file on
// the site, and scrolls inside a fixed height. The textarea keeps the plain text, for the find
// buttons below and for screen readers.
let viewer: File | undefined;
const showGenerated = () => {
  generated.value = outputs[generatedFile.value] ?? runtime[generatedFile.value] ?? "";
  viewer?.cleanUp();
  generatedView.replaceChildren();
  if (generated.value) {
    viewer = new File({ theme: { light: "pierre-light", dark: "pierre-dark" }, themeType: dark() ? "dark" : "light", overflow: "wrap", disableFileHeader: true });
    viewer.render({ file: { name: generatedFile.value, contents: generated.value }, containerWrapper: generatedView });
  }
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
    const { check, output } = compiler.compile({ name: example.value, files: compilerFiles(files), previous: null });
    if (!check.ok || !output) {
      clearOutputs();
      status.dataset.state = "diagnostics";
      status.textContent = "Fix the config to generate files.";
      diagnostics.textContent = check.diagnostics.map((d) => {
        const location = d.location ? `${d.location.file}:${d.location.line}:${d.location.column}: ` : "";
        return toFirst(`${location}${d.message}${d.help ? `\n${d.help}` : ""}`);
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
  // Every site example can run in WordPress; the blog, which only the tour uses, has no seed or landing page here.
  runWordPress.hidden = !runs.has(example.value);
  wordpress.hidden = true;
  frame.removeAttribute("src");
  // Installed npm packages go to the compiler with the rest but aren't listed for editing.
  const paths = Object.keys(files).filter((name) => !name.startsWith("node_modules/")).sort((a, b) => {
    if (a === entry) return -1;
    if (b === entry) return 1;
    return a.localeCompare(b);
  });
  sourceFile.replaceChildren(...paths.map((name) => new Option(name, name)));
  showSource();
  compile();
};

// WordPress Playground, embedded on request: it downloads WordPress and PHP (about 30 MB), so it
// starts only when asked. The config in the editor is compiled again with the example's migration
// ledger, and lib/blueprint.ts turns the result into a blueprint: the app plugin the compiler
// returned, First's shared plugins from this site, and the WordPress.org plugins in the example's
// lock. Each press starts a fresh WordPress.
const runWordPress = document.querySelector<HTMLButtonElement>("#run-wordpress")!;
const wordpress = document.querySelector<HTMLElement>("#wordpress")!;
const frame = document.querySelector<HTMLIFrameElement>("#wordpress-frame")!;
const wordpressTab = document.querySelector<HTMLAnchorElement>("#wordpress-tab")!;
const wordpressNote = document.querySelector<HTMLElement>("#wordpress-note")!;
const runsData = document.querySelector<HTMLScriptElement>("#playground-runs");
const runs = new Map(Object.entries(JSON.parse(runsData?.textContent ?? "{}") as Record<string, ExampleRun>));
const ran = wordpressNote.innerHTML;
runWordPress.addEventListener("click", () => {
  const run = runs.get(example.value);
  if (!compiler || !run) return;
  const { output } = compiler.compile(runRequest(example.value, compilerFiles(files), run.ledger));
  wordpress.hidden = false;
  if (!output) {
    // The status line and the diagnostics already say what to fix.
    frame.removeAttribute("src");
    frame.hidden = true;
    wordpressTab.hidden = true;
    wordpressNote.textContent = "Fix the config first: it doesn't compile, so there is nothing to run.";
  } else {
    const built = editedBlueprint({ output, example: run, site: runWordPress.dataset.site!, platform: { php: runWordPress.dataset.php!, sqlite: runWordPress.dataset.sqlite! } });
    if ("refused" in built) {
      frame.removeAttribute("src");
      frame.hidden = true;
      wordpressTab.hidden = true;
      wordpressNote.textContent = built.refused;
    } else {
      const url = playgroundUrl(built.blueprint);
      frame.hidden = false;
      wordpressTab.hidden = false;
      frame.src = url;
      wordpressTab.href = url;
      wordpressNote.innerHTML = ran;
      if (!built.seeded && run.seed) wordpressNote.append(" Your edit changed the schema, so the example's sample data isn't loaded.");
    }
  }
  wordpress.scrollIntoView({ behavior: "smooth", block: "start" });
});

sourceFile.addEventListener("change", showSource);
generatedFile.addEventListener("change", showGenerated);
document.querySelectorAll<HTMLButtonElement>("[data-runtime-file]").forEach((button) => {
  button.addEventListener("click", () => {
    const file = wordpressFiles.find(({ path }) => path === button.dataset.runtimeFile);
    if (!file) return;
    updateFileMenu(file.path);
    const start = generated.value.indexOf(file.find);
    if (start < 0) return;
    // Scroll the rendered file to the line that holds the call.
    const line = generated.value.slice(0, start).split("\n").length;
    requestAnimationFrame(() => {
      const row = generatedView.querySelector("diffs-container")?.shadowRoot?.querySelector(`[data-column-number="${line}"]`);
      row?.scrollIntoView({ block: "center" });
    });
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
