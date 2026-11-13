# Sealed mode

A site that runs only First's code can say so in its config:

```ts
export default defineConfig({
  name: "shop",
  sealed: true,
  plugins: { "woocommerce": "10.2.0" },
});
```

With `sealed: true`, the only code that runs as a plugin is:

| Code | Why it is trusted |
|---|---|
| First's own plugins: `first-runtime`, `first-identity`, `first-admin`, the app plugin `first-app-<name>` and its pages plugin | built from this project by `first build` |
| the platform plugins First pins: Secure Custom Fields, Action Scheduler, MCP Adapter, Two Factor, Polylang with `locales` ([wp-plugins.md](wp-plugins.md)) | exact versions with checksums in First's release |
| the plugins the config declares under `plugins` | exact versions, with checksums in the committed `first/_generated/wp-plugins.lock.json` |
| plugin packages under `use` (`definePlugin`) | compiled into the app plugin; see [below](#plugin-packages) |

Sealed mode is off by default. With it off, activating other plugins stays
open, as WordPress ships it.

`first build` writes the resulting list, by plugin directory slug, into the
build: `sealed` in `first-manifest.json`, in the hosted manifest and in the
build store's manifest. The app reads its own copy from `schema.php`.

## What sealed mode guarantees, and where

WordPress 7.1 loads a request in this order (`wp-settings.php`):

1. drop-ins: `advanced-cache.php` (with `WP_CACHE`), `db.php`, `object-cache.php`,
   and `sunrise.php` on multisite;
2. must-use plugins (`wp-content/mu-plugins/*.php`);
3. network-active plugins, on multisite;
4. active plugins, in the order of the `active_plugins` option: First's app
   plugin is one of them;
5. the active theme's `functions.php`, then the rest of WordPress.

An ordinary plugin can't stop another plugin that WordPress has already loaded
in the same request, and every drop-in and must-use plugin loads before any
plugin. So what sealed mode guarantees depends on who loads First.

### On a plain WordPress host: a refusal and a report

First is an active plugin there, so sealed mode:

- **refuses to activate** anything not on the list, for everyone,
  administrators included: wp-admin's Plugins screen (one, bulk and network
  activation), core's REST plugins route (in every request form: `?rest_route=`,
  letter case, `_method`; `/batch/v1` doesn't take that route), and WP-CLI. All of
  them go through WordPress's `activate_plugin()`, which asks First before it
  loads the plugin. The Activate link is replaced by "Sealed: not in
  first.config.ts", and the refusal says to declare the plugin in
  `first.config.ts`.
- **reports** everything loaded that isn't on the list: active and
  network-active plugins, must-use plugins, drop-ins, and the active theme's
  PHP. It reports; it never deactivates or deletes anything, and a plugin
  that was active before sealed mode turned on keeps running.
  - `GET /__first/api/v1` has `runtime.wp.sealed`: `{plugins, networkPlugins,
    muPlugins, dropins, theme, enforced}` for an administrator, and only
    `{enforced}` for anyone else.
  - `first doctor --site <url>` fails a `sealed` check that names what is
    loaded and unlisted (sign in with `FIRST_APP_PASSWORD` or `FIRST_TOKEN`).
  - wp-admin shows the same list to administrators in a notice.

This is not a guarantee that only listed code runs. Anyone who can write files
to the server, or the `active_plugins` option directly, can still make other
code load; sealed mode tells you that it did.

### Where the host mounts First through the build store: enforced

A host that mounts First with the build store loader
([decision](decisions/2026-11-07-build-store.md)) runs code before WordPress
reads its plugin list, so it can enforce the list:

```php
require_once "$root/runtime/$revision/first-loader.php";
$sealed = \First\Loader\Loader::sealed($root, $build);   // null when the build isn't sealed
if ($sealed !== null) {
    define('FIRST_SEALED_ENFORCED', true);
    add_filter('option_active_plugins', fn ($active) => \First\Loader\Loader::allowedPlugins((array) $active, $sealed));
    add_filter('site_option_active_sitewide_plugins', fn ($active) => array_intersect_key(
        (array) $active, array_flip(\First\Loader\Loader::allowedPlugins(array_keys((array) $active), $sealed))));
}
\First\Loader\Loader::load($root, $build, $options);
```

The host also controls its own must-use plugins and drop-ins, so it ships only
what it needs there. With `FIRST_SEALED_ENFORCED`, the report says
`enforced: "host"`. The [host contract](host-contract.md) states the list and
these calls. First writes nothing to `wp-config.php` or the must-use plugins
directory itself, and nothing changes for sites that don't serve a First app.

### Theme PHP

A block theme renders from templates, but WordPress still includes its
`functions.php` on every request and includes each PHP file in its `patterns/`
directory to render that pattern. Sealed mode doesn't refuse switching themes,
which isn't plugin activation; it reports the active theme's `functions.php`
and the number of PHP pattern files, so the owner sees that theme code runs.
First's own minimal block theme ships neither and is never reported.

## Plugin packages

Plugin packages (`use: [seo()]`) aren't WordPress plugins: the compiler turns
them into PHP inside the app plugin. They run in the same PHP process as the
app, with no CPU or memory limit.

The compiler is their security boundary, and it is a good one. First compiles a
closed subset of TypeScript and refuses everything else, so a plugin's compiled
code can only call the First APIs it names: there is no `eval`, no dynamic
`require`, no file or process access, no reaching into PHP or WordPress except
through the `php/wordpress` functions the compiler records. The compiler records
every capability a plugin's code uses (reads and writes per kind, hooks,
actions, outgoing hosts, environment variables, mail, jobs, timers, abilities,
WordPress hooks and PHP functions), including through helpers and the npm
packages it imports, and `first/_generated/plugins.lock.json` is the grant. A
build with a capability the lock doesn't hold fails under `--frozen` or `CI`, and
narrowing the lock makes the compiler refuse the code that exceeds it. A plugin
can't import app modules or another plugin's package, and its state is kept
apart from every other plugin's ([decision](decisions/2026-11-07-plugin-capabilities.md)).

What a granted plugin can still do:

- everything its grant names, as the app could: read and write the kinds it was
  granted, run when its hooks fire, register its actions;
- send data out: **a granted read plus a granted outgoing host can carry what it
  read to that host**, or by mail with a granted mail capability. `first check
  --json` reports the handlers that both read and send, so a reviewer sees them;
- use as much CPU and memory as the request allows, and fail the request: a
  throw in a plugin's hook rolls back the request's writes, as an app hook's
  does.

## What else stays open

Sealed mode is about which code runs as a plugin. Content, media, users,
settings, and each plugin's own settings stay as they are. Deactivating or
deleting a plugin stays open, and so do translations.
