import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db } from "zero";
const notes = collection("notes", { id: id(), email: email().notNull().unique().max(191), handle: slug() }, { auth: true });
export default defineConfig({ schema: { notes },  });
