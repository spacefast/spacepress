# Field Notes

A complete First site: TSX pages and layouts under `first/app/`, a note's own
URL (`/notes/<slug>`) rendered from its row, a stylesheet, a CSS module and an
SVG imported from TSX, a `"use client"` cheer button on the Interactivity API,
and two HTTP routes (`route.ts`): a JSON Feed and a signed webhook. WordPress
stays the content editor, and every page reads as the visitor.

This publication pins Yoast SEO Free 28.8 for head metadata and JSON-LD. The
note route opts into Article schema, and the public `/notes` Page supplies its
breadcrumb parent. See the [SEO adapter reference](../../docs/seo.md) for
metadata precedence and the exact plugin checksum.

| File | What it does |
|---|---|
| `first.config.ts` | The `notes` collection (served at `/notes/:slug`) and the `cheers` table |
| `first/actions.ts` | `cheer`, the one public action |
| `first/app/layout.tsx` | The site's header, nav and footer; imports `global.css` |
| `first/app/page.tsx`, `notes/page.tsx`, `notes/featured/page.tsx` | Listings of published notes |
| `first/app/notes/[slug]/page.tsx` | One note, its body through `the_content`, and its cheer button; uses `note.module.css` |
| `first/app/about/page.tsx` | A prebuilt page (`export const prerender = true`) that imports `compass.svg` |
| `first/app/applause/page.tsx` | Every note with a cheer button |
| `first/components/CheerButton.tsx` | The `"use client"` component: state, a handler, an action call |
| `first/app/api/feed.json/route.ts`, `webhooks/stripe/route.ts` | HTTP routes outside `/wp-json` |

Run it locally:

```sh
first dev examples/full-site --port 8872
```

Open the URL `first dev` prints, then `/wp-admin/` to write and publish Notes.
`/notes/` and `/notes/<slug>` read the saved content on every request, a draft
is a 404 to visitors, and desk notes show only to staff. `/about` is prebuilt:
WordPress writes it to a file in the background and serves the file before it
parses the request (the response carries `X-First-Prebuilt: 1`). The cheer button
updates in place and stores its count. Edit any page and `first dev` rebuilds.

`tests/wp/hosted-pages-run.sh` runs the same site on WordPress and MariaDB from
`first compile-sources` output, as a host serves it, and clicks the cheer
button in Chromium. The [Pages guide](../../docs/pages.md) documents the TSX
subset.
