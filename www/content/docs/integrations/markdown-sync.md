---
uid: zr_b52abeed3074aa6e7cf3
title: Two-Way Markdown & Git Sync
description: Synchronize Markdown/JSON files in Git with WordPress collections and taxonomies.
order: 1
status: published
publishedAt: 2026-11-21T09:09:00.000Z
---
## Configuring sync

Add a `sync` glob to any `collection()`, `wp.posts.extend()`, `taxonomy()`, `product()`, or `table()`:

```ts
import { collection, richText, slug, text } from "spacepress";

export const docs = collection({
  title: text(),
  slug: slug({ source: "title" }),
  content: richText().optional(),
}, {
  hierarchical: true,
  url: "/docs/:path",
  sync: "content/docs/**/*.md",
});
```

On a `hierarchical` collection, a `**` pattern maps folders to parents and children; a folder's `index.md` is the folder's own page. Every synced record gets a `uid` in its front matter that never changes, so renames and slug changes stay linked.

A synced page can use the app's [block components](/docs/core/pages-and-islands#components-from-npm-packages) as tags on lines of their own, such as `<Callout type="warning">`, and code fences with `title="…"`, marked lines `{2,4-5}` and `group="…"`. `spacepress sync` writes them back the same way. [`@spacepress/docs`](/docs/integrations/docs-package) ships a ready-made set.

## Running sync & CI workflows

- Run `spacepress sync` to perform a 3-way merge between local Markdown files and WordPress. Front matter is validated against your TypeScript schema before writing.
- Run `spacepress init --github` to scaffold GitHub Actions for automated content sync.
- Configure `spacepress git-dispatch` so edits saved inside WordPress Admin trigger a repository dispatch event automatically.
- Enable `seed: true` in `defineConfig()` to populate synced records when a fresh deployment activates the plugin without overwriting existing editorial changes.
