import { collection, json, global, defineConfig, table, mutation } from "spacepress";
import { db } from "spacepress/server";
export const n = table({  });
export const settings = global({ stats: json<{ visits: number }>().optional() });
export const a = mutation({}, async () => { await db.globals.settings.update({ stats: 42 }); });

export default defineConfig({});
