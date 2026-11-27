import { collection, defineConfig, f, global } from "spacepress";

// Each note is a WordPress post. The [slug] route binds it automatically.
export const notes = collection({
  title: f.text().min(1).max(120),
  slug: f.slug({ source: "title" }).optional(),
  summary: f.text().max(200).optional(),
  body: f.richText().optional(),
}, {
  label: "Notes",
  title: "title",
  content: "body",
  sync: "content/notes/*.md",
  access: { read: "anyone", create: "editor", update: "editor", delete: "editor" },
});

// A global stores one set of editable options for the whole site.
export const site = global({
  name: f.text().default("Field Notes"),
}, { label: "Site settings" });

export default defineConfig({
  name: "__SP_APP_NAME__",
  seed: true,
});
