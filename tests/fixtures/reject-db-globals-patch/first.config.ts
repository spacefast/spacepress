import { collection, id, json, global, defineConfig, action, db, table } from "first";
const n = table({ id: id() });
const settings = global("settings", { stats: json().$type<{ visits: number }>() });
export default defineConfig({ tables: { n }, globals: { settings }, actions: { a: action({ input: {}, handler: async () => { await db.globals.settings.update({ stats: 42 }); } }) } });
