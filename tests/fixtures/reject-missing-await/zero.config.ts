import { collection, id, text, defineConfig, db } from "zero";
const a = collection("a", { id: id(), name: text().notNull() }, { editor: false });
export default defineConfig({
  schema: { a },
  hooks: { a: { async afterCreate(row) { db.insert(a).values({ name: "x" }); } } },
});
