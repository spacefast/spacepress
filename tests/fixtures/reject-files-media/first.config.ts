import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "first";
const notes = table({ id: id(), x: text() });
export default defineConfig({ tables: { notes }, files: { media: files("media", { accept: ["image/*"], maxBytes: 100 }) } });
