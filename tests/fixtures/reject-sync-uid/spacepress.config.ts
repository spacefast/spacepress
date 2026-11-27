import { collection, files, job, env, global, defineConfig, table, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = table({ x: f.text().optional() }, { sync: "content/*.json", uid: false });
export default defineConfig({});
