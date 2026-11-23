import { collection, defineConfig, text } from "spacepress";
import { seoFields } from "./sp/seo";

export const articles = collection({
  title: text(),
  ...seoFields(),
}, { title: "title" });

export default defineConfig({ name: "recipes" });
