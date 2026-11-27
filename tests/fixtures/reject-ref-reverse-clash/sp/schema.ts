import { table, f } from "spacepress";
export const notes = table({ title: f.text(), tags: f.text().optional() });
export const tags = table({ noteId: f.ref(notes) });
