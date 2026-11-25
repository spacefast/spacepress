import { collection, text, defineConfig, db } from "spacepress";
export const posts = collection({ title: text() }, {
  access: { read: async () => { await db.insert(posts).values({ title: "x" }); return true; } },
});
export default defineConfig({});

