import { collection, id, text, defineConfig, db } from "zero";
const posts = collection("posts", { id: id(), title: text().notNull() }, {
  access: { read: async (ctx) => (await db.query.posts.findFirst()) !== null },
});
export default defineConfig({ schema: { posts } });
