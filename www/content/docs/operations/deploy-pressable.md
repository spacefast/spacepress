---
uid: zr_41c9d0b1a28e7f34c002
title: Deploy on Pressable
description: Deploy a SpacePress app to Pressable (WP Cloud) using the TypedPress plugin, Application Passwords, and typedpress push.
order: 4
status: published
publishedAt: 2026-11-21T10:01:00.000Z
---
[Pressable](https://pressable.com) runs managed WordPress on WP Cloud with PHP 8.2+, WordPress 7.1+, `ZipArchive`, WP-CLI over SSH, and Application Passwords enabled over HTTPS. `spacepress.dev` itself runs on Pressable.

## Prerequisites

- A Pressable site running **WordPress 7.1+** and **PHP 8.2+**
- Administrator access in `wp-admin` (or SSH/WP-CLI access)

## 1. Package and install the SpacePress plugin

Generate the uploadable host plugin (`typedpress.zip`):

```bash
npx typedpress plugin --out typedpress.zip
```

Install and activate `typedpress.zip` in **wp-admin → Plugins → Add Plugin → Upload Plugin**, or over SSH with WP-CLI:

```bash
wp plugin install typedpress.zip --activate --force
```

Activating the plugin automatically installs and activates its pinned platform dependencies (`action-scheduler`, `secure-custom-fields`, `two-factor`, `mcp-adapter`).

## 2. Sign in and push your build

Authenticate against your Pressable site and preview the deployment plan:

```bash
npx typedpress login https://your-site.example
npx typedpress push --dry-run
```

When the plan looks right, make it live:

```bash
npx typedpress push
```

In CI or non-interactive scripts, create a WordPress Application Password (`wp user application-password create <user> deploy --porcelain`) and pass `TP_APP_PASSWORD="<user>:<password>"`.

## 3. Sync Markdown content

If you use `sync: "content/**/*.md"`, push or pull Markdown edits after deploying:

```bash
npx typedpress sync --site https://your-site.example
```

## Pressable / WP Cloud hosting notes

- **Build store location:** On Pressable, PHP-FPM runs inside `/srv/htdocs` and cannot write outside it, so SpacePress automatically creates a randomized build store directory (`wp-content/typedpress-store-<random-hex>`). Keep that path private and never link to it publicly.
- **Root static files (`.js`, `.wasm`, `.txt`):** Pressable's nginx serves top-level static file extensions directly from `/srv/htdocs/` before reaching PHP. If your app ships custom scripts or WebAssembly assets under `public/` (like `public/site.js` or `public/compiler.wasm`), copy them into `/srv/htdocs/` during release so nginx serves them directly from the edge CDN.
- **Avoid `/files/` for public assets:** WP Cloud reserves `/files/*` for legacy WordPress Multisite rewrites. Place downloadable assets in another path (for example, `public/downloads/` or `public/playground-plugins/`).
