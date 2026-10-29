import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db } from "zero";
const notes = collection("notes", { id: id(), meta: group({ fields: { value: text() } }), x: text().showIf({ meta: null }) }, { editor: false });
export default defineConfig({ schema: { notes },  });
