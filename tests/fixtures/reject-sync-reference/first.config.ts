import { defineConfig, ref, table } from "first";
export const a = table({  });
export const b = table({ aId: ref(a).optional() }, { sync: "content/*.json" });
export default defineConfig({});
