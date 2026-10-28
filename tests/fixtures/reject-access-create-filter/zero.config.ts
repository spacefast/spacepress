import { collection, id, text, integer, defineConfig } from "zero";
const posts = collection("posts", { id: id(), title: text().notNull(), ownerId: integer() }, {
  access: { create: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }) },
});
export default defineConfig({ schema: { posts } });
