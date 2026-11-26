---
uid: zr_3f4039830d3c09ef98d3
title: CLI & Deployment
description: Build, check, export, push, doctor, plugin packaging, and production hosting options.
order: 1
status: published
publishedAt: 2026-11-21T09:14:00.000Z
---
## Build commands

These run on the project's files. `spacepress help <command>` shows each one's arguments.

| Command | What it does |
|---|---|
| `spacepress dev` / `dev stop` / `dev status` | Start the local WordPress + SQLite site and rebuild on change; stop it, keeping its data; report it. |
| `spacepress check [--json] [--frozen] [--fix]` | Compile and report problems without writing output. `--fix` applies lint fixes. `--json` includes each route's cache plan. |
| `spacepress build [--frozen]` | Write the WordPress plugins to `sp/dist/wp-content/plugins/`, plus migrations, types, `api`, the typed client and OpenAPI. `--frozen` fails when a lock would change. |
| `spacepress export [--site <url>]` | Write `sp/app/` as a static site to `sp/dist/static/` (`output: "static"`). |
| `spacepress add <module>` | Copy `shop`, `db` or `api-reference` into the project as files you own. |
| `spacepress init [--github] [--check]` | Write `AGENTS.md`, `.mcp.json` and the agent skills. See [MCP & AI Agents](/docs/operations/mcp-and-agents). |
| `spacepress sync` | Sync content files with site records. See [Markdown sync](/docs/integrations/markdown-sync). |
| `spacepress plugin [--out spacepress.zip]` | Write the SpacePress plugin to upload in wp-admin. |
| `spacepress login <site-url>` / `logout` | Approve an application password for a site in the browser, or forget it. |
| `spacepress push [--dry-run]` | Compile, install the plugins the build needs, upload it, show what it changes, and make it live. |
| `spacepress doctor [--site <url> [--links]]` | Check a build and a running site. `--links` follows every link and `#anchor` its pages make. |
| `spacepress pull` / `styles pull` / `abilities pull` | Write a site's runtime schema versions, Global Styles, or Abilities into `sp/`. |

In CI, set `SP_APP_PASSWORD=user:application-password` (or `SP_TOKEN`) instead of running `spacepress login`.

## Site commands (WP-CLI bridge)

These run as `wp spacepress <command>` on the project's dev site by default, or on another site with `--site <dir | workspace | @alias>`:

- `spacepress wp <args...>` runs any WP-CLI command.
- `migrate`, `seed`, `jobs`, `staged`, `publish-due`, `identity`, `abilities`, `run`, `action`, `find`, `insert`, `update`, `delete`, `git-dispatch` and `schema` manage the app's data and background work.
- `danger` (`status`, `plan`, `drop-column`, `drop-table`, `purge-deleted`, `raw-sql`) is the CLI-only escape hatch for destructive cleanup. It works only when `spacepress.config.ts` lists `destructiveMigrations()` from `spacepress/danger` in `use`.

`spacepress migrate` applies the project's pending database migrations, checked against live rows. To import an existing project from another stack, install the repository's standalone `migrate/` package and run `spacepress-migrate --from <source> <operation>`.

## Hosting & deployment guides

SpacePress runs anywhere WordPress 7.1+ and PHP 8.2+ run:

- **[Deploy on Spacefast](/docs/operations/deploy-spacefast)**
- **[Deploy on Pressable & WordPress.com (WP Cloud)](/docs/operations/deploy-wp-cloud)**
- **[Deploy on Self-hosted WordPress](/docs/operations/deploy-self-hosted)** — server requirements & everywhere else

## Sealed mode & plugin lockfile

Declare third-party WordPress plugins in `defineConfig({ plugins: { ... }, sealed: true })`. Exact versions and SHA-256 checksums are locked in `sp/_generated/wp-plugins.lock.json`, and sealed mode refuses activation of undeclared plugins.

[Gutenberg](https://wordpress.org/plugins/gutenberg/) is optional. Add `gutenberg: "24.4.1"` under `plugins` to install the supported version. The allowed range is 24.4.1 up to, but excluding, 24.4.2. [Enable experimental collaboration in SpacePress Admin](/docs/operations/admin#enable-experimental-collaborative-editing).
