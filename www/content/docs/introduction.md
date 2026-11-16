---
uid: zr_54d327ab551c32be24fd
title: Introduction
description: What these docs cover and where to start.
order: 1
status: published
publishedAt: 2026-11-15T21:51:51.000Z
---
TypedPress compiles TypeScript into a WordPress plugin. You describe your data, your server functions and your pages; WordPress stores the content, runs the editor and sign-in, and serves the site. No JavaScript runs on the server.

These docs are the longer reference. Two shorter ways in:

- [The guide](/) is one page that shows every feature with an example.
- [The playground](/play) builds an app in your browser as you type, and runs it in WordPress.

## Names

The framework is being renamed from TypedPress to TypedPress. The code today still uses the First names, and so do these docs: `typedpress.config.ts`, the `tp/` folder, the `typedpress` command. The guide lists what each name becomes.

## How these docs are made

Each page here is a Markdown file in `content/docs/` of this site's repository. The site is a TypedPress app: `typedpress sync` stores each file as a WordPress item, and one page, `tp/app/docs/[...path]/page.tsx`, renders them all with the navigation on the left and the headings on the right.

```ts title="tp/schema.ts"
export const docs = collection({
  title: text(),
  slug: slug({ source: "title" }),
  content: richText().optional(),
  description: text().optional(),
}, { hierarchical: true, url: "/docs/:path", sync: "content/docs/**/*.md" });
```

An editor can change a doc in WordPress, and `typedpress sync` writes the change back to the file.
