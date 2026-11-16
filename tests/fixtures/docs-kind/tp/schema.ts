import { collection, text, slug, richText } from "typedpress";

export const docs = collection({
  title: text(),
  slug: slug({ source: "title" }),
  content: richText().optional(),
  summary: text().optional(),
}, { hierarchical: true, url: "/docs/:path", sync: "content/docs/**/*.md" });
