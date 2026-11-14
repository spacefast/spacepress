import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db } from "first";
export const notes = collection({ title: text().showIf({ title: "x" }) });
export default defineConfig({});
