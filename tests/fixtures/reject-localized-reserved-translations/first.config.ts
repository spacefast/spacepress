import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "first";
export const notes = table({ translations: text().optional() });
export default defineConfig({});
