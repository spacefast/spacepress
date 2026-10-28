import { collection, id, text, defineConfig, db } from "zero";
const a = collection("a", { id: id(), name: text().notNull() });
export default defineConfig({
  schema: { a },
  hooks: { a: { async afterCreate(row) { await db.query.a.findMany({ where: { nmae: "x" } }); } } },
});
