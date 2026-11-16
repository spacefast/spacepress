import { collection, defineConfig, table } from "typedpress";
export const notes = table({  }, { sync: "content/*.json" });
export default defineConfig({});
