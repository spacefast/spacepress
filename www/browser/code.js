// Draws the guide's code, diffs, file trees and whole projects with @pierre/diffs and
// @pierre/trees (https://diffs.com). The page holds each one as a custom element with its text
// (first/components/Guide.tsx); this replaces the text with the drawn version and marks the
// element tp-drawn. Without this script the text stays, as plain monospace.
import { File, FileDiff } from "@pierre/diffs";
import { FileTree } from "@pierre/trees";

const theme = { light: "pierre-light", dark: "pierre-dark" };
const options = { theme, themeType: "system", overflow: "scroll" };
// The grammars in this build (scripts/build.mjs `keep`). Any other file is shown as plain text.
const known = new Set(["ts", "tsx", "js", "jsx", "mjs", "json", "css", "sql", "php", "html", "md", "sh"]);
const extension = { typescript: "ts", shellscript: "sh", markdown: "md", text: "txt" };

function fileOf(node) {
  const lang = node.getAttribute("lang");
  const name = node.getAttribute("file") ?? `snippet.${extension[lang] ?? lang ?? "ts"}`;
  const file = { name, contents: node.textContent.replace(/\n+$/, "") };
  if (!known.has(name.split(".").pop())) file.lang = "text";
  return file;
}

function drawCode(node) {
  if (node.classList.contains("tp-drawn")) return;
  const file = fileOf(node);
  const titled = node.hasAttribute("file");
  const note = node.getAttribute("note");
  node.replaceChildren();
  new File({ ...options, disableFileHeader: !titled, disableLineNumbers: !titled }).render({ file, containerWrapper: node });
  if (note) {
    const meta = Object.assign(document.createElement("span"), { slot: "header-metadata", className: "tp-note", textContent: note });
    node.querySelector("diffs-container")?.append(meta);
  }
  node.classList.add("tp-drawn");
}

function drawDiff(node) {
  const [before, after] = [...node.querySelectorAll(":scope > tp-code")].map(fileOf);
  if (!before || !after) return;
  node.replaceChildren();
  new FileDiff({ ...options, diffStyle: "unified", hunkSeparators: "simple" }).render({ oldFile: before, newFile: after, containerWrapper: node });
  node.classList.add("tp-drawn");
}

// The tree draws only the rows that fit its height, so the box gets one row per file and folder,
// corrected once the tree has merged folders that hold a single folder.
function tree(host, paths, notes, selected, onSelect) {
  const rows = new Set();
  for (const p of paths) { const parts = p.replace(/\/$/, "").split("/"); for (let i = 1; i <= parts.length; i++) rows.add(parts.slice(0, i).join("/")); }
  host.style.height = `${rows.size * 24 + 8}px`;
  const model = new FileTree({
    paths, initialExpansion: "open", flattenEmptyDirectories: true, density: "compact", icons: { set: "complete", colored: true },
    ...(selected ? { initialSelectedPaths: [selected] } : {}),
    renderRowDecoration: ({ item }) => (notes[item.path] ? { text: notes[item.path] } : null),
    onSelectionChange: (picked) => { if (picked.length === 1) onSelect?.(picked[0]); },
  });
  model.render({ containerWrapper: host });
  requestAnimationFrame(() => {
    const drawn = host.querySelector("file-tree-container")?.shadowRoot?.querySelectorAll('[role="treeitem"]').length;
    if (drawn) host.style.height = `${drawn * 24 + 8}px`;
  });
}

// "name   note" lines, two spaces per level, folders end with "/".
function drawTree(node) {
  const paths = [], notes = {}, stack = [];
  for (const line of node.textContent.split("\n")) {
    const m = line.match(/^(\s*)(\S+)(?:\s{2,}(.*))?$/);
    if (!m) continue;
    stack.length = m[1].length / 2;
    const path = stack.join("") + m[2];
    if (m[2].endsWith("/")) stack.push(m[2]);
    paths.push(path);
    if (m[3]) notes[path] = m[3].trim();
  }
  node.replaceChildren();
  tree(node, paths, notes);
  node.classList.add("tp-drawn");
}

// A whole project: its files in a tree, and the one that is picked beside it.
function drawExample(node) {
  const files = [...node.querySelectorAll(":scope > tp-code")];
  const byPath = new Map(files.map((f) => [f.getAttribute("file"), f]));
  const notes = Object.fromEntries(files.filter((f) => f.hasAttribute("label")).map((f) => [f.getAttribute("file"), f.getAttribute("label")]));
  const show = (path) => {
    const file = byPath.get(path);
    if (!file) return;
    for (const f of files) f.classList.toggle("tp-open", f === file);
    drawCode(file);
  };
  const first = byPath.has(node.getAttribute("open")) ? node.getAttribute("open") : files[0]?.getAttribute("file");
  const host = Object.assign(document.createElement("div"), { className: "tp-example-tree" });
  node.prepend(host);
  node.classList.add("tp-drawn");
  tree(host, [...byPath.keys()], notes, first, show);
  show(first);
}

// Everything is drawn a few at a time so the page stays responsive, top to bottom.
const jobs = [
  ...[...document.querySelectorAll("tp-example")].map((n) => () => drawExample(n)),
  ...[...document.querySelectorAll("tp-diff")].map((n) => () => drawDiff(n)),
  ...[...document.querySelectorAll("tp-tree")].map((n) => () => drawTree(n)),
  ...[...document.querySelectorAll("tp-code")].filter((n) => !n.closest("tp-example, tp-diff")).map((n) => () => drawCode(n)),
];
const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
(function next() {
  for (const job of jobs.splice(0, 8)) { try { job(); } catch (error) { console.error("could not draw a block", error); } }
  if (jobs.length) setTimeout(next, 0);
  // Drawn blocks are a little taller than their text, so a link to a section is followed again at the end.
  else { document.documentElement.dataset.drawn = ""; if (target) requestAnimationFrame(() => target.scrollIntoView()); }
})();
