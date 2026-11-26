// The docs collection: one record per Markdown file under the sync folder. A file's name is its
// slug, its folder its parent, and a folder's index.md the page the folder stands for.
import { type AnyCollection, collection, richText, slug, text } from "spacepress";

export interface DocsCollectionOptions {
  label?: string;
  /** Where each doc is served. `:path` is the parent chain, so `/docs/:path` serves `/docs/guides/install`. */
  url?: `/${string}`;
  /** The Markdown files `spacepress sync` keeps the collection equal to. */
  sync?: `${string}/**/*.md`;
}

export function createDocsCollection(options: DocsCollectionOptions = {}): AnyCollection {
  return collection(
    {
      title: text(),
      slug: slug({ source: "title" }),
      content: richText().optional(),
      description: text().optional(),
    },
    {
      label: options.label ?? "Docs",
      hierarchical: true,
      url: options.url ?? "/docs/:path",
      sync: options.sync ?? "content/docs/**/*.md",
      access: { read: "anyone", create: "editor", update: "editor", delete: "editor" },
    },
  );
}
