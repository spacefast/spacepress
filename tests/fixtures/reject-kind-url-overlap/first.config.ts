import { collection, defineConfig, text } from "first";
export const notes = collection({ title: text().notNull() }, { url: "/n/:slug" });
export const posts = collection({ title: text().notNull() }, { url: "/n/:id" });
export default defineConfig({ name: "kindurlshape", collections: { notes, posts } });
