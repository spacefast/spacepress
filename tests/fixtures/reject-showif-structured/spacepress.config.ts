import { collection, files, job, env, global, defineConfig, table, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = table({ meta: f.group({ value: f.text().optional() }).optional(), x: f.text().showIf({ meta: null }).optional() });
export default defineConfig({});
