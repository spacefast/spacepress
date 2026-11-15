// Makes the pre-rendered file trees interactive: folders open and close, and in a project
// example a click on a file shows that file. Without this script every tree and file is
// still on the page; the files of an example are then shown one under another.
import { FileTree } from "@pierre/trees";

const configs = JSON.parse(document.getElementById("tp-trees")?.textContent ?? "{}");

for (const [id, config] of Object.entries(configs)) {
  const host = document.getElementById(id);
  if (!host) continue;
  const { notes, example, ...options } = config;
  const box = example ? host.closest(".tp-example") : null;
  const show = (path) => {
    if (!box) return;
    const panels = box.querySelectorAll(".tp-example-files > .tp-file");
    const target = [...panels].find((p) => p.dataset.path === path);
    if (!target) return;
    for (const p of panels) p.classList.toggle("tp-open", p === target);
  };
  try {
    const tree = new FileTree({
      ...options,
      renderRowDecoration: ({ item }) => (notes[item.path] ? { text: notes[item.path] } : null),
      onSelectionChange: (paths) => { if (paths.length === 1) show(paths[0]); },
    });
    tree.hydrate({ fileTreeContainer: host });
    if (box) box.classList.add("tp-live");
  } catch (error) {
    console.error("file tree", id, error);
  }
}
