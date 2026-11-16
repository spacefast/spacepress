import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "typedpress";
export const notes = table({ n: integer().localized().optional() });
export default defineConfig({ locales: { default: "en", all: ["en"] } });
