import { collection, text, defineConfig, table } from "spacepress";
import { db } from "spacepress/server";
export const a = table({ name: text(), x: text() }).on({ async afterCreate(row) { await db.insert(a).values({ name: "x" }); } });
export default defineConfig({});
