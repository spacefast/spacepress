//! What a host (Spacefast, or any platform that compiles and mounts First apps itself) relies on,
//! stated once. The hosted manifest carries it (`bundle::compile_tree`), and `docs/host-contract.md`
//! is generated from it (`tests/host_contract.rs` fails when the doc is stale).
//!
//! Bump [`HOST_CONTRACT`] only when something here changes incompatibly for a host: a manifest field
//! it reads changes meaning, a path or name below moves, the mount entry or the jobs command changes
//! shape, or a hook changes its arguments. Additions are not bumps. A host refuses compiled trees
//! whose `hostContract` it doesn't know.

use serde_json::{Value, json};

/// The host contract version, in every hosted manifest as `hostContract`.
pub const HOST_CONTRACT: u32 = 1;

/// Paths below the site root that First answers itself; a host routes them to WordPress and keeps
/// its own paths out of them.
pub const RESERVED_PATHS: &[(&str, &str)] = &[
    (
        "/__first/*",
        "First's HTTP API (`/__first/api/v1/*`): kinds, globals, actions, files, `/me`; served before the theme, outside `/wp-json`. Route it to WordPress and never cache it: every answer is `Cache-Control: private, no-store` with `Vary: Cookie, Authorization`, except file streams",
    ),
    (
        "/identity/*",
        "First Identity's issuer and pages, when the app mounts identity",
    ),
    ("/wp-json/first-identity/v1/*", "First Identity's REST API"),
    (
        "/wp-admin/new/*",
        "First Admin, unless the app sets `admin: false`: served by wp-admin's `admin.php?page=first-admin`. Apache applies the plugin's `.htaccess` rule; any other server must send a path that is not a file to WordPress's `index.php`, which redirects it to `admin.php?page=first-admin&p=<route>`",
    ),
    (
        "/first-admin/*",
        "the admin's earlier address, redirected to `/wp-admin/new/*`",
    ),
];

/// The app API (`First\Wp\Facade::PREFIX`), and the path prefix of actions under it.
pub const API_PREFIX: &str = "/__first/api/v1";
pub const ACTION_PREFIX: &str = "/__first/api/v1/actions/";

/// Live updates: what a host's transport and publisher deal in.
pub const LIVE_UPDATES: &[(&str, &str)] = &[
    (
        "first_realtime_changes",
        "WordPress action fired once per committed transaction with its change notice `{id, at, changes: [{collection, ops, ids}]}`",
    ),
    (
        "First\\Realtime\\Publisher",
        "PHP interface a host implements to send each notice to its realtime transport (`First\\Realtime\\Module::publish`)",
    ),
    (
        "First\\Realtime\\Module::shared($notice)",
        "the notice with the ids of collections not every visitor can list set to null, for a room every visitor shares",
    ),
    (
        "__firstRealtime",
        "the page-wide registry on `globalThis` that every generated client on a page shares; a host script calls `registerRealtimeTransport` from the client to set it",
    ),
];

/// Filters and actions a host implements or listens to. Every one is called by the runtime.
pub const HOOKS: &[(&str, &str, &str)] = &[
    (
        "first_mail_transport",
        "filter",
        "delivers `mail.send` messages; without it, the app's mail is refused",
    ),
    (
        "first_purge_urls",
        "action",
        "the root-relative URLs a committed content write changed, for a host's page cache",
    ),
    (
        "first_private_probe_url",
        "filter",
        "the URL the private-files probe fetches, when the public URL is not reachable from the server",
    ),
    (
        "first_prebuild_url",
        "filter",
        "the URL a prebuilt page is rendered from, when the site cannot reach its own address (`output: \"server\"` with `prerender`)",
    ),
    (
        "first_identity_providers",
        "filter",
        "OpenID Connect sign-in providers First Identity offers",
    ),
    (
        "first_identity_rest_cookie_auth",
        "filter",
        "lets the identity session cookie authenticate the app's REST API (a host serving its own frontend)",
    ),
    (
        "first_identity_session_cookie_aliases",
        "filter",
        "other cookie names whose session a migrated site keeps",
    ),
    (
        "first_fetch_allow_address",
        "filter",
        "allows an outgoing `fetch` to an address First denies by default",
    ),
    (
        "first_runtime_loaded",
        "action",
        "the runtime has booted; register commands and seams after it",
    ),
];

/// The one site command a host's worker runs, and what it prints.
pub const JOBS_COMMAND: &str = "wp first jobs tick [--limit=<1..100>] [--budget-ms=<ms>]";

/// The PHP entry points a host calls, in order.
pub const MOUNT: &[(&str, &str)] = &[
    (
        "First\\Loader\\Loader::load($root, $build, $options)",
        "before WordPress initializes, with the build the host selected for this request",
    ),
    (
        "First\\Loader\\Loader::initialize($root, $build)",
        "once per build per site, before the host exposes it: storage upgrades, migrations, identity maintenance, the content seed",
    ),
    (
        "First\\Loader\\Loader::sealed($root, $build)",
        "a sealed build's plugin allow-list, or null; with `Loader::allowedPlugins` and `Loader::keepUnlisted` in the host's own early code, before WordPress reads its active plugins",
    ),
    (
        "First\\Loader\\Store::gc($root, $keep)",
        "after the host deletes a version: keeps exactly the builds it still serves",
    ),
];

/// Sealed mode (`sealed: true`, docs/sealed.md): what a host does with the allow-list.
pub const SEALED: &str = "When the app sets `sealed: true`, the hosted manifest and the build manifest carry `sealed`: the plugin directory names that may load (First's own, the platform pins, and the plugins the config declares). The key is absent when the app isn't sealed. First itself only refuses new activations and reports what else is loaded, because WordPress loads drop-ins, must-use plugins and active plugins before First's app plugin. A host that wants the list enforced does it in its own early code (a must-use plugin of the host's, or `sunrise.php`): it filters `option_active_plugins` with `First\\Loader\\Loader::allowedPlugins($active, $sealed)`, keeps the hidden entries stored with `First\\Loader\\Loader::keepUnlisted($new, $stored, $sealed)` on `pre_update_option_active_plugins`, ships no must-use plugin or drop-in beyond its own, and defines `FIRST_SEALED_ENFORCED` so the app reports `enforced: \"host\"`. `allowedPlugins` never passes `vip-block-data-api` or `vip-decoupled-bundle`, whatever list it is given: each serves stored content around the app's read rules. Nothing changes for sites that don't serve a First app. docs/sealed.md has the example.";

/// Prebuilt pages (`prerender = true` with `output: "server"`; docs/decisions/2026-11-13-static-output.md):
/// when a host may answer a URL from its file before PHP, and what it must send. Every rule is what
/// `First\Render\Prebuilt::serve()` checks at `plugins_loaded`, which answers the same files when the
/// host doesn't; a host that serves them sooner must decide the same way, and send anything it can't
/// decide to PHP.
pub const PREBUILT: &[(&str, &str)] = &[
    (
        "Where",
        "`wp-content/cache/first-prebuilt/` (moved by the `first_prebuilt_dir` filter) holds one directory per build, named by 16 hex characters, and `current.json`. Only the directory `current.json` names (`build`) is served; when `current.json` is absent, nothing is: the site has no complete build yet, or it hides itself from the public, or a site-wide change dropped every file",
    ),
    (
        "Request",
        "`GET` or `HEAD`, with no query string, below the site's home path (`home` in `current.json`, `\"\"` at the domain root). Any other method or a query string goes to PHP",
    ),
    (
        "Cookies",
        "none whose name starts with `wordpress_logged_in_`, `wordpress_sec_`, `wp-postpass_` or `comment_author_`, and none named `wp_lang`, `zi_session` or `__Host-zi_session`. Any of them goes to PHP",
    ),
    (
        "Accept",
        "a request whose `Accept` contains `text/markdown` goes to PHP (the Markdown negotiation answers it); the `.md` URL itself is a file like any other",
    ),
    (
        "Path to file",
        "below the home path, `/` is `index.html`, `/x/y` is `x/y.html`, `/x/y.md` is `x/y.md`, and `/index.md` is the home page's twin. A path ending in `/` other than `/`, a path that is `/index`, a path whose segments aren't each exactly `rawurlencode(rawurldecode(segment))` (one spelling per file), or one that decodes to `..`, NUL or `\\` goes to PHP",
    ),
    (
        "Age",
        "a file whose modification time is more than `maxAge` seconds ago (`current.json`; 3600) goes to PHP. Files are rewritten well within that window",
    ),
    (
        "Missing file",
        "goes to PHP: the page isn't prebuilt, or a write removed its file and its rebuild hasn't run",
    ),
    (
        "Response",
        "`200` with the file's bytes (none for `HEAD`) and `Content-Length`; `Cache-Control` from `current.json` (`cacheControl`, what a cacheable render sends); `X-First-Prebuilt: 1`; for `.html`, `Content-Type: text/html; charset=<charset>` and `Link: <url>.md; rel=\"alternate\"; type=\"text/markdown\"` (`/index.md` for `/`); for `.md`, `Content-Type: text/markdown; charset=UTF-8`, `X-Content-Type-Options: nosniff` and `Link: <url>; rel=\"canonical\"`; and `Content-Signal: <contentSignal>` when it is not empty",
    ),
    (
        "Purges and rebuilds",
        "a write that changes a prebuilt page removes its files at once, before the write's purge is announced on `first_purge_urls`, and schedules the rebuild (the `first_prebuild` Action Scheduler action, run by the host's jobs worker like any other). Until it has run, the URL has no file and goes to PHP. A host's page cache is purged as for any page; the files need no purge of their own. A full rebuild (deploy, hourly, a site-wide change) rewrites `current.json` when it completes",
    ),
];

/// The table-prefix rule.
pub const TABLE_PREFIX: &str = "First puts every table under WordPress's `$wpdb->prefix` and never changes it. App tables are `{prefix}first_<table>`, system tables `{prefix}first__<name>`, identity tables `{prefix}first_identity_<name>`. The host owns the prefix: a host that binds several apps to one database gives each its own prefix before WordPress loads.";

/// The longest system name First adds after the prefix: `first_identity_recovery_codes` (29) and
/// `first__services_submissions` (27). An app table adds `first_` to a name the app chose, so a
/// longer table name is the app's choice and is refused at deploy by MySQL's 64-character limit.
pub const MAX_SUFFIX: usize = 29;

/// The `host` object of the hosted manifest.
pub fn manifest_host() -> Value {
    json!({
        "reservedPaths": RESERVED_PATHS.iter().map(|(p, _)| *p).collect::<Vec<_>>(),
        "apiPrefix": API_PREFIX,
        "actionPrefix": ACTION_PREFIX,
        "liveUpdates": {"action": "first_realtime_changes", "publisher": "First\\Realtime\\Publisher", "registry": "__firstRealtime"},
        "hooks": HOOKS.iter().map(|(name, _, _)| *name).collect::<Vec<_>>(),
        "mount": "First\\Loader\\Loader::load",
        "jobsCommand": "wp first jobs tick",
        "maxTablePrefix": 64 - MAX_SUFFIX,
        "prebuilt": {"dir": "wp-content/cache/first-prebuilt", "pointer": "current.json"},
    })
}

/// The generated part of docs/host-contract.md (between its markers).
pub fn render_doc() -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "Host contract version: **{HOST_CONTRACT}** (`hostContract` in the manifest).\n\n"
    ));
    out.push_str("### Reserved paths\n\n| Path | What |\n|---|---|\n");
    for (path, what) in RESERVED_PATHS {
        out.push_str(&format!("| `{path}` | {what} |\n"));
    }
    out.push_str(&format!("\nThe app API is `{API_PREFIX}`; actions are `POST {ACTION_PREFIX}<name>`. The generated client is a file of the compiled tree (`client/client.js`); the host chooses the URL it serves it at.\n\n"));
    out.push_str("### Mount and lifecycle\n\n| Call | When |\n|---|---|\n");
    for (call, when) in MOUNT {
        out.push_str(&format!("| `{call}` | {when} |\n"));
    }
    out.push_str("\n### Hooks a host implements or listens to\n\n| Hook | Kind | What |\n|---|---|---|\n");
    for (name, kind, what) in HOOKS {
        out.push_str(&format!("| `{name}` | {kind} | {what} |\n"));
    }
    out.push_str("\n### Live updates\n\n| Name | What |\n|---|---|\n");
    for (name, what) in LIVE_UPDATES {
        out.push_str(&format!("| `{name}` | {what} |\n"));
    }
    out.push_str(&format!("\n### Background work\n\n`{JOBS_COMMAND}`\n\n"));
    out.push_str(&format!("### Sealed mode\n\n{SEALED}\n\n"));
    out.push_str("### Prebuilt pages\n\nA host may answer a prebuilt page's URL from its file before PHP. It must decide as `First\\Render\\Prebuilt::serve()` does, and send every request it can't decide to PHP, which answers the same files at `plugins_loaded`.\n\n| Rule | What |\n|---|---|\n");
    for (rule, what) in PREBUILT {
        out.push_str(&format!("| {rule} | {what} |\n"));
    }
    out.push('\n');
    out.push_str(&format!("### Table prefix\n\n{TABLE_PREFIX} The longest name First adds after it is {MAX_SUFFIX} characters, so a prefix may be at most {} characters.\n\n", 64 - MAX_SUFFIX));
    out.push_str("### Manifest `host` object\n\n```json\n");
    out.push_str(&serde_json::to_string_pretty(&manifest_host()).unwrap());
    out.push_str("\n```\n");
    out
}
