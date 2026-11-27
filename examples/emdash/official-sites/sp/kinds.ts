import { collection, global, taxonomy, f } from "spacepress";

// Native WordPress titles and blocks; the remaining fields are editable in SCF.
export const posts = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }),
  body: f.richText().optional(),
  excerpt: f.text({ multiline: true }).optional(),
  cover: f.media({ accept: "image" }).optional(),
  seoTitle: f.text().optional(),
  seoDescription: f.text({ multiline: true }).optional(),
}, {
  label: "Publication posts", title: "title", content: "body", revisions: true, comments: { guests: true },
  access: { read: (ctx) => ["admin", "editor", "author"].includes(ctx.user?.role ?? "") ? true : { status: "published" }, create: "editor", update: "editor", delete: "editor" },
});

export const pages = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }),
  body: f.richText().optional(),
  seoTitle: f.text().optional(),
  seoDescription: f.text({ multiline: true }).optional(),
}, {
  label: "Publication pages", title: "title", content: "body", revisions: true,
  access: { read: (ctx) => ["admin", "editor", "author"].includes(ctx.user?.role ?? "") ? true : { status: "published" }, create: "editor", update: "editor", delete: "editor" },
});

// The template's two vocabularies and its byline credits, as WordPress terms on posts.
export const category = taxonomy({}, { label: "Categories", hierarchical: true, on: [posts] });
export const tag = taxonomy({}, { label: "Tags", on: [posts] });
export const credits = taxonomy({ role: f.text().optional() }, { label: "Byline credits", on: [posts] });

// The template's widget areas (sidebar, footer), edited in wp-admin as one record.
export const widgets = global({ areas: f.json<unknown[]>().default([]) }, { label: "Template widgets", access: { read: "anyone", update: "editor" } });
