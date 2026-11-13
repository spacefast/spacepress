import { defineConfig, ref, table } from "first";
const a = table({  });
const b = table({ aId: ref(a).optional() }, { sync: "content/*.json" });
export default defineConfig({ tables: { a, b } });
