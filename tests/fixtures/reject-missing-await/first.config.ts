import { collection, text, defineConfig, db, table } from "first";
export const a = table({ name: text() }).on({ async afterCreate(row) { db.insert(a).values({ name: "x" }); } });
export default defineConfig({});
