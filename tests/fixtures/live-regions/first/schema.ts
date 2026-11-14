import { collection, text } from "first";

export const notes = collection({ title: text() }, { title: "title", drafts: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
