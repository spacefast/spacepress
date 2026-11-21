# Deploy to any WordPress with the TypedPress plugin

One plugin makes a WordPress site a place you deploy a TypedPress app to. You install it once, sign in
from your project, and push. The site needs WordPress 7.1 or later and PHP 8.2 with the `zip`
extension; everything else the plugin installs.

```sh
typedpress plugin                          # writes typedpress.zip
# wp-admin: Plugins, Add Plugin, Upload Plugin, choose typedpress.zip, activate TypedPress
typedpress login https://example.com       # approve the command line in the browser
typedpress push                            # compile, upload, show the plan, go live
```

## 1. Install the plugin

`typedpress plugin` writes `typedpress.zip` (`--out <file>` for another name). Upload and activate it in
wp-admin. Activating it installs and activates the plugins TypedPress depends on: Secure Custom Fields,
Action Scheduler, the MCP Adapter and Two Factor. Each is downloaded from wordpress.org at the
version TypedPress pins and installed only if its SHA-256 is the pinned one. A **TypedPress** item appears in
the menu; its screen lists what TypedPress needs and what the site has, and its button repeats the
install if anything is missing (no network at activation, a plugin someone deactivated). Polylang is
installed by the first push of an app with `locales`.

## 2. Sign in

`typedpress login <site-url>` prints a link to WordPress's own Authorize Application screen and opens it
(`--no-browser` only prints it). When you approve, WordPress sends an application password to the
command on `127.0.0.1`. It is kept in `~/.config/tp/sites.json` (`TP_CONFIG_DIR` moves it),
readable by you only. Run inside a project, the command also records the site in
`.tp/site.json`, so `typedpress push` needs no `--site`.

WordPress accepts application passwords over HTTPS, or on a site whose `WP_ENVIRONMENT_TYPE` is
`local`. Every command that talks to the site (`push`, `sync`, `pull`, `export --site`,
`abilities pull`, `doctor --site`) uses the credential stored for it. In CI, set
`TP_APP_PASSWORD=user:application-password` (or `TP_TOKEN` for the commands other than `push`) and
pass `--site`; no login is needed, and the environment wins over a stored credential. `typedpress logout <site-url>` forgets the credential on this machine; revoke it on the site
under Users, Profile, Application Passwords.

## 3. Push

`typedpress push [dir] [--site url] [--dry-run]`:

1. Compiles the project on your machine, compared with the build deployed last, so the migration
   it carries is the difference from what the database holds.
2. Uploads the build: the runtime (about 8 MB, sent once per TypedPress version) and the app (usually
   well under 1 MB). A tree the site already holds is not sent again.
3. Prints what installing it would change: tables, each migration, pages, the search index, URL
   rules. Nothing of the app's code runs for this.
4. Installs it, copies its browser files to `wp-content/typedpress-assets/`, and makes it live.

`--dry-run` stops after step 3. What it leaves on the site is the uploaded trees in the private
build store and an open deployment that expires after an hour. It does not update the site's
TypedPress plugin, install the plugins the app needs, make any file public, or run the live app's
own code. It stops before uploading, and says so, when a plugin the app needs is missing or when the
live build has lost a tree from the store, since storing that tree would run the live build again.

The migration is planned against the site, not against `tp/_generated/migrations/` in the
project: the site's own ledger is what its database ran. If someone else deployed while your build
was compiling, the site refuses yours and you push again.

If the site lacks a plugin this build needs, `typedpress push` says which and installs it. A
build the schema check refuses (a required field with no default on a kind that has rows, a dropped
kind) is not installed, and the live build keeps serving.

`typedpress push` also replaces the site's TypedPress plugin when it is not the one your `typedpress` carries.
A live TypedPress app turns off plugin uploads in wp-admin, so this is how the plugin is updated.

## Going back

The TypedPress screen lists every deployment, and so does **Deployments** in TypedPress Admin
(`/wp-admin/new/`), the admin a TypedPress app ships by default. **Make live** on an earlier one switches
the site to that build's code. It does not undo migrations: the earlier code runs on the current database. The next
`typedpress push` is compared with the last deployment, so no migration runs twice.

## Settings in wp-config.php

| Constant | What |
|---|---|
| `TP_VARIABLES` | `['NAME' => 'value', ...]`: the app's `process.env.NAME`. Nothing else of the server's environment reaches the app |
| `TP_STORE_DIR` | where builds are kept, when the default (a directory with a random name in `wp-content`) doesn't suit: a path outside the web root is best. When the store is under the web root and the server is not Apache or LiteSpeed (which read the `.htaccess` that blocks it), the TypedPress screens and `typedpress push` say so. On a network each site keeps its builds in `site-<id>` under it |
| `DISALLOW_FILE_MODS` | set by hosts that manage their own code: the site then takes no deployment, and `typedpress push` says so. A `file_mod_allowed` filter that refuses file changes does the same |

The app's mail leaves through `wp_mail`, so an SMTP plugin applies. Background jobs run through
Action Scheduler: make sure WP-Cron or a real cron reaches the site.

## Who may deploy

A deployment installs PHP, so it is for people whose role lets them install plugins:
administrators, and on a multisite network only its super admins. A role that may only activate
plugins that are already installed can't deploy. A credential scoped for an agent
(`typedpress identity agent add`) can't either.

`typedpress login` gets an application password that is not scoped: it can do everything the account
that approved it can. WordPress's approval screen says so, and the password is revoked under
Users, Profile, Application Passwords.

## A WordPress network (multisite)

Activate TypedPress for the network. Each site of the network then takes its own app: push to that
site's address (`typedpress login https://example.com/news`, `typedpress push`). A site's builds, live build,
deployment history and tables (under that site's table prefix) are its own, and a deployment to one
site changes nothing on another. Only the network's super admins deploy. The runtime is uploaded
once per site, because each site keeps its own store.

## Where things are on the site

| Path | What | Served |
|---|---|---|
| `wp-content/plugins/tp/` | the plugin | as any plugin |
| `wp-content/typedpress-store-<random>/` | every deployed build: PHP, schema snapshots, migrations, seed content | never; `.htaccess` denies it and no URL names it |
| `wp-content/typedpress-assets/` | a copy of each build's scripts, styles, images, fonts, and `public/` files | yes |

Options: `tp_live_build` (the build every request runs), `tp_deployments` (every deployment
and switch, never pruned), `tp_store_key`. Deactivating the plugin stops the app and deletes
nothing.

On nginx or another server that ignores `.htaccess`, the store's random name is what keeps it
private. Deny it as well if you can:

```nginx
location ~ ^/wp-content/typedpress-store- { deny all; }
```

## Limits today

- One TypedPress app per site. Several apps, and an app mounted under a path such as `/news`, are not
  built.
- You deploy a build compiled on your machine. A site compiling uploaded sources itself is not
  built.
- Old builds are kept. Nothing collects them yet.
- A site that already runs TypedPress from separately installed plugins (`typedpress build`'s
  `tp/dist/wp-content`) must deactivate those first.
