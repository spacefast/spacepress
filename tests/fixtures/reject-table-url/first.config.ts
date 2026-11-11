import { defineConfig, table, text } from "first";
export const notes = table({ title: text().notNull() }, { url: "/notes/:id" });
export default defineConfig({ name: "tableurl", tables: { notes } });
