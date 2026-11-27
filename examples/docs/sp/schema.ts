import { collection, f } from "spacepress";

// Each file under content/docs/ is one doc: its name is its slug, its folder its parent, and a
// folder's index.md the page the folder stands for. Editors change docs in wp-admin, and
// `spacepress sync` carries their edits back to these files.
export const docs = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }),
  content: f.richText().optional(),
  description: f.text().optional(),
}, { hierarchical: true, sync: "content/docs/**/*.md", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
