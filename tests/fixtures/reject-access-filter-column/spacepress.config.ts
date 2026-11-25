import { collection, text, integer, defineConfig } from "spacepress";
export const posts = collection({ title: text(), ownerId: integer().optional() }, {
  access: { update: (ctx) => ({ ownr: ctx.user?.id ?? -1 }) },
});
export default defineConfig({});
