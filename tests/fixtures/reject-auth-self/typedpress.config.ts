import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, once, env, global, defineConfig, db, table } from "typedpress";
export const notes = table({ x: text().optional() }, { access: { read: "self" } });
export default defineConfig({});
