import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "first";
export const notes = table({ x: text().optional() });
export default defineConfig({ media: { sizes: { thumb: { width: 300, fit: "cover" } } } });
