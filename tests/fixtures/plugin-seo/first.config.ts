import { collection, defineConfig, text } from "first";
import seo from "first-plugin-seo";

export const posts = collection({ title: text(), summary: text().optional(), body: text().optional() }, { title: "title" }).on({ beforeCreate(data) { data.body = "seen: " + (data.summary ?? ""); } });

export default defineConfig({
  name: "plugins",
  use: [seo({ suffix: " | Site" })],
});
