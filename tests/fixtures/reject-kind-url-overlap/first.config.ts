import { collection, defineConfig, text } from "first";
export const notes = collection({ title: text().notNull() }, { url: "/n/latest/:slug" });
export const posts = collection({ title: text().notNull(), topic: text().notNull() }, { url: "/n/:topic/:id" });
export default defineConfig({ name: "kindurlshape", collections: { notes, posts } });
