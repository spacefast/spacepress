import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "typedpress";
export const notes = table({ x: text().optional() });
export const bad = action({ input: {}, handler: async () => await once(42, () => true) });

export default defineConfig({});
