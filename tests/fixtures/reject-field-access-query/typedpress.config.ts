import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, once, env, global, defineConfig, db, table } from "typedpress";
export const notes = table({ x: text().access({ read: () => db.query.notes.findMany().length > 0 }).optional() });
export default defineConfig({});
