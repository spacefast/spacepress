# The TypedPress guide

Source of <https://typedpress-guide.space.fast/>: one page that describes the whole framework, and a
playground page that compiles an app in the browser and runs it in WordPress.

`../typedpress-guide/` is this folder's build output and is not committed. Never edit it by hand.

```sh
# once, and again when src/ or examples/ change: the browser compiler, the native compiler and
# the example builds this page reuses
(cd ../../docs-site && pnpm install && pnpm wasm && pnpm showcase)
(cd ../../examples/reading-list && npm ci --ignore-scripts)   # the one example with npm packages

bun install
bun build.mjs                      # writes ../typedpress-guide/
cd ../typedpress-guide && sf publish . -m "<what changed>" -y --wait
```

`SITE_URL=http://127.0.0.1:8931 bun build.mjs` builds a copy whose "Run in WordPress" fetches the
plugin zips from a local server instead of the published site.

## Files

| File | What it is |
| --- | --- |
| `guide.html` | The guide. Plain HTML with four source tags, listed below |
| `examples/notes`, `pantry`, `garden` | The three whole projects the guide shows, in the decided spelling. They are translations of `examples/full-site`, `examples/pantry`, `examples/garden` and `examples/astro-garden` |
| `examples/_today` | Copies of today's example files, for the "today and after" diffs |
| `examples/_built` | Real compiler output shown on the page: PHP, SQL migrations |
| `examples/_compare` | Other systems' own quickstart files, copied unchanged, and the same task in TypedPress |
| `build.mjs` | Renders every code block, file tree and diff at build time, numbers the sections, builds the table of contents, and assembles the playground |
| `client.js` | Makes the pre-rendered trees clickable |
| `play.html`, `play.js` | The playground page |
| `run-data.ts` | Collects each featured example's sources and what "Run in WordPress" needs, through `docs-site/lib` |

## Source tags in `guide.html`

| Tag | Renders |
| --- | --- |
| `<tp-code file="tp/schema.ts" note="…">` | a file with its path in the header; `src="examples/…"` reads the code from a file |
| `<tp-code lang="ts">` | a snippet with no file |
| `<tp-tree>` | a file tree, from an indented listing with `name   note` per line |
| `<tp-diff old="…" new="…" old-name="…" new-name="…">` | a diff of two files |
| `<tp-example dir="examples/notes" open="tp/schema.ts">` | a whole project: tree on the left, files on the right |

Section numbers are not written in the source. An `<h2 id="x">` gets its number from its position,
and `{{sec:x}}` in the text becomes that number.

## What is reused and what is not

- **Rendering:** `@pierre/diffs` and `@pierre/trees` (<https://diffs.com>, Apache-2.0). The guide is
  pre-rendered with their `ssr` entry points; the playground uses their `File`, `FileDiff`, `Editor`
  and `FileTree` in the browser.
- **Compiler in the browser:** `docs-site/public/compiler.wasm`, built from `src/wasm.rs`, through
  `docs-site/lib/compiler.ts`.
- **Run in WordPress:** `docs-site/lib/blueprint.ts` builds the WordPress Playground blueprint. The
  app plugin is what the browser compile returned; the runtime, identity and admin plugins are the
  zips `pnpm showcase` wrote, published under `files/plugins/`.
- **Not reused:** `docs-site/pages/playground.astro` and `docs-site/lib/playground.ts`. They are an
  Astro page inside the Blume site and edit one file in a textarea. This page is standalone HTML
  and edits with the diffs library's editor.

## Two host facts found while publishing (2026-11-15)

- Spacefast serves `foo.html` at `/foo` and redirects `/foo.html` there, keeping the query string.
- WordPress Playground fetches the plugin zips from another origin, so each needs exactly one
  `Access-Control-Allow-Origin` header. With no `_headers` rule for `/files/*` the zips had none.
  With a rule that set that header they had two, which browsers refuse. A rule that sets any other
  header makes the request go through the Spacefast runtime, which adds the header once. `build.mjs`
  writes that rule.

## Checked by hand, not by a test suite

There is no automated test here. On 2026-11-15 these were checked in headless Chromium against a
local build: the guide in dark, light, phone width and with JavaScript off; in the playground a
typed edit, the new migration it produced, both diff views, a compile error and undo; and "Run in
WordPress" for all four examples, including an edited page that WordPress then served.
