import { collection, f } from "spacepress";

export const notes = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }),
  summary: f.text().optional(),
  body: f.richText().optional(),
  cover: f.media().optional(),
  rank: f.integer().default(0),
  featured: f.boolean().default(false),
  // Only editors read it: anonymous readers get rows without it.
  memo: f.text().optional().access({ read: "editor" }),
}, { title: "title", content: "body", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

// A kind whose client key (`fieldNotes`) differs from its storage name (`field_notes`).
export const fieldNotes = collection({ title: f.text(), slug: f.slug({ source: "title" }), site: f.text() }, { title: "title", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
