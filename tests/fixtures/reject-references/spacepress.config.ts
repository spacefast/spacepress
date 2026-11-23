import { defineConfig, integer, table, text } from "spacepress";
export const notes = table({ title: text() });
export const tags = table({ noteId: integer().references(() => notes.id) });
export default defineConfig({});
