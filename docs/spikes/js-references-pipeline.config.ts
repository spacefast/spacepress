import { action, collection, db, defineConfig, defineRelations, id, integer, json, text } from "zero";
const owners = collection("owners", { id: id(), name: text().notNull() }, { editor: false });
const records = collection("records", {
  id: id(), name: text().notNull(), ownerId: integer().notNull().references(() => owners.id),
  meta: json().$type<{ count: number; tags: string[]; detail: { label: string } }>().notNull(),
}, { editor: false });
const schema = { owners, records };
const relations = defineRelations(schema, r => ({ records: { owner: r.one.owners({ from: r.records.ownerId, to: r.owners.id }) } }));
export default defineConfig({ schema, relations, actions: {
  report: action({ input: {}, access: "anyone", handler: async () => {
    const rows = await db.query.records.findMany({ with: { owner: true }, limit: 200 });
    return rows.map(row => ({ id: row.id, name: row.name, owner: row.owner, meta: row.meta }));
  } }),
} });
