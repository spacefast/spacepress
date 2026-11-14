import { collection, json, global, defineConfig, action, db, table } from "first";
const n = table({  });
const settings = global({ stats: json<{ visits: number }>().optional() });
export default defineConfig({ tables: { n }, globals: { settings }, actions: { a: action({ input: {}, handler: async () => { await db.globals.settings.update({ stats: 42 }); } }) } });
