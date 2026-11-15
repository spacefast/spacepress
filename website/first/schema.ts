import { collection, table, text, slug, richText, json, integer, timestamp } from "first";

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
}, {
  label: "Posts", url: "/blog/:slug", sync: "content/posts/*.md",
  // WordPress's own comments: stored in wp_comments and moderated in the admin like any WordPress
  // comment. Signed-in people may write one; a commenter's first comment waits for approval, and
  // replies nest two deep. (`guests: true` would also accept comments from visitors who are not
  // signed in, but <Comments> shows its form only to signed-in people today.)
  comments: { moderation: "first-time", threaded: 2 },
  access: { read: "anyone", create: "author", update: "author", delete: "editor" },
});

// A playground edit someone saved to share: the example it started from and the files they changed.
// Anyone may save one (through `share` in first/server.ts, which checks its size) and nobody lists
// them: the playground page reads one by its key.
export const shares = table({
  key: text().max(12).unique(),
  example: text().max(40),
  files: json(),
}, { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });

// The examples the site lists, each with the repository its code lives in and that repository's
// star count. An admin adds a row; the `refreshStars` job (first/server.ts) fills in `stars`.
export const examples = table({
  name: text().max(60).unique(),
  title: text().max(80),
  summary: text({ multiline: true }).max(300),
  // "owner/name" on GitHub, and the folder of the example inside it.
  repo: text().max(120),
  path: text().max(200).default(""),
  position: integer().default(0),
  // `starsAt` is when GitHub was last asked; `stars` stays empty while it has never answered.
  stars: integer().optional(),
  starsAt: timestamp().optional(),
}, { access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });
