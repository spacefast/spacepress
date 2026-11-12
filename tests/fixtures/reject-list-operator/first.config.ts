import { collection, text, select, defineConfig, db } from "first";
const posts = collection({ title: text(), tags: select(["a", "b"]).many().optional() });
export default defineConfig({
  collections: { posts },
  hooks: { posts: { async afterCreate(row) { await db.query.posts.findMany({ where: { tags: { in: ["a"] } } }); } } },
});
