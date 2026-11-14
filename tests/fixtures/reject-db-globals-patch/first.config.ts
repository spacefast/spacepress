import { collection, json, global, defineConfig, action, db, table } from "first";
export const n = table({  });
export const settings = global({ stats: json<{ visits: number }>().optional() });
export const a = action({ input: {}, handler: async () => { await db.globals.settings.update({ stats: 42 }); } });

export default defineConfig({});
