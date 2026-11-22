---
uid: zr_41c9d0b1a28e7f34c004
title: Deploy on Self-hosted WordPress
description: Run SpacePress on your own VPS, Docker stack, or any LAMP/LEMP host with zero lock-in — via typedpress push or standalone plugins.
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

## Option A: Deploy with `typedpress push` (recommended)

### 1. Configure a private build store outside the web root

On nginx or any server that does not enforce `.htaccess`, point `TP_STORE_DIR` in `wp-config.php` to a writable directory **outside** your web root:

```php
<?php
define('TP_STORE_DIR', '/var/lib/typedpress-store');
```

Make sure the PHP-FPM user owns or can write to `/var/lib/typedpress-store` (`chmod 750`).

### 2. Install `typedpress.zip`

```bash
npx typedpress plugin --out typedpress.zip
```

Upload and activate `typedpress.zip` in `wp-admin` (or with `wp plugin install typedpress.zip --activate`), then authenticate and push:

```bash
npx typedpress login https://your-site.example
npx typedpress push --dry-run
npx typedpress push
```

## Option B: Deploy compiled plugins directly (Git / CI / Docker)

If your host sets `DISALLOW_FILE_MODS` or deploys immutable plugin directories via Git, rsync, or Docker images, compile the full plugin bundle locally or in CI:

```bash
npx typedpress build
```

Deploy every generated plugin from `tp/dist/wp-content/plugins/` (`typedpress-runtime`, `typedpress-identity`, `typedpress-admin`, `typedpress-app-<name>`, plus any pinned third-party plugins) into your WordPress `wp-content/plugins/` directory and activate them in order:

```bash
wp plugin activate typedpress-runtime typedpress-identity typedpress-admin typedpress-app-my-app
wp typedpress migrate
wp typedpress seed
```

## Web server & cron tips

- **Nginx routing for `public/`:** Pass unknown paths to `/index.php?$args` so SpacePress's `PublicFiles` handler serves files from `public/`, or map static files from the active app's `public/` directory directly in nginx for faster edge delivery.
- **Background jobs (`job()`):** SpacePress queues background jobs on Action Scheduler. Configure a real system cron (`* * * * * wp cron event run --due-now --path=/var/www/html`) rather than relying solely on visitor-triggered `wp-cron.php`.
- **Static export (`output: "static"`):** If your site needs no server runtime at all, run `npx typedpress export` and deploy `tp/dist/static/` to any static CDN.
