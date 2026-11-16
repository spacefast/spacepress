import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "typedpress";
export const notes = table({ x: text().optional() });
export const bad = job({ input: { code: text().unique().max(191).optional() }, handler: () => {} });

export default defineConfig({});
