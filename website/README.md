# The TypedPress site

A First app. The home page is the guide, with a hero you can edit and build; every example on it
can be opened for editing; `/play` is the playground. One component, `<tp-play>` (`src/play.js`),
does all three.

```sh
# once, and again when src/ or examples/ change: the browser compiler, the native compiler and
# the example builds this site reuses
(cd ../docs-site && pnpm install && pnpm wasm && pnpm showcase)
(cd ../examples/reading-list && npm ci --ignore-scripts)   # the one example with npm packages

(cd src && bun install && bun build.mjs)    # writes first/app/ and public/
../target/release/first dev --port 8960 --detach   # http://localhost:8960/
../target/release/first dev stop
```

`first dev` rebuilds when `first/app/*.tsx` or `public/` change, so `bun build.mjs` while it runs
is enough. It does not rebuild on a `.css` save alone; `build.mjs` always rewrites the pages too.

## What is written by hand and what is generated

| Path | |
| --- | --- |
| `first.config.ts`, `tsconfig.json` | the First app; by hand |
| `src/guide.html` | the guide: plain HTML with the source tags below, and the site's CSS in its `<style>` |
| `src/play.js` | the `<tp-play>` component |
| `src/client.js` | makes the guide's pre-rendered file trees clickable |
| `src/build.mjs` | renders code, trees and diffs at build time and writes the First app |
| `src/run-data.ts` | collects each app the component can load, through `docs-site/lib` |
| `src/examples/_hero` | the two-file app in the hero, with its migration ledger and plugin lock |
| `src/examples/notes`, `pantry`, `garden` | the three whole projects the guide shows, in the decided spelling |
| `src/examples/_today`, `_built`, `_compare` | today's files for the diffs; real compiler output; other systems' own quickstart files |
| `first/app/`, `public/` | **generated, git-ignored**: `layout.tsx`, `page.tsx`, `play/page.tsx`, `site.css`; scripts, `compiler.wasm`, `play-data.json`, plugin zips |

## Source tags in `src/guide.html`

| Tag | Renders |
| --- | --- |
| `<tp-code file="tp/schema.ts" note="…">` | a file with its path in the header; `src="examples/…"` reads the code from a file |
| `<tp-code lang="ts">` | a snippet with no file |
| `<tp-tree>` | a file tree, from an indented listing with `name   note` per line |
| `<tp-diff old="…" new="…" old-name="…" new-name="…">` | a diff of two files |
| `<tp-example dir="examples/notes" open="tp/schema.ts">` | a whole project: tree on the left, files on the right |
| `<tp-play example="pantry" hint="…">` | the playground component, closed until "Edit and build this" is pressed |
| `<tp-play example="tasks" open>` | the same, started at once (the hero) |

Section numbers are not written in the source. An `<h2 id="x">` gets its number from its position,
and `{{sec:x}}` in the text becomes that number.

## The component

`<tp-play example="…">` loads `compiler.wasm` (7 MB) and `play-data.json` once per page, on the
first component that starts. Attributes: `open` (start at once), `picker` (show the example menu
and keep the example and file in the address), `file` (the file to open), `hint` (the text beside
the button), `plugins` (where WordPress Playground fetches First's shared plugin zips).

- **Edit:** the left file is the diffs library's editor. "My changes" shows the diff from the example as committed.
- **Build:** 150 ms after a keystroke, with the example's migration ledger, as `first build` does.
- **What the build writes:** every file, in a tree that marks added and changed files.
- **Diff from the previous build:** two builds are kept, the last and the one before. After an
  edit the pane switches to the new or changed migration, as a diff.
- **Run in WordPress:** `docs-site/lib/blueprint.ts` turns the edited build into a WordPress
  Playground blueprint: the app plugin is what the browser build returned, the runtime, identity
  and admin plugins are the zips `pnpm showcase` wrote.

## Opening it from another machine

`first dev` listens on this machine's loopback only, and WordPress writes `http://localhost:8960`
into every page. `src/share.mjs` forwards to it and rewrites that address in text answers:

```sh
PUBLIC=https://<this-machine>.<tailnet>.ts.net:8960 node src/share.mjs &   # listens on 127.0.0.1:8961
tailscale serve --bg --https=8960 http://127.0.0.1:8961                    # tailnet only
tailscale serve --https=8960 off                                           # to stop
```

It must not pass `X-Forwarded-*` headers on: WordPress then writes `https://localhost:8960`.

## What First's pages needed, found while moving this site onto First (2026-11-15)

- Browser code is a script module in `public/`, named in the layout's `metadata.scripts`
  (`["/guide.js", "/play.js"]`). First loads each once with `wp_enqueue_script_module`. TSX
  refuses `<script>`, and that is the way around it. The layout and `play/page.tsx` are plain
  TSX; `<tp-play>` is a custom element, which TSX allows.
- A page cannot import a text file, and nothing renders a code block from TSX. So the guide page
  is still one literal passed to `<Html>`, which places a literal as written: its 80 highlighted
  blocks are rendered by this build, not by First.
- The active WordPress theme's styles load after the app's stylesheet and set `body` colours and
  fonts. The site's rules are under `body.first-app`, which outranks them.
- Addresses are from the site root (`/play`, `/pierre-diffs.css`), also inside shadow roots.
- `first dev` does not send `Access-Control-Allow-Origin` on `public/` files, and WordPress
  Playground fetches the plugin zips from another origin. So the zips come from the published
  site (`plugins` in `play-data.json`; `PLUGINS_URL=… bun build.mjs` changes it). The local and
  published zips had the same SHA-256 when this was written.
- Each `public/` file is answered by WordPress in about 200 ms under `first dev`. The playground
  used to load 28 script files (the highlighter puts every grammar and theme behind its own
  `import()`), and its code panes filled about 1.6 s after the component was ready. `build.mjs`
  now keeps the eleven grammars and two themes the site uses and writes one `public/play.js`
  (2.1 MB); the panes draw as soon as the component is ready. A file in another language shows
  as plain text.

## The published copy

<https://typedpress-guide.space.fast/> is an earlier static build of the same guide and playground
(commit `a8b3fe452`, `docs/typedpress-guide-src/`). This folder no longer writes static files, so
that Space is not updated from here.

## Checked by hand, not by a test suite

On 2026-11-15, in headless Chromium against `first dev`: both pages in dark, light and at phone
width, and the home page with JavaScript off; in the hero, two edits one after the other, the
migration each produced and the diff between the two builds; an example opened from the guide; the
menu entry and the example menu; and an edited page built in the hero and then served by WordPress
Playground with its sample data.
