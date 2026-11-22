import { collection, text, files, job, once, env, global, defineConfig, db, table, mutation } from "typedpress";
export const notes = table({ x: text().optional() });
export const notesList = mutation({}, () => true);

export default defineConfig({});
