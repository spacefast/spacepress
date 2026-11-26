import { collection, text, defineConfig } from "spacepress";
import { db } from "spacepress/server";
export const posts = collection({ title: text() }, {
  access: { read: async () => { await db.insert(posts).values({ title: "x" }); return true; } },
});
export default defineConfig({});

