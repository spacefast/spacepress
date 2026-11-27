import { collection, f } from "spacepress";

// Each file in content/plants/ is one plant. Editors change them in wp-admin, and `spacepress sync`
// carries their edits back to the files.
export const plants = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }),
  family: f.text(),
  summary: f.text().optional(),
  height: f.integer().optional(),
  body: f.richText().optional(),
}, { title: "title", content: "body", sync: "content/plants/*.md", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
