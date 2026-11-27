import { collection, f } from "spacepress";

export const notes = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }).optional(),
  body: f.richText().optional(),
  // Editors only: a match here must never find the row for anyone else.
  secret: f.text({ multiline: true }).optional().access({ read: "editor" }),
}, { title: "title", content: "body", drafts: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const guides = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }).optional(),
}, { title: "title", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

// Searchable, but no URL: site-wide results leave it out.
export const memos = collection({ title: f.text() }, { title: "title", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
