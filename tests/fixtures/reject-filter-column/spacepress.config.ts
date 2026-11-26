import { collection, text, defineConfig, table } from "spacepress";
import { db } from "spacepress/server";
export const a = table({ name: text() }).on({ async afterCreate(row) { await db.query.a.findMany({ where: { nmae: "x" } }); } });
export default defineConfig({});
