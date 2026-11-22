import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, once, env, global, defineConfig, db, table } from "typedpress";
export const notes = table({ meta: group({ value: text().optional() }).optional(), x: text().showIf({ meta: null }).optional() });
export default defineConfig({});
