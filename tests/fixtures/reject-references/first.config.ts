import { defineConfig, integer, table, text } from "first";
const notes = table({ title: text() });
const tags = table({ noteId: integer().references(() => notes.id) });
export default defineConfig({ tables: { notes, tags } });
