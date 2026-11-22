# `www/` — spacepress.dev

The official website and documentation for **SpacePress** (`https://spacepress.dev`), built and served as a real SpacePress application.

## What's Inside

- `typedpress.config.ts` & `tp/schema.ts` — defines the hierarchical `docs` collection (`content/docs/**/*.md`), `posts` (`wp.posts.extend` synced from `content/posts/*.md` with comments), `shares` SQL table (saved Playground edits), and `examples` SQL table (curated showcase with GitHub star counts)
- `tp/server.ts` — `share` public action, `refreshStars` Action Scheduler background job, and `refreshStarsNow` admin action
- `tp/app/` — Convex-inspired landing page (`/`), Quick Start (`/quick-start`), 14-section Interactive Engineering Handbook (`/handbook`, with `/guide` redirect), Browser Playground (`/play`), Documentation (`/docs` & `/docs/[...path]`), Examples (`/examples` & `/api/examples.json`), and Blog (`/blog` & `/blog/[slug]`)
- `browser/` — client scripts bundled into `public/site.js` (`@pierre/diffs`, `@pierre/trees`, `<tp-sandbox>` inline WASM compiler, `<tp-play>` full Playground + WordPress Playground runner, copy buttons, and sticky TOC scroll spy)
- `lib/` — browser compiler wrapper, WordPress Playground blueprint generator, and example showcase loaders
- `content/` — Markdown documentation (`content/docs/**/*.md`, also embedded into `typedpress mcp`) and blog posts (`content/posts/*.md`)

## Build & Run Locally

```bash
cd www

# 1. Build the browser WASM compiler and showcase plugin zips (first time or after compiler/example changes)
node scripts/build-wasm.mjs
node scripts/build-showcase.ts

# 2. Bundle browser scripts, example sources, and play-data.json into public/
bun run build

# 3. Type-check & compile SpacePress plugins
../target/release/typedpress check
../target/release/typedpress build

# 4. Start local WordPress dev server (port 8960)
../target/release/typedpress dev --port 8960 --detach

# 5. Sync Markdown docs & blog posts into WordPress
../target/release/typedpress sync

# 6. (Optional) Seed the examples SQL table
TP_APP_PASSWORD="admin:<app-password>" npm run seed
```

Stop the local server at any time with `../target/release/typedpress dev stop`.

### Test Run in WordPress with local plugin ZIPs

By default, **Run in WordPress** fetches the shared plugin ZIPs from
`https://spacepress.dev/playground-plugins/`. To test ZIPs from your local build,
set `PLUGINS_URL` to the origin where your browser can reach the dev site.

```bash
PLUGINS_URL=http://localhost:8960 bun run build
```

The build copies the ZIPs to `public/playground-plugins/` and records the origin in
`public/play-data.json`. Serve the ZIPs with a CORS header that allows
`https://playground.wordpress.net`. Chrome may prompt for local network access when
the ZIPs are hosted on localhost or a private network.

## Scripts

- `node scripts/build-wasm.mjs` — builds `src/wasm.rs` (`wasm32-unknown-unknown`) into `.build/compiler.wasm`
- `node scripts/build-showcase.ts` — builds the featured `examples/*` apps and writes shared plugin zips & manifests into `.build/files/`
- `bun run build` — runs `scripts/sources.mjs`, `scripts/run-data.ts`, copies WASM + plugin zips, and bundles `browser/site.js` into `public/`
- `npm run seed` — seeds missing rows into `/wp-json/typedpress/v1/examples`
