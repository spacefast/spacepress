import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db } from "zero";
const notes = collection("notes", { id: id(), x: text().access({ read: async () => (await db.query.notes.findMany()).length > 0 }) }, { editor: false });
export default defineConfig({ schema: { notes },  });
