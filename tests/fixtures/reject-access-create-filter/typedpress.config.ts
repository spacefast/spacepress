import { collection, text, integer, defineConfig } from "typedpress";
export const posts = collection({ title: text(), ownerId: integer().optional() }, {
  access: { create: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }) },
});
export default defineConfig({});
