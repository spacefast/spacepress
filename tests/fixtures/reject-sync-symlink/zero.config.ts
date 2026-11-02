import { collection, id, defineConfig, table } from "zero";
const notes = table({ id: id() }, { sync: "content/*.json" });
export default defineConfig({ tables: { notes } });
