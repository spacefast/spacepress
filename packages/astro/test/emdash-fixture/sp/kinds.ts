import { collection, f, global } from "spacepress";

// What EmDash's templates read: posts and pages, and the widget areas as a global. (Taxonomies,
// for categories, tags and bylines, are optional: without them those read as empty.)
export const posts = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }),
  body: f.richText().optional(),
  excerpt: f.text({ multiline: true }).optional(),
  cover: f.media({ accept: "image" }).optional(),
  seoTitle: f.text().optional(),
  seoDescription: f.text({ multiline: true }).optional(),
}, { title: "title", content: "body", comments: { guests: true }, access: { read: (ctx) => ["admin", "editor"].includes(ctx.user?.role ?? "") ? true : { status: "published" }, create: "editor", update: "editor", delete: "editor" } });

export const pages = collection({ title: f.text(), slug: f.slug({ source: "title" }), body: f.richText().optional() }, { title: "title", content: "body", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const widgets = global({ areas: f.json<unknown[]>().default([]) }, { access: { read: "anyone", update: "editor" } });
