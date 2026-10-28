import { collection, id, text, select, defineConfig, db } from "zero";
const posts = collection("posts", { id: id(), title: text().notNull(), tags: select({ options: ["a", "b"], multiple: true }) });
export default defineConfig({
  schema: { posts },
  hooks: { posts: { async afterCreate(row) { await db.query.posts.findMany({ where: { tags: { in: ["a"] } } }); } } },
});
