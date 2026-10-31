import { collection, id, json, global, defineConfig, action, db } from "zero";
const n = collection("n", { id: id() }, { editor: false });
const settings = global("settings", { stats: json().$type<{ visits: number }>() });
export default defineConfig({ schema: { n }, globals: { settings }, actions: { a: action({ input: {}, handler: async () => { await db.globals.settings.update({ stats: 42 }); } }) } });
