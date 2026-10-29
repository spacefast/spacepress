import { collection, defineConfig, id, text } from "zero";

const notes = collection("notes", {
  id: id(),
  title: text().notNull(),
});

export default defineConfig({
  name: "plugin-demo",
  target: "wp",
  schema: { notes },
  wordpress: {
    plugins: [
      // The first successful build records the WordPress.org archive SHA-256.
      { slug: "classic-editor", version: "1.6.7" },
    ],
  },
});
