import { extend, f, table } from "spacepress";

import { createDocsCollection } from "@spacepress/docs/schema";

export const docs = createDocsCollection();

// The blog: WordPress's own posts. Written in the WordPress editor, SpacePress Admin, or as Markdown in
// content/posts/; `sp/app/blog/[slug]/page.tsx` renders each one in the site's layout. Posts have their
// title, slug, content and excerpt already; WordPress's capabilities decide who writes them.
export const posts = extend("posts", {
  label: "Posts",
  sync: "content/posts/*.md",
  comments: { moderation: "first-time", threaded: 2 },
});

// A playground edit someone saved to share: the example it started from and the files they changed.
// Anyone may save one (through `share` in sp/server.ts, which checks its size) and nobody lists
// them: the playground page reads one by its key.
export const shares = table({
  key: f.text().max(12).unique(),
  example: f.text().max(40),
  files: f.json(),
}, { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });

// The examples the site lists, each with the repository its code lives in and that repository's
// star count. An admin adds a row; the `refreshStars` job (sp/server.ts) fills in `stars`.
export const examples = table({
  name: f.text().max(60).unique(),
  title: f.text().max(80),
  summary: f.text({ multiline: true }).max(300),
  // "owner/name" on GitHub, and the folder of the example inside it.
  repo: f.text().max(120),
  path: f.text().max(200).default(""),
  position: f.integer().default(0),
  // `starsAt` is when GitHub was last asked; `stars` stays empty while it has never answered.
  stars: f.integer().optional(),
  starsAt: f.timestamp().optional(),
}, { access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });
