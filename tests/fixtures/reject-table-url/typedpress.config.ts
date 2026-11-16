import { defineConfig, table, text } from "typedpress";
export const notes = table({ title: text() }, { url: "/notes/:id" });
export default defineConfig({ name: "tableurl" });
