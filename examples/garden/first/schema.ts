import { collection, text, slug, richText, integer } from "first";

// Each file in content/plants/ is one plant. Editors change them in wp-admin, and `first sync`
// carries their edits back to the files.
export const plants = collection({
  title: text(),
  slug: slug({ source: "title" }),
  family: text(),
  summary: text().optional(),
  height: integer().optional(),
  body: richText().optional(),
}, { title: "title", content: "body", url: "/plants/:slug", sync: "content/plants/*.md", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
