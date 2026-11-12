import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "first";
const notes = table({ meta: group({ value: text().optional() }).optional(), x: text().showIf({ meta: null }).optional() });
export default defineConfig({ tables: { notes },  });
