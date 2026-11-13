import { collection, group, text, defineConfig, db } from "first";
const posts = collection({ title: text(), seo: group({ metaTitle: text().optional() }).optional() });
export default defineConfig({
  collections: { posts },
  hooks: { posts: { async afterCreate() { await db.query.posts.findMany({ where: { seo: { eq: { metaTitle: "x" } } } }); } } },
});
