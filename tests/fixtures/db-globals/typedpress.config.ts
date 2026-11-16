import { collection, text, integer, json, global, defineConfig, action, db, table } from "typedpress";
export const n = table({ meta: json().optional() });
export const settings = global({
  title: text().default("Hi"),
  stats: json<{ visits: number }>().optional(),
});
// Never written: defaults. Then a typed JSON field round-trips through update().
export const visit = action({ input: {}, handler: async () => {
  const before = await db.globals.settings.get();
  const after = await db.globals.settings.update({ stats: { visits: (before.stats?.visits ?? 0) + 1 } });
  return [before.title, before.stats, after.stats?.visits ?? null];
} });

// A compiled filter on a json() column: `{}` is the empty object to compare with, not "no operators".
export const emptyMeta = action({ input: {}, handler: async () => {
  await db.insert(n).values([{ meta: {} }, { meta: [] }]);
  return (await db.query.n.findMany({ where: { meta: {} } })).map((r) => JSON.stringify(r.meta));
} });

export default defineConfig({});
