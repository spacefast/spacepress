import { collection, text, defineConfig, table } from "zero";
const notes = table({ code: text().primaryKey(), title: text() }, { sync: "content/*.json" });
export default defineConfig({ tables: { notes } });
