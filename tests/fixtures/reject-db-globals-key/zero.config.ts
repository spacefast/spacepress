import { collection, id, text, global, defineConfig, action, db } from "zero";
const n = collection("n", { id: id() }, { editor: false });
const settings = global("settings", { title: text() });
export default defineConfig({ schema: { n }, globals: { settings }, actions: { a: action({ input: {}, handler: async () => (await db.globals.setings.get()).title }) } });
