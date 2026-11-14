import { collection, text, slug } from "first";

export const notes = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
}, { title: "title", drafts: true, url: "/notes/:slug", comments: true, access: { read: "anyone", create: "author", update: "editor", delete: "editor" } });

export const memos = collection({ title: text() }, { title: "title" });
