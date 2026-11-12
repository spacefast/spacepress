import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "first";
const a = table({  }, { sync: "data/./items/*.json" });
const b = table({  }, { sync: "data/items/*.json" });
export default defineConfig({ tables: { a, b } });
