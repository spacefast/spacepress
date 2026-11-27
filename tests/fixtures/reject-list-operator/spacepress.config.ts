import { collection, defineConfig, f } from "spacepress";
export const posts = collection({ title: f.text(), tags: f.select(["a", "b"]).many().optional() }).on({ async afterCreate({ db }) { await db.posts.list({ where: { tags: { in: ["a"] } } }); } });
export default defineConfig({});
