import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "typedpress";
export const a = table({  }, { sync: "data/./items/*.json" });
export const b = table({  }, { sync: "data/items/*.json" });
export default defineConfig({});
