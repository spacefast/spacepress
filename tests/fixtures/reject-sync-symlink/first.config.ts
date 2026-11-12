import { collection, defineConfig, table } from "first";
const notes = table({  }, { sync: "content/*.json" });
export default defineConfig({ tables: { notes } });
