import { collection, global, defineConfig, table, mutation, f } from "spacepress";
export const n = table({ meta: f.json().optional() });
export const settings = global({
  title: f.text().default("Hi"),
  stats: f.json<{ visits: number }>().optional(),
});
// Never written: defaults. Then a typed JSON field round-trips through update().
export const visit = mutation({}, async ({ db }) => {
  const before = await db.settings.get();
  const after = await db.settings.update({ stats: { visits: (before.stats?.visits ?? 0) + 1 } });
  return [before.title, before.stats, after.stats?.visits ?? null];
});

// A compiled filter on a json() column: `{}` is the empty object to compare with, not "no operators".
export const emptyMeta = mutation({}, async ({ db }) => {
  await db.n.create({ meta: {} });
  await db.n.create({ meta: [] });
  return (await db.n.list({ where: { meta: {} } })).map((r) => JSON.stringify(r.meta));
});

export default defineConfig({});
