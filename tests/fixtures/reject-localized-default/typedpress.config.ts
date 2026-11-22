import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, once, env, global, defineConfig, db, table } from "typedpress";
export const notes = table({ x: text().localized().optional() });
export default defineConfig({ locales: { default: "fr", all: ["en"] } });
