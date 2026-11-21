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

function fileOf(node) {
  const lang = node.getAttribute("lang");
  const name = node.getAttribute("file") ?? `snippet.${extension[lang] ?? lang ?? "ts"}`;
  const file = { name, contents: node.textContent.replace(/^\n+/, "").replace(/\n+$/, "") };
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
  const copy = Object.assign(document.createElement("button"), {
    type: "button",
    className: "tp-copy-btn",
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
  node.classList.add("tp-drawn");
}

function drawDiff(node) {
  const [before, after] = [...node.querySelectorAll(":scope > tp-code")].map(fileOf);
  if (!before || !after) return;
  node.replaceChildren();
  new FileDiff({ ...options, diffStyle: "unified", hunkSeparators: "simple" }).render({ oldFile: before, newFile: after, containerWrapper: node });
  node.classList.add("tp-drawn");
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
      const drawn = host.querySelector("file-tree-container")?.shadowRoot?.querySelectorAll('[role="treeitem"]').length;
      if (drawn) host.style.height = `${drawn * 24 + 8}px`;
    });
  }
}

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
  if (pre.classList.contains("tp-drawn")) return;
  const codeEl = pre.querySelector("code");
  const rawText = (codeEl ?? pre).textContent.replace(/^\n+/, "").replace(/\n+$/, "");
  const classes = `${pre.className} ${codeEl?.className ?? ""}`;
  const langMatch = classes.match(/\blanguage-([a-z0-9_-]+)\b/i);
  const lang = langMatch ? langMatch[1].toLowerCase() : null;

  if (lang === "tree" || isAsciiTree(rawText)) {
    const { paths, notes } = parseAsciiTree(rawText);
    if (paths.length > 0) {
      const host = document.createElement("tp-tree");
      pre.replaceWith(host);
      tree(host, paths, notes);
      host.classList.add("tp-drawn");
      return;
    }
  }

  const host = document.createElement("tp-code");
  if (lang) host.setAttribute("lang", lang);
  host.textContent = rawText;
  pre.replaceWith(host);
  drawCode(host);
}

let pendingTimer = null;

function collectJobs(root = document) {
  const prosePres = [...root.querySelectorAll(".sp-prose pre, pre.typedpress-code, pre.wp-block-code")]
    .filter((n) => !n.classList.contains("tp-drawn") && !n.closest("tp-code, tp-diff, tp-tree, tp-example, tp-sandbox, tp-play"));

  return [
    ...[...root.querySelectorAll("tp-example:not(.tp-drawn)")].map((n) => () => drawExample(n)),
    ...[...root.querySelectorAll("tp-diff:not(.tp-drawn)")].map((n) => () => drawDiff(n)),
    ...[...root.querySelectorAll("tp-tree:not(.tp-drawn)")].map((n) => () => drawTree(n)),
    ...[...root.querySelectorAll("tp-code:not(.tp-drawn)")].filter((n) => !n.closest("tp-example, tp-diff")).map((n) => () => drawCode(n)),
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
