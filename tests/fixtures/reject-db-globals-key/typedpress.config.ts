import { collection, text, global, defineConfig, db, table, mutation } from "typedpress";
export const n = table({  });
export const settings = global({ title: text().optional() });
export const a = mutation({}, async () => (await db.globals.setings.get()).title);

export default defineConfig({});
