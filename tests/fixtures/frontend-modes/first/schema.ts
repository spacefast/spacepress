import { collection, text, slug, richText } from "first";

export const notes = collection({
  title: text().notNull(),
  slug: slug({ source: "title" }),
  body: richText(),
}, { title: "title", content: "body", url: "/notes/:slug" });

export const journal = collection({
  title: text().notNull(),
  slug: slug({ source: "title" }),
}, { title: "title", url: "/journal/:year/:slug" });
