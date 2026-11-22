import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, once, env, global, defineConfig, db, table } from "typedpress";
export const notes = table({ enabled: boolean().optional(), meta: group({ value: text().showIf({ enabled: true }).optional() }).optional() });
export default defineConfig({});
