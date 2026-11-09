import { collection, text, defineConfig, table } from "first";
const notes = table({ code: text().primaryKey(), title: text() }, { sync: "content/*.json" });
export default defineConfig({ tables: { notes } });
