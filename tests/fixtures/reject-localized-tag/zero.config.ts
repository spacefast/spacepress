import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "zero";
const notes = table({ id: id(), x: text().localized() });
export default defineConfig({ tables: { notes }, locales: { default: "english", all: ["english"] } });
