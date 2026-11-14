import { collection, text, defineConfig, db, table } from "first";
export const a = table({ name: text(), x: text() }).on({ async afterCreate(row) { await db.insert(a).values({ name: "x" }); } });
export default defineConfig({});
