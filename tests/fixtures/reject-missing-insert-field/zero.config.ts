import { collection, id, text, defineConfig, db, table } from "zero";
const a = table({ id: id(), name: text().notNull(), x: text().notNull() });
export default defineConfig({
  tables: { a },
  hooks: { a: { async afterCreate(row) { await db.insert(a).values({ name: "x" }); } } },
});
