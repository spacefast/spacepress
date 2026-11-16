import { collection, global, json, media, richText, slug, text } from "typedpress";

// What EmDash's templates read: posts and pages, and the widget areas as a global. (Taxonomies,
// for categories, tags and bylines, are optional: without them those read as empty.)
export const posts = collection({
  title: text(),
  slug: slug({ source: "title" }),
  body: richText().optional(),
  excerpt: text({ multiline: true }).optional(),
  cover: media({ accept: "image" }).optional(),
  seoTitle: text().optional(),
  seoDescription: text({ multiline: true }).optional(),
}, { title: "title", content: "body", comments: { guests: true }, access: { read: (ctx) => ["admin", "editor"].includes(ctx.user?.role ?? "") ? true : { status: "published" }, create: "editor", update: "editor", delete: "editor" } });

export const pages = collection({ title: text(), slug: slug({ source: "title" }), body: richText().optional() }, { title: "title", content: "body", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const widgets = global({ areas: json<unknown[]>().default([]) }, { access: { read: "anyone", update: "editor" } });
