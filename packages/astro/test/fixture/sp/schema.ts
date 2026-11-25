import { collection, text, slug, richText, media, integer, boolean } from "spacepress";

export const notes = collection({
  title: text(),
  slug: slug({ source: "title" }),
  summary: text().optional(),
  body: richText().optional(),
  cover: media().optional(),
  rank: integer().default(0),
  featured: boolean().default(false),
  // Only editors read it: anonymous readers get rows without it.
  memo: text().optional().access({ read: "editor" }),
}, { title: "title", content: "body", url: "/notes/:slug", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

// A kind whose client key (`fieldNotes`) differs from its storage name (`field_notes`).
export const fieldNotes = collection({ title: text(), slug: slug({ source: "title" }), site: text() }, { title: "title", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
