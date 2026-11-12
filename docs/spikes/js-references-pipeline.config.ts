import { action, db, defineConfig, defineRelations, integer, json, text, table } from "first";
const owners = table({ name: text() });
const records = table({
  name: text(), ownerId: integer().references(() => owners.id),
  meta: json<{ count: number; tags: string[]; detail: { label: string } }>(),
});
const tables = { owners, records };
const entities = { ...tables };
const relations = defineRelations(entities, r => ({ records: { owner: r.one.owners({ from: r.records.ownerId, to: r.owners.id }) } }));
export default defineConfig({ tables, relations, actions: {
  report: action({ input: {}, access: "anyone", handler: async () => {
    const rows = await db.query.records.findMany({ with: { owner: true }, limit: 200 });
    return rows.map(row => ({ id: row.id, name: row.name, owner: row.owner, meta: row.meta }));
  } }),
} });
