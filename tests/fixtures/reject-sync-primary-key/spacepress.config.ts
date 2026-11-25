import { defineConfig, table, text } from "spacepress";
export const notes = table({ code: text().primaryKey(), title: text() }, { sync: "content/*.json" });
export default defineConfig({});
