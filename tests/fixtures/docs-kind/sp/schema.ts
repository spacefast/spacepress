import { collection, f } from "spacepress";

export const docs = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }),
  content: f.richText().optional(),
  summary: f.text().optional(),
}, { hierarchical: true, sync: "content/docs/**/*.md" });
