import { collection, text, slug, richText } from "typedpress";

// Each file under content/docs/ is one doc: its name is its slug, its folder its parent, and a
// folder's index.md the page the folder stands for. Editors change docs in wp-admin, and
// `typedpress sync` carries their edits back to these files.
export const docs = collection({
  title: text(),
  slug: slug({ source: "title" }),
  content: richText().optional(),
  description: text().optional(),
}, { hierarchical: true, url: "/docs/:path", sync: "content/docs/**/*.md", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
