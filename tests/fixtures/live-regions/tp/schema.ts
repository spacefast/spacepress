import { collection, slug, table, text } from "typedpress";

export const notes = collection({ title: text(), slug: slug({ source: "title" }).optional() }, { title: "title", drafts: true, url: "/notes/:slug", comments: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

// Anyone may sign: a browser test writes as another visitor and watches the board's region.
export const signatures = table({ name: text() }, { access: { read: "anyone", create: "anyone", update: "admin", delete: "admin" } });
