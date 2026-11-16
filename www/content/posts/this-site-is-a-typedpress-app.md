---
uid: zr_a9553865108e0d0ccf40
title: This site is a TypedPress app
slug: this-site-is-a-typedpress-app
excerpt: "The guide, the playground, the docs and this post are served by one WordPress plugin compiled from TypeScript."
status: published
publishedAt: 2026-11-15T20:00:00.000Z
---
The site you are reading is built with the framework it describes. Its pages are TSX files, its docs are Markdown files stored as WordPress content, and this post is a WordPress item you can edit in the WordPress editor.

```ts title="tp/schema.ts"
export const posts = collection({
  title: text().min(1).max(140),
  slug: slug({ source: "title" }),
  content: richText().optional(),
  excerpt: text({ multiline: true }).max(300).optional(),
}, { url: "/blog/:slug", sync: "content/posts/*.md" });
```
