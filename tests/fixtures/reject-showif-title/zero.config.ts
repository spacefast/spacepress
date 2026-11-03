import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db } from "zero";
const notes = collection({ id: id(), title: text().notNull().showIf({ title: "x" }) });
export default defineConfig({ collections: { notes },  });
