import { collection, text, slug } from "first";

export const notes = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
}, { title: "title", drafts: true, url: "/notes/:slug", comments: true, access: { read: "anyone", create: "author", update: "editor", delete: "editor" } });

export const memos = collection({ title: text() }, { title: "title" });

// An authored policy: anyone may comment, nothing is held, replies are flat, and comments close
// 30 days after publishing.
export const notices = collection({ title: text() }, {
  title: "title", comments: { guests: true, moderation: "none", threaded: false, closeAfterDays: 30 },
  access: { read: "anyone", create: "author", update: "editor", delete: "editor" },
});
