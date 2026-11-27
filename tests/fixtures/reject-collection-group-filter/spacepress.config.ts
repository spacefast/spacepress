import { collection, defineConfig, f } from "spacepress";
export const posts = collection({ title: f.text(), seo: f.group({ metaTitle: f.text().optional() }).optional() }).on({ async afterCreate({ db }) { await db.posts.list({ where: { seo: { eq: { metaTitle: "x" } } } }); } });
export default defineConfig({});
