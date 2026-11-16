import { collection, defineConfig, text } from "typedpress";

export const notes = collection({
  title: text(),
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
