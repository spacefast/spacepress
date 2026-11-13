import { action, db, defineConfig, integer, json, text, table, ref } from "first";
const owners = table({ name: text() });
const records = table({
  name: text(), ownerId: ref(owners),
  meta: json<{ count: number; tags: string[]; detail: { label: string } }>(),
});
const tables = { owners, records };
const entities = { ...tables };
export default defineConfig({ tables, actions: {
  report: action({ input: {}, access: "anyone", handler: async () => {
    const rows = await db.query.records.findMany({ with: { owner: true }, limit: 200 });
    return rows.map(row => ({ id: row.id, name: row.name, owner: row.owner, meta: row.meta }));
  } }),
} });
