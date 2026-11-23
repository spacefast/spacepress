import { defineConfig, table, text } from "spacepress";
export const notes = table({ title: text() }, { url: "/notes/:id" });
export default defineConfig({ name: "tableurl" });
