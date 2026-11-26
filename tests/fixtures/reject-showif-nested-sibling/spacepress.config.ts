import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, env, global, defineConfig, table } from "spacepress";
import { once, db } from "spacepress/server";
export const notes = table({ enabled: boolean().optional(), meta: group({ value: text().showIf({ enabled: true }).optional() }).optional() });
export default defineConfig({});
