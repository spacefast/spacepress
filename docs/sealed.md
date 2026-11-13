# Sealed mode

A site that runs only First's code can say so in its config:

```ts
export default defineConfig({
  name: "shop",
  sealed: true,
  plugins: { "classic-editor": "1.6.7" },
});
```

With `sealed: true`, the only code that runs as a plugin is:

| Code | Where it comes from |
|---|---|
| First's own plugins: `first-runtime`, `first-identity`, `first-admin` with `admin: true`, the app plugin `first-app-<name>`, and its pages plugin `first-pages-<name>` | shipped in the compiler and built from this project (`first build`, and `first-pages build` for pages) |
| the platform plugins First pins: Secure Custom Fields, Action Scheduler, MCP Adapter, Two Factor, and Polylang when the config sets `locales` ([wp-plugins.md](wp-plugins.md)) | exact versions with checksums in First's release |
| the plugins the config declares under `plugins` | exact versions, with checksums in the committed `first/_generated/wp-plugins.lock.json` |
| plugin packages under `use` (`definePlugin`) | compiled into the app plugin; see [below](#plugin-packages) |

Sealed mode is off by default. With it off, activating other plugins stays
open, as WordPress ships it, and nothing below applies: no hook is added and no
build output changes.

`first build` computes the list once, by plugin directory name, and writes the
same list everywhere it is read: `sealed.plugins` in the app's `schema.php` (what
the running app uses), and `sealed` in `first-manifest.json`, in the hosted
manifest and in the build store's manifest (what a host uses). A hosted build
can't declare WordPress plugins at all, so its list is First's and the
platform's.

On the site, a plugin counts as listed when it is the main file of a listed
directory: `<slug>/<file>.php`. The site checks the directory name. Versions and
checksums are checked when the build fetches the plugin, not again on the site.

## What sealed mode guarantees, and where

WordPress 7.1 loads a request in this order (`wp-settings.php`):

1. drop-ins that load at start-up: `fatal-error-handler.php`, `maintenance.php`
   while the site is in maintenance, `advanced-cache.php` (with `WP_CACHE`),
   `db.php`, `object-cache.php`, and `sunrise.php` on multisite (with `SUNRISE`).
   The other drop-ins (`php-error.php`, `db-error.php`, `install.php` and the
   multisite `blog-*.php` pages) load only when their case arises;
2. must-use plugins (`wp-content/mu-plugins/*.php`);
3. network-active plugins, on multisite;
4. active plugins, in the order of the `active_plugins` option: First's app
   plugin is one of them;
5. the active theme's `functions.php`, then the rest of WordPress.

An ordinary plugin can't stop another plugin that WordPress has already loaded
in the same request, and the start-up drop-ins and every must-use plugin load
before any plugin. So what sealed mode guarantees depends on who loads First.

### On a plain WordPress host: refusals and a report

First is an active plugin there. While it is active, sealed mode:

- **refuses to activate** anything not on the list, for every user,
  administrators included: wp-admin's Plugins screen (one, bulk and network
  activation), core's REST plugins route (in every request form: `?rest_route=`,
  letter case, `_method`; `/batch/v1` doesn't take that route), and WP-CLI's
  `wp plugin activate`. All of them go through WordPress's `activate_plugin()`,
  which asks First before it loads the plugin. In wp-admin the Activate link is
  replaced by "Sealed: not in first.config.ts". WP-CLI prints First's refusal,
  which names `first.config.ts`; REST answers core's own 403
  (`rest_cannot_activate_plugin`).
- **refuses to deactivate, from wp-admin and REST, the plugins the app runs on**:
  First's own and the platform's. With the app stopped nothing would refuse
  anything, so this is what keeps an administrator from switching the list off
  in the browser. Declared plugins can be deactivated and reactivated freely.
- **reports** what is loaded, to administrators:
  - `plugins` and `networkPlugins`: active plugins that aren't on the list. A
    plugin that was active before sealed mode turned on appears here and keeps
    running; First never deactivates or deletes anything.
  - `muPlugins`, `dropins`, `theme`: every must-use plugin, every drop-in
    present, and the active theme's PHP (see below). No config can list these,
    and a host's own are among them, so they are shown, not judged.
  - where: `GET /__first/api/v1` under `runtime.wp.sealed` (`{enforced}` only for
    anyone who isn't an administrator); `first doctor --site <url>`, whose
    `sealed` check fails when an unlisted plugin is active and which lists the
    rest for information (sign in with `FIRST_APP_PASSWORD` or `FIRST_TOKEN`);
    and a wp-admin notice naming the unlisted active plugins.

This is not a guarantee that only listed code runs, and it holds only against
people working through WordPress. Someone with a shell is outside it:
`wp --skip-plugins` loads no plugin (First included) and can activate or
deactivate anything, as can writing the `active_plugins` option or the plugin
files directly. An unlisted plugin activated that way is reported on the next
request. A must-use plugin or drop-in placed on the server always loads.

### Where the host mounts First through the build store: enforced

A host that mounts First with the build store loader
([decision](decisions/2026-11-07-build-store.md)) runs its own code before
WordPress reads its plugin list, so it can enforce the list. In a must-use
plugin of the host's (or its `sunrise.php`), where `add_filter()` exists:

```php
require_once "$root/runtime/$revision/first-loader.php";
use First\Loader\Loader;

$sealed = Loader::sealed($root, $build);   // null when the build isn't sealed
if ($sealed !== null) {
    define('FIRST_SEALED_ENFORCED', true);
    $filter = static fn ($active) => Loader::allowedPlugins((array) $active, $sealed);
    add_filter('option_active_plugins', $filter, PHP_INT_MAX);
    // WordPress writes the option back from what it read: keep the hidden entries stored.
    add_filter('pre_update_option_active_plugins', static function ($new) use ($filter, $sealed) {
        remove_filter('option_active_plugins', $filter, PHP_INT_MAX);
        $stored = (array) get_option('active_plugins', []);
        add_filter('option_active_plugins', $filter, PHP_INT_MAX);

        return Loader::keepUnlisted((array) $new, $stored, $sealed);
    }, PHP_INT_MAX);
}
Loader::load($root, $build, $options);
```

With that, an unlisted plugin that is active in the option doesn't load, and it
stays in the stored option: sealing a site hides it, and unsealing brings it
back. With `FIRST_SEALED_ENFORCED` defined, the report says `enforced: "host"`.
The report trusts that constant; it doesn't check the host's filter.

On multisite the same applies to the network's `active_sitewide_plugins` (its
keys are the plugin files). That option is shared by every site of the network,
so a host filters it per request with `site_option_active_sitewide_plugins` and
must not let a write from a sealed site's request drop other sites' entries.
First has no test on multisite; treat that part as the host's to verify.

The host also controls its own must-use plugins and drop-ins, so it ships only
what it needs there. The [host contract](host-contract.md) states the list and
these calls. First writes nothing to `wp-config.php` or the must-use plugins
directory itself, and nothing changes for sites that don't serve a First app.

### Theme PHP

Switching themes isn't plugin activation, and sealed mode doesn't refuse it. A
block theme renders from templates, but WordPress still includes its
`functions.php` on every request and includes each PHP file in its `patterns/`
directory to register that pattern. The report names the active theme's
`functions.php` and the number of PHP pattern files, so the owner sees that
theme code runs. A classic theme's template files are PHP too and aren't
counted. First's own minimal block theme ships no PHP and is never reported.

## Plugin packages

Plugin packages (`use: [seo()]`) aren't WordPress plugins: the compiler turns
them into PHP inside the app plugin.

The compiler is their security boundary. First compiles a closed subset of
TypeScript and refuses everything else, so a plugin's compiled code can only
call the First APIs it names: there is no `eval`, no dynamic `require`, no file
or process access, and no reaching into PHP or WordPress except through the
`php/wordpress` functions the compiler records. The compiler records every
capability a plugin's code uses, including through its helpers and the npm
packages it imports: reads, writes and deletes per kind, hooks, actions,
outgoing hosts, environment variables, mail, jobs, timers, abilities, WordPress
hooks and PHP functions. `first/_generated/plugins.lock.json` is the grant. With
`--frozen`, or when `CI` is set, a build whose plugin needs a capability the
lock doesn't hold fails; narrowing the lock by hand makes the compiler refuse
the code that exceeds it. A plugin can't import app modules or another plugin's
package, and its state is kept apart from every other plugin's
([decision](decisions/2026-11-07-plugin-capabilities.md)).

The limits:

- **No resource limits.** A plugin runs in the same PHP process as the app, with
  no CPU or memory limit of its own. A throw in its hook rolls back the
  request's writes, as an app hook's does.
- **A grant is as wide as it reads.** A granted read plus a granted outgoing
  host can carry what was read to that host, or by mail with a mail grant.
  `first check --json` reports the handlers that both read and send. That report
  works by handler; a hook that forwards the row it was handed isn't counted as
  a read. An `http` grant of `*` is any public host.
- **Granted PHP functions and abilities do what they do.** A grant such as
  `php: wordpress:update_option` allows that function with any arguments, and a
  granted ability runs another plugin's PHP. Read those lines of the lock as you
  would read the code.
- **A local build can widen the lock.** Without `--frozen` or `CI`, `first
  build` adds a newly needed capability to the lock and prints the change;
  committing the lock is the approval. Build in CI (or with `--frozen`) so
  nothing is granted without a reviewed commit.

## What else stays open

Sealed mode is about which code runs as a plugin. Content, media, users,
settings and each plugin's own settings stay as they are. Installing, updating
and deleting plugins from wp-admin are already refused on every First site
(the `pluginAndThemeInstalls` switch); translations still install, and a
translation file is PHP that WordPress includes.
