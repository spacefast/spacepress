import { collection, id, text, defineConfig, db } from "first";
const posts = collection({ id: id(), title: text().notNull() }, {
  access: { read: async (ctx) => (await db.query.posts.findFirst()) !== null },
});
export default defineConfig({ collections: { posts } });
