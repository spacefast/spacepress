import { collection, text, defineConfig, db } from "first";
export const posts = collection({ title: text() }, {
  access: { read: async (ctx) => (await db.query.posts.findFirst()) !== null },
});
export default defineConfig({});
