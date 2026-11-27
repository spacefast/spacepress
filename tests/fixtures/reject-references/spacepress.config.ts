import { defineConfig, table, f } from "spacepress";
export const notes = table({ title: f.text() });
export const tags = table({ noteId: f.integer().references(() => notes.id) });
export default defineConfig({});
