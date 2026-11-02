import { collection, id, text, integer, defineConfig } from "zero";
const posts = collection({ id: id(), title: text().notNull(), ownerId: integer() }, {
  access: { update: (ctx) => ({ ownr: ctx.user?.id ?? -1 }) },
});
export default defineConfig({ collections: { posts } });
