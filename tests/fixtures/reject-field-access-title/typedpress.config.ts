import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, once, env, global, defineConfig, db } from "typedpress";
export const notes = collection({ title: text().access({ read: false }) });
export default defineConfig({});
