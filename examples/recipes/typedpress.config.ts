import { collection, defineConfig, text } from "typedpress";
import { seoFields } from "./tp/seo";

export const articles = collection({
  title: text(),
  ...seoFields(),
}, { title: "title" });

export default defineConfig({ name: "recipes" });
