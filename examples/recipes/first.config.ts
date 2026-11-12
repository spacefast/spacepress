import { collection, defineConfig, text } from "first";
import { seoFields } from "./first/seo";

const articles = collection({
  title: text(),
  ...seoFields(),
}, { title: "title" });

export default defineConfig({ name: "recipes", collections: { articles } });
