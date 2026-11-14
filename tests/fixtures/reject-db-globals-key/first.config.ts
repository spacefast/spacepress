import { collection, text, global, defineConfig, action, db, table } from "first";
export const n = table({  });
export const settings = global({ title: text().optional() });
export const a = action({ input: {}, handler: async () => (await db.globals.setings.get()).title });

export default defineConfig({});
