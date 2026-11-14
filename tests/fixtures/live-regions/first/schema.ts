import { collection, slug, text } from "first";

export const notes = collection({ title: text(), slug: slug({ source: "title" }).optional() }, { title: "title", drafts: true, url: "/notes/:slug", comments: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
