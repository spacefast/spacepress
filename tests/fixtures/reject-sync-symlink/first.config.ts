import { collection, defineConfig, table } from "first";
export const notes = table({  }, { sync: "content/*.json" });
export default defineConfig({});
