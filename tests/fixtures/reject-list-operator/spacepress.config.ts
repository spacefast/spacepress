import { collection, text, select, defineConfig } from "spacepress";
import { db } from "spacepress/server";
export const posts = collection({ title: text(), tags: select(["a", "b"]).many().optional() }).on({ async afterCreate(row) { await db.query.posts.findMany({ where: { tags: { in: ["a"] } } }); } });
export default defineConfig({});
