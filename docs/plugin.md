# Deploy to any WordPress with the First plugin

One plugin makes a WordPress site a place you deploy a First app to. You install it once, sign in
from your project, and push. The site needs WordPress 7.2-beta5 or later and PHP 8.2 with the `zip`
extension; everything else the plugin installs.

```sh
first plugin                          # writes first.zip
# wp-admin: Plugins, Add Plugin, Upload Plugin, choose first.zip, activate First
first login https://example.com       # approve the command line in the browser
first push                            # compile, upload, show the plan, go live
```

## 1. Install the plugin

`first plugin` writes `first.zip` (`--out <file>` for another name). Upload and activate it in
wp-admin. Activating it installs and activates the plugins First depends on: Secure Custom Fields,
Action Scheduler, the MCP Adapter and Two Factor. Each is downloaded from wordpress.org at the
version First pins and installed only if its SHA-256 is the pinned one. A **First** item appears in
the menu; its screen lists what First needs and what the site has, and its button repeats the
install if anything is missing (no network at activation, a plugin someone deactivated). Polylang is
installed by the first push of an app with `locales`.

## 2. Sign in

`first login <site-url>` prints a link to WordPress's own Authorize Application screen and opens it
(`--no-browser` only prints it). When you approve, WordPress sends an application password to the
command on `127.0.0.1`. It is kept in `~/.config/first/sites.json` (`FIRST_CONFIG_DIR` moves it),
readable by you only. Run inside a project, the command also records the site in
`.first/site.json`, so `first push` needs no `--site`.

WordPress accepts application passwords over HTTPS, or on a site whose `WP_ENVIRONMENT_TYPE` is
`local`. In CI, set `FIRST_APP_PASSWORD=user:application-password` and pass `--site`; no login is
needed. `first logout <site-url>` forgets the credential on this machine; revoke it on the site
under Users, Profile, Application Passwords.

## 3. Push

`first push [dir] [--site url] [--dry-run]`:

1. Compiles the project on your machine, compared with the build deployed last, so the migration
   it carries is the difference from what the database holds.
2. Uploads the build: the runtime (about 8 MB, sent once per First version) and the app (usually
   well under 1 MB). A tree the site already holds is not sent again.
3. Prints what installing it would change: tables, each migration, pages, the search index, URL
   rules. Nothing of the app's code runs for this.
4. Installs it and makes it live. `--dry-run` stops after step 3.

The migration is planned against the site, not against `first/_generated/migrations/` in the
project: the site's own ledger is what its database ran. If someone else deployed while your build
was compiling, the site refuses yours and you push again.

If the site lacks a plugin this build needs, `first push` says which and installs it. A
build the schema check refuses (a required field with no default on a kind that has rows, a dropped
kind) is not installed, and the live build keeps serving.

`first push` also replaces the site's First plugin when it is not the one your `first` carries.
A live First app turns off plugin uploads in wp-admin, so this is how the plugin is updated.

## Going back

The First screen lists every deployment, and so does **Deployments** in First Admin
(`/wp-admin/new/`), the admin a First app ships by default. **Make live** on an earlier one switches
the site to that build's code. It does not undo migrations: the earlier code runs on the current database. The next
`first push` is compared with the last deployment, so no migration runs twice.

## Settings in wp-config.php

| Constant | What |
|---|---|
| `FIRST_VARIABLES` | `['NAME' => 'value', ...]`: the app's `process.env.NAME`. Nothing else of the server's environment reaches the app |
| `FIRST_STORE_DIR` | where builds are kept, when the default (a directory with a random name in `wp-content`) doesn't suit: a path outside the web root is best. When the store is under the web root and the server is not Apache or LiteSpeed (which read the `.htaccess` that blocks it), the First screens and `first push` say so. On a network each site keeps its builds in `site-<id>` under it |
| `DISALLOW_FILE_MODS` | set by hosts that manage their own code: the site then takes no deployment, and `first push` says so. A `file_mod_allowed` filter that refuses file changes does the same |

The app's mail leaves through `wp_mail`, so an SMTP plugin applies. Background jobs run through
Action Scheduler: make sure WP-Cron or a real cron reaches the site.

## Who may deploy

A deployment installs PHP, so it is for people whose role lets them install plugins:
administrators, and on a multisite network only its super admins. A role that may only activate
plugins that are already installed can't deploy. A credential scoped for an agent
(`first identity agent add`) can't either.

`first login` gets an application password that is not scoped: it can do everything the account
that approved it can. WordPress's approval screen says so, and the password is revoked under
Users, Profile, Application Passwords.

## A WordPress network (multisite)

Activate First for the network. Each site of the network then takes its own app: push to that
site's address (`first login https://example.com/news`, `first push`). A site's builds, live build,
deployment history and tables (under that site's table prefix) are its own, and a deployment to one
site changes nothing on another. Only the network's super admins deploy. The runtime is uploaded
once per site, because each site keeps its own store.

## Where things are on the site

| Path | What | Served |
|---|---|---|
| `wp-content/plugins/first/` | the plugin | as any plugin |
| `wp-content/first-store-<random>/` | every deployed build: PHP, schema snapshots, migrations, seed content | never; `.htaccess` denies it and no URL names it |
| `wp-content/first-assets/` | a copy of each build's scripts, styles, images and fonts | yes |

Options: `first_live_build` (the build every request runs), `first_deployments` (every deployment
and switch, never pruned), `first_store_key`. Deactivating the plugin stops the app and deletes
nothing.

On nginx or another server that ignores `.htaccess`, the store's random name is what keeps it
private. Deny it as well if you can:

```nginx
location ~ ^/wp-content/first-store- { deny all; }
```

## Limits today

- One First app per site. Several apps, and an app mounted under a path such as `/news`, are not
  built.
- You deploy a build compiled on your machine. A site compiling uploaded sources itself is not
  built.
- Old builds are kept. Nothing collects them yet.
- A site that already runs First from separately installed plugins (`first build`'s
  `first/dist/wp-content`) must deactivate those first.
