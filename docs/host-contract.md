# Host contract

A host compiles TypedPress apps itself and mounts them into WordPress: Spacefast is one. This page is
everything such a host may rely on. Anything not listed here is TypedPress's internals: a host that reads
generated files, requires runtime files by path or calls other `TypedPress\` classes breaks when they change.

## Versioning

Every hosted manifest (`manifest.json` of a `compile-sources` tree, format `typedpress.hosted.v1`) carries an
integer `hostContract`. It changes only when something below changes incompatibly for a host. Additions
don't change it. A host refuses a compiled tree whose `hostContract` it doesn't know, rather than serving
it on assumptions.

Version 2 requires managed commerce hosts to check shipping compatibility before selecting a build,
including rollback and recovery after a failed initialization. Version 1 hosts must refuse version 2
manifests until they implement this lifecycle requirement.

## Uploads

`compile-sources <sources> <new-output> <assets> [previous-output]` takes a captured source bundle:
`typedpress.source-bundle.v1` (`app.typedpress.json`, `vendor.typedpress.json`, `manifest.json`).
`previous-output` is the tree of the version being replaced: its snapshot is the migration baseline.

## Manifest

Besides `format`, `hostContract`, `compiler` and the platform versions (`wordpress`, `php`, `requires`):

- `summary`: `{name, collections, tables, actions, identity, admin}`, what a dashboard shows about the app.
- `routes`: `[{method, path}]`, the app's HTTP routes outside `/wp-json`, and `pagePaths`, its pages (GET
  and HEAD). Hand any request whose path matches to WordPress, whatever its method, after trimming one
  trailing `/` and treating HEAD as GET. Paths use `:name` for one segment and a final `*name` for the
  rest.
- `host`: the names below, as data.

## Lifecycle

Builds come from the build store: `typedpress compile-to-store <sources> <store> <assets> [previous-build]`
writes one and prints its id (see `docs/decisions/2026-11-07-build-store.md`). `Loader::load` mounts store
builds only; a `compile-sources` tree is for hosts that mount it themselves and is not part of this
contract. The compiled app tree's `manifest.json` (under `app/<hash>/`) is the manifest above.

1. Select the build for the request, then call `Loader::load` before WordPress initializes. It mounts
   the runtime, identity when the app needs it (or `users: true`), the app and the admin plugin. `tp/app/`
   pages render from the app plugin.
2. Before exposing a new version, call `Loader::initialize` once. (It does not take the schema check's
   `--drop` confirmations yet: a version that drops data is refused there until it does.) It brings this site's storage up to
   the build, applies
   pending migrations forward only, schedules identity maintenance, seeds content, and writes the ready
   marker. A ready build returns its receipt and changes nothing.
3. Rollback is selecting an older ready build: no migration runs, and the older build reads the newer
   schema's data. Interim limit: a request never installs anything, and `Loader::initialize` on a ready
   build changes nothing, so the stored rewrite rules and the app's Pages stay those of the build
   initialized last until a new build initializes; builds selected per request must share URL patterns
   and page records with the build initialized last. A commerce build that declares shipping must also match the installed
   shipping policy. Omitting `shipping` leaves the installed zones and rates under merchant control.
   Inspection then reports no commerce-shipping step, including after a build that managed them.
   An explicit `shipping: []` manages an empty policy and is checked like any other declaration. Selecting an older ready build does not restore shipping zones or methods;
   its scalar store settings apply immediately while shipping rows remain at their last committed
   state. Refuse a selection whose declared shipping policy differs from that installed state.
   This applies after failed initialization too: a completed shipping transaction is not rolled
   back if a later installation step fails. Block new checkout requests and drain active ones before changing shipping.
   If initialization stopped partway through migrations, first repair the cause and retry initialization
   of that same build. The migrator skips recorded statements. If DDL committed just before its
   ledger entry could be written, verify the actual schema against that statement before using
   `wp typedpress migrate --mark-applied <id>:<n>`. Keep checkout suspended if the schema cannot
   be verified or the build cannot finish. A partially migrated schema has no supported recovery
   baseline until it matches a stored snapshot.
   Once the schema matches a stored build, use its ID as `previous-build` and compile the sources
   declaring the intended shipping policy. If these inputs reproduce a ready ID, give the recovery
   source tree a fresh public deployment revision (for example, a unique non-secret identifier in
   `public/deployment-revision.txt`), recapture with `typedpress sources`, and compile again with
   the same baseline. The changed asset produces a distinct build ID. Verify that the resulting
   build has no ready receipt before initialization. After initialization, inspect the candidate as described below,
   select it only when compatible, and then resume checkout. Historical orders must not be restored or rewritten as part of this recovery.
   Check compatibility in a separate WordPress request/process: call `Loader::load($root, $build,
   ['inspect' => true])` before WordPress initializes, then `Loader::inspect($root, $build)` after
   `init`. Its `steps` list contains `{id: "commerce-shipping", kind: "commerce-shipping",
   state: "pending"}` when the selected build's declared shipping differs from the site's recorded
   source or current shipping rows. Refuse the selection when that entry exists, or when `refusals`
   is non-empty or inspection fails. This reads live state even for an already-ready build; do not
   use its stored initialization receipt as a compatibility check. Keep the host's deployment lock
   and checkout suspension across this check and selection. Block every shipping writer for that
   window: other initializers, Woo merchant administration and REST writes, CLI commands and jobs.
   Rechecking without excluding those writers still leaves a race and is insufficient. There is
   no need to read generated files, private options, or compare
   a host-computed hash.
4. Run `wp typedpress jobs tick` on a schedule. It does one bounded pass of the site's background work and
   prints `{processed, failures, requeued, receiptsExpired, remaining}`. Run it again
   while `remaining` is true. It exits non-zero when it could not run. It takes the same locks as
   WordPress's own runners: it claims Action Scheduler actions before running them and runs WP-Cron
   events under core's `doing_cron` lock, so overlapping ticks, or a tick beside `wp-cron.php` or
   Action Scheduler's runner, run each action and event once.

The built-in TypedPress deployment receiver is not a qualified commerce host yet. It refuses
commerce builds before mounting or initializing them and before selecting a rollback, rather than
changing shared shipping rows without these safeguards. Standalone plugin installations and local
`typedpress dev` remain available; external managed hosts must complete commerce qualification.

<!-- generated by `cargo test --test host_contract` from src/host_contract.rs; do not edit below -->
Host contract version: **2** (`hostContract` in the manifest).

### Reserved paths

| Path | What |
|---|---|
| `/__tp/*` | TypedPress's HTTP API (`/__tp/api/v1/*`): kinds, globals, actions, files, `/me`; served before the theme, outside `/wp-json`. Route it to WordPress and never cache it: every answer is `Cache-Control: private, no-store` with `Vary: Cookie, Authorization`, except file streams |
| `/identity/*` | TypedPress Identity's issuer and pages, when the app mounts identity |
| `/wp-json/typedpress-identity/v1/*` | TypedPress Identity's REST API |
| `/wp-admin/new/*` | TypedPress Admin, unless the app sets `admin: false`: served by wp-admin's `admin.php?page=typedpress-admin`. Apache applies the plugin's `.htaccess` rule; any other server must send a path that is not a file to WordPress's `index.php`, which redirects it to `admin.php?page=typedpress-admin&p=<route>` |
| `/typedpress-admin/*` | the admin's earlier address, redirected to `/wp-admin/new/*` |

The app API is `/__tp/api/v1`; actions are `POST /__tp/api/v1/actions/<name>`. The generated client is a file of the compiled tree (`client/client.js`); the host chooses the URL it serves it at.

### Mount and lifecycle

| Call | When |
|---|---|
| `TypedPress\Loader\Loader::load($root, $build, $options)` | before WordPress initializes, with the build the host selected for this request |
| `TypedPress\Loader\Loader::initialize($root, $build)` | once per build per site, before the host exposes it: storage upgrades, migrations, identity maintenance, the content seed |
| `TypedPress\Loader\Loader::inspect($root, $build)` | after mounting with load(..., ['inspect' => true]) and WordPress init, without initialization: returns steps and refusals; a steps entry with id commerce-shipping means the build's declared shipping policy does not match the site's recorded source and current shipping rows |
| `TypedPress\Loader\Loader::sealed($root, $build)` | a sealed build's plugin allow-list, or null; with `Loader::allowedPlugins` and `Loader::keepUnlisted` in the host's own early code, before WordPress reads its active plugins |
| `TypedPress\Loader\Store::gc($root, $keep)` | after the host deletes a version: keeps exactly the builds it still serves |

### Hooks a host implements or listens to

| Hook | Kind | What |
|---|---|---|
| `tp_mail_transport` | filter | delivers `mail.send` messages; without it, the app's mail is refused |
| `tp_purge_urls` | action | the root-relative URLs a committed content write changed, for a host's page cache; `/*` after a new build goes live |
| `tp_private_probe_url` | filter | the URL the private-files probe fetches, when the public URL is not reachable from the server |
| `tp_prebuild_url` | filter | the URL a prebuilt page is rendered from, when the site cannot reach its own address (`output: "server"` with `prerender`) |
| `tp_identity_providers` | filter | OpenID Connect sign-in providers TypedPress Identity offers |
| `tp_identity_rest_cookie_auth` | filter | lets the identity session cookie authenticate the app's REST API (a host serving its own frontend) |
| `tp_identity_session_cookie_aliases` | filter | other cookie names whose session a migrated site keeps |
| `tp_fetch_allow_address` | filter | allows an outgoing `fetch` to an address TypedPress denies by default |
| `tp_runtime_loaded` | action | the runtime has booted; register commands and seams after it |

### Live updates

| Name | What |
|---|---|
| `tp_realtime_changes` | WordPress action fired once per committed transaction with its change notice `{id, at, changes: [{collection, ops, ids}]}` |
| `TypedPress\Realtime\Publisher` | PHP interface a host implements to send each notice to its realtime transport (`TypedPress\Realtime\Module::publish`) |
| `TypedPress\Realtime\Module::shared($notice)` | the notice with the ids of collections not every visitor can list set to null, for a room every visitor shares |
| `__tpRealtime` | the page-wide registry on `globalThis` that every generated client on a page shares; a host script calls `registerRealtimeTransport` from the client to set it |

### Background work

`wp typedpress jobs tick [--limit=<1..100>] [--budget-ms=<ms>]`

### Sealed mode

When the app sets `sealed: true`, the hosted manifest and the build manifest carry `sealed`: the plugin directory names that may load (TypedPress's own, the platform pins, and the plugins the config declares). The key is absent when the app isn't sealed. TypedPress itself only refuses new activations and reports what else is loaded, because WordPress loads drop-ins, must-use plugins and active plugins before TypedPress's app plugin. A host that wants the list enforced does it in its own early code (a must-use plugin of the host's, or `sunrise.php`): it filters `option_active_plugins` with `TypedPress\Loader\Loader::allowedPlugins($active, $sealed)`, keeps the hidden entries stored with `TypedPress\Loader\Loader::keepUnlisted($new, $stored, $sealed)` on `pre_update_option_active_plugins`, ships no must-use plugin or drop-in beyond its own, and defines `TP_SEALED_ENFORCED` so the app reports `enforced: "host"`. `allowedPlugins` never passes `vip-block-data-api` or `vip-decoupled-bundle`, whatever list it is given: each serves stored content around the app's read rules. Nothing changes for sites that don't serve a TypedPress app. docs/sealed.md has the example.

### Prebuilt pages

A build with prebuilt pages writes their HTML and Markdown below `wp-content/cache/typedpress-prebuilt/` (moved by the `tp_prebuilt_dir` filter), and PHP serves them: `TypedPress\Render\Prebuilt::serve()` answers at `plugins_loaded` when the request, its cookies, the site's visibility and the file's age allow it, and lets WordPress render otherwise. A host must not serve these files directly, from its web server or any cache of its own, and must not expose the folder over HTTP: deny requests to it as it does for other private paths. Whether a file may be served is decided per request, and only `serve()` decides it. A host's page cache stores and purges these answers as it does any other page. The rebuild runs as the `tp_prebuild` Action Scheduler action, on the host's jobs worker like any other.

### Table prefix

TypedPress puts every table under WordPress's `$wpdb->prefix` and never changes it. App tables are `{prefix}tp_<table>`, system tables `{prefix}tp__<name>`, identity tables `{prefix}tp_identity_<name>`. The host owns the prefix: a host that binds several apps to one database gives each its own prefix before WordPress loads. An app's `existingTable` must be under that prefix (and not WordPress's, TypedPress's or Action Scheduler's own table, nor under another site's longer prefix, which need not end in `_`), or the Space's own Zero 0.8 table `sf_<space>_<table>_<10 hex>` with the converter's digest of that Space id and table name. The Space id comes from the host: `spacefast_content_space_id()` when it exists, else the `TP_SPACE_ID` constant defined before WordPress loads; on a `sfz_<24 hex>_` prefix it must also be the Space that prefix was made from. With neither, no 0.8 table binds. The longest name TypedPress adds after it is 29 characters, so a prefix may be at most 35 characters.

### Manifest `host` object

For a build with `store()`, both the hosted manifest's `maxTablePrefix` and
`host.maxTablePrefix` are **20**, because Woo's longest table suffix is 44 characters.
The loader's early commerce policy enforces this before Woo initializes. Other builds use
the ordinary 35-character limit shown below.

```json
{
  "reservedPaths": [
    "/__tp/*",
    "/identity/*",
    "/wp-json/typedpress-identity/v1/*",
    "/wp-admin/new/*",
    "/typedpress-admin/*"
  ],
  "apiPrefix": "/__tp/api/v1",
  "actionPrefix": "/__tp/api/v1/actions/",
  "liveUpdates": {
    "action": "tp_realtime_changes",
    "publisher": "TypedPress\\Realtime\\Publisher",
    "registry": "__tpRealtime"
  },
  "hooks": [
    "tp_mail_transport",
    "tp_purge_urls",
    "tp_private_probe_url",
    "tp_prebuild_url",
    "tp_identity_providers",
    "tp_identity_rest_cookie_auth",
    "tp_identity_session_cookie_aliases",
    "tp_fetch_allow_address",
    "tp_runtime_loaded"
  ],
  "mount": "TypedPress\\Loader\\Loader::load",
  "jobsCommand": "wp typedpress jobs tick",
  "maxTablePrefix": 35
}
```
<!-- end generated -->
