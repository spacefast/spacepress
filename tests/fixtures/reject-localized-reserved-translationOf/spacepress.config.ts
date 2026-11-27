import { collection, files, job, env, global, defineConfig, table, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = table({ translationOf: f.text().optional() });
export default defineConfig({});
