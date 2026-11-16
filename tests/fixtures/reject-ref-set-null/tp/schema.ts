import { ref, table, text } from "typedpress";
export const notes = table({ title: text() });
export const tags = table({ noteId: ref(notes).onDelete("setNull") });
