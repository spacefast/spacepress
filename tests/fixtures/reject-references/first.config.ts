import { defineConfig, integer, table, text } from "first";
export const notes = table({ title: text() });
export const tags = table({ noteId: integer().references(() => notes.id) });
export default defineConfig({});
