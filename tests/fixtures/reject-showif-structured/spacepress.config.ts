import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, env, global, defineConfig, table } from "spacepress";
import { once, db } from "spacepress/server";
export const notes = table({ meta: group({ value: text().optional() }).optional(), x: text().showIf({ meta: null }).optional() });
export default defineConfig({});
