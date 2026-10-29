import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db } from "zero";
const a = collection("a", { id: id() }, { editor: false, sync: "data/./items/*.json" });
const b = collection("b", { id: id() }, { editor: false, sync: "data/items/*.json" });
export default defineConfig({ schema: { a, b } });
