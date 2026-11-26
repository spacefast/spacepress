import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, once, env, global, defineConfig, db, table } from "spacepress";
export const a = table({  }, { sync: "data/./items/*.json" });
export const b = table({  }, { sync: "data/items/*.json" });
export default defineConfig({});
