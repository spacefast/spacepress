import { collection, defineConfig, text } from "first";
import seo from "first-plugin-seo";

const posts = collection({ title: text(), summary: text().optional(), body: text().optional() }, { title: "title" });

export default defineConfig({
  name: "plugins",
  collections: { posts },
  // The app's own hook runs after the plugin's and sees its change.
  hooks: { posts: { beforeCreate(data) { data.body = "seen: " + (data.summary ?? ""); } } },
  use: [seo({ suffix: " | Site" })],
});
