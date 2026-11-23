import { collection, json, global, defineConfig, db, table, mutation } from "spacepress";
export const n = table({  });
export const settings = global({ stats: json<{ visits: number }>().optional() });
export const a = mutation({}, async () => { await db.globals.settings.update({ stats: 42 }); });

export default defineConfig({});
