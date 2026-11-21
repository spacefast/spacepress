---
uid: zr_41c9d0b1a28e7f34c005
title: Deploy on Pressable & WordPress.com (WP Cloud)
description: Deploy a SpacePress app to Pressable or plugin-enabled WordPress.com sites running on WP Cloud using typedpress plugin and typedpress push.
order: 4
status: published
publishedAt: 2026-11-21T10:01:00.000Z
---
Both [Pressable](https://pressable.com) and plugin-enabled [WordPress.com](https://wordpress.com) plans (Business and Commerce) run on **WP Cloud** with PHP 8.2+, WordPress 7.1+, `ZipArchive`, SSH/WP-CLI access, and Application Passwords enabled over HTTPS. Deployment works identically on both — `spacepress.dev` itself runs on Pressable.

## Prerequisites

- A **Pressable** site or a plugin-enabled **WordPress.com** site (Business or Commerce) running **WordPress 7.1+** and **PHP 8.2+**
- Administrator access in `wp-admin` (or SSH/WP-CLI access)

## 1. Package and install the SpacePress plugin

Generate the uploadable host plugin (`typedpress.zip`):

```bash
npx typedpress plugin --out typedpress.zip
```

Upload and activate `typedpress.zip` in **wp-admin → Plugins → Add New Plugin → Upload Plugin**, or over SSH with WP-CLI:

```bash
wp plugin install typedpress.zip --activate --force
```

Activating the plugin automatically installs and activates its pinned platform dependencies (`action-scheduler`, `secure-custom-fields`, `two-factor`, `mcp-adapter`).

## 2. Authenticate and deploy

Sign in with WordPress Application Passwords, preview the deployment plan, and make it live:

```bash
npx typedpress login https://your-site.example
npx typedpress push --dry-run
npx typedpress push
```

`typedpress push` uploads the compiled PHP runtime and app trees, runs any new numbered SQL migrations in `tp/_generated/migrations/`, configures pretty permalinks, creates app routes, and activates the build atomically.

In CI or non-interactive scripts, create a WordPress Application Password (`wp user application-password create <user> deploy --porcelain`) and pass `TP_APP_PASSWORD="<user>:<password>"`.

## 3. Sync Markdown content & verify

If your schema uses `sync: "content/**/*.md"`, sync Markdown edits and verify live health and links:

```bash
npx typedpress sync --site https://your-site.example
npx typedpress doctor --site https://your-site.example --links
```

## WP Cloud hosting notes

- **Build store location:** On WP Cloud, PHP-FPM runs inside `/srv/htdocs` and cannot write outside it, so SpacePress automatically creates a randomized build store directory (`wp-content/typedpress-store-<random-hex>`). Keep that path private and never link to it publicly.
- **Root static files (`.js`, `.wasm`, `.txt`):** WP Cloud's nginx edge serves top-level static file extensions directly from `/srv/htdocs/` before reaching PHP. If your app ships custom browser bundles or WebAssembly assets under `public/` (such as `public/site.js` or `public/compiler.wasm`), copy them into `/srv/htdocs/` during release and purge edge cache so nginx serves them directly from the CDN.
- **Avoid `/files/` for public assets:** WP Cloud reserves `/files/*` for legacy WordPress Multisite rewrites. Place downloadable assets in another path (for example, `public/downloads/` or `public/playground-plugins/`).
- **Rollbacks:** Earlier builds stay in the site's build store so you can switch back to a previous release in `wp-admin` without re-uploading. Switching code does not revert applied SQL migrations.
