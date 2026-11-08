import { collection, defineConfig, id, text } from "zero";
import seo from "zero-plugin-seo";

const posts = collection({ id: id(), title: text().notNull(), summary: text(), body: text() }, { title: "title" });

export default defineConfig({
  name: "plugins",
  collections: { posts },
  // The app's own hook runs after the plugin's and sees its change.
  hooks: { posts: { beforeCreate(data) { data.body = "seen: " + (data.summary ?? ""); } } },
  use: [seo({ suffix: " | Site" })],
});
