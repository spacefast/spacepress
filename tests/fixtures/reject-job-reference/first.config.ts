import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "first";
const notes = table({ x: text().optional() });
export default defineConfig({ tables: { notes }, jobs: { bad: job({ input: { id: integer().references(() => notes.id).optional() }, handler: () => {} }) } });
