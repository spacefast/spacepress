import { collection, files, job, env, global, defineConfig, table, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = table({ enabled: f.boolean().optional(), meta: f.group({ value: f.text().showIf({ enabled: true }).optional() }).optional() });
export default defineConfig({});
