import { collection, text, slug, richText } from "first";

export const notes = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
  body: richText().optional(),
}, { title: "title", content: "body", url: "/notes/:slug" });

export const journal = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
}, { title: "title", url: "/journal/:year/:slug" });
