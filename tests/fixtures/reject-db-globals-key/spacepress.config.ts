import { collection, text, global, defineConfig, table, mutation } from "spacepress";
import { db } from "spacepress/server";
export const n = table({  });
export const settings = global({ title: text().optional() });
export const a = mutation({}, async () => (await db.globals.setings.get()).title);

export default defineConfig({});
