import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db } from "zero";
const notes = collection("notes", { id: id(), x: text() }, { editor: false });
export default defineConfig({ schema: { notes }, jobs: { bad: job({ input: { code: text().unique().max(191) }, handler: () => {} }) } });
