import { collection, id, text, defineConfig, db } from "zero";
const a = collection("a", { id: id(), name: text().notNull(), x: text().notNull() });
export default defineConfig({
  schema: { a },
  hooks: { a: { async afterCreate(row) { await db.insert(a).values({ name: "x" }); } } },
});
