import { collection, files, job, env, global, defineConfig, table, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = table({ x: f.text().showIf({ absent: true }).optional() });
export default defineConfig({});
