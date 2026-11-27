import { defineConfig, table, f } from "spacepress";
export const notes = table({ title: f.text() });
export default defineConfig({ hooks: { notes: { beforeCreate(data) { data.title = data.title.trim(); } } } });
