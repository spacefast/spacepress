# Deploy the framework website

`www/` is a TypedPress app. It needs WordPress for docs, blog posts, shared playground
edits, the examples table and Action Scheduler jobs.

Use a dedicated nonproduction WordPress site to qualify a destination first.
Pressable is a candidate: it documents application passwords and writable PHP
filesystem access. This app has not been verified there. The framework requires
WordPress 7.2-beta5 or newer, PHP 8.2 or newer, and ZipArchive. Check those versions
and installation permissions on the selected site.

## Build the app

From the repository root:

```sh
cargo build --locked --release
(cd docs-site && pnpm install --frozen-lockfile && pnpm wasm && pnpm showcase)
(cd examples/reading-list && npm ci --ignore-scripts)
(cd www && bun install --frozen-lockfile && bun run build)
cd www
../target/release/typedpress check
../target/release/typedpress plugin --out typedpress.zip
```

Set `PLUGINS_URL` when building to the URL that will serve `/files/plugins/`.
WordPress Playground fetches those ZIPs across origins, so verify the destination
preserves the public-file CORS headers.

## Prepare WordPress

Upload and activate `typedpress.zip` in wp-admin. The plugin installs its pinned
requirements. Application passwords and file modifications must be enabled.
On a network, activate it for the network; super administrators deploy one app
per site.

Prefer a private build-store directory outside the web root, configured through
`TP_STORE_DIR`. The default store writes an Apache access rule; nginx does
not enforce `.htaccess`. Verify that a browser cannot fetch private build files.

Authenticate from `www/`, then inspect the plan:

```sh
../target/release/typedpress login https://chosen-site.example
../target/release/typedpress push --dry-run
```

A human starts a production release. The deployment command is `typedpress push`.
A push seeds the synced Markdown on an empty site. Later edits to existing content
use `typedpress sync --site <url>`, run from `www/`. It signs in with the credential
`typedpress login` stored for the site; on a machine without one (CI), supply
`TP_APP_PASSWORD` through a secure environment mechanism instead. It commits the synced files and
`.tp/sync-base.json`; `--no-commit` leaves them for you to commit.

After the build and initial deployment, run `SITE_URL=<site-url> bun run seed`
with `TP_APP_PASSWORD` supplied through the environment. It adds the featured
examples through the app API and retains existing rows and star counts.
See [website build and seeding work](https://github.com/spacefast/zero/issues/500)
and [Pressable qualification](https://github.com/spacefast/zero/issues/501).

## Verify a nonproduction deployment

Check the homepage, nested docs, blog, assets and examples. Save and reopen a
playground edit, run an edited example in WordPress Playground, and confirm the
stock Action Scheduler job refreshes an example's star count. Test a subsequent
push, schema refusal and switching to an earlier build. Switching code does not
undo database migrations.

## Spacefast

Spacefast's current host adapter still consumes the older Zero source and runtime
contracts. It needs the compiler/source-detection and host-contract work described
in [the host checklist](../docs/spacefast-host-checklist.md) and
[the integration issue](https://github.com/spacefast/zero/issues/503).

Publishing `docs-site/dist` serves the older static documentation site. It does
not deploy this app's WordPress features.

References: [Pressable application passwords](https://pressable.com/knowledgebase/get-started-with-wordpress-mcp-on-pressable/),
[filesystem permissions](https://pressable.com/knowledgebase/understanding-php-filesystem-permissions/),
and [WordPress beta versions](https://pressable.com/knowledgebase/testing-wordpress-beta-versions/).
