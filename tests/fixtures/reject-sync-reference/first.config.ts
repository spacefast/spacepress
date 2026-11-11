import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "first";
const a = table({ id: id() });
const b = table({ id: id(), aId: integer().references(() => a.id) }, { sync: "content/*.json" });
export default defineConfig({ tables: { a, b } });
