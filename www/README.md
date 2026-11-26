# `www/` — spacepress.dev

The official website and documentation for **SpacePress** (`https://spacepress.dev`), built and served as a real SpacePress application.

## What's Inside

- `spacepress.config.ts` & `sp/schema.ts` — imports the hierarchical `docs` collection from `@spacepress/docs` (`content/docs/**/*.md`), `posts` (`wp.posts.extend` synced from `content/posts/*.md` with comments), `shares` SQL table (saved Playground edits), and `examples` SQL table (curated showcase with GitHub star counts)
- `sp/server.ts` — `share` public action, `refreshStars` Action Scheduler background job, and `refreshStarsNow` admin action
- `sp/app/` — Convex-inspired landing page (`/`), Quick Start (`/quick-start`), 14-section Interactive Engineering Handbook (`/handbook`, with `/guide` redirect), Browser Playground (`/play`), Documentation (`/docs` & `/docs/[...path]`), Examples (`/examples` & `/api/examples.json`), and Blog (`/blog` & `/blog/[slug]`)
- `browser/` — client scripts bundled into `public/site.js` (`@pierre/diffs`, `@pierre/trees`, `<sp-sandbox>` inline WASM compiler, `<sp-play>` full Playground + WordPress Playground runner, copy buttons, and sticky TOC scroll spy)
- `lib/` — browser compiler wrapper, WordPress Playground blueprint generator, and example showcase loaders
- `content/` — Markdown documentation (`content/docs/**/*.md`, also embedded into `spacepress mcp`) and blog posts (`content/posts/*.md`)

## Build and run locally

Install the Node.js version in `../.node-version`, Bun 1.3.14, and the Rust
toolchain in `../rust-toolchain` with the `wasm32-unknown-unknown` target. From
the repository root, run:

```bash
PLUGINS_URL=http://localhost:8960 npm run build --prefix www
```

The command installs the locked dependencies, builds the native compiler and
WASM from this checkout, builds the featured examples and shared plugin ZIPs,
then bundles, checks, and compiles the website. WordPress is only needed to run
the compiled site. Set `WWW_FETCH_GITHUB_STARS=1` if you want the build to query
GitHub for the header badge.

```bash
cd www
../target/debug/spacepress dev --port 8960 --detach
SP_APP_PASSWORD="admin:<app-password>" ../target/debug/spacepress sync --no-commit
SP_APP_PASSWORD="admin:<app-password>" npm run seed
```

Stop the local server with `../target/debug/spacepress dev stop`. The dev site and
its content remain on disk.

## Test a fresh WordPress install

Run these commands from the repository root after building with the local
`PLUGINS_URL` above. Keep port 8960 free for the suite.

```bash
(cd www && bun x --no-install playwright-core install chromium-headless-shell)
npm exec --yes --package=typescript@5.9.3 -- tsc --project www/tsconfig.json
node scripts/check-www-examples.mjs
npm test --prefix www
```

CI installs Chromium with `--with-deps` on Linux. The suite copies the site into
a temporary project, starts WordPress on SQLite, syncs Markdown, and seeds the
examples before running Chromium. It stops and removes its own site afterward.
To use another port, set `SP_WWW_PORT` for the tests and use the same port in
`PLUGINS_URL` when building.

## Serve the Playground ZIPs

**Run in WordPress** fetches ZIPs from `/playground-plugins/` at the origin
recorded in `public/play-data.json`. Set `PLUGINS_URL` to the destination's
origin when building. The default is `https://spacepress.dev`. The destination
must send CORS headers that allow `https://playground.wordpress.net` to fetch
the ZIPs. The browser suite checks cross-origin fetches against the local build.
Chrome may prompt for local network access when you open WordPress Playground
with ZIPs hosted on localhost or a private network.
