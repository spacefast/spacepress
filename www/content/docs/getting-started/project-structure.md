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
├── typedpress.config.ts   # Entry point: defineConfig() + re-exports
├── tsconfig.json          # Maps "typedpress", "typedpress/*", "typedpress:db"
├── tp/
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

Commit everything you author (`typedpress.config.ts`, `tp/schema.ts`, `tp/app/`, `content/`, `emails/`, `public/`) **plus** these compiler lock/ledger files:

- `tp/_generated/migrations/` (sortable folders containing `ops.json` and `migration.sql`) — tracks schema history for safe incremental deploys.
- `tp/_generated/wp-plugins.lock.json` — locks WordPress plugin versions and SHA-256 checksums.
- `tp/_generated/plugins.lock.json` — locks capability grants for `use` plugin packages.
- `tp/_generated/abilities.json` & `tp/_generated/runtime-schema.json` — when using pulled WordPress Abilities or runtime schema versions.

`tp/dist/` is a build artifact and is typically git-ignored.
