import { collection, defineConfig, global, richText, slug, text } from "typedpress";

// Each note is a WordPress post. The URL binds it to the matching [slug] page.
export const notes = collection({
  title: text().min(1).max(120),
  slug: slug({ source: "title" }).optional(),
  summary: text().max(200).optional(),
  body: richText().optional(),
}, {
  label: "Notes",
  title: "title",
  content: "body",
  url: "/notes/:slug",
  sync: "content/notes/*.md",
  access: { read: "anyone", create: "editor", update: "editor", delete: "editor" },
});

// A global stores one set of editable options for the whole site.
export const site = global({
  name: text().default("Field Notes"),
}, { label: "Site settings" });

export default defineConfig({
  name: "__ZERO_APP_NAME__",
  seed: true,
});
