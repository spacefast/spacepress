import { collection, text, defineConfig, db, table } from "spacepress";
export const a = table({ name: text() }).on({ async afterCreate(row) { db.insert(a).values({ name: "x" }); } });
export default defineConfig({});
