import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table , ref } from "first";
const notes = table({ x: text().optional() });
export default defineConfig({ tables: { notes }, jobs: { bad: job({ input: { id: ref(notes).optional() }, handler: () => {} }) } });
