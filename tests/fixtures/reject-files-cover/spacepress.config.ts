import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, env, global, defineConfig, table } from "spacepress";
import { once, db } from "spacepress/server";
export const notes = table({ x: text().optional() });
export default defineConfig({ media: { sizes: { thumb: { width: 300, fit: "cover" } } } });
