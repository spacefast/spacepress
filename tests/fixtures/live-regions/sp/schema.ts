import { collection, table, f } from "spacepress";

export const notes = collection({ title: f.text(), slug: f.slug({ source: "title" }).optional() }, { title: "title", drafts: true, comments: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

// Anyone may sign: a browser test writes as another visitor and watches the board's region.
export const signatures = table({ name: f.text() }, { access: { read: "anyone", create: "anyone", update: "admin", delete: "admin" } });
