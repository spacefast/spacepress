import { ref, table, text } from "spacepress";
export const notes = table({ title: text(), tags: text().optional() });
export const tags = table({ noteId: ref(notes) });
