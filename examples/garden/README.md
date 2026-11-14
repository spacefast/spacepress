# Garden: a First app

A small plant guide written as a First app. It is the native twin of
[`examples/astro-garden`](../astro-garden/README.md), which renders the same pages in Astro from this
app's content, so the two can be read side by side.

| File | What it shows |
| --- | --- |
| [`first/schema.ts`](first/schema.ts) | `plants`, a kind synced from `content/plants/*.md`, with its URL `/plants/:slug` |
| [`content/plants/`](content/plants) | The plants: one Markdown file each, front matter for the fields |
| [`first/app/page.tsx`](first/app/page.tsx) | The list, read with `db.query` as the visitor |
| [`first/app/plants/[slug]/page.tsx`](first/app/plants/[slug]/page.tsx) | One plant: the kind's URL hands the page its `item` |

## Run it

```sh
first dev examples/garden
first sync examples/garden     # pushes content/plants/ to the site, and pulls editors' changes back
```

[`examples/astro-garden/twins.test.mjs`](../astro-garden/twins.test.mjs) builds this app, seeds it
as a publish does, and reads it and its Astro twin in Chromium.
