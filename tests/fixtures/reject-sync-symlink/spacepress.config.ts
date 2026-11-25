import { collection, defineConfig, table } from "spacepress";
export const notes = table({  }, { sync: "content/*.json" });
export default defineConfig({});
