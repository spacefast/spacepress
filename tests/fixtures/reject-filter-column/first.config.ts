import { collection, text, defineConfig, db, table } from "first";
const a = table({ name: text() });
export default defineConfig({
  tables: { a },
  hooks: { a: { async afterCreate(row) { await db.query.a.findMany({ where: { nmae: "x" } }); } } },
});
