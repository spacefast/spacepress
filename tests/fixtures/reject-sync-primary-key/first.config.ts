import { defineConfig, table, text } from "first";
const notes = table({ code: text().primaryKey(), title: text() }, { sync: "content/*.json" });
export default defineConfig({ tables: { notes } });
