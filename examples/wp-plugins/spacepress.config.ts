import { collection, defineConfig, f } from "spacepress";

export const notes = collection({
  title: f.text(),
});

export const collections = { notes };
export const entities = { ...collections };

export default defineConfig({
  name: "plugin-demo",
  plugins: {
    // The first successful build records the WordPress.org archive SHA-256.
    "classic-editor": "1.6.7",
  },
});
