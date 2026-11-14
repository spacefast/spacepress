import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "first";
export const notes = table({ x: text().localized().unique().max(191).optional() });
export default defineConfig({ locales: { default: "en", all: ["en"] } });
