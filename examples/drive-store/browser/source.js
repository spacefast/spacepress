import { File } from "@pierre/diffs";
import { FileTree } from "@pierre/trees";

const theme = { light: "pierre-light", dark: "pierre-dark" };
const output = document.querySelector("#drive-source-code");
const tree = document.querySelector("#drive-source-files");
const viewer = document.querySelector("#drive-source-viewer");
const status = document.querySelector("#drive-source-status");

function showSource() {
  const files = new Map(__DRIVE_SOURCE_FILES__);
  const paths = [...files.keys()];
  const requested = new URLSearchParams(location.search).get("file");
  const first = files.has(requested) ? requested : "tp/schema.ts";
  const code = new File({ theme, themeType: "system", overflow: "scroll" });

  function show(path) {
    output.scrollTop = 0;
    code.render({ file: { name: path, contents: files.get(path) }, containerWrapper: output });
  }

  const fileTree = new FileTree({
    paths,
    density: "compact",
    stickyFolders: false,
    icons: { set: "complete", colored: true },
    initialExpansion: "open",
    initialSelectedPaths: [first],
    onSelectionChange(picked) {
      const [path] = picked;
      if (picked.length !== 1 || !files.has(path)) return;
      show(path);
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
  show(first);
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
