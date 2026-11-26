import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, once, env, global, defineConfig, db, table } from "spacepress";
export const notes = table({ x: text().access({ read: () => ({ x: "private" }) }).optional() });
export default defineConfig({});
