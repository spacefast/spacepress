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
├── spacepress.config.ts   # Entry point: defineConfig() + re-exports
├── tsconfig.json          # Maps "spacepress", "spacepress/*", "spacepress:db"
├── sp/
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

## What to commit to Git

Commit everything you author (`spacepress.config.ts`, `sp/schema.ts`, `sp/app/`, `content/`, `emails/`, `public/`) **plus** these compiler lock/ledger files:

- `sp/_generated/migrations/` (sortable folders containing `ops.json` and `migration.sql`) — tracks schema history for safe incremental deploys.
- `sp/_generated/wp-plugins.lock.json` — locks WordPress plugin versions and SHA-256 checksums.
- `sp/_generated/plugins.lock.json` — locks capability grants for `use` plugin packages.
- `sp/_generated/abilities.json` & `sp/_generated/runtime-schema.json` — when using pulled WordPress Abilities or runtime schema versions.

`sp/dist/` is a build artifact and is typically git-ignored.
