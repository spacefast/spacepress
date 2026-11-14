import { defineConfig, table, text } from "first";
export const notes = table({ title: text() });
export default defineConfig({ hooks: { notes: { beforeCreate(data) { data.title = data.title.trim(); } } } });
