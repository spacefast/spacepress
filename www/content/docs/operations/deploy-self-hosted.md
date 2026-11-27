---
uid: zr_41c9d0b1a28e7f34c004
title: Deploy on Self-hosted WordPress
description: Run SpacePress on your own VPS, Docker stack, or any LAMP/LEMP host with zero lock-in — via spacepress push or standalone plugins.
order: 6
status: published
publishedAt: 2026-11-21T10:03:00.000Z
---
Because SpacePress compiles into standard PHP and WordPress plugins with **zero Node.js in production**, you can host your app on any VPS, Docker container, or traditional LAMP/LEMP server.

## Server requirements

- **WordPress 7.1+**
- **PHP 8.2+** with the `zip` (`ZipArchive`), `openssl`, and `mbstring` extensions
- **MySQL 8.0+**, **MariaDB 10.6+**, or **SQLite** (via `sqlite-database-integration` 3.1.2+)
- HTTPS enabled (required by WordPress for Application Passwords)
- Pretty permalinks enabled (`/%postname%/`)

On MySQL and MariaDB, SpacePress checks for InnoDB and `utf8mb4` before the first write or locking read in each app transaction. If an app table changes to MyISAM, writes return `503 unavailable` even when the recorded schema and install marker still match. Ordinary reads skip the engine check.

## Option A: Deploy with `spacepress push` (recommended)

### 1. Configure a private build store outside the web root

On nginx or any server that does not enforce `.htaccess`, point `SP_STORE_DIR` in `wp-config.php` to a writable directory **outside** your web root:

```php
<?php
define('SP_STORE_DIR', '/var/lib/spacepress-store');
```

Make sure the PHP-FPM user owns or can write to `/var/lib/spacepress-store` (`chmod 750`).

### 2. Install `spacepress.zip`

```bash
npx spacepress plugin --out spacepress.zip
```

Upload and activate `spacepress.zip` in `wp-admin` (or with `wp plugin install spacepress.zip --activate`), then authenticate and push:

```bash
npx spacepress login https://your-site.example
npx spacepress push --dry-run
npx spacepress push
```

## Option B: Deploy compiled plugins directly (Git / CI / Docker)

If your host sets `DISALLOW_FILE_MODS` or deploys immutable plugin directories via Git, rsync, or Docker images, compile the full plugin bundle locally or in CI:

```bash
npx spacepress build
```

Deploy every generated plugin from `sp/dist/wp-content/plugins/` into your WordPress `wp-content/plugins/` directory: the platform plugins (`action-scheduler`, `secure-custom-fields`, `two-factor`, `mcp-adapter`), any plugins you pinned, then `spacepress-runtime`, `spacepress-identity`, `spacepress-app-<name>` and `spacepress-admin`. Activate them in that order; SpacePress Admin goes last because it registers only after the app has:

```bash
wp plugin activate action-scheduler secure-custom-fields two-factor mcp-adapter
wp plugin activate spacepress-runtime spacepress-identity spacepress-app-my-app spacepress-admin
wp spacepress migrate
wp spacepress seed
```

## Web server & cron tips

- **Nginx routing for `public/`:** Pass unknown paths to `/index.php?$args` so SpacePress's `PublicFiles` handler serves files from `public/`, or map static files from the active app's `public/` directory directly in nginx for faster edge delivery.
- **Background jobs (`job()`):** SpacePress queues background jobs on Action Scheduler. Configure a real system cron (`* * * * * wp cron event run --due-now --path=/var/www/html`) rather than relying solely on visitor-triggered `wp-cron.php`.
- **Static export (`output: "static"`):** If your site needs no server runtime at all, run `npx spacepress export` and deploy `sp/dist/static/` to any static CDN.
