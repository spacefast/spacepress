# An Astro site migrated to First

A worked run of the [`first-migrate-astro`](../../skills/first-migrate-astro/SKILL.md) skill.
[`before/`](before) is a small Astro 7 site: three pages, a layout, a Markdown page, a `blog`
collection of Markdown files, and one React island. [`after/`](after) is the same site as a First
app, as the skill produced it.

## What it converted

| Astro (`before/`) | First (`after/`) | How |
| --- | --- | --- |
| `src/content.config.ts`, `blog` | [`first/schema.ts`](after/first/schema.ts) `blog` | moved by hand: `heroImage: image()` has no First field (the build said so at the field), so the collection moved into `first/` with `heroImage: text()` |
| `src/content/blog/*.md` | `src/content/blog/*.md`, unchanged but two lines | synced into the kind by `first sync`; `pubDate: 'Mar 02 2026'` became `2026-03-02`, `heroImage: ./first-light.svg` became `/images/first-light.svg` |
| `src/layouts/Base.astro` | [`first/app/layout.tsx`](after/first/app/layout.tsx) | `<html>`/`<head>` dropped (WordPress writes them), `<slot />` → `{children}`, `title` prop → `metadata` |
| `src/pages/index.astro`, `src/pages/blog/index.astro` | `first/app/page.tsx`, `first/app/blog/page.tsx` | `getCollection("blog")` → `db.query.blog.findMany({ orderBy: { pubDate: "desc" } })` |
| `src/pages/blog/[...slug].astro` | [`first/app/blog/[...path]/page.tsx`](after/first/app/blog/[...path]/page.tsx) | `getStaticPaths()` → the kind's `url: "/blog/:path"`; `render(post)` → `<Content value={item.body} />` |
| `src/pages/about.md` | `first/app/about/page.md` | `layout:` dropped: the app layout wraps it |
| `src/components/Likes.tsx`, `client:load` | [`first/components/Likes.tsx`](after/first/components/Likes.tsx) | `"use client"`, `useState` from `"first/client"`; no React on the page |
| the hero image next to the post | `public/images/first-light.svg` | `astro:assets` doesn't run in First |

## What it flagged for hand work

- `astro.config.mjs` (`site`, the React integration): nothing to carry. The site URL is
  WordPress's; React isn't used once the island is a `"use client"` component.
- The hero image is shown with a plain `<img>`: Astro's `<Image>` resized it at build time, First
  doesn't. Resizing is the media library's job if the image moves there.
- Dates: Astro's `z.coerce.date()` reads `'Mar 02 2026'`; First's `date()` reads `YYYY-MM-DD`
  only, so the front matter changed.

## Check it

[`migrated.test.mjs`](migrated.test.mjs) builds `after/`, seeds the posts as a publish does, serves
it on WordPress-on-SQLite and reads it in Chromium: home lists the posts newest first, the blog
page their dates, a post its body and hero image, the island counts two clicks, and `/about`
renders the Markdown page.

```sh
node --test examples/migrate-astro/migrated.test.mjs
```
