import { collection, text, slug, richText } from "first";

export const docs = collection({
  title: text(),
  slug: slug({ source: "title" }),
  content: richText().optional(),
}, { hierarchical: true, url: "/:path", sync: "content/docs/**/*.md" });
