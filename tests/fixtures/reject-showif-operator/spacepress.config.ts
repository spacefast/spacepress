import { collection, files, job, env, global, defineConfig, table, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = table({ x: f.text().showIf({ x: { gt: "a" } }).optional() });
export default defineConfig({});
