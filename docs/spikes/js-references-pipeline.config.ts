import { action, db, defineConfig, defineRelations, id, integer, json, text, table } from "first";
const owners = table({ id: id(), name: text().notNull() });
const records = table({
  id: id(), name: text().notNull(), ownerId: integer().notNull().references(() => owners.id),
  meta: json().$type<{ count: number; tags: string[]; detail: { label: string } }>().notNull(),
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
