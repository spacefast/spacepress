import { collection, defineConfig, text } from "zero";
import { seoFields } from "./zero/seo";

const articles = collection({
  title: text().notNull(),
  ...seoFields(),
}, { title: "title" });

export default defineConfig({ name: "recipes", collections: { articles } });
