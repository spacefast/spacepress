# An Astro site migrated to TypedPress

A worked run of the [`typedpress-migrate-astro`](../../skills/typedpress-migrate-astro/SKILL.md) skill.
[`before/`](before) is a small Astro 7 site: three pages, a layout, a Markdown page, a `blog`
collection of Markdown files, and one React island. [`after/`](after) is the same site as a TypedPress
app, as the skill produced it.

Run `typedpress-migrate --from astro app ./before --out ./candidate --dry-run` to check a source. The importer maps supported collection definitions and Markdown pages, and copies `public/` and `src/content/`. Port Astro templates, layouts and client components by hand.

This example uses an `image()` field in its original schema. The importer reports that field and asks for a schema it can translate. The checked-in `after/` shows the completed port.

## What the worked port converted

| Astro (`before/`) | TypedPress (`after/`) | How |
| --- | --- | --- |
| `src/content.config.ts`, `blog` | [`tp/schema.ts`](after/tp/schema.ts) `blog` | moved by hand: `heroImage: image()` has no TypedPress field (the build said so at the field), so the collection moved into `tp/` with `heroImage: text()` |
| `src/content/blog/*.md` | `src/content/blog/*.md`, unchanged but two lines | synced into the kind by `typedpress sync`; `pubDate: 'Mar 02 2026'` became `2026-03-02`, `heroImage: ./first-light.svg` became `/images/first-light.svg` |
| `src/layouts/Base.astro` | [`tp/app/layout.tsx`](after/tp/app/layout.tsx) | `<html>`/`<head>` dropped (WordPress writes them), `<slot />` → `{children}`, `title` prop → `metadata` |
| `src/pages/index.astro`, `src/pages/blog/index.astro` | `tp/app/page.tsx`, `tp/app/blog/page.tsx` | `getCollection("blog")` → `db.query.blog.findMany({ orderBy: { pubDate: "desc" } })` |
| `src/pages/blog/[...slug].astro` | [`tp/app/blog/[...path]/page.tsx`](after/tp/app/blog/[...path]/page.tsx) | `getStaticPaths()` → the kind's `url: "/blog/:path"`; `render(post)` → `<Content value={item.body} />` |
| `src/pages/about.md` | `tp/app/about/page.md` | `layout:` dropped: the app layout wraps it |
| `src/components/Likes.tsx`, `client:load` | [`tp/components/Likes.tsx`](after/tp/components/Likes.tsx) | `"use client"`, `useState` from `"typedpress/client"`; no React on the page |
| the hero image next to the post | `public/images/first-light.svg` | `astro:assets` doesn't run in TypedPress |

## What it flagged for hand work

- `astro.config.mjs` (`site`, the React integration): nothing to carry. The site URL is
  WordPress's; React isn't used once the island is a `"use client"` component.
- The hero image is shown with a plain `<img>`: Astro's `<Image>` resized it at build time, TypedPress
  doesn't. Resizing is the media library's job if the image moves there.
- Dates: Astro's `z.coerce.date()` reads `'Mar 02 2026'`; TypedPress's `date()` reads `YYYY-MM-DD`
  only, so the front matter changed.

## Check it

[`migrated.test.mjs`](migrated.test.mjs) builds `after/`, seeds the posts as a publish does, serves
it on WordPress-on-SQLite and reads it in Chromium: home lists the posts newest first, the blog
page their dates, a post its body and hero image, the island counts two clicks, and `/about`
renders the Markdown page.

```sh
node --test migrate/astro/example/migrated.test.mjs
```
