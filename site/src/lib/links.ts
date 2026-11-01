// A remark plugin for the docs: the repository's relative links become links that work on the site.
// `wp-plugins.md` and `docs/wp-plugins.md` go to the doc's page; `../examples/...`, `../tests/...`,
// `LICENSE` and the like go to the file on GitHub; `#anchor` and absolute URLs stay.
import type { Link, Root } from "mdast";
import { visit } from "unist-util-visit";

const github = "https://github.com/spacefast/zero/blob/main";

export interface Options {
  /** The site's base path, no trailing slash. */
  base: string;
  /** The file's own repository path, e.g. `docs/config-api.md` or `README.md`. */
  from: string;
}

/** The site URL for a repository-relative link target, or the GitHub URL for anything else. */
export function rewrite(target: string, { base, from }: Options): string {
  if (/^[a-z]+:/i.test(target) || target.startsWith("#") || target === "") return target;
  const [path, hash = ""] = target.split("#", 2) as [string, string?];
  const anchor = hash ? `#${hash}` : "";
  // Resolve against the linking file's directory, repository-relative.
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const parts = [...(dir ? dir.split("/") : []), ...path.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  const resolved = out.join("/");
  const doc = /^docs\/([a-z0-9-]+)\.md$/.exec(resolved);
  if (doc && !doc[1]!.startsWith("design-") && !doc[1]!.startsWith("research-")) return `${base}/docs/${doc[1]}${anchor}`;
  if (resolved === "README.md") return `${base}/docs${anchor}`;
  return `${github}/${resolved}${anchor}`;
}

/** remark plugin; Astro passes the file's path via `file.path`. */
export function remarkRepoLinks(options: { base: string; repo: string }) {
  return (tree: Root, file: { path?: string }) => {
    const path = file.path ?? "";
    const from = path.startsWith(options.repo + "/") ? path.slice(options.repo.length + 1) : path;
    visit(tree, "link", (node: Link) => {
      node.url = rewrite(node.url, { base: options.base, from });
    });
  };
}
