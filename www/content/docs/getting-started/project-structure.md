---
uid: zr_e76e7a887030c99a122b
title: Project Structure
description: Layout of a SpacePress repository, authored files vs generated artifacts.
order: 2
status: published
publishedAt: 2026-11-21T09:02:00.000Z
---
## Directory layout

```text
my-app/
├── spacepress.config.ts   # Entry point: defineConfig({ dir? }) + re-exports
├── tsconfig.json          # Standard bundler resolution ("spacepress", "spacepress/server/*", "@spacepress/client")
├── sp/                    # Default SpacePress app root (customizable via defineConfig({ dir }))
│   ├── schema.ts          # Collections, SQL tables, globals, taxonomies, stores
│   ├── server.ts          # Actions, background jobs, mail helpers
│   ├── app/               # File-based TSX pages, layouts, and route.ts handlers
│   ├── components/        # Server and "use client" components
│   ├── wp-hooks/          # Typed WordPress core action & filter handlers
│   ├── _generated/        # db.d.ts, routes.d.ts, openapi.json, client/, migrations/
│   └── dist/wp-content/   # Compiled WordPress plugins ready to deploy
├── content/               # Markdown/JSON content synced with WordPress
├── emails/                # React Email (.tsx) templates
└── public/                # Static assets served from site root
```

## Customizing the app root directory (`dir`)

SpacePress defaults to `sp/` so it coexists cleanly beside an existing `index.html`, Next.js, or Astro app at the repository root. Set `dir` in `spacepress.config.ts` to move all SpacePress source, `_generated/`, and `dist/` paths into another relative folder (for example `"cms"` or `"backend"`):

```ts
import { defineConfig } from "spacepress";

export default defineConfig({
  name: "my-app",
  dir: "cms",
});
```

Every compiler pass, route scanner (`cms/app/`), `cms/wp-hooks/`, `cms/_generated/`, `cms/dist/`, `spacepress add`, `spacepress init`, and `create-spacepress --dir cms` follows the configured `dir`.

## Import boundaries

The import path tells you where the code runs:

| Import path | Runs on | What it provides |
|---|---|---|
| `"spacepress"` | Anywhere (DSL & types) | `defineConfig`, `collection`, `table`, `global`, `query`, `mutation`, `job`, `cron`, `env`, field builders, shared types |
| `"spacepress/server"` | Server only (PHP) | `db`, `HttpError`, `once`, `mail`, `connectors` |
| `"spacepress/server/db"` | Server only (PHP) | App kinds by registered name (`import { posts } from "spacepress/server/db"`) |
| `"spacepress/app"` | Pages & layouts | Page/layout UI & routing primitives (`Link`, `Content`, `Html`, `Image`, `Live`, `useFormState`, `notFound`, `redirect`; per-route `PageProps`/`LayoutProps`/`StaticParams` via `./$types`) |
| `"spacepress/content"` | Pages & layouts | `nav`, `pager`, `headings`, `apiReference` |
| `"spacepress/server/wp"` | Server only (PHP) | WordPress core functions, `abilities`, `Handler<"...">`, `WP_Post`/`WP_User`/`WP_Query` |
| `"react"` | Browser (`"use client"`) | Standard React hooks (`useState`, `useEffect`, `useRef`) lowered to the WordPress Interactivity API |
| `"spacepress/client"` & `"spacepress/react"` (also `@spacepress/client` & `@spacepress/client/react`) | Browser / Node / Bun / Deno | Typed `fetch` client (`bind`, `createClient`, WP Abilities calls) and React hooks (`useLive`, `useMutation`, `createHooks`, `useMount`, `useEvent`, `sharedState`, `uploadFile`) driven by typed `_generated/api` refs |

Importing `"spacepress/server"` or `"spacepress/server/*"` inside a `"use client"` component is refused at build time and throws in browser bundles.

## What to commit to Git

Commit everything you author (`spacepress.config.ts`, `sp/schema.ts`, `sp/app/`, `content/`, `emails/`, `public/`) **plus** these compiler lock/ledger files:

- `sp/_generated/migrations/` (sortable folders containing `ops.json` and `migration.sql`) — tracks schema history for safe incremental deploys.
- `sp/_generated/wp-plugins.lock.json` — locks WordPress plugin versions and SHA-256 checksums.
- `sp/_generated/plugins.lock.json` — locks capability grants for `use` plugin packages.
- `sp/_generated/abilities.json` & `sp/_generated/runtime-schema.json` — when using pulled WordPress Abilities or runtime schema versions.

`sp/dist/` is a build artifact and is typically git-ignored.
