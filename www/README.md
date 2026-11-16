# The TypedPress site

The site for TypedPress, built as a TypedPress app:
a one-page guide, a playground, examples with their GitHub stars, docs from Markdown, and a blog.
WordPress serves all of it. It is also the app TypedPress is tested with: it uses content kinds,
tables, server functions, a background job, an HTTP route, pages, Markdown sync and TypedPress Admin.

| URL | What | Written as |
|---|---|---|
| `/` | the guide, one page | `tp/app/page.tsx` and one TSX file per section in `tp/components/guide/` |
| `/play` | the playground | `tp/app/play/page.tsx` and `browser/play.js` |
| `/examples` | the examples, with links to their code and star counts | `tp/app/examples/page.tsx`, the `examples` table and the `refreshStars` job |
| `/api/examples.json` | the same list as JSON | `tp/app/api/examples.json/route.ts` |
| `/docs/...` | the docs | Markdown in `content/docs/`, rendered by `tp/app/docs/[...path]/page.tsx` |
| `/blog`, `/blog/<slug>` | the blog | WordPress content; `tp/app/blog/` renders it in the site's layout |
| `/wp-admin/new/` | TypedPress Admin | shipped with the build |

## Run it

```sh
cargo build --release                                   # ../target/release/typedpress
(cd ../docs-site && pnpm install && pnpm wasm && pnpm showcase)   # the browser compiler and the example builds
(cd ../examples/reading-list && npm ci --ignore-scripts)
bun install && bun scripts/build.mjs                    # public/ and tp/data/sources.ts
../target/release/typedpress dev --port 8960 --detach        # http://localhost:8960/
```

Then send the Markdown in `content/` to the site, once and after each change to it:

```sh
PW=$(../target/release/typedpress wp user application-password create admin typedpress-sync --porcelain | tail -1)
TP_APP_PASSWORD="admin:$PW" ../target/release/typedpress sync
```

Run `SITE_URL=<site-url> bun run seed` with `TP_APP_PASSWORD` in the environment to add
the build's featured examples. Repeating it retains existing rows and their star counts.

Stop with `../target/release/typedpress dev stop`. The local login is `admin` / `typedpress-test-admin`.

`typedpress dev` rebuilds the pages when a TypeScript file is saved. Run `bun scripts/build.mjs` again
after changing `browser/` or `examples/`.

## Where things are

| Path | What |
|---|---|
| `typedpress.config.ts` | the site's name; re-exports the schema and the server function |
| `tp/schema.ts` | `docs` and `posts` (WordPress content, synced from `content/`); `shares` and `examples` (tables) |
| `tp/server.ts` | `share` saves a playground edit; `refreshStars` is the job that asks GitHub for star counts; `refreshStarsNow` lets an admin start it |
| `tp/app/layout.tsx`, `site.css` | the one layout and stylesheet every page uses |
| `tp/components/Guide.tsx` | what the guide is written with: `<Section>`, `<Ref>`, `<Code>`, `<Source>`, `<Diff>`, `<Tree>`, `<Example>`, the status badges |
| `tp/components/guide/*.tsx` | the guide's 30 sections; `sections.ts` gives their order and titles |
| `tp/components/Callout.tsx` | a component Markdown may use as a block |
| `content/docs/**/*.md`, `content/posts/*.md` | the docs and the first post |
| `examples/` | the projects and files the guide shows, and `_hero`, the app in the hero |
| `browser/code.js` | draws the guide's code, diffs and file trees with `@pierre/diffs` and `@pierre/trees` |
| `browser/play.js` | `<tp-play>`, the playground component |
| `scripts/build.mjs` | bundles `browser/` into `public/site.js`; copies the compiler, the example data and the plugin zips into `public/` |
| `scripts/sources.mjs` | writes `tp/data/sources.ts`, the text of every file in `examples/` |
| `scripts/share.mjs` | lets another machine open the dev site (below) |
| `tests/site.test.mjs` | reads the running site in Chromium |

Git-ignored: `public/`, `tp/data/sources.ts`, `tp/dist/`, `.tp/` except `.tp/sync-base.json`.

## Writing the guide

A section is a component. To add one, write `tp/components/guide/<id>.tsx`, add `{ id, title }`
to `sections.ts` at its place, and add the component to `tp/app/page.tsx`. Numbers, the table
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
with the edited build installed. `/play?example=pantry&file=typedpress.config.ts` links to an example
and a file.

Share posts the files that differ from the example to `share` (`tp/server.ts`), which stores
them in the `shares` table and answers with a key; `/play?s=<key>` opens them. Visitors cannot
list saved edits: the table's access is `admin`, and the page reads one row as the system.

## Examples and stars

`examples` is a table: name, title, summary, the GitHub repository and the folder inside it, and
`stars` with `starsAt`. An admin adds rows (TypedPress Admin, or `POST /__tp/api/v1/examples`).

`refreshStars` is a `job`: it runs on WordPress's job queue (Action Scheduler), asks
`https://api.github.com/repos/<owner>/<name>` once per repository and stores the count. Nothing
polls. `/examples` enqueues it, with the key `refresh-stars` so it is queued once, when a row was
last checked more than a day ago; `refreshStarsNow` enqueues it for an admin. GitHub is asked
without a token (60 requests an hour), so a private repository has no count and the page says
"no public star count". The repository these rows name is private today.

The playground's "This website" entry is this folder's own `typedpress.config.ts` and `tp/`, put
into `public/play-data.json` by `scripts/run-data.ts`.

## Tests

```sh
SITE_URL=http://localhost:8960 node --test tests/site.test.mjs
```

Ten tests against the running site: the guide's sections and drawn code, the guide without
JavaScript, phone width, the docs' navigation and highlighted code, an edit that builds a
migration and is shared and reopened, an announced syntax error, the examples page with its JSON
and its playground link, the blog from the menu to a post, and that a visitor can neither start the star job nor list `/shares`. `CHROMIUM=<path>` names the browser when Playwright's own is not installed. They are
not wired into CI yet.

## Opening it from another machine

`typedpress dev` listens on this machine's loopback only, and WordPress writes `http://localhost:8960`
into every page. `scripts/share.mjs` forwards to it and rewrites that address in text answers:

```sh
PUBLIC=https://<this-machine>.<tailnet>.ts.net:8960 node scripts/share.mjs &   # listens on 127.0.0.1:8961
tailscale serve --bg --https=8960 http://127.0.0.1:8961                        # tailnet only
tailscale serve --https=8960 off                                               # to stop
```

It must not pass `X-Forwarded-*` headers on: WordPress then writes `https://localhost:8960`.

## What TypedPress lacks for this site (15 November 2026)

- **WordPress's own posts as a kind.** The blog is an app collection for now (post type
  `tp_posts`, under Collections in TypedPress Admin, not under WordPress's Posts). It moves to
  `wp.posts` when that lands; `/blog` and `/blog/<slug>` stay the same.
- **Reading a file from a page.** There is no text import, so `scripts/sources.mjs` copies the
  example files into a TypeScript module.
- **A code component for TSX.** Markdown code fences are highlighted in PHP; TSX has nothing, so
  the guide's code is drawn by a browser script.
- **npm imports in browser code.** `browser/` is bundled by Bun into one file in `public/` and
  loaded through `metadata.scripts`. The bundle keeps eleven grammars and two themes of the
  highlighter; a file in another language shows as plain text.
- **Playground plugin source.** Set `PLUGINS_URL` to the destination site when building.
  Public files allow cross-origin reads; verify that the host preserves those headers.
  The current default is the earlier published guide, until a destination is selected.
- **Theme styles.** The active theme's styles load after the app's and set `body` colours and
  fonts, so the site's base rules are under `body.typedpress-app`.
- **Public files still boot WordPress.** Serving them before WordPress initializes is unfinished.
  Stylesheet and image changes do rebuild under `typedpress dev`.
- **JSX only compiles in `tp/components/`, pages and client components**, which is why the
  guide's sections are under `tp/components/guide/`.
- **A docs page is a 404 to WordPress's main query.** `/docs/...` answers 200 with the right
  content, but `<body>` has the class `error404` and the answer carries `Expires: 1984`. It is
  being fixed in TypedPress (branch `tp/docs-kind-query`); nothing here works around it. When the
  fix is on main, add a test that a docs page has no `error404` class.
- **Smaller things in server code.** A timestamp field takes an ISO string on write, not a
  `Date`. `await response.json()` is `unknown`, so it needs `as { … }`. An object indexed by a
  prop needs a fixed set of keys, so lookups here use an array and `.find`.
- **`typedpress sync` in a subfolder of a repository** prints a `git add` error for the ignored
  `.tp/` folder. The sync itself applies.
