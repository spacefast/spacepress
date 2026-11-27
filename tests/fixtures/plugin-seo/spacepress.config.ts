import { collection, defineConfig, f } from "spacepress";
import seo from "spacepress-plugin-seo";

export const posts = collection({ title: f.text(), summary: f.text().optional(), body: f.text().optional() }, { title: "title" }).on({ beforeCreate({ data }) { data.body = "seen: " + (data.summary ?? ""); } });

export default defineConfig({
  name: "plugins",
  use: [seo({ suffix: " | Site" })],
});
