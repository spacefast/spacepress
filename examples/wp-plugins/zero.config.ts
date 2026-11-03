import { collection, defineConfig, text } from "zero";

const notes = collection({
  title: text().notNull(),
});

export const collections = { notes };
export const entities = { ...collections };

export default defineConfig({
  name: "plugin-demo",
  collections,
  plugins: {
    // The first successful build records the WordPress.org archive SHA-256.
    "classic-editor": "1.6.7",
  },
});
