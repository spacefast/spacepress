import { defineConfig, table, f } from "spacepress";
export const notes = table({ title: f.text() });
export default defineConfig({ name: "tableurl", permalinks: { notes: "/notes/:id" } });
