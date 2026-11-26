import { collection, text, defineConfig, table } from "spacepress";
import { db } from "spacepress/server";
export const a = table({ name: text() }).on({ async afterCreate(row) { db.insert(a).values({ name: "x" }); } });
export default defineConfig({});
