import { collection, defineConfig, f } from "spacepress";
import { seoFields } from "./sp/seo";

export const articles = collection({
  title: f.text(),
  ...seoFields(),
}, { title: "title" });

export default defineConfig({ name: "recipes" });
