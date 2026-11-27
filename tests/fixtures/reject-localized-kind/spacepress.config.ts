import { collection, files, job, env, global, defineConfig, table, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = table({ n: f.integer().localized().optional() });
export default defineConfig({ locales: { default: "en", all: ["en"] } });
