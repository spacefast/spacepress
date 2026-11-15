# The TypedPress site

The site for TypedPress (the framework called First in the code today), built as a First app:
a one-page guide, a playground, docs from Markdown, and a blog. WordPress serves all of it.

| URL | What | Written as |
|---|---|---|
| `/` | the guide, one page | `first/app/page.tsx` and one TSX file per section in `first/components/guide/` |
| `/play` | the playground | `first/app/play/page.tsx` and `browser/play.js` |
| `/docs/...` | the docs | Markdown in `content/docs/`, rendered by `first/app/docs/[...path]/page.tsx` |
| `/blog`, `/blog/<slug>` | the blog | WordPress content; `first/app/blog/` renders it in the site's layout |
| `/wp-admin/new/` | First Admin | shipped with the build |

## Run it

```sh
cargo build --release                                   # ../target/release/first
(cd ../docs-site && pnpm install && pnpm wasm && pnpm showcase)   # the browser compiler and the example builds
(cd ../examples/reading-list && npm ci --ignore-scripts)
bun install && bun scripts/build.mjs                    # public/ and first/data/sources.ts
../target/release/first dev --port 8960 --detach        # http://localhost:8960/
```

Then send the Markdown in `content/` to the site, once and after each change to it:

```sh
PW=$(../target/release/first wp user application-password create admin first-sync --porcelain | tail -1)
FIRST_APP_PASSWORD="admin:$PW" ../target/release/first sync
```

Stop with `../target/release/first dev stop`. The local login is `admin` / `first-test-admin`.

`first dev` rebuilds the pages when a TypeScript file is saved. Run `bun scripts/build.mjs` again
after changing `browser/` or `examples/`.

## Where things are

| Path | What |
|---|---|
| `first.config.ts` | the site's name; re-exports the schema and the server function |
| `first/schema.ts` | `docs` and `posts` (WordPress content, synced from `content/`), and `shares` (a table) |
| `first/server.ts` | `share`: saves a playground edit and answers with its key |
| `first/app/layout.tsx`, `site.css` | the one layout and stylesheet every page uses |
| `first/components/Guide.tsx` | what the guide is written with: `<Section>`, `<Ref>`, `<Code>`, `<Source>`, `<Diff>`, `<Tree>`, `<Example>`, the status badges |
| `first/components/guide/*.tsx` | the guide's 30 sections; `sections.ts` gives their order and titles |
| `first/components/Callout.tsx` | a component Markdown may use as a block |
| `content/docs/**/*.md`, `content/posts/*.md` | the docs and the first post |
| `examples/` | the projects and files the guide shows, and `_hero`, the app in the hero |
| `browser/code.js` | draws the guide's code, diffs and file trees with `@pierre/diffs` and `@pierre/trees` |
| `browser/play.js` | `<tp-play>`, the playground component |
| `scripts/build.mjs` | bundles `browser/` into `public/site.js`; copies the compiler, the example data and the plugin zips into `public/` |
| `scripts/sources.mjs` | writes `first/data/sources.ts`, the text of every file in `examples/` |
| `scripts/share.mjs` | lets another machine open the dev site (below) |
| `tests/site.test.mjs` | reads the running site in Chromium |

Git-ignored: `public/`, `first/data/sources.ts`, `first/dist/`, `.first/` except `.first/sync-base.json`.

## Writing the guide

A section is a component. To add one, write `first/components/guide/<id>.tsx`, add `{ id, title }`
to `sections.ts` at its place, and add the component to `first/app/page.tsx`. Numbers, the table
of contents and "section N" links follow `sections.ts`.

```tsx
<Section id="pages" />                                   // the numbered heading
<p>See section <Ref to="server" />.</p>                  // a link that shows that section's number
<Code file="tp/schema.ts" note="…">{`…`}</Code>          // code written here
<Code lang="sh">{`…`}</Code>                             // a snippet with no file
<Source path="_built/functions.php" as="…" />            // a file from examples/
<Diff old="_built/schema.before.ts" new="_built/schema.after.ts" />
<Tree>{`listing: two spaces per level, folders end with /, then two spaces and a note`}</Tree>
<Example name="notes" open="tp/schema.ts" />             // a whole project from examples/notes/
<tp-play example="tasks" hint="…" />                     // the playground component, closed until pressed
```

Code, diffs and trees reach the browser as text inside custom elements. `browser/code.js` draws
them. Without JavaScript the text is still there, in monospace.

## The playground component

```html
<tp-play example="tasks"></tp-play>                 closed until "Edit and build this" is pressed
<tp-play example="tasks" open></tp-play>            started at once (the hero)
<tp-play example="full-site" picker share open>     with an example menu and a Share button (/play)
```

It compiles in the browser with `public/compiler.wasm`, the same compiler as the command line.
It shows every file the build writes, with one line on what each is, the diff from the previous
build, and a Download button for the file on screen. Build errors are listed with
`file:line:column` in a `role="alert"` region. "Run in WordPress" starts WordPress Playground
with the edited build installed. `/play?example=pantry&file=first.config.ts` links to an example
and a file.

Share posts the files that differ from the example to `share` (`first/server.ts`), which stores
them in the `shares` table and answers with a key; `/play?s=<key>` opens them. Visitors cannot
list saved edits: the table's access is `admin`, and the page reads one row as the system.

## Tests

```sh
SITE_URL=http://localhost:8960 node --test tests/site.test.mjs
```

Seven tests against the running site: the guide's sections and drawn code, the guide without
JavaScript, phone width, the docs' navigation and highlighted code, an edit that builds a
migration and is shared and reopened, an announced syntax error, and that `/shares` is not
listable. `CHROMIUM=<path>` names the browser when Playwright's own is not installed. They are
not wired into CI yet.

## Opening it from another machine

`first dev` listens on this machine's loopback only, and WordPress writes `http://localhost:8960`
into every page. `scripts/share.mjs` forwards to it and rewrites that address in text answers:

```sh
PUBLIC=https://<this-machine>.<tailnet>.ts.net:8960 node scripts/share.mjs &   # listens on 127.0.0.1:8961
tailscale serve --bg --https=8960 http://127.0.0.1:8961                        # tailnet only
tailscale serve --https=8960 off                                               # to stop
```

It must not pass `X-Forwarded-*` headers on: WordPress then writes `https://localhost:8960`.

## What First lacks for this site (15 November 2026)

- **WordPress's own posts as a kind.** The blog is an app collection for now. It moves to
  `wp.posts` when that lands, and is out of the menu until then.
- **Reading a file from a page.** There is no text import, so `scripts/sources.mjs` copies the
  example files into a TypeScript module.
- **A code component for TSX.** Markdown code fences are highlighted in PHP; TSX has nothing, so
  the guide's code is drawn by a browser script.
- **npm imports in browser code.** `browser/` is bundled by Bun into one file in `public/` and
  loaded through `metadata.scripts`. The bundle keeps eleven grammars and two themes of the
  highlighter; a file in another language shows as plain text.
- **Cross-origin `public/` files.** WordPress Playground fetches First's plugin zips from another
  origin and First sends no `Access-Control-Allow-Origin`, so the zips come from the published
  site (`plugins` in `play-data.json`; `PLUGINS_URL=… bun scripts/build.mjs` changes it).
- **Theme styles.** The active theme's styles load after the app's and set `body` colours and
  fonts, so the site's base rules are under `body.first-app`.
- **A `.css` save does not rebuild** under `first dev`; save a TypeScript file.
- **JSX only compiles in `first/components/`, pages and client components**, which is why the
  guide's sections are under `first/components/guide/`.
