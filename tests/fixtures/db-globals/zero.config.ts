import { collection, id, text, integer, json, global, defineConfig, action, db } from "zero";
const n = collection("n", { id: id() }, { editor: false });
const settings = global("settings", {
  title: text().notNull().default("Hi"),
  stats: json().$type<{ visits: number }>(),
});
export default defineConfig({
  schema: { n },
  globals: { settings },
  actions: {
    // Never written: defaults. Then a typed JSON field round-trips through update().
    visit: action({ input: {}, handler: async () => {
      const before = await db.globals.settings.get();
      const after = await db.globals.settings.update({ stats: { visits: (before.stats?.visits ?? 0) + 1 } });
      return [before.title, before.stats, after.stats?.visits ?? null];
    } }),
  },
});
