import { collection, global, defineConfig, table, mutation, f } from "spacepress";
import { db } from "spacepress/server";
export const n = table({  });
export const settings = global({ stats: f.json<{ visits: number }>().optional() });
export const a = mutation({}, async () => { await db.settings.update({ stats: 42 }); });

export default defineConfig({});
