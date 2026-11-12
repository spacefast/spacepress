import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "first";
const a = table({  });
const b = table({ aId: integer().references(() => a.id).optional() }, { sync: "content/*.json" });
export default defineConfig({ tables: { a, b } });
