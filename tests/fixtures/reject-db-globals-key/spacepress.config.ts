import { collection, global, defineConfig, table, mutation, f } from "spacepress";
import { db } from "spacepress/server";
export const n = table({  });
export const settings = global({ title: f.text().optional() });
export const a = mutation({}, async () => (await db.setings.get()).title);

export default defineConfig({});
