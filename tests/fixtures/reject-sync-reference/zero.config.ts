import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db } from "zero";
const a = collection("a", { id: id() }, { editor: false });
const b = collection("b", { id: id(), aId: integer().references(() => a.id) }, { editor: false, sync: "content/*.json" });
export default defineConfig({ schema: { a, b } });
