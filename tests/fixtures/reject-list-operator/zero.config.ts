import { collection, id, text, select, defineConfig, db } from "zero";
const posts = collection({ id: id(), title: text().notNull(), tags: select({ options: ["a", "b"], multiple: true }) });
export default defineConfig({
  collections: { posts },
  hooks: { posts: { async afterCreate(row) { await db.query.posts.findMany({ where: { tags: { in: ["a"] } } }); } } },
});
