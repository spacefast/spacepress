// The docs collection: one record per Markdown file under the sync folder. A file's name is its
// slug, its folder its parent, and a folder's index.md the page the folder stands for.
import { collection, f } from "spacepress";

export interface DocsCollectionOptions {
  label?: string;
  /** The Markdown files `spacepress sync` keeps the collection equal to. */
  sync?: `${string}/**/*.md`;
}

export function createDocsCollection(options: DocsCollectionOptions = {}) {
  return collection(
    {
      title: f.text(),
      slug: f.slug({ source: "title" }),
      content: f.richText().optional(),
      description: f.text().optional(),
    },
    {
      label: options.label ?? "Docs",
      hierarchical: true,
      sync: options.sync ?? "content/docs/**/*.md",
      access: { read: "anyone", create: "editor", update: "editor", delete: "editor" },
    },
  );
}
