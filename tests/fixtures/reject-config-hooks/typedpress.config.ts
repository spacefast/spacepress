import { defineConfig, table, text } from "typedpress";
export const notes = table({ title: text() });
export default defineConfig({ hooks: { notes: { beforeCreate(data) { data.title = data.title.trim(); } } } });
