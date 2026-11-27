import { collection, f } from "spacepress";

export const notes = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }).optional(),
}, { title: "title", drafts: true, comments: true, access: { read: "anyone", create: "author", update: "editor", delete: "editor" } });

export const memos = collection({ title: f.text() }, { title: "title" });

// An authored policy: anyone may comment, nothing is held, replies are flat, and comments close
// 30 days after publishing.
export const notices = collection({ title: f.text() }, {
  title: "title", comments: { guests: true, moderation: "none", threaded: false, closeAfterDays: 30 },
  access: { read: "anyone", create: "author", update: "editor", delete: "editor" },
});
