import { collection, table, text, integer, richText, slug, ref, timestamp } from "typedpress";

export const articles = collection({
  title: text().min(1).max(140),
  slug: slug({ source: "title" }).optional(),
  summary: text({ multiline: true }).max(260).optional(),
  body: richText().optional(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()),
}, {
  label: "Articles",
  title: "title",
  content: "body",
  url: "/articles/:slug",
  sync: "content/articles/*.md",
  access: { read: "anyone", create: "author", update: "editor", delete: "editor" },
});

export const claps = table({
  articleId: ref(articles).unique().onDelete("cascade"),
  count: integer().default(0),
}, {
  access: { read: "anyone", create: "admin", update: "admin", delete: "admin" },
});
