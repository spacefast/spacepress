import { collection, defineConfig, id, text } from "zero";
import { seoFields } from "./seo";

const articles = collection("articles", {
  id: id(),
  title: text().notNull(),
  ...seoFields(),
}, { title: "title" });

export default defineConfig({ name: "recipes", schema: { articles } });
