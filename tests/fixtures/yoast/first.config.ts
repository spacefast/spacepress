import { collection, text, richText, slug, defineConfig } from "first";

export const notes = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
  body: richText().optional(),
  dek: text().optional(),
  secret: text().access({ read: "editor" }).optional(),
}, { title: "title", content: "body", url: "/notes/:slug" });

export const masked = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
  body: richText().access({ read: "editor" }).optional(),
}, { title: "title", content: "body", url: "/masked/:slug" });

export default defineConfig({
  name: "yoast",
  plugins: {
    "wordpress-seo": {
      version: "28.8",
      sha256: "27cc01cb149db7186ef750552a5cc2ae5028933473886e419918af273b075105",
    },
  },
});
