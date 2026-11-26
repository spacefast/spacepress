import { collection, text, files, job, once, env, global, defineConfig, db, table, mutation } from "spacepress";
export const notes = table({ x: text().optional() });
export const bad = mutation({}, async () => { await send.enqueue({}); });

export default defineConfig({});
