import { collection, files, job, env, global, defineConfig, table, f } from "spacepress";
import { db } from "spacepress/server";
export const a = table({  }, { sync: "data/./items/*.json" });
export const b = table({  }, { sync: "data/items/*.json" });
export default defineConfig({});
