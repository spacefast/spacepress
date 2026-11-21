---
uid: zr_41c9d0b1a28e7f34c001
title: Deploy on Spacefast
description: Deploy a SpacePress app to Spacefast with zero server configuration, automatic PHP compilation, and instant preview environments.
order: 3
status: published
publishedAt: 2026-11-21T10:00:00.000Z
---
[Spacefast](https://spacefast.com) is built to run SpacePress applications natively on WordPress 7.1+ and PHP 8.2+ without managing servers, nginx rules, or manual plugin uploads.

## Prerequisites

- A SpacePress project that passes `typedpress check` cleanly
- A [Spacefast](https://spacefast.com) account and site URL

## 1. Verify your project locally

Run a check and test build before pushing:

```bash
npx typedpress check
npx typedpress build
```

Commit your migration ledger (`tp/_generated/migrations/`) and plugin lockfile (`tp/_generated/wp-plugins.lock.json`) so every deployment upgrades your database safely and deterministically.

## 2. Sign in and preview the deployment plan

Authenticate once with your Spacefast site using WordPress Application Passwords, then inspect what the deployment will change:

```bash
npx typedpress login https://your-site.space.fast
npx typedpress push --dry-run
```

The dry run uploads your compiled runtime and app trees and prints every migration, page, and index change before making the build live.

## 3. Push to production

```bash
npx typedpress push
```

`typedpress push` atomically activates the new build, applies pending SQL migrations, seeds synced Markdown content on an empty site, and purges page caches automatically.

## 4. Sync Markdown content & verify

If your schema defines synced collections (`sync: "content/**/*.md"`), keep Git and your live Spacefast site in two-way sync:

```bash
npx typedpress sync --site https://your-site.space.fast
npx typedpress doctor --site https://your-site.space.fast --links
```

For CI pipelines, supply `TP_APP_PASSWORD="user:application-password"` as a secret environment variable instead of running `typedpress login` interactively.
