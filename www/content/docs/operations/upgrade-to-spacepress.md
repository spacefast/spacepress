---
uid: zr_8e2b6d0c4f1a9375e2d1
title: Upgrade to SpacePress
description: Move a project and a site deployed with a pre-release build onto the SpacePress names without losing data.
order: 7
status: published
publishedAt: 2026-11-23T09:00:00.000Z
---
Pre-release builds of SpacePress used an earlier name for their npm packages, config file (`<name>.config.ts`), app folder and module imports, and for what they stored in the database. Everything now uses `spacepress` and `sp`, and nothing reads the earlier names, so a project and a site each move once.

## 1. Rename the project

From a clean git checkout of your project, with your work committed:

```bash
python3 path/to/spacepress/scripts/rename/spacepress.py .            # dry run: what would change
python3 path/to/spacepress/scripts/rename/spacepress.py . --apply    # rename and stage it
```

The script rewrites the tracked files and their paths to the current names:

- the config file becomes `spacepress.config.ts`
- the app folder becomes `sp/`
- imports become `"spacepress"`, `"spacepress/app"` and `"spacepress/server/db"`
- the CLI dev dependency becomes `spacepress`

It refuses to run when a renamed path already exists. Review the staged diff, run `npm install` and `spacepress build`, and commit. Your committed migrations under `sp/_generated/migrations/` keep their IDs, and the table names inside them change to match the site's renamed tables. Don't regenerate or renumber them. The site's ledger keeps the hash each one had when it was applied, and it already counts them as applied.

## 2. Upgrade the site

The new plugins move the site's stored state on their first request. This covers the app's tables, the migration ledger, revisions, queued jobs, Action Scheduler actions and groups, options, post and user meta, post types, taxonomies, roles, application-password scopes and active plugins.

- Tables are renamed, not copied.
- Each applied migration keeps its recorded SHA-256, and the ledger gains one `data` entry saying what moved.
- Files already in S3 keep their key prefix.
- Private files stay in the directory they are in, at the same URL and under the same server rules. A site installed after the rename uses `uploads/spacepress-private`.
- Options of other plugins that only look like SpacePress's are left alone.
- If a new name is already taken, nothing is changed. The site shows which name it found twice.

**Sites deployed with `push`.** The deploy plugin of a pre-release build accepts only its own archive, so `spacepress push` can't replace it. Update it once by hand:

1. Run `spacepress plugin --out spacepress.zip`.
2. Install it in **wp-admin → Plugins → Add Plugin → Upload Plugin**, or with WP-CLI: `wp plugin install spacepress.zip --activate`.
3. Deactivate the previous deploy plugin. Its build store stays where it is until your first push.
4. Run `spacepress login <site-url>`, then `spacepress push`.

**Sites that run the built plugins directly** (Git, CI or Docker):

1. Copy the new `sp/dist/wp-content/plugins/spacepress-*` folders next to the previous ones.
2. Find the previous runtime, identity, app and admin plugins with `wp plugin list --status=active`.
3. Activate the new plugins without loading the previous ones, then deactivate the previous ones:

   ```bash
   wp plugin activate spacepress-runtime spacepress-identity spacepress-app-<name> spacepress-admin \
     --skip-plugins=<the previous four, comma-separated>
   wp plugin deactivate <the previous four> --skip-plugins=<the previous four, comma-separated>
   ```

   In wp-admin, deactivate the previous four plugins first, then activate the new ones.

4. Remove the previous plugin folders once the site serves the app. Don't use **Delete** in wp-admin: it runs the previous plugin's uninstaller.

Environment constants in `wp-config.php` take the `SP_` prefix, for example `SP_STORE_DIR` and `SP_GITHUB_DISPATCH_TOKEN`. Rename the ones you set.

## What changes for clients

- REST routes are under `/wp-json/spacepress/v1`.
- Outgoing webhooks are signed with the `SpacePress-Signature` header.
- Identity sessions stay signed in. Signed preview and live links issued before the upgrade stop working and are issued again.
- Update any client that calls the API directly. The typed client and `@spacepress/astro` follow when you rebuild.
