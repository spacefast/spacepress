---
name: typedpress-migrate-astro
description: "Use when moving an Astro site onto TypedPress: its content collections become kinds, its pages and layouts become `tp/app/` TSX, and its islands become \"use client\" components. Covers what to keep as it is, what to convert, what to flag for the owner, and how to check the result page by page."
compatibility: "Targets TypedPress 0.3 (WordPress 7.1+, PHP 8.2+). Requires the `typedpress` CLI and Node.js 22+."
---

# Migrate an Astro site to TypedPress

## When to use

- An Astro site should be served by WordPress through TypedPress: editors in wp-admin, the pages in
  PHP. To keep Astro and read a TypedPress app instead, use `@typedpress/astro` (`www/content/docs/integrations/astro-and-clients.md`).

The conversion is done by you, file by file, with the table in
[references/astro-to-first.md](references/astro-to-first.md). There is no converter command.

## Inputs required

- The Astro project: `src/content.config.ts`, `src/pages/`, `src/layouts/`, `src/components/`.
- The list of its URLs (`astro build` prints them, or read `src/pages/`), to check against at the end.
- Which islands must stay interactive.

## Procedure

1. Add TypedPress beside Astro: a `typedpress.config.ts` at the root, then `typedpress init` for the agent files.

2. Content. Run `typedpress check`. Every `glob()` collection in `src/content.config.ts` is already a
   kind that syncs its Markdown folder. For each error it prints (a field TypedPress can't map), move
   that collection into `tp/` as a `collection()` and choose the field by hand:

   ```ts
   // tp/kinds.ts
   import { collection, text, slug, richText, date } from "typedpress";

   // Was `blog` in src/content.config.ts; `heroImage: image()` became a path under public/.
   export const blog = collection(
     { title: text(), pubDate: date(), heroImage: text().optional(), slug: slug(), body: richText().optional() },
     { title: "title", content: "body", hierarchical: true, url: "/blog/:path", sync: "src/content/blog/**/*.md" },
   );
   ```

   Then remove it from `src/content.config.ts`. Dates in front matter must be `YYYY-MM-DD`.

3. Layouts. `src/layouts/Base.astro` becomes `tp/app/layout.tsx`. Drop `<html>`, `<head>` and
   `<body>` (WordPress writes them); `<slot />` is `{children}`; title and description props become
   `export const metadata`.

4. Pages. Each `src/pages/x.astro` becomes `tp/app/x/page.tsx`: the frontmatter script is the
   async component body, `getCollection("blog")` is `db.query.blog.findMany(...)`, `<a href>` to an
   internal page is `<Link href>`. A dynamic page with `getStaticPaths()` over a collection becomes
   the kind's `url` plus a page that takes `item`; `render(entry)` is `<Content value={item.body} />`.
   A Markdown page (`src/pages/about.md`) becomes `tp/app/about/page.md` without its `layout:`.

5. Islands. A component with `client:load` (React, Preact, Svelte, Vue) becomes a `"use client"`
   component under `tp/components/` with `useState` from `"typedpress/client"`. It cannot import npm
   packages: flag any island that does.

6. Files. `public/` stays. Images an `image()` field or `astro:assets` resolved go to `public/` or
   the media library, and the field holds the URL.

7. `typedpress build`, then `typedpress dev`, and open every URL from the inputs.

## Verification

- `typedpress check` exits 0, and `src/content.config.ts` holds only collections TypedPress maps.
- Every URL the Astro site had answers 200 under `typedpress dev`, with the same title and heading.
- Each island responds to a click in the browser.
- Write down what you flagged (step 5, and the rows marked "by hand" in the reference table).

## Failure modes / debugging

- `field ... has no TypedPress field type`: step 2. The message names the field and what to use.
- `its folder has no index.md`: a folder tree needs `<folder>/index.md` for each folder that
  holds entries. Add one, or move the files up.
- A date is refused at sync: front matter like `'Jul 08 2022'` must become `2022-07-08`.
- A page is 404: the folder under `tp/app/` doesn't match the URL; `[...slug]` is `[...path]`
  when the kind's url is `/x/:path`.
- Any other diagnostic: the `typedpress-fix-diagnostic` skill reads them; `typedpress help` lists the commands.

## Escalation

- Astro features with no TypedPress equivalent (an SSR adapter, middleware, API routes with streaming,
  i18n routing, view transitions, an island that imports packages): list them for the owner, do
  not drop them silently.
- Copying a live site's content is publishing; do it only when the owner asks.

Reference: `www/content/docs/integrations/astro-and-clients.md`, `www/content/docs/core/pages-and-islands.md` and `www/content/docs/core/schema-and-storage.md`; a worked migration is `examples/migrate-astro/` in the repository.
