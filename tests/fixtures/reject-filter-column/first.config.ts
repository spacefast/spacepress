import { collection, text, defineConfig, db, table } from "first";
export const a = table({ name: text() }).on({ async afterCreate(row) { await db.query.a.findMany({ where: { nmae: "x" } }); } });
export default defineConfig({});
