import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db } from "zero";
const a = collection("a", { id: id(), email: email().notNull().unique().max(191) }, { auth: true });
const b = collection("b", { id: id(), email: email().notNull().unique().max(191) }, { auth: true });
export default defineConfig({ schema: { a, b } });
