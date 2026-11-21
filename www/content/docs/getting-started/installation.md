---
uid: zr_7920cac7a56f3e471e53
title: Installation & Setup
description: Requirements, creating a new app, and starting the local WordPress development environment.
order: 1
status: published
publishedAt: 2026-11-21T09:01:00.000Z
---
## Requirements

- **Node.js 22 or newer** and npm
- No Docker and no Rust toolchain required — the `typedpress` npm package downloads a prebuilt native compiler binary automatically.

## Create a new application

```bash
npm create typedpress@0.3.0 my-app
cd my-app
npm run dev
```

`create-typedpress` creates a complete starter project with:

- `typedpress.config.ts` defining a synced `notes` collection and `site` global
- `tp/app/` with a layout, home page, dynamic `/notes/[slug]` page, and a progressive `<form action={greet}>`
- `content/notes/` sample Markdown content
- `AGENTS.md`, `.mcp.json`, and coding-agent skills generated via `typedpress init`

## Running locally

`npm run dev` invokes `typedpress dev`, which compiles your TypeScript, boots a local WordPress + SQLite server, activates the compiled plugins, and rebuilds automatically on file changes.

- Open the printed site URL to view your rendered TSX pages.
- Open `/wp-admin/new/` to explore SpacePress Admin (or `/wp-admin/` for classic wp-admin).
- Stop the dev server without deleting local data via `npm run stop` (`typedpress dev stop`).

## Adding modules

Add first-party modules as source files you own at any time:

```bash
npx typedpress add shop           # WooCommerce storefront & catalog
npx typedpress add db             # SQL table starter
npx typedpress add api-reference  # /api documentation pages from OpenAPI
```
