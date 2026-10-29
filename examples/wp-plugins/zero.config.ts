import { collection, defineConfig, id, text } from "zero";

const notes = collection("notes", {
  id: id(),
  title: text().notNull(),
});

export const schema = { notes };

export default defineConfig({
  name: "plugin-demo",
  target: "wp",
  schema,
  plugins: {
    // The first successful build records the WordPress.org archive SHA-256.
    "classic-editor": "1.6.7",
  },
});
