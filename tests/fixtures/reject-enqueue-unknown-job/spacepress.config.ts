import { collection, text, files, job, env, global, defineConfig, table, mutation } from "spacepress";
import { once, db } from "spacepress/server";
export const notes = table({ x: text().optional() });
export const bad = mutation({}, async () => { await send.enqueue({}); });

export default defineConfig({});
