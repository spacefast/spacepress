---
name: typedpress-markdown-sync
description: "Use when setting up or troubleshooting two-way Markdown and Git sync in a TypedPress project: configuring sync globs on collections, syncing with typedpress sync, handling UIDs and 3-way merge conflicts, or enabling GitHub sync workflows."
compatibility: "Targets TypedPress 0.3 (WordPress 7.1+, PHP 8.2+). Requires the `typedpress` CLI and Node.js 22+."
---

# Configure two-way Markdown and Git sync

## When to use

- Storing editorial content (docs, blog posts, products) as Markdown files in Git while letting editors work in WordPress Admin.
- Syncing changes between a local repository and a dev or production WordPress site, or resolving a sync conflict.

## Inputs required

- Which collection, `wp.posts.extend()`, taxonomy, or product kind should sync, and its target glob (for example `content/guides/**/*.md`).
- Target site URL when syncing against a remote site (local dev site is the default).

## Procedure

1. Add a `sync` glob to the kind declaration. Use `**` for hierarchical collections (folder `index.md` files become parent items):

   ```ts
   // tp/guides-sync.ts
   import { collection, text, slug, richText } from "typedpress";

   export const guides = collection({
     title: text().min(1).max(160),
     slug: slug({ source: "title" }),
     content: richText().optional(),
   }, {
     hierarchical: true,
     url: "/guides/:path",
     sync: "content/guides/**/*.md",
   });
   ```

2. Keep front matter schema-valid and avoid raw HTML comments (`<!-- ... -->`) inside Markdown bodies. Each synced record keeps an immutable `uid` so renames and slug changes stay linked — never reuse a deleted record's `uid` for a brand-new file.

3. Check sync state and perform a 3-way merge:

   ```bash
   typedpress sync status
   typedpress sync
   ```

4. For automated PR-based sync from WordPress Admin edits, scaffold the GitHub workflow and wire repository dispatch:

   ```bash
   typedpress init --github
   typedpress git-dispatch status
   ```

## Verification

Run `typedpress check` and `typedpress sync --check` to confirm front matter validates against the schema and local files match the target site cleanly.

## Failure modes / debugging

- **3-way conflict under `.tp/conflicts/<uid>.md`:** Inspect the conflict file, edit the canonical Markdown file to keep the desired version, and run `typedpress sync resolve <uid>` followed by `typedpress sync`.
- **Deleted remote post conflicts with local edit:** If replacing a deleted doc with a new page, assign a fresh `uid` instead of reusing the deleted post's `uid`.
- **`core/html can't be written as Markdown`:** Remove raw HTML comments or unsupported raw HTML blocks from the `.md` body.

## Escalation

Read `www/content/docs/integrations/markdown-sync.md` via `docs_read`. Ask the user before discarding conflicting edits made in WordPress Admin.
