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

A `**` folder pattern maps subdirectories into parent/child hierarchy (`index.md` represents the folder item). Every synced record receives an immutable `uid` so renames and slug changes stay linked.

## Running sync & CI workflows

- Run `typedpress sync` to perform a 3-way merge between local Markdown files and WordPress. Front matter is validated against your TypeScript schema before writing.
- Run `typedpress init --github` to scaffold GitHub Actions for automated content sync.
- Configure `typedpress git-dispatch` so edits saved inside WordPress Admin trigger a repository dispatch event automatically.
- Enable `seed: true` in `defineConfig()` to populate synced records when a fresh deployment activates the plugin without overwriting existing editorial changes.
