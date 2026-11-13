import { ref, table, text } from "first";
export const notes = table({ title: text() });
export const tags = table({ noteId: ref(notes).onDelete("setNull") });
