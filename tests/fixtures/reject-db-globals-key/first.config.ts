import { collection, text, global, defineConfig, action, db, table } from "first";
const n = table({  });
const settings = global("settings", { title: text().optional() });
export default defineConfig({ tables: { n }, globals: { settings }, actions: { a: action({ input: {}, handler: async () => (await db.globals.setings.get()).title }) } });
