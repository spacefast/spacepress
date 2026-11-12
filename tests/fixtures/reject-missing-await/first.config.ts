import { collection, text, defineConfig, db, table } from "first";
const a = table({ name: text() });
export default defineConfig({
  tables: { a },
  hooks: { a: { async afterCreate(row) { db.insert(a).values({ name: "x" }); } } },
});
