import { collection, defineConfig, f } from "spacepress";
export const posts = collection({ title: f.text() }, {
  access: { read: async ({ db }) => { await db.posts.create({ title: "x" }); return true; } },
});
export default defineConfig({});
