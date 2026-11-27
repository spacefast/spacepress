---
title: Host Contract
description: Everything a hosting platform may rely on when compiling and mounting SpacePress apps into WordPress.
order: 1
status: published
publishedAt: 2026-11-21T09:21:00.000Z
---
# Host contract

A host compiles SpacePress apps itself and mounts them into WordPress: Spacefast is one. This page is
everything such a host may rely on. Anything not listed here is SpacePress's internals: a host that reads
generated files, requires runtime files by path or calls other `SpacePress\` classes breaks when they change.

## Versioning

Every hosted manifest (`manifest.json` of a `compile-sources` tree, format `spacepress.hosted.v1`) carries an
integer `hostContract`. It changes only when something below changes incompatibly for a host. Additions
don't change it. A host refuses a compiled tree whose `hostContract` it doesn't know, rather than serving
it on assumptions.

Version 2 requires managed commerce hosts to check shipping compatibility before selecting a build,
including rollback and recovery after a failed initialization. Version 1 hosts must refuse version 2
manifests until they implement this lifecycle requirement.

## Uploads

`compile-sources <sources> <new-output> <assets> [previous-output]` takes a captured source bundle:
`spacepress.source-bundle.v1` (`app.spacepress.json`, `vendor.spacepress.json`, `manifest.json`).
`previous-output` is the tree of the version being replaced: its snapshot is the migration baseline.

## Manifest

Besides `format`, `hostContract`, `compiler` and the platform versions (`wordpress`, `php`, `requires`):

- `summary`: `{name, collections, tables, actions, identity, admin}`, what a dashboard shows about the app.
- `routes`: `[{method, path}]`, the app's HTTP routes outside `/wp-json`, and `pagePaths`, its pages (GET
  and HEAD). Hand any request whose path matches to WordPress, whatever its method, after trimming one
  trailing `/` and treating HEAD as GET. Paths use `:name` for one segment and a final `*name` for the
  rest.
- `host`: the names below, as data.

Host contract version: **2** (`hostContract` in the manifest).

### Reserved paths

| Path | What |
|---|---|
| `/wp-json/spacepress/v1/*` | SpacePress's HTTP API: kinds, globals, actions, files, `/me`, one route on WordPress's REST server. Every answer is `Cache-Control: private, no-store` with `Vary: Origin, Cookie, Authorization`, except file streams and `/openapi.json` |
| `/identity/*` | SpacePress Identity's issuer and pages, when the app mounts identity |
| `/wp-json/spacepress-identity/v1/*` | SpacePress Identity's REST API |
| `/wp-admin/new/*` | SpacePress Admin, unless the app sets `admin: false`: served by wp-admin's `admin.php?page=spacepress-admin`. Apache applies the plugin's `.htaccess` rule; any other server must send a path that is not a file to WordPress's `index.php`, which redirects it to `admin.php?page=spacepress-admin&p=<route>` |

The app API is `/wp-json/spacepress/v1`; actions are `POST /wp-json/spacepress/v1/actions/<name>`. The generated client runs each kind, action and global operation as the app's WordPress Ability at core's run route, `/wp-json/wp-abilities/v1/abilities/<app>/<name>/run`, and uses the app API for media, revisions, `me`, uploads, file streams, live subscriptions and sign-in: route `/wp-json/*` to WordPress and never cache it. The client is a file of the compiled tree (`client/client.js`); the host chooses the URL it serves it at.

### Mount and lifecycle

| Call | When |
|---|---|
| `SpacePress\Loader\Loader::load($root, $build, $options)` | before WordPress initializes, with the build the host selected for this request. `preview: true` marks a preview binding, one that runs on a database of its own and seeds it again for each version: the seed's writes queue no webhook deliveries and no `mail.send` mail (`mail.send` checks the message and resolves to `{ id: "" }`); after the seed a preview sends webhooks and mail like any site. Off by default, which is production |
| `SpacePress\Loader\Loader::initialize($root, $build)` | once per build per site, before the host exposes it: storage upgrades, migrations, identity maintenance, the content seed |
| `SpacePress\Loader\Loader::inspect($root, $build)` | after mounting with load(..., ['inspect' => true]) and WordPress init, without initialization: returns steps and refusals; a steps entry with id commerce-shipping means the build's declared shipping policy does not match the site's recorded source and current shipping rows |
| `SpacePress\Loader\Loader::sealed($root, $build)` | a sealed build's plugin allow-list, or null; with `Loader::allowedPlugins` and `Loader::keepUnlisted` in the host's own early code, before WordPress reads its active plugins |
| `SpacePress\Loader\Store::gc($root, $keep)` | after the host deletes a version: keeps exactly the builds it still serves |

### Hooks a host implements or listens to

| Hook | Kind | What |
|---|---|---|
| `sp_mail_transport` | filter | optional: delivers `mail.send` messages itself by returning `true`, refuses one for a retry with `false` or a throw, or returns `null` to leave it to WordPress's `wp_mail()` (before this, `null` was a refusal and managed builds refused mail without a transport) |
| `sp_purge_urls` | action | the root-relative URLs a committed content write changed, for a host's page cache, each with the query string a page was cached under (only parameters the page declares as `search`; a request with any other parameter is answered `private, no-store` and never named here); `/*` after a new build goes live |
| `sp_private_probe_url` | filter | the URL the private-files probe fetches, when the public URL is not reachable from the server |
| `sp_private_dir` | filter | optional: the directory private files (`files()` buckets with local uploads) are kept in, outside anything the web server serves. Returning one replaces `wp-content/uploads/spacepress-private`, its `.htaccess` and the probe: the host vouches that the directory is never served directly. Set it before a site stores any private file; files already under the default directory are not moved |
| `sp_prebuild_url` | filter | the URL a prebuilt page is rendered from, when the site cannot reach its own address (`output: "server"` with `prerender`) |
| `sp_identity_providers` | filter | OpenID Connect sign-in providers SpacePress Identity offers |
| `sp_identity_rest_cookie_auth` | filter | lets the identity session cookie authenticate the app's REST API (a host serving its own frontend) |
| `sp_fetch_allow_address` | filter | allows an outgoing `fetch` to an address SpacePress denies by default |
| `sp_runtime_loaded` | action | the runtime has booted; register commands and seams after it |
| `sp_connectors_call` | filter | invokes a host-managed connector with `(null, $role, $tool, $args, $context)`: now for `connectors.call(role, tool, args?)` (`$context['mode']` is `call`), or after commit from the built-in `spacepress.connector` job for `connectors.enqueue(role, tool, args?, { key?, delay? })` (`mode` is `queued`, with `jobId` and `attempt`; a `WP_Error`, a throw or `null` retries with backoff; a queued call runs at least once and may repeat, so de-duplicate by `jobId`); register with 5 accepted args to receive `$context`; credentials remain owned by the host |
| `sp_identity_callback_url` | filter | the redirect URI an OpenID provider is sent back to, with `($url, $provider, $pathUrl)`: the default `<prefix>/provider/callback?provider=<name>`, or `$pathUrl`, `<prefix>/callback/<name>`; both are served |
| `sp_auth_prefix` | filter | overrides the OIDC issuer and callback route prefix (default `/identity`, or `SP_AUTH_PREFIX` constant); browser sign-in stays on `wp-login.php` |
| `sp_api_namespace` | filter | overrides the app REST API namespace under `/wp-json/` (default `spacepress/v1`, or `SP_API_NAMESPACE` constant) |
| `sp_identity_api_namespace` | filter | overrides the identity REST API namespace under `/wp-json/` (default `spacepress-identity/v1`, or `SP_IDENTITY_API_NAMESPACE` constant) |

### Live updates

| Name | What |
|---|---|
| `sp_realtime_changes` | WordPress action fired once per committed transaction with its change notice `{id, at, changes: [{collection, ops, ids}]}` |
| `SpacePress\Realtime\Publisher` | PHP interface a host implements to send each notice to its realtime transport (`SpacePress\Realtime\Module::publish`) |
| `SpacePress\Realtime\Module::shared($notice)` | the notice with the ids of collections not every visitor can list set to null, for a room every visitor shares |
| `__spRealtime` | the page-wide registry on `globalThis` that every generated client on a page shares; a host script calls `registerRealtimeTransport` from the client to set it |

### Background work

`wp spacepress jobs tick [--limit=<1..100>] [--budget-ms=<ms>]`

### Sealed mode

When the app sets `sealed: true`, the hosted manifest and the build manifest carry `sealed`: the plugin directory names that may load (SpacePress's own, the platform pins, and the plugins the config declares). The key is absent when the app isn't sealed. SpacePress itself only refuses new activations and reports what else is loaded, because WordPress loads drop-ins, must-use plugins and active plugins before SpacePress's app plugin. A host that wants the list enforced does it in its own early code (a must-use plugin of the host's, or `sunrise.php`): it filters `option_active_plugins` with `SpacePress\Loader\Loader::allowedPlugins($active, $sealed)`, keeps the hidden entries stored with `SpacePress\Loader\Loader::keepUnlisted($new, $stored, $sealed)` on `pre_update_option_active_plugins`, ships no must-use plugin or drop-in beyond its own, and defines `SP_SEALED_ENFORCED` so the app reports `enforced: "host"`. `allowedPlugins` never passes `vip-block-data-api` or `vip-decoupled-bundle`, whatever list it is given: each serves stored content around the app's read rules. Nothing changes for sites that don't serve a SpacePress app. /docs/operations/cli-and-deploy has the example.

### Prebuilt pages

A build with prebuilt pages writes their HTML and Markdown below `wp-content/cache/spacepress-prebuilt/` (moved by the `sp_prebuilt_dir` filter), and PHP serves them: `SpacePress\Render\Prebuilt::serve()` answers at `plugins_loaded` when the request, its cookies, the site's visibility and the file's age allow it, and lets WordPress render otherwise. A host must not serve these files directly, from its web server or any cache of its own, and must not expose the folder over HTTP: deny requests to it as it does for other private paths. Whether a file may be served is decided per request, and only `serve()` decides it. A host's page cache stores and purges these answers as it does any other page. The rebuild runs as the `sp_prebuild` Action Scheduler action, on the host's jobs worker like any other.

### Table prefix

SpacePress puts every table under WordPress's `$wpdb->prefix` and never changes it. App tables are `{prefix}sp_<table>`, system tables `{prefix}sp__<name>`, identity tables `{prefix}sp_identity_<name>`. The host owns the prefix: a host that binds several apps to one database gives each its own prefix before WordPress loads. An app's `existingTable` must be under that prefix, and not WordPress's, SpacePress's, Action Scheduler's, identity's or WooCommerce's own table, nor under another site's longer prefix, which need not end in `_`. The longest name SpacePress adds after it is 29 characters, so a prefix may be at most 35 characters.

### Manifest `host` object

For a build with `store()`, both the hosted manifest's `maxTablePrefix` and
`host.maxTablePrefix` are **20**, because Woo's longest table suffix is 44 characters.
The loader's early commerce policy enforces this before Woo initializes. Other builds use
the ordinary 35-character limit shown below.

```json
{
  "reservedPaths": [
    "/wp-json/spacepress/v1/*",
    "/identity/*",
    "/wp-json/spacepress-identity/v1/*",
    "/wp-admin/new/*"
  ],
  "apiPrefix": "/wp-json/spacepress/v1",
  "actionPrefix": "/wp-json/spacepress/v1/actions/",
  "liveUpdates": {
    "action": "sp_realtime_changes",
    "publisher": "SpacePress\\Realtime\\Publisher",
    "registry": "__spRealtime"
  },
  "hooks": [
    "sp_mail_transport",
    "sp_purge_urls",
    "sp_private_probe_url",
    "sp_private_dir",
    "sp_prebuild_url",
    "sp_identity_providers",
    "sp_identity_rest_cookie_auth",
    "sp_fetch_allow_address",
    "sp_runtime_loaded",
    "sp_connectors_call",
    "sp_identity_callback_url",
    "sp_auth_prefix",
    "sp_api_namespace",
    "sp_identity_api_namespace"
  ],
  "mount": "SpacePress\\Loader\\Loader::load",
  "jobsCommand": "wp spacepress jobs tick",
  "maxTablePrefix": 35
}
```
