import { collection, id, text, global, defineConfig, action, db, table } from "zero";
const n = table({ id: id() });
const settings = global("settings", { title: text() });
export default defineConfig({ tables: { n }, globals: { settings }, actions: { a: action({ input: {}, handler: async () => (await db.globals.setings.get()).title }) } });
