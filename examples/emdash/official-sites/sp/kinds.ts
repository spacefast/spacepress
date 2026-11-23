import { collection, global, json, media, richText, slug, taxonomy, text } from "spacepress";

// Native WordPress titles and blocks; the remaining fields are editable in SCF.
export const posts = collection({
  title: text(),
  slug: slug({ source: "title" }),
  body: richText().optional(),
  excerpt: text({ multiline: true }).optional(),
  cover: media({ accept: "image" }).optional(),
  seoTitle: text().optional(),
  seoDescription: text({ multiline: true }).optional(),
}, {
  label: "Publication posts", title: "title", content: "body", revisions: true, comments: { guests: true },
  access: { read: (ctx) => ["admin", "editor", "author"].includes(ctx.user?.role ?? "") ? true : { status: "published" }, create: "editor", update: "editor", delete: "editor" },
});

export const pages = collection({
  title: text(),
  slug: slug({ source: "title" }),
  body: richText().optional(),
  seoTitle: text().optional(),
  seoDescription: text({ multiline: true }).optional(),
}, {
  label: "Publication pages", title: "title", content: "body", revisions: true,
  access: { read: (ctx) => ["admin", "editor", "author"].includes(ctx.user?.role ?? "") ? true : { status: "published" }, create: "editor", update: "editor", delete: "editor" },
});

// The template's two vocabularies and its byline credits, as WordPress terms on posts.
export const category = taxonomy({}, { label: "Categories", hierarchical: true, on: [posts] });
export const tag = taxonomy({}, { label: "Tags", on: [posts] });
export const credits = taxonomy({ role: text().optional() }, { label: "Byline credits", on: [posts] });

// The template's widget areas (sidebar, footer), edited in wp-admin as one record.
export const widgets = global({ areas: json<unknown[]>().default([]) }, { label: "Template widgets", access: { read: "anyone", update: "editor" } });
