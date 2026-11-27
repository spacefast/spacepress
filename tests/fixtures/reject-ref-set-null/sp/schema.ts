import { table, f } from "spacepress";
export const notes = table({ title: f.text() });
export const tags = table({ noteId: f.ref(notes).onDelete("setNull") });
