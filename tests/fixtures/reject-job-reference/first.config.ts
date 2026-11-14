import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table , ref } from "first";
export const notes = table({ x: text().optional() });
export const bad = job({ input: { id: ref(notes).optional() }, handler: () => {} });

export default defineConfig({});
