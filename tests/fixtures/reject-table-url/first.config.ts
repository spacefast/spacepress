import { defineConfig, table, text } from "first";
export const notes = table({ title: text() }, { url: "/notes/:id" });
export default defineConfig({ name: "tableurl", tables: { notes } });
