import { collection, text, slug, richText, date, json } from "typedpress";

// Was the `blog` collection in src/content.config.ts. Its `image()` field has no TypedPress field, so
// the collection moved here: the hero image is now a path under public/.
export const blog = collection({
  title: text(),
  description: text(),
  pubDate: date(),
  heroImage: text().optional(),
  tags: json<string[]>().default([]),
  slug: slug(),
  body: richText().optional(),
}, {
  title: "title",
  content: "body",
  hierarchical: true,
  url: "/blog/:path",
  sync: "src/content/blog/**/*.md",
  access: { read: "anyone", create: "editor", update: "editor", delete: "editor" },
});
