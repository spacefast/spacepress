// Draws code blocks, diffs, file trees and multi-file projects with @pierre/diffs and @pierre/trees.
// Adds one-click copy buttons to rendered code blocks.
import { File, FileDiff } from "@pierre/diffs";
import { FileTree } from "@pierre/trees";

const theme = { light: "pierre-light", dark: "pierre-dark" };
const options = { theme, themeType: "dark", overflow: "scroll" };
const known = new Set(["ts", "tsx", "js", "jsx", "mjs", "json", "css", "sql", "php", "html", "xml", "md", "yaml", "yml", "sh"]);
const extension = {
  typescript: "ts",
  javascript: "js",
  shellscript: "sh",
  shell: "sh",
  bash: "sh",
  zsh: "sh",
  markdown: "md",
  yaml: "yaml",
  yml: "yaml",
  text: "txt",
};

// The Interactivity router rebuilds pages from a copy of their DOM: a page it shows again, or the
// first page as it was when the router read it, comes back with the `sp-drawn` class and an empty
// shadow root. So what was drawn is known by element, not by class, and each host keeps its source
// in `data-sp-source`, which a copy carries, so a copied host is drawn again from it.
const drawn = new WeakSet();
const isDrawn = (node) => drawn.has(node);
function markDrawn(node) {
  drawn.add(node);
  node.classList.add("sp-drawn");
}
function sourceOf(node) {
  if (node.dataset.spSource !== undefined) return node.dataset.spSource;
  const text = node.textContent.replace(/^\n+/, "").replace(/\n+$/, "");
  node.dataset.spSource = text;
  return text;
}

function fileOf(node) {
  const lang = node.getAttribute("lang");
  const name = node.getAttribute("file") ?? `snippet.${extension[lang] ?? lang ?? "ts"}`;
  const file = { name, contents: sourceOf(node) };
  if (!known.has(name.split(".").pop())) file.lang = "text";
  return file;
}

function drawCode(node) {
  if (isDrawn(node)) return;
  const file = fileOf(node);
  const titled = node.hasAttribute("file");
  const note = node.getAttribute("note");
  node.replaceChildren();
  new File({ ...options, disableFileHeader: !titled, disableLineNumbers: !titled }).render({ file, containerWrapper: node });
  if (note) {
    const meta = Object.assign(document.createElement("span"), { slot: "header-metadata", className: "sp-note", textContent: note });
    node.querySelector("diffs-container")?.append(meta);
  }
  const copy = Object.assign(document.createElement("button"), {
    type: "button",
    className: "sp-copy-btn",
    textContent: "Copy",
  });
  copy.setAttribute("aria-label", `Copy ${file.name}`);
  copy.onclick = () => {
    navigator.clipboard?.writeText(file.contents).then(() => {
      copy.dataset.origLabel ??= copy.textContent;
      clearTimeout(copy._copyTimer);
      copy.textContent = "Copied";
      copy.classList.add("is-copied");
      copy._copyTimer = setTimeout(() => {
        copy.textContent = copy.dataset.origLabel;
        copy.classList.remove("is-copied");
      }, 1400);
    }, () => {});
  };
  node.append(copy);
  markDrawn(node);
}

function drawDiff(node) {
  let files;
  try {
    files = node.dataset.spSource !== undefined ? JSON.parse(node.dataset.spSource) : [...node.querySelectorAll(":scope > sp-code")].map(fileOf);
  } catch {
    return;
  }
  const [before, after] = files;
  if (!before || !after) return;
  node.dataset.spSource = JSON.stringify([before, after]);
  node.replaceChildren();
  new FileDiff({ ...options, diffStyle: "unified", hunkSeparators: "simple" }).render({ oldFile: before, newFile: after, containerWrapper: node });
  markDrawn(node);
}

function tree(host, paths, notes, selected, onSelect, fixedHeight = false) {
  if (!fixedHeight) {
    const rows = new Set();
    for (const p of paths) {
      const parts = p.replace(/\/$/, "").split("/");
      for (let i = 1; i <= parts.length; i++) rows.add(parts.slice(0, i).join("/"));
    }
    host.style.height = `${rows.size * 24 + 8}px`;
  }
  const model = new FileTree({
    paths,
    initialExpansion: "open",
    flattenEmptyDirectories: true,
    density: "compact",
    icons: { set: "complete", colored: true },
    ...(selected ? { initialSelectedPaths: [selected] } : {}),
    renderRowDecoration: ({ item }) => (notes[item.path] ? { text: notes[item.path] } : null),
    onSelectionChange: (picked) => { if (picked.length === 1) onSelect?.(picked[0]); },
  });
  model.render({ containerWrapper: host });
  if (!fixedHeight) {
    requestAnimationFrame(() => {
      const rows = host.querySelector("file-tree-container")?.shadowRoot?.querySelectorAll('[role="treeitem"]').length;
      if (rows) host.style.height = `${rows * 24 + 8}px`;
    });
  }
}

function drawTree(node) {
  if (node.hasAttribute("data-sp-ascii")) {
    const { paths, notes } = parseAsciiTree(sourceOf(node));
    node.replaceChildren();
    tree(node, paths, notes);
    markDrawn(node);
    return;
  }
  const paths = [], notes = {}, stack = [];
  for (const line of sourceOf(node).split("\n")) {
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
  markDrawn(node);
}

function drawExample(node) {
  const files = [...node.querySelectorAll(":scope > sp-code")];
  const byPath = new Map(files.map((f) => [f.getAttribute("file"), f]));
  const notes = Object.fromEntries(files.filter((f) => f.hasAttribute("label")).map((f) => [f.getAttribute("file"), f.getAttribute("label")]));
  const show = (path) => {
    const file = byPath.get(path);
    if (!file) return;
    for (const f of files) f.classList.toggle("sp-open", f === file);
    drawCode(file);
  };
  const first = byPath.has(node.getAttribute("open")) ? node.getAttribute("open") : files[0]?.getAttribute("file");
  node.querySelector(":scope > .sp-example-tree")?.remove();
  const host = Object.assign(document.createElement("div"), { className: "sp-example-tree" });
  node.prepend(host);
  markDrawn(node);
  tree(host, [...byPath.keys()], notes, first, show, true);
  show(first);
}

function isAsciiTree(text) {
  return /(?:^|\n)[│├└\s]*[├└]──\s+\S/.test(text);
}

function parseAsciiTree(text) {
  const paths = [];
  const notes = {};
  const stack = [];
  let rootPrefix = "";

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    const branch = line.match(/^([│\s]*)(?:├──|└──)\s+(\S+)(?:\s+(?:#\s*)?(.*))?$/);
    if (branch) {
      const depth = Math.floor(branch[1].length / 4);
      stack.length = depth;
      const name = branch[2];
      const path = rootPrefix + stack.join("") + name;
      if (name.endsWith("/")) stack.push(name);
      paths.push(path);
      if (branch[3]?.trim()) notes[path] = branch[3].trim();
      continue;
    }
    const root = line.match(/^(\S+\/)(?:\s+(?:#\s*)?(.*))?$/);
    if (root && paths.length === 0) {
      rootPrefix = root[1];
      paths.push(rootPrefix);
      if (root[2]?.trim()) notes[rootPrefix] = root[2].trim();
    }
  }
  return { paths, notes };
}

function enhanceProsePre(pre) {
  if (isDrawn(pre)) return;
  const codeEl = pre.querySelector("code");
  const rawText = (codeEl ?? pre).textContent.replace(/^\n+/, "").replace(/\n+$/, "");
  const classes = `${pre.className} ${codeEl?.className ?? ""}`;
  const langMatch = classes.match(/\blanguage-([a-z0-9_-]+)\b/i);
  const lang = langMatch ? langMatch[1].toLowerCase() : null;

  if (lang === "tree" || isAsciiTree(rawText)) {
    const { paths, notes } = parseAsciiTree(rawText);
    if (paths.length > 0) {
      const host = document.createElement("sp-tree");
      host.dataset.spSource = rawText;
      host.setAttribute("data-sp-ascii", "");
      pre.replaceWith(host);
      tree(host, paths, notes);
      markDrawn(host);
      return;
    }
  }

  const host = document.createElement("sp-code");
  if (lang) host.setAttribute("lang", lang);
  host.textContent = rawText;
  pre.replaceWith(host);
  drawCode(host);
}

let pendingTimer = null;

function collectJobs(root = document) {
  const prosePres = [...root.querySelectorAll(".sd-prose pre, .sp-prose pre, pre.spacepress-code, pre.wp-block-code")]
    .filter((n) => !isDrawn(n) && !n.closest("sp-code, sp-diff, sp-tree, sp-example, sp-sandbox, sp-play"));
  const fresh = (selector) => [...root.querySelectorAll(selector)].filter((n) => !isDrawn(n));

  return [
    ...fresh("sp-example").map((n) => () => drawExample(n)),
    ...fresh("sp-diff").map((n) => () => drawDiff(n)),
    ...fresh("sp-tree").map((n) => () => drawTree(n)),
    ...fresh("sp-code").filter((n) => !n.closest("sp-example, sp-diff")).map((n) => () => drawCode(n)),
    ...prosePres.map((n) => () => enhanceProsePre(n)),
  ];
}

function runEnhance(initial = false) {
  const jobs = collectJobs(document);
  if (jobs.length === 0) {
    document.documentElement.dataset.drawn = "";
    return;
  }
  const target = initial && location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
  (function next() {
    for (const job of jobs.splice(0, 8)) {
      try { job(); } catch (error) { console.error("could not draw a block", error); }
    }
    if (jobs.length) setTimeout(next, 0);
    else {
      document.documentElement.dataset.drawn = "";
      if (target) requestAnimationFrame(() => target.scrollIntoView());
    }
  })();
}

function scheduleEnhance() {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    runEnhance(false);
  }, 40);
}

runEnhance(true);

// Re-enhance newly swapped blocks after Interactivity Router client-side navigations.
if (typeof MutationObserver !== "undefined" && document.body) {
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        scheduleEnhance();
        return;
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}
