import { collection, defineConfig, f } from "spacepress";
export const posts = collection({ title: f.text(), ownerId: f.integer().optional() }, {
  access: { create: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }) },
});
export default defineConfig({});
