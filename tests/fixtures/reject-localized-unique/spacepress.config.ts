import { collection, files, job, env, global, defineConfig, table, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = table({ x: f.text().localized().unique().max(191).optional() });
export default defineConfig({ locales: { default: "en", all: ["en"] } });
