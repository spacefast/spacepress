---
name: typedpress-deploy
description: "Use when deploying a TypedPress project to Spacefast, WP Cloud (Pressable or WordPress.com), or self-hosted WordPress: running preflight checks, previewing with --dry-run, pushing safely, syncing Markdown content, and verifying the live site."
compatibility: "Targets TypedPress 0.3 (WordPress 7.1+, PHP 8.2+). Requires the `typedpress` CLI and Node.js 22+."
---

# Deploy a TypedPress project

## When to use

- Shipping a project to production or staging on Spacefast, Pressable, WordPress.com, or self-hosted WordPress.
- Packaging `typedpress.zip` for first-time installation in `wp-admin`.

## Inputs required

- The target site URL (confirm whether it is staging or production before pushing).
- Explicit approval from the site owner before running a live production push or creating credentials.
- Which host stack runs the site: Spacefast, WP Cloud (Pressable / WordPress.com), or self-hosted WordPress.

## Procedure

1. Run local preflight checks and verify agent files and migrations are committed:

   ```bash
   typedpress check
   typedpress build
   typedpress init --check
   ```

2. On a fresh WP Cloud or self-hosted site without the TypedPress host plugin, generate `typedpress.zip` so the owner can upload and activate it in `wp-admin`:

   ```bash
   typedpress plugin --out typedpress.zip
   ```

3. Authenticate once (or use `TP_APP_PASSWORD` in CI) and preview every migration, route, and seed change before touching production:

   ```bash
   typedpress login https://example.com
   typedpress push --site https://example.com --dry-run
   ```

4. Announce the target URL and the dry-run summary. Wait for explicit confirmation before pushing to production, then deploy:

   ```bash
   typedpress push --site https://example.com
   ```

5. On WP Cloud (Pressable / WordPress.com), remember that nginx serves top-level `.js`, `.wasm`, and `.txt` assets from `/srv/htdocs/` directly and reserves `/files/*` for Multisite rewrites. See `www/content/docs/operations/deploy-wp-cloud.md`.

6. If collections use `sync: "content/**/*.md"`, sync content after deploying:

   ```bash
   typedpress sync --site https://example.com
   ```

## Verification

Run `typedpress doctor --site https://example.com --links` to verify live plugins, routes, and internal links.

## Failure modes / debugging

- **401 / Application Password rejected:** Ensure HTTPS is enabled and the user has the Administrator role; re-run `typedpress login https://example.com`.
- **Migration refusal:** Never force-drop live columns without checking data; add `.was("oldName")` for renames.
- **Static assets 404 on WP Cloud:** Copy `public/` root static files into `/srv/htdocs/` and purge edge cache.

## Escalation

Read `www/content/docs/operations/cli-and-deploy.md`, `www/content/docs/operations/deploy-spacefast.md`, `www/content/docs/operations/deploy-wp-cloud.md`, or `www/content/docs/operations/deploy-self-hosted.md` via `docs_read`. Stop and ask the user before running any destructive migration or overwriting production data.
