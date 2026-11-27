import { defineConfig, table, f } from "spacepress";
export const a = table({  });
export const b = table({ aId: f.ref(a).optional() }, { sync: "content/*.json" });
export default defineConfig({});
