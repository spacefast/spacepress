import { defineConfig, table, text } from "first";
export const notes = table({ code: text().primaryKey(), title: text() }, { sync: "content/*.json" });
export default defineConfig({});
