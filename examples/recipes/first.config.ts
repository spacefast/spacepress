import { collection, defineConfig, text } from "first";
import { seoFields } from "./first/seo";

export const articles = collection({
  title: text(),
  ...seoFields(),
}, { title: "title" });

export default defineConfig({ name: "recipes" });
