import { collection, group, text, defineConfig, db } from "first";
export const posts = collection({ title: text(), seo: group({ metaTitle: text().optional() }).optional() }).on({ async afterCreate() { await db.query.posts.findMany({ where: { seo: { eq: { metaTitle: "x" } } } }); } });
export default defineConfig({});
