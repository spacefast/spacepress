import { collection, defineConfig, text } from "first";
import { seoFields } from "./seo";

const articles = collection({
  title: text().notNull(),
  ...seoFields(),
}, { title: "title" });

export default defineConfig({ name: "recipes", collections: { articles } });
