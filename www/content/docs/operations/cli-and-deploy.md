---
uid: zr_3f4039830d3c09ef98d3
title: CLI & Deployment
description: Build, check, export, push, doctor, plugin packaging, and production hosting options.
order: 1
status: published
publishedAt: 2026-11-21T09:14:00.000Z
---
## Core build & deploy commands

- `spacepress dev` / `dev stop` / `dev status` — manage the local WordPress + SQLite site.
- `spacepress check [--json] [--frozen]` — compile and report diagnostics without writing output.
- `spacepress build` — emit WordPress plugins into `sp/dist/wp-content/plugins/`, migrations, types, client, and OpenAPI.
- `spacepress export [--site <url>]` — prebuild `sp/app/` into `sp/dist/static/` (`output: "static"`).
- `spacepress plugin` — package an uploadable `spacepress.zip` plugin for `wp-admin`.
- `spacepress login <site-url>` & `spacepress push` — authenticate via WordPress Application Passwords and deploy directly to a remote WordPress site.
- `spacepress doctor [--links]` — verify build integrity, live site plugins, and crawl internal links/anchors.

## Site operations (WP-CLI bridge)

Target local dev (default) or any remote site (`--site <dir | workspace | @alias>`):

- `spacepress wp <args...>` — run any WP-CLI command.
- `spacepress migrate`, `seed`, `jobs`, `staged`, `publish-due`, `identity`, `find`, `insert`, `update`, `delete`, `action`, `abilities`, `run`.

`spacepress migrate` accepts flags and applies the current project’s database migrations. To import an existing project, install the repository’s standalone `migrate/` package and run `spacepress-migrate --from <source> <operation>`.

## Hosting & deployment guides

SpacePress runs anywhere WordPress 7.1+ and PHP 8.2+ run:

- **[Deploy on Spacefast](/docs/operations/deploy-spacefast)**
- **[Deploy on Pressable & WordPress.com (WP Cloud)](/docs/operations/deploy-wp-cloud)**
- **[Deploy on Self-hosted WordPress](/docs/operations/deploy-self-hosted)** — server requirements & everywhere else

## Sealed mode & plugin lockfile

Declare third-party WordPress plugins in `defineConfig({ plugins: { ... }, sealed: true })`. Exact versions and SHA-256 checksums are locked in `sp/_generated/wp-plugins.lock.json`, and sealed mode refuses activation of undeclared plugins.

[Gutenberg](https://wordpress.org/plugins/gutenberg/) is optional. Add `gutenberg: "24.4.1"` under `plugins` to install the supported version. The allowed range is 24.4.1 up to, but excluding, 24.4.2. [Enable experimental collaboration in SpacePress Admin](/docs/operations/admin#enable-experimental-collaborative-editing).
