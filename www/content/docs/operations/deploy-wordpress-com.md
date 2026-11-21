---
uid: zr_41c9d0b1a28e7f34c003
title: Deploy on WordPress.com
description: Deploy a SpacePress app to a plugin-enabled WordPress.com site with typedpress plugin and typedpress push.
order: 5
status: published
publishedAt: 2026-11-21T10:02:00.000Z
---
[WordPress.com](https://wordpress.com) Business and Commerce plans run on WP Cloud with full custom plugin support, PHP 8.2+, WordPress 7.1+, SSH/WP-CLI access, and Application Passwords.

## Prerequisites

- A plugin-enabled **WordPress.com** plan (Business or Commerce) on **WordPress 7.1+** and **PHP 8.2+**
- Administrator permissions on the site

## 1. Generate and upload the SpacePress plugin

Build `typedpress.zip` locally:

```bash
npx typedpress plugin --out typedpress.zip
```

Upload and activate it via **Plugins → Add New Plugin → Upload Plugin** in `wp-admin` (or via SSH/WP-CLI on your WordPress.com site):

```bash
wp plugin install typedpress.zip --activate --force
```

Activating the plugin installs the pinned runtime dependencies automatically.

## 2. Authenticate and deploy

Run `typedpress login` to authorize an Application Password in your browser, inspect the dry-run plan, and push:

```bash
npx typedpress login https://your-site.example
npx typedpress push --dry-run
npx typedpress push
```

SpacePress uploads the compiled PHP runtime and app trees, runs any new numbered SQL migrations in `tp/_generated/migrations/`, configures pretty permalinks, creates app routes, and activates the build atomically.

## 3. Sync content and verify

Sync any Markdown-backed collections and run `doctor` to verify live health and links:

```bash
npx typedpress sync --site https://your-site.example
npx typedpress doctor --site https://your-site.example --links
```

## WordPress.com hosting notes

- **Static assets under `public/`:** Like Pressable, WordPress.com runs on WP Cloud's nginx stack, which intercepts top-level `.js`, `.wasm`, and `.txt` requests before PHP and reserves `/files/*` for legacy Multisite rewrites. Place downloadable assets outside `/files/`, and copy root `.js`/`.wasm` files into `/srv/htdocs/` if your site ships custom browser bundles in `public/`.
- **Rollbacks:** Earlier builds stay in the site's build store so you can switch back to a previous release in `wp-admin` without re-uploading. Note that switching code does not revert applied SQL migrations.
