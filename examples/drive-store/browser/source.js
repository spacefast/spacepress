import { FileTree } from "@pierre/trees";
import { files } from "drive-source-previews";

const output = document.querySelector("#drive-source-code");
const tree = document.querySelector("#drive-source-files");
const viewer = document.querySelector("#drive-source-viewer");
const status = document.querySelector("#drive-source-status");

function showSource() {
  const defaultPath = __DRIVE_SOURCE_DEFAULT__;
  const requested = new URLSearchParams(location.search).get("file");
  const first = files.has(requested) ? requested : defaultPath;

  const code = document.createElement("diffs-container");
  const shadow = code.attachShadow({ mode: "open" });
  shadow.innerHTML = __DRIVE_SOURCE_SHARED_HTML__;
  output.append(code);
  let currentRequest = 0;

  function replacePreview(content) {
    shadow.querySelector("[data-diffs-header]")?.remove();
    shadow.querySelector("pre")?.remove();
    if (content) shadow.append(content);
  }

  async function show(path) {
    const request = ++currentRequest;
    status.hidden = true;
    output.setAttribute("aria-busy", "true");
    try {
      const load = files.get(path);
      const html = load ? (await load()).default : __DRIVE_SOURCE_DEFAULT_HTML__;
      if (request !== currentRequest) return;

      const preview = document.createElement("template");
      preview.innerHTML = html;
      replacePreview(preview.content);
      output.scrollTop = 0;
    } catch {
      if (request !== currentRequest) return;
      replacePreview();
      status.hidden = false;
      status.textContent = "This file could not load. Select another file or use the repository link.";
    } finally {
      if (request === currentRequest) output.removeAttribute("aria-busy");
    }
  }

  const fileTree = new FileTree({
    paths: [...files.keys()],
    density: "compact",
    stickyFolders: false,
    icons: { set: "complete", colored: true },
    initialExpansion: "open",
    initialSelectedPaths: [first],
    onSelectionChange(picked) {
      const [path] = picked;
      if (picked.length !== 1 || !files.has(path)) return;
      void show(path);
      const url = new URL(location.href);
      url.searchParams.set("file", path);
      history.replaceState(history.state, "", url);
    },
  });

  viewer.hidden = false;
  fileTree.render({ containerWrapper: tree });
  tree.querySelector("file-tree-container")?.shadowRoot
    ?.querySelector('[role="tree"]')?.setAttribute("aria-label", "Project files");
  if (requested === first) fileTree.scrollToPath(first);
  void show(first);
}

if (viewer) {
  try {
    showSource();
  } catch {
    viewer.hidden = true;
    status.hidden = false;
    status.textContent = "The source viewer could not load. Use the repository link to browse the files.";
  }
}
