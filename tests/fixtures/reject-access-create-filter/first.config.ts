import { collection, id, text, integer, defineConfig } from "first";
const posts = collection({ id: id(), title: text().notNull(), ownerId: integer() }, {
  access: { create: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }) },
});
export default defineConfig({ collections: { posts } });
