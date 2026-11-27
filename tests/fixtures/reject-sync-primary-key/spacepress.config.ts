import { defineConfig, table, f } from "spacepress";
export const notes = table({ code: f.text().primaryKey(), title: f.text() }, { sync: "content/*.json" });
export default defineConfig({});
