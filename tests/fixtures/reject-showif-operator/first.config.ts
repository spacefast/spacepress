import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "first";
export const notes = table({ x: text().showIf({ x: { gt: "a" } }).optional() });
export default defineConfig({});
