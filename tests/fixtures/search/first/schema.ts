import { collection, richText, text, slug } from "first";

export const notes = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
  body: richText().optional(),
  // Editors only: a match here must never find the row for anyone else.
  secret: text({ multiline: true }).optional().access({ read: "editor" }),
}, { title: "title", content: "body", drafts: true, url: "/notes/:slug", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const guides = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
}, { title: "title", url: "/guides/:slug", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

// Searchable, but no URL: site-wide results leave it out.
export const memos = collection({ title: text() }, { title: "title", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
