import { collection, table, text, slug, richText, json } from "first";

// The docs: each file under content/docs/ is one doc. Its name is its slug, its folder its
// parent, and a folder's index.md the page the folder stands for.
export const docs = collection({
  title: text(),
  slug: slug({ source: "title" }),
  content: richText().optional(),
  description: text().optional(),
}, { label: "Docs", hierarchical: true, url: "/docs/:path", sync: "content/docs/**/*.md", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

// The blog. Posts are WordPress content: written in the WordPress editor or First Admin, or as
// Markdown in content/posts/. `first/app/blog/[slug]/page.tsx` renders each one in the site's layout.
export const posts = collection({
  title: text().min(1).max(140),
  slug: slug({ source: "title" }),
  content: richText().optional(),
  excerpt: text({ multiline: true }).max(300).optional(),
}, { label: "Posts", url: "/blog/:slug", sync: "content/posts/*.md", access: { read: "anyone", create: "author", update: "author", delete: "editor" } });

// A playground edit someone saved to share: the example it started from and the files they changed.
// Anyone may save one (through `share` in first/server.ts, which checks its size) and nobody lists
// them: the playground page reads one by its key.
export const shares = table({
  key: text().max(12).unique(),
  example: text().max(40),
  files: json(),
}, { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });
