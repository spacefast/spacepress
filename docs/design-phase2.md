# Zero phase 2 — design and work plan

Status: frozen for implementation. Extends `docs/design-wp-parity.md` (rev 2,
"phase 1"); where this document is silent, phase 1 holds. Where it changes
phase 1 it says so with **CHANGES §x.y**. Many agents build from this in
parallel without talking; §9 says who owns which files and in what order
things merge. Running example stays `examples/blog`, extended in §4–§8.

**Revision 2 (2026-10-28).** User rulings applied: Composer-built, properly
bundled PHP dependencies are allowed (§3.3 rewritten; `vendor-prefixed/` in
§2.1/§2.3; sync's Markdown conversion moves to the PHP runtime on the
WordPress php-toolkit, §5.2/§5.3/§5.4/§5.6/§5.7); Action Scheduler and the
`guest` role confirmed; localization redesigned around **Polylang** with one
post per locale (§7.3 replaced; lane H's files in §9.2; seam `onLookup` in
§9.1); new **§2.7 Required platform** (enforced WP/PHP/plugin versions, checked
by `zero doctor`, activation, harness, CI); per-feature "leans on" rulings
(§1 table; MCP server registration in §7.1; optional Jetpack Image CDN adapter
in §7.2); §9.5 CI provisions the required plugins and verifies vendor drift;
§10 rewritten. Everything in §9's lanes, stacks and review gate is unchanged
except the file lists noted.

Conventions: "rejected" = `zero check`/`zero build` fails with `file:line:col`
and a fix, on both targets. "WP" = the WordPress target, "standalone" = the
PHP+SQLite target. Both stay alive (ruling); the per-feature support matrix is
in §1. Problem codes are RFC 9457 as in phase 1. New system tables are named
`__zero_<x>` standalone and `{prefix}zero__<x>` on WP, exactly as phase 1's.

---

## 1. Decisions in one screen

| Area | Decision |
|---|---|
| Plugin set | Three plugins: **`zero-runtime`** (shared PHP runtime, versioned with the `zero` binary), **`zero-identity`** (spacefast-identity, renamed, OIDC issuer + account screens), **`zero-app-<name>`** (generated per app: schema.php, functions.php, migrations). No `mu-plugins`. One app plugin per site in phase 2. |
| Build output (WP) | `zero build --target wp` writes `.zero/wp-content/plugins/{zero-runtime,zero-identity,zero-app-<name>}/` plus one zip per plugin and `zero-manifest.json`. Drop the tree onto any WordPress; the harness bind-mounts `plugins/`. |
| Standalone | Stays `.zero/app`. Same runtime bytes. Supports features 1, 2, 3, 6, 7 fully (7 with Zero's own translation-group columns); feature 4 partially (password + guest sessions, no OIDC/passkeys/MFA); feature 5 not at all (abilities/MCP are WordPress APIs). |
| schema.php | **Version 3** (§3.1). Additive keys; the runtime refuses v2. |
| Required platform | WordPress ≥ 7.1, PHP ≥ 8.2, MySQL 8.0+/MariaDB 10.11+ InnoDB or SQLite Database Integration 3.1.2+; required plugins with minimum versions: `secure-custom-fields` 6.9.7, `action-scheduler` 4.2, `mcp-adapter` 0.7.1, and `polylang` 3.9 when `locales` is configured. Declared in plugin headers, checked on activation and by `zero doctor`, provisioned by the harness and `zero dev --wp` (§2.7). |
| Third-party PHP | Composer is used **at maintainer time** to install and prefix (Strauss) a small, justified dependency set per plugin; the prefixed tree is committed under `vendor-prefixed/` with a drift guard, embedded in the binary and emitted into the built plugins. `zero build` needs no PHP, Composer or Strauss on the user's machine (§3.3). |
| Identity | spacefast-identity moves into this repo as `runtime/identity/` → plugin `zero-identity`, namespace `Zero\Identity`, GPL-2.0-or-later. Keeps webauthn-lib (passkeys), firebase/php-jwt, spomky-labs/otphp; drops league/oauth2-server + jumbojett + nyholm + defuse + lcobucci in favour of ~300 lines of plain PHP (the plugin already implemented most of OIDC itself). |
| Leans on plugins | Jobs → Action Scheduler. Abilities/MCP → core Abilities API (WP 6.9+, `meta.public` 7.1) + the WordPress MCP Adapter plugin. Localization → Polylang free (one post per locale, Zero emits `wpml-config.xml` + `pll_*` calls; WPML-compatible by the same file). Markdown ⇄ blocks → WordPress php-toolkit (`wp-php-toolkit/markdown`). Images → core (`add_image_size` + `wp_get_image_editor`, focal via `image_resize_dimensions`), with an **optional** Jetpack Image CDN adapter. Private files, identity, field access, webhooks → no plugin (nothing suitable exists; justified per feature). |
| Feature 4 on WP | `zero-identity` owns accounts, sessions, PKCE authorize, token endpoint (gains refresh rotation), suspension. `zero-runtime` resolves its Bearer tokens, creates guests, and maps `auth: true` collections onto `wp_users`. |
| Field access | `.access({ read, update })` per column, evaluated in the pipeline per row; hidden columns are stripped from rows and refused in filters. wp-admin ignores it (WP caps govern there, as phase 1 §1.6). |
| Conditional fields | `.showIf(filter)` static sibling filter → SCF `conditional_logic`; UI + `/_schema` metadata only, no pipeline effect. |
| Sync | Markdown/JSON files with YAML front matter ⇄ records, per-field three-way merge in the Rust CLI, `.zero/sync-base.json` keyed by site id, conflict files `.zero/conflicts/<uid>.md`, `zr_` uids as a system column. Sync REST `/sync/*` on both targets; on WP also abilities. Media bytes don't sync in phase 2. |
| Jobs | `job({ input, handler })` + `jobs.<name>.enqueue()` from hooks/actions; enqueue inside a transaction writes an **outbox** row, moved to the queue after commit. Standalone: `__zero_jobs` + `zero jobs work`. WP: Action Scheduler (`Requires Plugins: action-scheduler`). `once(key, fn)` + `Idempotency-Key` header via `__zero_receipts`. Outbound webhooks are a built-in job; inbound HMAC check is an action option. |
| Abilities/MCP | Every collection op, action, global op and sync op registers as a WP Ability `<app>/<kebab-name>`; JSON Schemas derived from schema.php; permission = Zero access rule; MCP via the WordPress MCP Adapter plugin. `agents: false` on a collection/action/global keeps the ability out of REST + MCP. |
| Media | `media.sizes` in config → named sizes on both targets; `focal` on media rows drives `cover` crops; `PATCH /media/{id}`. Private files: `files("decks", {...})` buckets, `file({ bucket })` column kind, signed 5-minute download URLs streamed by PHP. |
| Localization | **One row per locale** (Polylang's model, adopted on both targets). `locales: { default, all, fallback }`; a collection with any `.localized()` column is localized: `.localized()` columns are translated per locale, every other column is synced across the translation group. System columns `locale` and `translations: Record<locale, id>`; per-query `locale`; create with `translationOf`. WP post-backed: Polylang owns language + group (`pll_*`), Zero generates `wpml-config.xml` for copy/translate policy. Tables + standalone: Zero's own `locale` + `translationGroup` columns and pipeline-level sync. |
| Shared-file strategy | A sequential **seams stack (A)** lands first: runtime extension points, the whole phase-2 config surface parsed into schema.php v3 (no behaviour), the plugin split + wp-content output, and CI. Feature lanes B–H then never edit `compile.rs`/`extract.rs`/`eval.rs`/`Db.php`/`App.php`/`Schema.php`/`index.d.ts` except where §9.2 names one owner. |
| Review gate | Every PR gets a Sol 6.1 high review (`codex-t3-proxy exec`, `gpt-6.1-sol`, reasoning high) on its `merge-base` diff; findings are fixed or rebutted in the PR body before merge. |
| CI | GitHub Actions: `cargo test`, `tests/php/run.sh`, three `tsc` projects, `tests/wp/run.sh` (docker) and `tests/identity/run.sh` (docker). |

---

## 2. Plugin and output architecture

### 2.1 The `wp-content/` artifact

`zero build --target wp [--out <dir>]` (default `<project>/.zero/wp-content`) writes:

```
.zero/wp-content/
  zero-manifest.json                      {"zero":"0.2.0","app":"blog","plugins":{"zero-runtime":"0.2.0","zero-identity":"0.2.0","zero-app-blog":"0.2.0+<schemaHash>"},"requires":{"secure-custom-fields":">=6.9.7","action-scheduler":">=3.9"}}
  plugins/
    zero-runtime/
      zero-runtime.php                    header below; `require zero/bootstrap.php`; `Zero\Wp\Runtime::boot(__FILE__)`
      zero/*.php  zero/Wp/*.php  zero/Sync/*.php  zero/Jobs/*.php  zero/Media/*.php  zero/Auth/*.php   (runtime/Zero/**, verbatim)
      zero/vendor-prefixed/**             Strauss-prefixed libraries (`Zero\Vendor\…`), §3.3: php-toolkit markdown
      zero/bin/zero.php                   (WP-CLI uses `wp zero`; the file is here for parity/tests)
      readme.txt
    zero-identity/
      zero-identity.php  src/**  vendor-prefixed/**  build/{hosted,admin}.{js,css}  uninstall.php  readme.txt   (runtime/identity/**, verbatim)
    zero-app-blog/
      zero-app-blog.php                   generated main file (header below)
      zero/app/schema.php                 version 3, target 'wp'
      zero/app/functions.php
      zero/app/migrations/NNNN_*.sql      MySQL dialect
      wpml-config.xml                     generated when `locales` is set (§7.3): translatable CPTs + per-meta copy/translate policy
      public/                             copied from <project>/public if present
    zero-runtime.zip  zero-identity.zip  zero-app-blog.zip
```

Not written: `mu-plugins/` (nothing needs forced load order; `Requires Plugins`
handles activation order), `uploads/` seeds (content arrives through sync, §5;
`zero seed` is deferred, §10). `zero build` deletes and rewrites only
`plugins/zero-*` directories and the zips; anything else under `plugins/`
(SCF, Action Scheduler, the MCP adapter installed by the harness) is kept.

Plugin headers:

```
Plugin Name:       Zero Runtime
Version:           {{zeroVersion}}
Requires at least: 7.1
Requires PHP:      8.2
Requires Plugins:  secure-custom-fields, action-scheduler, mcp-adapter
License:           GPL-2.0-or-later
```
```
Plugin Name:       Zero Identity
Version:           {{zeroVersion}}
Requires at least: 7.1
Requires PHP:      8.2
License:           GPL-2.0-or-later
```
```
Plugin Name:       {{label}} (Zero app)
Version:           {{zeroVersion}}+{{schemaHash}}
Requires at least: 7.1
Requires PHP:      8.2
Requires Plugins:  secure-custom-fields, action-scheduler, mcp-adapter, zero-runtime{{, polylang}}
License:           GPL-2.0-or-later
```

`{{, polylang}}` is emitted only when the config sets `locales` (§7.3).
`zero-identity` is **not** in any `Requires Plugins`: it is optional. The
runtime detects it (`class_exists(\Zero\Identity\Plugin::class)`) and enables
the WP half of feature 4 when present. **CHANGES §4.9**: `Requires at least`
moves 6.7 → 7.1 (Abilities API shipped in 6.9; the `meta.public` exposure flag
Zero's `agents` maps onto is 7.1), `Plugin::MIN_WP = '7.1'`. Minimum plugin
versions are enforced by §2.7, not by headers (headers can't carry versions).

### 2.2 Who boots what

`runtime/wp-plugin/` becomes two templates: `zero-runtime.php` and
`zero-app.php`. The app main file is:

```php
<?php
/** (header above) */
declare(strict_types=1);
defined('ABSPATH') || exit;
const ZERO_APP_FILE = __FILE__;
const ZERO_APP_NAME = '{{name}}';
const ZERO_SCHEMA_HASH = '{{schemaHash}}';
const ZERO_APP_RUNTIME = '{{runtimeSeries}}';      // "0.2": the runtime major.minor this app was built for
add_action('plugins_loaded', static function (): void {
    if (!class_exists(\Zero\Wp\Runtime::class)) {
        add_action('admin_notices', static fn () => printf('<div class="notice notice-error"><p>%s</p></div>', esc_html('Zero: the zero-runtime plugin is not active; ' . ZERO_APP_NAME . ' is not running.')));
        return;
    }
    \Zero\Wp\Runtime::app(__DIR__, __FILE__);
}, 1);
```

`Zero\Wp\Runtime` (new, in `runtime/Zero/Wp/Runtime.php`) is the registry:

```php
final class Runtime {
    public const SERIES = '0.2';                       // bumped with every incompatible schema.php/runtime change
    public static function boot(string $runtimeFile): void;   // registers activation hook (system tables), WP-CLI `wp zero`, `zero_runtime_loaded` action
    /** Called by an app plugin on plugins_loaded(1). Refuses (admin notice, no boot) when the series differs or an app is already registered. */
    public static function app(string $dir, string $mainFile): ?Plugin;
    public static function plugin(): ?Plugin;         // the one registered app
    public static function identity(): bool;          // zero-identity present and >= SERIES
}
```

`Zero\Wp\Plugin` keeps its phase-1 responsibilities (post types, SCF, REST,
editor hooks) and is constructed only by `Runtime::app`. Compatibility rule:
an app plugin runs only when `ZERO_APP_RUNTIME === Runtime::SERIES`; otherwise
an admin notice says "rebuild with zero 0.2.x". `zero doctor` (§2.5) reports
the same. The runtime plugin and the identity plugin are always written
together by the same `zero` binary, so their versions are identical.

System tables shared by every app (`zero__jobs`, `zero__outbox`,
`zero__receipts`, `zero__files`, `zero__sessions` on WP) are created by the
**runtime** plugin's activation hook and on `admin_init` when
`get_option('zero_runtime_tables') !== Runtime::SERIES`; app-specific tables
(`editor: false` collections, `zero__revisions`) stay with the app plugin's
migrator as in phase 1.

### 2.3 Standalone output

Unchanged layout (`runtime-contract.md`), plus `private/` (feature 6),
`data/secret` (a 32-byte random hex written on first boot, used for signing
when `ZERO_SECRET` is unset), and `zero/runtime/vendor-prefixed/` (the same
prefixed library tree the runtime plugin ships, §3.3; `bootstrap.php` requires
its `autoload.php`). `zero/bin/zero.php` gains `jobs`, `sync`-side helpers,
`users suspend|reactivate`, `files` (per feature sections). The standalone
target never sees the plugin split; "zero-runtime" is just the `zero/runtime/`
directory as today. **CHANGES runtime-contract.md** "No Composer, no
third-party packages": third-party PHP now ships prefixed under
`vendor-prefixed/`; Composer is still never run on the user's machine.

### 2.4 Harness and `zero dev --wp`

`tests/wp/compose.yml` mounts one directory instead of one plugin:

```yaml
- ${ZERO_WP_CONTENT:-./empty-wp-content}/plugins:/var/www/html/wp-content/plugins
```

`harness.sh up --wp-content <dir>` (replaces `--plugin`): installs the
required plugins (§2.7; pinned zips + sha256 in `cache/`, downloaded once)
into that mounted `plugins/` via WP-CLI, then activates in order
`secure-custom-fields action-scheduler mcp-adapter polylang zero-runtime
zero-identity zero-app-<name>` (polylang only when `zero-manifest.json`
requires it, identity only if the dir has it), then creates the four users
with application passwords as today. `up` also registers a dev OIDC
application (§3.4) and prints its `clientId` in the JSON line
(`"identity":{"clientId":"app_…"}`). `zero dev --wp` passes `--wp-content
.zero/wp-content`. `ZERO_WP_PLUGIN` / `--plugin` are removed (**CHANGES §8, §9.2**).

### 2.5 `zero doctor`

`zero doctor [dir] [--site URL --token T]` prints one line per check and exits
1 on any ✗: binary/runtime series, built output series vs binary, every
§2.7 platform row (WP, PHP, DB, SCF/AS/MCP-adapter/Polylang versions, from
`GET /_schema`'s new `runtime` block, §3.1), identity presence, private-files
probe result (§7.2), Polylang languages vs `locales.all`, and pending
migrations. Standalone: PHP version, extensions (`pdo_sqlite`,
`gd`, `sodium` when identity features are used), writable `data/` and
`private/`.

### 2.6 Migration from the single-plugin output

`.zero/wp/` is deleted by the next `zero build`; `tests/wp/run.sh` stages
`.zero/wp-content` instead of `tests/wp/.plugin`. The phase-1 plugin's options
(`zero_<app>_schema`) keep their names; existing post types, meta keys, SCF keys
and `editor: false` tables are untouched, so activating `zero-runtime` +
`zero-app-<name>` over a site that ran the phase-1 `zero-<name>` plugin
(deactivated first) keeps all data. There is no in-place upgrade from the
phase-1 plugin slug: deactivate it, activate the three, done.

### 2.7 Required platform

One table, owned by `runtime/Zero/Wp/Platform.php` (PHP constants) and
`src/platform.rs` (the same values, drift-guarded by a golden JSON
`tests/fixtures/platform.json` both sides read):

| Requirement | Minimum | Why | Checked where |
|---|---|---|---|
| WordPress | 7.1 | Abilities API `meta.public`; `wp_register_ability` (6.9) | header, `Runtime::boot` (admin notice + no boot), `zero doctor` |
| PHP | 8.2 | runtime syntax; webauthn-lib 5 | header, `Runtime::boot`, `zero doctor` |
| MySQL / MariaDB | 8.0 / 10.11, InnoDB, `utf8mb4` | transactions (phase 1), window functions, `JSON_*` | activation (phase 1 InnoDB check extended with version), `zero doctor` |
| `secure-custom-fields` | 6.9.7 | SCF field groups, options pages (phase 1) | `Requires Plugins`; `Plugin::checkRequirements` |
| `action-scheduler` | 4.2 | jobs (§6.1); 4.0+ atomic `unique_key` | `Requires Plugins`; `checkRequirements` (`ActionScheduler_Versions::instance()->latest_version()`) |
| `mcp-adapter` | 0.7.1 | abilities exposure via `meta.mcp`, named servers (§7.1); first wordpress.org release | `Requires Plugins`; `checkRequirements` (`defined('MCP_ADAPTER_VERSION')`, else the plugin header via `get_plugin_data`) |
| `polylang` | 3.9 | `pll_insert_post` + `translations` (3.7), `wpml-config.xml` `encoding` (3.8), only when `locales` set (§7.3) | conditional `Requires Plugins`; `checkRequirements` (`POLYLANG_VERSION`) |
| `zero-identity` | = runtime version | optional, feature 4 on WP | `Runtime::identity()` |
| `jetpack` or `jetpack-boost` with Image CDN | any | optional, §7.2 adapter | runtime detection |

`checkRequirements` (phase 1 §4.9, extended) refuses to boot the app and
shows one admin notice naming every unmet row. `zero doctor --site` prints
the same table with ✓/✗ from `GET /_schema`'s `runtime.wp` block (which gains
`actionScheduler`, `mcpAdapter`, `polylang` versions). The harness pins
exactly these minimums in `tests/wp/cache/` (zip + sha256 per plugin,
`harness.sh` refuses to run with a mismatched hash) so CI proves the floor,
not whatever is newest. Raising a minimum is a one-line change in both
`Platform.php`/`platform.rs` plus a new pinned zip.

---

## 3. Identity integration (spacefast-identity → `zero-identity`)

### 3.1 What moves, what is renamed

`spacefast/spacefast-identity` HEAD `fd2ab0a` is copied into this repo at
`runtime/identity/` (plugin tree only: `plugin/spacefast-identity/{src,
composer.json, composer.lock, uninstall.php}`, the two SPA bundles' sources
under `runtime/identity/apps/`, `docs/{api,security}.md` as
`docs/identity-{api,security}.md`). The SDK packages (`@spacefast/identity-core/
react/next`) are **not** moved: the Zero typed client absorbs what a frontend
needs (§6.5); the React profile UI is replaced by the hosted `/identity/account`
screen. Everything else in that repo (Playwright, Next example, Better Auth
fixture) is dropped.

Renames (mechanical, one commit, verified by the identity suite running green
afterwards):

| From | To |
|---|---|
| namespace `Spacefast\Identity` | `Zero\Identity` |
| plugin slug/text domain `spacefast-identity` | `zero-identity` |
| REST namespace `spacefast-identity/v1` | `zero-identity/v1` |
| tables `{prefix}sfi_*` | `{prefix}zero_identity_*` (17 tables, same columns) |
| options `sfi_*` | `zero_identity_*` |
| cookies `sfi_session`, `sfi_factor`, `sfi_passkey`, `sfi_oidc`, `sfi_reauth` | `zi_session`, `zi_factor`, `zi_passkey`, `zi_oidc`, `zi_reauth` |
| constants `SPACEFAST_IDENTITY_*` | `ZERO_IDENTITY_*` (`ZERO_IDENTITY_DEV_HTTP`, `ZERO_IDENTITY_GOOGLE_CLIENT_ID/SECRET`) |
| hooks `spacefast_identity_*` | `zero_identity_*` |
| webhook headers `Spacefast-Signature`/`Spacefast-Event-Id` | `Zero-Signature`/`Zero-Event-Id` (same `t=…,v1=…` format as §6.4 outbound webhooks) |
| CLI `wp identity …` | `wp zero-identity …` |
| branding strings "Spacefast", "◈ Spacefast", "Spacefast Identity" | the WP site title (`get_bloginfo('name')`) |
| hosted screens path `/identity` | unchanged |

### 3.2 Scope cut

| Keep | Cut |
|---|---|
| OIDC issuer (discovery, authorize, token, userinfo, jwks), PKCE S256, consent page, hosted sign-in/account SPA | `HostAdapter.php` (Spacefast runtime bridge) and the `spacefast_content_principal_*` calls in `Accounts::provider()` |
| Accounts, emails, email codes, password sign-in, sessions, reverify window, rate limits, challenges | The `spacefast` provider branch in `Providers.php` (EdDSA pin, root discovery); `docs/providers.md` Spacefast contract |
| Passkeys (webauthn-lib), MFA (otphp TOTP + recovery codes) | `jumbojett/openid-connect-php`, `league/oauth2-server`, `nyholm/psr7`, `defuse/php-encryption`, `lcobucci/jwt` (replaced, §3.3) |
| Providers framework with **Google** as the one built-in adapter + `zero_identity_providers` filter | `woo-v2.ts`, `gravatar` label, `/__zero/auth/complete` allowlist |
| Organizations, invitations, roles | nothing cut, but no Zero feature uses them in phase 2 |
| Admin screen (DataViews), privacy export/erase, webhooks + delivery cron, maintenance cron, CLI | `spacefast-discovery.php`, `runtime-hook.php`, `host-lock-fixture.php` tests |
| Schema v2 → renamed tables, `VERSION = 3` (adds refresh-token columns, §3.5) | |

Known defects fixed while moving (each with a test in `tests/identity/`): the
duplicate `passkeys/register` branch (`Api.php:389-400`, dead code);
`sfi_factor` cookie set inside a DB transaction; `applications.origins` never
read (it becomes the CORS allow-list for `/identity/token` and
`/zero-identity/v1/*`, needed by cross-origin frontends in §6.5).

### 3.3 Composer: how third-party PHP is bundled (all plugins)

Ruling: Composer is allowed; dependencies are bundled properly into the built
plugins. The mechanism is the same for every plugin that needs a library:

1. **Maintainer time, not user time.** Each bundling root has a
   `composer.json` (`runtime/Zero/composer.json` for the runtime,
   `runtime/identity/composer.json` for identity). `scripts/vendor.sh [runtime|identity|all]`
   runs `composer install --no-dev --classmap-authoritative --prefer-dist`,
   then **Strauss** (`brianhenryie/strauss` 0.31+, run as a PHAR pinned by
   sha256 in `scripts/`) with `extra.strauss`:
   `namespace_prefix: "Zero\\Vendor\\"` (identity: `"Zero\\Identity\\Vendor\\"`),
   `classmap_prefix: "Zero_Vendor_"`, `constant_prefix: "ZERO_VENDOR_"`,
   `target_directory: "vendor-prefixed"`, `delete_vendor_packages: true`,
   `exclude_from_prefix.namespaces: ["Zero\\"]`,
   `exclude_constants.constants: ["ABSPATH","WP_CONTENT_DIR","WP_PLUGIN_DIR","WP_CLI","WP_UNINSTALL_PLUGIN","ARRAY_A"]`.
   Strauss is chosen over php-scoper because it only renames symbols *defined
   by the copied packages* — WordPress functions never appear in the vendor
   tree, so there is no hand-maintained WP exclusion list to drift (the exact
   failure spacefast-identity hit in `d0c9e34`). Output: `vendor-prefixed/`
   with Strauss's own `autoload.php`, plus `vendor-prefixed/.manifest.json`
   `{ "lock": "<sha256 of composer.lock>", "strauss": "0.31.1", "php": "8.2" }`
   and `vendor-prefixed/THIRD-PARTY-LICENSES.txt`.
2. **Committed.** `vendor-prefixed/` trees are committed (they are build
   artifacts of the repo, like `zero/client/`). Drift guard
   `tests/php/vendor_drift.php`: fails when `.manifest.json.lock` ≠
   sha256 of the current `composer.lock` for any root, or when a
   `composer.json` has no `vendor-prefixed/`. CI runs `scripts/vendor.sh all`
   on a PHP 8.2 image and fails on a dirty tree (§9.5), so a lock bump without
   a regenerated tree can't merge. Composer's own `vendor/` is gitignored.
3. **Embedded and emitted.** `build.rs` embeds `vendor-prefixed/**` like any
   runtime file; `zero build` emits it into `plugins/zero-runtime/zero/
   vendor-prefixed/`, `plugins/zero-identity/vendor-prefixed/` and the
   standalone `zero/runtime/vendor-prefixed/`. `bootstrap.php` and
   `zero-identity.php` `require_once` the respective `autoload.php`. A fresh
   clone with Rust alone builds and ships everything; PHP + Composer + the
   Strauss PHAR are needed only to *change* a dependency.
4. **Every dependency is justified in `docs/dependencies.md`** (one line:
   package, version, why not hand-rolled, transitive count). Phase 2's list:

| Root | Package | Why |
|---|---|---|
| runtime | `wp-php-toolkit/markdown` ^0.10 (vendors commonmark 2.6, symfony/yaml 7.2, webuni/front-matter under their original namespaces → Strauss prefixes them too; 7 transitive) | Markdown ⇄ Gutenberg blocks with the WordPress-maintained mapping (§5.2); the round-trip representability gate is exactly what the monorepo proved on it. Replaces the Rust-side pulldown-cmark design. |
| runtime | `wp-php-toolkit/merge` ^0.10 | `LineDiffer`/`LineMerger`/`MergeStrategy` three-way body merge on the server side of sync (§5.3 `/sync/{c}/merge`), so Rust and PHP never need two merge implementations. |
| identity | `web-auth/webauthn-lib` ^5.3 (29 transitive, symfony serializer et al.) | Passkeys: CBOR/COSE/attestation parsing is not hand-rollable. The one heavy dep; kept by ruling. |
| identity | `firebase/php-jwt` ^7.2 (0 transitive) | RS256 signing for the issuer and inbound ID-token verification incl. EdDSA; one JWT library instead of two. |
| identity | `spomky-labs/otphp` ^11.5 (3 transitive) | TOTP; small, maintained, already proven in the plugin's tests; not worth re-implementing. |

Not bundled, with reasons: `league/oauth2-server` + `nyholm/psr7` +
`defuse/php-encryption` + `lcobucci/jwt` (12 packages for an authorization-
code grant the plugin already wraps with its own consent/nonce/sid/userinfo/
revocation logic — replaced by `Zero\Identity\Protocol\AuthCode`, ~150 lines,
PKCE via `hash_equals(base64url(sha256(verifier)), challenge)`, code = 32
random bytes stored hashed with `code_challenge/redirect_uri/client_id/nonce/
session_id`, 60 s TTL, single use); `jumbojett/openid-connect-php` (its
signature/claims paths were already overridden; the remaining transport is
~120 lines over `wp_remote_*` in `Providers\OidcClient`); any RFC 9421 HTTP
signature library (none is mature; Stripe-style `t=…,v1=hmac_sha256` is 15
lines of `hash_hmac`/`hash_equals`, §6.1); `symfony/yaml` directly (the
toolkit vendors it; front matter parsing on the PHP side goes through
`webuni/front-matter` inside the toolkit, and the Rust CLI keeps its own
strict YAML subset for file I/O). Zero's standalone target carries the same
`vendor-prefixed/` tree (≈ 2 MB for the runtime root) so sync behaves the
same on both targets.

5. **Size.** Runtime root ≈ 2 MB, identity root ≈ 4 MB of PHP embedded in the
   binary. Accepted (§10). `build.rs` skips `tests/`, `docs/`, `*.md` inside
   `vendor-prefixed/` to keep it lean.

Lane ownership: `scripts/vendor.sh`, `tests/php/vendor_drift.php`,
`runtime/Zero/composer.json` + its `vendor-prefixed/` are created by seams
**A3** (with the two toolkit packages, so lane C1 finds them in place);
`runtime/identity/composer.json` + tree by lane **E1**.

### 3.4 Applications, dev registration

OIDC clients stay admin-registered (public clients only, PKCE required,
`token_endpoint_auth_methods_supported: ["none"]`). New CLI:
`wp zero-identity app add --name=<n> --redirect=<uri> --origin=<origin>
[--id=<app_id>]` (deterministic id when `--id` given, so the harness and `zero
dev --wp` can pre-register `app_zero_dev` with redirect
`http://127.0.0.1:<port>/auth/callback` and origin `http://127.0.0.1:<port>`;
localhost http only under `ZERO_IDENTITY_DEV_HTTP`).

### 3.5 Additions the identity plugin needs for feature 4

Schema `VERSION = 3`:

- `tokens` gains `kind ENUM('access','refresh')`, `family CHAR(32)`,
  `replaced_by VARCHAR(100) NULL`, `used_at DATETIME NULL`.
- Token endpoint accepts `grant_type=refresh_token`. Refresh token = opaque
  `zr_` + 43 base64url chars, stored as sha256 hash, TTL 30 days, **rotated on
  every use**: the old row gets `replaced_by`/`used_at`; presenting an
  already-used refresh token revokes the whole `family` and returns 400
  `invalid_grant`. Response: `{ access_token (JWT, 300 s), token_type: "Bearer",
  expires_in: 300, refresh_token, id_token? }`. Discovery advertises
  `grant_types_supported: ["authorization_code","refresh_token"]`.
- `POST /identity/revoke` (RFC 7009 shape: `token`, `token_type_hint`) revokes
  a refresh family or an access jti; `POST /identity/logout` (RP-initiated:
  `id_token_hint`, `post_logout_redirect_uri` must match a registered
  redirect's origin) revokes the identity session and redirects.
- `Zero\Identity\Bearer` — `determine_current_user` filter (priority 20) that
  resolves `Authorization: Bearer <JWT>` (RS256 against local keys, `iss`,
  `exp`, `jti` not revoked, session not revoked, account `active`,
  application enabled — the same checks as `userinfo`) to the WP user id.
  Application passwords keep working (core's filter runs first).
- `Zero\Identity\Accounts::issueForUser(int $wpUserId, string $clientId): array`
  — mints a session + token pair without a browser flow. Used by the runtime
  for guests (§6.3). Guarded: only callable when `did_action('zero_runtime_loaded')`.
- `Zero\Identity\Accounts::status(int $wpUserId): 'active'|'suspended'|'deletion_requested'|'deleted'|'none'`
  for the runtime's suspension check.
- Hosted sign-in SPA: when the signed-in user has role `zero_guest` and verifies
  a new email, `Accounts::verify` attaches the email to **that** user and sets
  the role to `subscriber` (in-place upgrade, same id, `do_action('zero_identity_guest_upgraded', $id)`).
  If the email already belongs to another account, the user is signed into
  that account and the guest stays as is (no merge in phase 2).

### 3.6 Licensing

GPL-2.0-or-later on every plugin (headers above). `runtime/identity/LICENSE`
and `NOTICE` come along; each `vendor-prefixed/THIRD-PARTY-LICENSES.txt`
is generated by `scripts/vendor.sh` (all bundled packages are MIT/BSD/GPL-2+,
compatible with GPL-2.0-or-later). The Rust binary and the rest of
the repo keep the repo's existing licence; the embedded PHP is GPL and is
emitted, not linked.

### 3.7 What standalone gets

No OIDC, passkeys, MFA, organizations or hosted screens. Standalone implements
the same **Zero** auth routes (§6.2) with a password issuer: `/auth/token`
(password and refresh grants, rotation), `/auth/guest`, `/auth/session`,
suspension. The typed client's `auth` module has the same method names on both
targets; `signIn()` on standalone throws `ZeroError{code:"not_supported"}` and
`login(name, password)` on WP throws the same (the WP flow goes through the
issuer).

---

## 3.1 schema.php v3 (one place for every new key)

```php
return [
  'version' => 3,
  'runtime' => '0.2',                          // Runtime::SERIES this file was built for
  'name' => 'blog', 'target' => 'wp',
  'site' => ['uidPrefix' => 'zr_'],
  'locales' => ['default' => 'en', 'all' => ['en', 'de'], 'fallback' => true],   // or null
  'media' => ['sizes' => ['thumb' => ['width' => 300, 'height' => 300, 'fit' => 'cover'], 'wide' => ['width' => 1600, 'height' => null, 'fit' => 'inside']]],
  'files' => ['decks' => ['accept' => ['application/pdf'], 'maxBytes' => 20000000,
              'access' => ['read' => ['owner' => true], 'create' => ['role' => 'authenticated'], 'delete' => ['owner' => true]]]],
  'auth' => ['collection' => 'members', 'guests' => true, 'accessTtl' => 300, 'refreshTtl' => 2592000],   // collection null when none
  'jobs' => ['sendWelcome' => ['input' => [...columns...], 'handler' => 'job__sendWelcome', 'retries' => 5, 'agents' => false]],
  'webhooks' => [['url' => ['env' => 'HOOK_URL'], 'secret' => ['env' => 'HOOK_SECRET'], 'events' => ['posts.created', 'posts.updated', 'posts.deleted']]],
  'collections' => ['posts' => [
      // phase-1 keys unchanged, plus:
      'uid' => true,                           // system column `uid` present (always true when sync != null; configurable otherwise)
      'sync' => ['dir' => 'content/posts', 'format' => 'md'],   // or null
      'auth' => false,
      'agents' => true,
      'localized' => true,                     // at least one localized column (§7.3); false otherwise
      'columns' => ['title' => [
          'type' => 'text', ...,
          'localized' => true,                 // translated per locale; absent = synced across the group
          'access' => ['read' => ['role' => 'anyone'], 'update' => ['fn' => 'posts__field__title__update']],   // absent = inherit
          'showIf' => ['kind' => ['in' => ['a', 'b']]],   // absent = always
      ],
      'deck' => ['type' => 'file', 'bucket' => 'decks'],
      'uid' => ['type' => 'text', 'unique' => true, 'system' => true, 'rules' => ['pattern' => ['source' => '^zr_[0-9a-f]{20}$', 'flags' => '']]],
      // localized collections only, after status/publishedAt:
      'locale' => ['type' => 'text', 'enum' => ['en', 'de'], 'notNull' => true, 'default' => ['value' => 'en'], 'system' => true],
      'translations' => ['type' => 'json', 'system' => true, 'derived' => true],
      'translationGroup' => ['type' => 'text', 'system' => true, 'hidden' => true],   // tables/standalone only; Polylang owns the group on post-backed
  ]]],
  'globals' => ['settings' => [ ..., 'agents' => true ]],
  'actions' => ['approveComment' => [ ..., 'agents' => true, 'idempotent' => true,
                 'signature' => ['secret' => ['env' => 'STRIPE_WEBHOOK_SECRET'], 'header' => 'stripe-signature', 'scheme' => 'hmac-sha256']]],
];
```

Rules: `runtime` is checked by `Schema::load` (`RuntimeException("schema.php
built for runtime 0.1; this runtime is 0.2")`). Every key above is always
present (null/false/[] when unused). `GET /_schema` exposes `locales`,
`media.sizes`, `files` (names + accept + maxBytes), `auth.collection`,
`auth.guests`, per-column `localized`/`showIf`/`access` (summarised like
phase 1: shorthand or `"rule"`), `sync` (dir+format), `agents`, the
collection's `localized` flag, and a new
`runtime: { series, target, wp?: { version, scf, actionScheduler, mcpAdapter, polylang: string|null, identity: bool, imageCdn: bool } }`
block, plus `site: { id }` (§5.3). Column type list gains `file`; column keys
gain `localized`, `access`, `showIf`, `bucket`, `derived`, `hidden`. Access
rule shapes gain `['self' => true]` (§6.2) and `['owner' => true]` (§7.2).

---

## 4. Feature 1 — field-level access + conditional fields

Targets: both. Lane **B** (§9).

### 4.1 Config API

```ts
// index.d.ts — ColumnBuilder gains:
/** Per-column rules. Omitted = inherit the collection's rule for that op. `read: false` hides the column from that viewer. */
access(rules: { read?: FieldRule; create?: FieldRule; update?: FieldRule }): this-shaped builder;
/** Editor UI: show this field only when the sibling filter holds. Static; checked at build time. */
showIf(condition: SiblingFilter): this-shaped builder;

export type FieldRule = AccessShorthand | ((ctx: FieldAccessCtx) => boolean);
export interface FieldAccessCtx { user: User | null; target: Target; op: "read" | "create" | "update"; /** read: the row; create/update: the incoming data */ data: Record<string, unknown>; }
/** `{ col: value }` or `{ col: { eq | ne | in | isNull | isNotNull } }` over sibling columns of the same level; several keys are ANDed; `OR: [...]` at the top. */
export type SiblingFilter = Record<string, unknown>;
```

`.access` is allowed on top-level columns and sub-fields (sub-field `data` is
the enclosing row). `.showIf` is allowed on top-level columns and on sub-fields
of group/repeater/blocks (siblings = same level). Neither on `id()`, system
columns, or the title designation (title is always readable). A function rule
may not call `db` (same rule as access functions) and must return a boolean.

### 4.2 schema.php

Per column: `'access' => ['read' => rule, 'create' => rule, 'update' => rule]`
with rule = `['allow'|'role'|'fn']` as phase 1 (field fns are named
`<table>__field__<col>__<op>`, nested `<table>__field__<col>__<sub>__<op>`);
`'showIf' => <filter array>`. Both absent when unset.

### 4.3 Runtime

`runtime/Zero/FieldAccess.php` registers on the pipeline extension points
(§9.1): 

- **read** (`Extensions::onRead`, after decode, before `with`): for each column with a
  read rule, evaluate once per request for shorthand rules, once per row for
  fn rules (`ctx.data` = the full decoded row). Hidden columns are **removed**
  from the row (not nulled; the typed client types them as optional
  `col?: T`). Applies to nested `with` rows and media populate. A `where`,
  `orderBy` or `columns` that names a hidden column → 403 `forbidden`, pointer
  `/where/<col>` (checked in `Db::fetch` before `Sql::select`; the viewer can't
  learn values through filters). Trusted reads (hooks, CLI) see everything.
- **create/update** (`Extensions::onWrite`, before `beforeCreate`/`beforeUpdate`, after
  defaults): a key present in `data`/`patch` whose rule is false → 403
  `forbidden`, pointer `/<col>`, detail "you can't set <col>". Defaults and
  hook-written values are not checked (hooks are trusted).
- Revisions: `GET …/revisions/{rid}` goes through the same read strip.
- wp-admin / core `/wp/v2`: untouched (phase 1 §1.6: WP caps govern). `Scf`
  gets the `showIf` → `conditional_logic` mapping through the `Scf::fieldFilter`
  seam: `[[['field' => '<sibling key>', 'operator' => '==' | '!=' | '==empty' | '!=empty', 'value' => …]]]`;
  `in: [a,b]` becomes an OR group of `==`; booleans map to `'1'`/`'0'`.
- `/_schema` reports `access.fields.<col>.<op>` summaries and `showIf`
  verbatim; the typed client's `schema.ts` carries `showIf` so a frontend
  form can mirror the editor.

Leans on: SCF's native `conditional_logic` for the editor; nothing else. No
plugin provides per-viewer field visibility over a custom REST API, and the
pipeline is the only place that knows the viewer.

### 4.4 Rejected at build time

`.access`/`.showIf` on `id()`, system columns, the title column
(`"title is always readable"`); a `showIf` naming a non-sibling or using an
operator outside `eq/ne/in/isNull/isNotNull`; a `showIf` referencing a
group/repeater/blocks/json column ("compare a scalar sibling"); a field read
rule that is a function returning a filter; `create: "self"`.

### 4.5 Owner files

Rust: none beyond seams (A2 parses both modifiers; compiles field fns through
the existing access-fn path, `Slot::FieldAccess`). PHP: new
`runtime/Zero/FieldAccess.php`; `runtime/Zero/Wp/Scf/ConditionalLogic.php`
(registered via the seam). Types: `types/zero/tests/field-access.ts`. Client:
`src/client.rs` emits `col?: T` for columns with a read rule that isn't
`"anyone"` (one `if` in `col_ts`, owned by lane B — the only `client.rs` edit
outside the seams).

### 4.6 Tests

| Behaviour | Level | File |
|---|---|---|
| rejections (§4.4), one fixture per class | compiler | `tests/fixtures/reject-field-access`, `reject-showif`; `tests/compiler.rs::rejects_field_rules` |
| field fn compiles like access fn | differential | `tests/differential/cases.ts` + one `FIELD_CTXS` case |
| strip on read (shorthand + per-row fn), hidden column in `where` → 403, write → 403 with pointer, nested `with` strip, revisions strip, trusted read sees all | PHP in-process | `tests/php/db_test.php` (section "field access"), fixture schema extended |
| `conditional_logic` lands in the registered SCF group; core `/wp/v2` save ignores field access | WP e2e | `tests/wp/editor.test.ts` (extend) |
| `/zero/v1` strips for `subscriber`, not for `editor` | WP e2e | `tests/wp/rest.test.ts` via the shared scenario (one assertion added to `blog-scenario.ts`) |
| client types: hidden columns optional | tsc | `examples/blog/client-tests/negative.ts` |

### 4.7 Acceptance

Blog example: `authors.email` gets `.access({ read: "editor" })`; anonymous
`GET /authors` rows lack `email`, editor rows have it; `posts.seo` gets
`.showIf({ status: "published" })` and the wp-admin field group carries the
logic. All suites green.

---

## 5. Feature 2 — content sync (files ⇄ records)

Targets: both (REST + system column on both; abilities on WP via feature 5).
Lanes **C1** (runtime) and **C2** (Rust CLI) — two agents, disjoint files,
C2 stacks on C1.

### 5.1 Config API

```ts
export interface CollectionOptions<T> {
  /** Sync this collection with files. Directory relative to the project; format from the extension. Default: none. */
  sync?: `${string}/*.md` | `${string}/*.json`;
  /** Give rows a stable `uid` (zr_ + 20 hex). Implied by `sync`. Default false. */
  uid?: boolean;
}
```

`sync: "content/posts/*.md"` → dir `content/posts`, format `md`. `md` requires
a `content` designation (the body); `json` is allowed with or without one (the
content column is then an ordinary key named `body`). Rejected:
`sync` on `auth: true` collections, on `media`, two collections syncing into the
same directory, a dir outside the project, `.md` without a content column.

### 5.2 File format

`content/posts/<slug-or-uid>.md`:

```
---
uid: zr_9f2c41d07ab35e8c1d44
title: Typed blocks
slug: typed-blocks
status: published
publishedAt: 2026-11-12T18:30:00.000Z
excerpt: null
cover: 12
tags: [news, guide]
authorId: zr_6720f1c0a4be93d1e275
seo:
  metaTitle: Typed blocks
  metaDescription: null
  noindex: false
gallery:
  - image: 7
    caption: Hero
---
Body in Markdown (the `content` column).
```

Rules: every column except `id` and the content column is a front-matter key,
in schema order, `null` written explicitly (absence and null are different
changes). `references()` columns whose target has `uid: true` hold the target's
uid; other references and `media`/`file` columns hold numeric ids (media bytes
don't sync in phase 2, §10). Values: timestamps as ISO UTC, dates `YYYY-MM-DD`,
json/group/repeater/blocks as YAML maps/lists. The YAML dialect is a strict
subset: block maps/lists, flow lists `[a, b]`, plain/quoted scalars, `|`
block scalars for multi-line strings, no anchors/tags/merge keys/duplicate keys
(refused with file:line). `.json` files are the same record as one object with
`body` as a key when a content column exists. File name = `<slug>.md` when the
collection has a slug column, else `<uid>.md`; renaming a slug moves the file.

Body ⇄ richText: conversion runs **in the PHP runtime** on the WordPress
php-toolkit (`Zero\Vendor\WordPress\Markdown\MarkdownConsumer` / `MarkdownProducer`,
bundled per §3.3), on both targets, so the mapping is the WordPress-maintained
one and the CLI never parses Markdown. Push: Markdown → block markup
(`consume()->get_block_markup()`), stored in the content column (on WP that is
real Gutenberg blocks; standalone stores the same markup verbatim). Pull:
block markup → Markdown via `produce()`, **lossless-or-refused**: the runtime
round-trips the produced Markdown back to blocks and compares the editor-
equivalence key (the monorepo's `spacefast_content_markdown_document_key`
normalisation, ported as `Zero\Sync\Markdown::key()`: whitespace between
delimiters, attribute order, `<b>`→strong, `<i>`→em, derived heading ids); a
mismatch refuses that record by name (`refused: not_representable`, "post 42:
core/table can't be written as Markdown; use *.html") and the file is left
alone. `*.html` files skip Markdown: push stores HTML as-is (one Classic/HTML
block), pull returns the stored markup with block delimiters stripped
(`Zero\Sync\Html::strip()`, the monorepo's `content-html.php` inner-content
walk) when every block is static and delimiter-only; otherwise refused. The
toolkit's own `MarkdownSourceDocument::patch_markdown()` is **not** used
(bases live in the CLI); its `Merge` component is (§5.3).

### 5.3 Runtime (both targets)

**uid**: system column `uid` (text, unique, `^zr_[0-9a-f]{20}$`, minted as
`'zr_' . substr(sha256(random 16 bytes), 0, 20)` by the pipeline on insert when
absent; writers may supply one; never updatable (422 "uid is immutable")).
Storage: tables/SQLite — a real column (compiler emits it in migrations);
post-backed — meta `_zero_uid` (not an SCF field; `ColumnRef` like other meta,
`checkUnique` applies). wp-admin-created posts get a uid on `wp_after_insert_post`
(runtime fills it, as `fillEditorDefaults` does for defaults). Site identity:
`site.id` (uuid v4) minted on first boot into `__zero_globals('__site')` /
option `zero_runtime_site_id`, exposed in `GET /_schema`.

**REST** (`runtime/Zero/Sync/Routes.php`, registered through the `App::route`
seam, prefix `/sync`):

| Route | Body/params | Returns | Access |
|---|---|---|---|
| `GET /sync/{c}?after=<id>&first=<1..100>` | keyset by primary key, includes **every** status (drafts, scheduled; on WP also trash as `trashed: true`) | `{ data: { records: [{ record, digest, trashed }], next: id\|null } }` | the collection's `update` rule must evaluate to `true` (not a filter) for the viewer, else 403; default `"editor"` |
| `POST /sync/{c}` | `{ record, expect: "absent" \| "sha256:<64hex>" }` | `{ data: { uid, digest, status: "unchanged"\|"applied"\|"normalized", record? } }` | `create` (when absent) / `update` rule, evaluated through the normal pipeline (hooks run, field access applies, validation applies) |
| `POST /sync/{c}/trash` | `{ uid, expect }` | `{ data: { uid, status: "unchanged"\|"applied" } }` | `delete` rule |

Two more routes carry the conversions the CLI delegates to PHP:

| Route | Body | Returns |
|---|---|---|
| `POST /sync/{c}/convert` | `{ direction: "toMarkdown" \| "toBlocks" \| "toHtml" \| "fromHtml", text }` | `{ data: { text } }` or 422 `not_representable` with `detail` naming the block |
| `POST /sync/{c}/merge` | `{ base, ours, theirs }` (Markdown or HTML bodies) | `{ data: { merged, conflicts: [{ ours, theirs, line }] } }` via `Zero\Vendor\WordPress\Merge\MergeStrategy(LineDiffer, LineMerger)` |

Both need the same `update`-rule access as `GET /sync/{c}`; both are pure
(no writes) and are batched by the CLI (`records: [...]` variant of each,
≤ 100 per call). `record` = `{ uid, fields: {<every column except id/content>}, body: string|null }`
where `body` is **Markdown** for `md` collections and HTML for `html` ones
(the runtime converts on the way in and out of `GET`/`POST /sync/{c}`; a
record whose stored blocks aren't representable comes back as
`{ uid, refused: "not_representable", message }` in `GET`, never dropped),
with references already resolved to uids by the runtime (`Sync\Wire::encode/
decode`, which maps uid ↔ id for reference columns; an unknown target uid →
422 `sync_missing_reference`, pointer `/fields/authorId`, detail "sync authors
first"). `digest` = `"sha256:" + sha256(canonical JSON of record)`; canonical =
sorted keys, no whitespace, `JSON_UNESCAPED_SLASHES|UNICODE|PRESERVE_ZERO_FRACTION`,
integral floats without `.0` — implemented by `Zero\Sync\Canon::json()` and
`src/sync/canon.rs`, pinned by a shared golden (`tests/fixtures/canon/*.json`
+ `.sha256`, allowed as a drift guard). `expect` mismatch → 409 `sync_stale`
with `current: { digest, record }`. After applying, the runtime re-reads and
re-digests; a different digest (normalisation: slug derivation, trimming hooks)
returns `normalized` with the stored record. Trash: WP post-backed →
`wp_trash_post`; everything else → pipeline delete (revisions keep the row).
Restore from WP trash is just another `POST /sync/{c}` with `expect: "absent"`.

### 5.4 CLI (`src/sync/`)

```
zero sync [dir] --site <url> (--token <t> | --app-password <user:pass> | --bearer <jwt>) [--only c1,c2] [--check] [--watch] [--no-commit] [--json]
zero sync status [dir]                      pending/conflicted per collection (reads base + files + site, writes nothing)
zero sync resolve <uid> [dir] --site …      apply the edited conflict file to both sides, re-checking both digests
```

Exit codes: 0 ok, 1 failed, 2 (`--check`) changes pending or conflicts,
3 usage, 4 auth. `--site` defaults to `ZERO_SITE`, credentials to
`ZERO_TOKEN`/`ZERO_APP_PASSWORD`.

Algorithm per run (one collection at a time, in config order, targets of
references first — the compiler already knows the reference graph; cycles →
two passes: identity-only then fields):

1. Read `.zero/sync-base.json`:
   `{ "version": 1, "sites": { "<site.id>": { "<collection>": { "<uid>": { "digest": "sha256:…", "record": {...} } } } } }`.
   Unknown site id → first run: no bases, deletions disabled, every record is
   reconciled as "both new".
2. Pull remote records (paged). Parse local files (a parse failure is reported
   and that file is skipped — never read as a deletion). A file without `uid`
   gets one minted locally and written back before anything else.
3. For every uid in files ∪ remote ∪ base, classify with `(local vs base,
   remote vs base)` and merge per field: unchanged on one side → take the
   other; both changed to the same value → that value; both changed
   differently → conflict. Nested maps merge member-wise; lists (repeater,
   blocks, mediaList, select) are atomic values. `body` merges by line through
   `POST /sync/{c}/merge` (php-toolkit `LineMerger`); any reported conflict
   hunk is a conflict for that uid. Deletions: file gone
   and remote == base → trash remote; remote trashed and local == base →
   delete file; otherwise conflict.
4. Apply: remote writes carry `expect` = the remote digest seen in step 2;
   `sync_stale` re-plans that uid once, then reports it. Local writes go
   through a temp file + rename. The base for a uid moves only after **both**
   sides landed.
5. Conflicts → `.zero/conflicts/<uid>.md` in the original design's layout
   (`<<<<<<< files` / `||||||| base` / `=======` / `>>>>>>> wordpress`, a
   `# Fields: /fields/title` header); nothing is written to either side for
   that uid. `resolve <uid>` parses the user's edit (the file must contain no
   markers), checks both current digests equal the ones recorded in the
   conflict header, applies to both, moves the base, deletes the conflict file.
6. Commit: when the project is a git repo and `--no-commit` is absent,
   `git add -- <written paths>` and `git commit -m "zero sync: N applied, M conflicts"`
   (only the paths it wrote; nothing to do → no commit). `.gitignore` gets
   `.zero/*` + `!.zero/sync-base.json` on `zero build` if absent.
7. `--watch`: poll the site every 5 s (`GET /sync/{c}?after=<last id>` is cheap)
   and watch the directory (`notify` crate); a write Zero itself just made
   doesn't retrigger (it records the digests it wrote).

Rust deps added (lane C2 only): `serde_yaml_ng` (parse; emission is our own
deterministic writer `src/sync/yaml_out.rs`, because round-trip stability of
key order and scalar quoting is a contract here); `notify` (watch); `ureq`
(blocking HTTP; also used by `zero doctor --site`). No Markdown or diff crate:
conversion and body merge are server-side (§5.2/§5.3), so the two targets and
the CLI share one implementation.

### 5.5 Rejected at build time

§5.1 list; `uid: false` together with `sync`; a `references()` to a collection
without `uid: true` when the referencing collection has `sync` (hint: "add
`uid: true` to <target> so references sync by uid").

### 5.6 Owner files

C1 (PHP): `runtime/Zero/Sync/{Routes,Wire,Canon,Uid,Markdown,Html,Merge}.php`;
uid minting hooks into `Extensions::onWrite`; `WpPostStore` gets `_zero_uid` in
`buildSource` (the only C1 edit in a shared file; `WpPostStore.php` is
otherwise untouched by C1). The toolkit packages are already in
`runtime/Zero/vendor-prefixed/` (A3). C2 (Rust): `src/sync/{mod,canon,
front_matter,yaml_out,merge,base,plan,apply,conflict,git,client}.rs`
(`merge.rs` is the per-field merge; bodies go to the server),
`src/commands/sync.rs` (dispatcher seam), `Cargo.toml` deps. Both:
`tests/fixtures/canon/`.

### 5.7 Tests

| Behaviour | Level | File |
|---|---|---|
| canonical JSON + digest identical Rust↔PHP | golden (drift guard) | `tests/fixtures/canon/*.json`+`.sha256`; `src/sync/canon.rs` unit test and `tests/php/sync_test.php` both read the fixtures |
| uid minted, immutable, unique; `/sync` read includes drafts; apply with `absent`/stale/normalized; trash; reference uid resolution + missing reference; `convert` md↔blocks round trip accepts/refuses the documented set (table, non-core block, aligned paragraph), html delimiter stripping; `merge` clean and conflicting bodies | PHP in-process | `tests/php/sync_test.php` (new, C1) with `tests/fixtures/sync/*.{md,html,blocks}` |
| front matter parse/emit round-trip, strict refusals (anchor, dup key, local time) | Rust unit | `src/sync/front_matter.rs` tests |
| per-field merge matrix (one row per distinct reason: scalar both-changed, nested member-wise, list atomic, delete vs edit; body merge result consumed from a stubbed server response) | Rust unit | `src/sync/merge.rs` |
| full run against a real standalone app: push new, pull editor change, both-sides merge, conflict file + resolve, rename moves file, first-run no-delete, `--check` exit 2, commit contains only written paths | Rust integration (spawns `php -S` like `tests/compiler.rs`) | `tests/sync.rs` (new) |
| the same run against WordPress incl. trash semantics and a wp-admin-created post gaining a uid | WP e2e | `tests/wp/sync.test.ts` (drives the `zero` binary) |

### 5.8 Acceptance

`examples/blog` gets `sync: "content/posts/*.md"` on posts and `uid: true` on
authors with two committed sample files; `zero sync --check` against a fresh
`zero dev` exits 2, `zero sync` exits 0 and creates the posts, a second run is
a no-op, and the WP lane proves the same against the harness.

---

## 6. Feature 3 — jobs, outbox, idempotency, webhooks … (see §6 below) and Feature 4 — auth

(Feature numbering follows the ruling; sections 6 and 7 below cover features
3+4 and 5+6+7 respectively. Each sub-feature is implementable by one agent.)

### 6.1 Feature 3 — jobs + outbox + `once()` + webhooks

Targets: both. Lane **D** (D1 jobs+outbox+receipts, D2 webhooks on top).

#### Config API

```ts
export declare function job<TInput extends ColumnsConfig>(definition: {
  input: TInput;
  /** Attempts before the job is dead. Default 3. Backoff: 1m, 5m, 15m, 1h, 3h, 6h, 12h, 24h (capped). */
  retries?: number;
  /** Expose as a WP Ability / MCP tool (feature 5). Default false for jobs. */
  agents?: boolean;
  handler: (input: InferActionInput<TInput>, ctx: JobCtx) => Awaitable<void>;
}): Job<TInput>;
export interface JobCtx extends HookCtx { attempt: number; jobId: string }

export interface ConfigInput { jobs?: Record<string, AnyJob>; webhooks?: Webhook[]; }

/** Available inside hooks, actions and job handlers. */
export declare const jobs: JobsApi;      // jobs.<name>.enqueue(input, opts?)
export interface EnqueueOptions { /** seconds */ delay?: number; /** dedupe among pending jobs of this name */ key?: string }
export interface JobHandle<TInput> { enqueue(input: TInput, opts?: EnqueueOptions): Promise<{ id: string }> }

/** Run `fn` at most once per key (per calling user); a second call with the same key returns the stored result; same key + different input → 409. */
export declare function once<T>(key: string, fn: () => Awaitable<T>): Promise<T>;

/** A value read from the environment at runtime (getenv, or a wp-config constant of the same name on WP). Allowed in `webhooks[].url/secret` and `action({ signature })`. */
export declare function env(name: string): EnvValue;

export interface Webhook { url: EnvValue | string; secret: EnvValue; events: WebhookEvent[] }
export type WebhookEvent = `${string}.created` | `${string}.updated` | `${string}.deleted` | "*";

// action() gains:
/** Accept `Idempotency-Key`; replay returns the stored result. */
idempotent?: boolean;
/** Inbound webhook: verify an HMAC over the raw body instead of an access rule (access is ignored; the caller is anonymous). */
signature?: { secret: EnvValue; header: string; scheme: "zero" | "hmac-sha256" };
```

`enqueue` is compiled by lane D (the only `compile.rs` edit in phase 2, in the
`db_call` neighbourhood: `jobs.x.enqueue(a, b)` → `\Zero\Jobs::enqueue('x',
$a, $b)`; `once(k, fn)` → `\Zero\Receipts::once('fn', $k, $fn)`; `env("X")`
is a build-time `Value::Env` that only `extract` accepts in the listed places
and that compiles to `\Zero\Env::get('X')` elsewhere). Hooks/actions calling
`enqueue` outside a transaction can't happen (every request is one).

#### schema.php

Top-level `jobs`, `webhooks` (§3.1); actions get `idempotent`, `signature`.
Job handler fn names `job__<name>`, called `$fn($input, $ctx)` with
`$ctx = ['user' => null, 'target', 'attempt' => int, 'jobId' => string]`.

#### Runtime

Tables (registered through the `SystemTables` seam; SQLite and MySQL DDL both):

```
__zero_outbox(id PK, job TEXT, input TEXT, key TEXT NULL, runAt TEXT, createdAt TEXT)                       -- rows live only inside the writing transaction's lifetime
__zero_jobs(id TEXT PK /* uuid */, job TEXT, input TEXT, key TEXT NULL, state TEXT /* pending|running|done|failed|dead */, attempts INT, runAt TEXT, lockedAt TEXT NULL, lastError TEXT NULL, createdAt TEXT, doneAt TEXT NULL)  + UNIQUE(job, key) WHERE state IN ('pending','running')  (SQLite partial index; MySQL: a `dedupe` column = key when pending else NULL, UNIQUE(job, dedupe))
__zero_receipts(scope TEXT, key TEXT, userId INT /* 0 anonymous */, inputHash CHAR(64), state TEXT /* started|done */, result TEXT NULL, createdAt TEXT, PRIMARY KEY(scope, key, userId))
```

`Zero\Jobs` (`runtime/Zero/Jobs/{Jobs,Outbox,Receipts,Runner,Queue}.php`):

- `Jobs::enqueue(name, input, opts)`: validate input like an action
  (`Schema::validateInput`), insert into `__zero_outbox`; register an
  after-commit callback (`Db::afterCommit` seam) that calls
  `Queue::dispatch()` which moves outbox rows into the queue (`Queue` is the
  per-target interface: `SqliteQueue` inserts into `__zero_jobs`;
  `Wp\ActionSchedulerQueue` inserts into `zero__jobs` **and**
  `as_schedule_single_action($runAt, 'zero_job', ['id' => $jobId], 'zero-<app>')`).
  A rollback leaves outbox rows that `Queue::dispatch` ignores (they're
  deleted by the next dispatch's `DELETE … WHERE createdAt < now-1h`).
  `key` dedupe → the existing pending job's id is returned.
- `Runner::run(jobId)`: lock (`UPDATE … SET state='running', lockedAt WHERE
  id=? AND state='pending'` affects 1 row), call the handler inside a
  transaction with a null viewer; success → `done`; throw → `attempts+1`,
  `failed` with backoff `runAt`, or `dead` when attempts ≥ retries. Stuck
  `running` rows older than 10 min are re-queued by the worker.
- Standalone worker: `php zero/bin/zero.php jobs work [--once] [--idle-exit]`
  polls every 1 s (`SELECT … WHERE state IN ('pending','failed') AND runAt <= now
  ORDER BY runAt LIMIT 1`); `zero dev` starts it as a child process; `zero jobs
  list [--state s] | run <id> | retry <id> | cancel <id>` wrap the PHP CLI.
- WP: `add_action('zero_job', Runner::run)`; `wp zero jobs …` mirrors the
  CLI; Action Scheduler's admin screen remains the UI. Enqueue uses the 4.0+
  signature `as_schedule_single_action($runAt, 'zero_job', ['id' => $jobId], 'zero-<app>', $unique = false)`
  (Zero's own `(job, key)` dedupe runs before AS, so AS uniqueness stays off).
  **Action Scheduler does not retry**: a throwing callback is marked failed
  once. `Runner` therefore catches, records `attempts`/`lastError` in
  `zero__jobs`, and re-schedules itself with the backoff — AS only ever sees
  successful single actions. Receipt sweep and guest pruning are
  `as_schedule_recurring_action` daily actions in group `zero`.

Leans on: Action Scheduler 4.2+ (ruling; the de-facto WordPress job queue,
shipped standalone on wordpress.org, zero deps, admin UI, WP-CLI runner).
Outbox/receipts/retries are Zero's because AS has none of them.
- `Receipts::once(scope, key, fn)` and the `Idempotency-Key` header on
  `POST /actions/{a}` (`idempotent: true`) and `POST /{c}`: scope =
  `action:<name>` / `create:<collection>` / `fn`; key ≤ 64 chars; same key +
  same `inputHash` + state done → stored result (header `Idempotent-Replayed:
  true`); different hash → 409 `idempotency_mismatch`; state `started` → 409
  `outcome_unknown`. Receipts older than 7 days are swept by the worker /
  Action Scheduler recurring action.

#### Webhooks (D2)

Outbound: after every committed pipeline write on a collection named in
`events`, enqueue the built-in job `zero.webhook` with
`{ webhook: <index>, event: "posts.created", id, row, previous? }`; delivery
`POST <url>` JSON `{ id: "<jobId>", event, collection, at, data: { row, previous? } }`,
headers `Zero-Event-Id`, `Zero-Event`, `Zero-Signature: t=<unix>,v1=<hex hmac_sha256(secret, "<t>.<body>")>`;
non-2xx → retry with the job backoff (retries 8); HTTP via `curl`/`stream`
standalone, `wp_safe_remote_post` on WP. Inbound: `signature` on an action
replaces the access check: `scheme: "zero"` verifies the format above (and
rejects `t` older than 5 min); `"hmac-sha256"` compares `hex(hmac_sha256(secret,
raw body))` to the header; failures → 401 `invalid_signature`. Replays are the
caller's job (`idempotent: true` + a key from the payload).

#### Rejected

`job()` input with `references()`/`unique()`; `retries` > 20; `once` with a
non-string key; `env()` used outside `webhooks`/`signature`; `signature`
together with `access`; a webhook `events` entry naming an unknown collection.

#### Owner files

D1: `runtime/Zero/Jobs/**`, `runtime/Zero/Env.php`, `runtime/Zero/Wp/Jobs/ActionSchedulerQueue.php`,
`src/compile.rs` (enqueue/once/env only), `src/commands/jobs.rs`, CLI in
`runtime/bin/zero.php` (`jobs` subcommand block, additive). D2:
`runtime/Zero/Jobs/Webhooks.php`, `runtime/Zero/Http.php` (outbound HTTP
abstraction, standalone + WP), the `signature` check in `App::runAction`
through the `Extensions::beforeAction` seam.

#### Tests

| Behaviour | Level | File |
|---|---|---|
| rejections | compiler | `tests/fixtures/reject-jobs`, `reject-webhooks` |
| `enqueue`/`once`/`env` compile to the documented PHP; `once` semantics match Node (first call runs, second returns stored) | differential | `tests/differential/cases.ts` (jobs section; the Node shim implements an in-memory receipts map) |
| outbox row only becomes a job after commit (hook that enqueues then throws → no job); dedupe key; retries/backoff/dead; `once` 409 paths; `Idempotency-Key` replay + mismatch; receipt sweep | PHP in-process (SQLite queue, `Runner::run` called directly; time via `ZERO_NOW`) | `tests/php/jobs_test.php` |
| `jobs work --once` drains; `zero jobs list/retry/cancel` | Rust integration | `tests/compiler.rs::pantry…` extended with one job in the pantry example (`notifyLowStock`) |
| Action Scheduler gets the action; `wp action-scheduler run` executes the handler with its effect visible; dead job after N failures | WP e2e | `tests/wp/jobs.test.ts` |
| outbound delivery + signature verified by a local receiver; retry on 500; inbound action accepts a valid `zero` signature, rejects stale `t` and bad HMAC | PHP in-process (receiver = `php -S` child in the test) | `tests/php/webhooks_test.php` |

#### Acceptance

The blog gets `jobs: { notifyEditors }` enqueued from `comments.afterCreate`
and one webhook on `posts.*`; the pantry gets `notifyLowStock`. `zero dev`
shows the worker draining; `tests/wp/jobs.test.ts` green.

### 6.2 Feature 4 — frontend sign-in + `auth: true` collections

Targets: WP (full, via zero-identity) and standalone (password/guest issuer).
Lanes **E1** (identity plugin move + additions §3) and **E2** (runtime auth +
`auth: true` + client), E2 stacks on E1.

#### Zero auth routes (both targets, `runtime/Zero/Auth/Routes.php`)

| Route | Standalone | WP (zero-identity present) | WP (absent) |
|---|---|---|---|
| `POST /auth/token` `{ grant_type: "password", name, password }` → `{ accessToken, refreshToken, expiresIn, user }` | yes | 404 (use `/identity/token`) | 404 |
| `POST /auth/token` `{ grant_type: "refresh_token", refreshToken }` → same, rotated | yes | 404 (identity's endpoint) | 404 |
| `POST /auth/guest` → `{ accessToken, refreshToken, expiresIn, user: { …, role: "guest" } }` | yes | yes (`Accounts::issueForUser` on a new `zero_guest` WP user, client `app_zero_guest` auto-registered by the runtime) | 404 |
| `POST /auth/guest/upgrade` `{ name, password }` (standalone) / identity email flow (WP, §3.5) | yes | via hosted screens | — |
| `DELETE /auth/session` (current access token) → `{ data: true }` | yes | yes (delegates to identity's revoke) | 404 |
| `GET /me` | user + `member` (the `auth: true` row, when any) | same | same |
| `GET /auth/config` → `{ issuer, clientId?, guests }` | `{ issuer: null, guests }` | `{ issuer: home_url('/identity'), guests }` | `{ issuer: null }` |

`Auth::resolve` on WP: core (cookies/app passwords) then `Zero\Identity\Bearer`.
`WpAuth::map` adds `role: "guest"` for `zero_guest`, and when identity is
present checks `Accounts::status()`: `suspended`/`deleted` → 403 `suspended`.
Standalone `Identity::resolve` accepts the phase-1 `zt_` CLI tokens **and**
`za_` access tokens from `__zero_sessions`:

```
__zero_sessions(id TEXT PK, userId INT, family TEXT, accessHash CHAR(64), refreshHash CHAR(64), accessExpiresAt TEXT, refreshExpiresAt TEXT, usedAt TEXT NULL, replacedBy TEXT NULL, revokedAt TEXT NULL, createdAt TEXT)
__zero_users gains: suspendedAt TEXT NULL, email TEXT NULL UNIQUE, guest INT NOT NULL DEFAULT 0
```

Rotation/revocation semantics exactly as §3.5 (reuse of a used refresh token
revokes the family). CLI: `zero users suspend|reactivate <name>` (standalone:
sets `suspendedAt`, revokes sessions; WP: `wp zero-identity suspend`). Guests:
`guest < subscriber < author < editor < admin` — **CHANGES §1.6/§5.1**: the
ladder gains `"guest"` at the bottom; `"authenticated"` includes guests; a role
rule `"subscriber"` excludes them; `User.role` type gains `"guest"`. Guests
without any owned row older than 30 days are pruned by the jobs worker /
an Action Scheduler recurring action (`zero.prune-guests`).

#### `auth: true` collections

```ts
export const members = collection("members", {
  id: id(),
  email: email().notNull().unique().max(191),
  name: text().notNull().max(80),
  plan: select({ options: ["free", "pro"] }).notNull().default("free"),
}, { auth: true, access: { read: "self", update: "self", create: "anyone", delete: "admin" } });

export interface CollectionOptions<T> { /** Rows are users. At most one per config. Implies editor: false, drafts: false, revisions: false. Needs `email: email().notNull().unique()`. */ auth?: boolean }
export type AccessShorthand = boolean | "anyone" | "authenticated" | "self" | Role;   // "self" only on auth collections (read/update/delete)
```

Semantics: `ctx.user.id` **is** the member row id. `POST /members` accepts a
virtual write-only `password` (string ≥ 12, standalone) — on WP the password
is set through `wp_set_password` (the hosted screens are the real sign-up
path; API create is for admin/import). Role: system column `role` (text enum
of the ladder, default `subscriber`, updatable only by `admin` — a built-in
field rule). `"self"` rule = filter `{ id: ctx.user.id }` (anonymous → 401).
Storage: standalone — the collection's table **is** the users table
(`__zero_users` is not created; hidden columns `passwordHash`, `suspendedAt`,
`guest` added by the compiler as system columns, never read through the API);
WP — `Wp\WpUserStore` (new): rows = `wp_users` (`id`→`ID`, `email`→`user_email`,
`name`→`display_name` when the column is named `name`) + usermeta `zero_<col>`
through an SCF field group located `user_form == all`; `role` ↔ WP role
(`admin`→`administrator`, `guest`→`zero_guest`). `Source` for the user store
mirrors §3.5.1 with `wp_users`/`wp_usermeta`. Filters on usermeta cost one
join each, same caveat as postmeta.

#### Typed client

```ts
createClient({ url, auth?: { issuer?: string; clientId?: string; redirectUri?: string; storage?: "memory" | "session" /* sessionStorage */ } })
client.auth.signIn(opts?: { returnTo?: string }): Promise<never>   // WP: builds PKCE (S256), stores verifier+state in sessionStorage, redirects to <issuer>/authorize
client.auth.handleCallback(): Promise<User>                        // exchanges `code` at <issuer>/token, keeps tokens per `storage`
client.auth.login(name, password): Promise<User>                   // standalone
client.auth.guest(): Promise<User>
client.auth.me(): Promise<User | null>
client.auth.signOut(): Promise<void>                               // revokes; WP also <issuer>/logout when `returnTo`
```

Every request sends `Authorization: Bearer <access>`; a 401 `unauthenticated`
with a stored refresh token triggers one refresh (`/auth/token` standalone,
`<issuer>/token` WP) and a retry. Server-side use keeps `token`/`headers`
options as in phase 1.

#### schema.php

`auth` block (§3.1); collection `auth: true`; the `role` column
`['type' => 'text', 'enum' => [...ladder], 'system' => true, 'default' => ['value' => 'subscriber'], 'access' => ['update' => ['role' => 'admin']]]`;
hidden columns carry `'hidden' => true` (omitted from `/_schema`, rows, and
the client types).

#### Rejected

Two `auth: true` collections; `auth: true` without the email column shape;
`auth: true` with `editor: true`, `drafts`, `revisions`, `sync`, or a `slug()`;
`"self"` on a non-auth collection or on `create`; a column named `password`,
`role`, `passwordHash` on an auth collection.

Leans on: `zero-identity` (our own, from spacefast-identity) because no
Automattic or wordpress.org plugin offers an OIDC issuer with PKCE, refresh
rotation, passkeys and MFA for headless frontends; core Application Passwords
stay the server-to-server path; WP core roles/`wp_users`/usermeta hold
`auth: true` rows so every other plugin sees them as normal users.

#### Owner files

E1: `runtime/identity/**` (incl. `composer.json`, `vendor-prefixed/`),
`tests/identity/**`, `docs/identity-*.md`. E2: `runtime/Zero/Auth/{Routes,Sessions,Guests,Tokens}.php`,
`runtime/Zero/Identity.php` (standalone issuer; owned by E2), `runtime/Zero/Wp/
{WpAuth.php,WpUserStore.php,IdentityBridge.php}`, `runtime/client/index.ts`
(`auth` module), `src/client.rs` (`member` in `User`, hidden columns) — note:
lane B also edits `client.rs` (`col?:`); B merges first, E2 rebases.

#### Tests

| Behaviour | Level | File |
|---|---|---|
| identity suites after rename (migrations, behavior, security-capabilities, admin-applications, native-password, credential-race, email-race) + new: refresh rotation + reuse revokes family, revoke, logout, Bearer resolves user, `issueForUser`, guest email upgrade in place, vendor drift | PHP in docker (`tests/identity/run.sh`: identity's compose, ported) | `tests/identity/*.php` |
| standalone: password grant, refresh rotation/reuse, guest + upgrade, suspension → 403, `"self"` rules, hidden columns never serialised, role update admin-only, `/me.member` | PHP in-process | `tests/php/auth_test.php` (extend) |
| rejections | compiler | `tests/fixtures/reject-auth-collection` |
| WP: Bearer from identity reaches `/zero/v1` with the right role; suspended → 403; guest create + `"authenticated"` access; `members` rows ⇄ `wp_users`/usermeta; app password still works | WP e2e | `tests/wp/auth.test.ts` (obtains a Bearer by running the authorization-code flow headlessly: `zero-identity/v1/sign-in/password`, then `POST /identity/authorize` approve with the session cookie + CSRF, then `POST /identity/token` with the PKCE verifier — the same steps the identity behaviour suite already scripts) |
| client `auth` module: PKCE redirect URL shape, callback exchange, refresh-on-401 | node:test with a stub `fetch` (the client is dependency-free; the stub is in `runtime/client/index.test.ts`) | `runtime/client/index.test.ts` |

#### Acceptance

`examples/blog` gains `members` (auth) and `public/index.html` gets a sign-in
button that works on `zero dev` (password) and on `zero dev --wp` (redirect to
`/identity`, back with a session, `GET /me` shows the member).

---

## 7. Features 5, 6, 7

### 7.1 Feature 5 — Abilities + MCP (WP only). Lane **F**.

Config: `agents?: boolean` on `CollectionOptions`, `action()`, `global()
options`, `job()` (default `true`, jobs `false`). schema.php: `agents` on each.
Standalone: `/_schema` omits entries with `agents: false`; nothing else.

Runtime (`runtime/Zero/Wp/Abilities/{Register,JsonSchema,Invoke}.php`), on
`wp_abilities_api_categories_init` (category `<app>`, label = app label) and
`wp_abilities_api_init`:

| Ability name | Input | Output | Annotations |
|---|---|---|---|
| `<app>/<collection>-list` | `{ where?, orderBy?, limit?, offset?, with?, locale? }` (schemas generated from columns: filter operator objects per kind) | `{ rows: Row[] }` | readonly, idempotent |
| `<app>/<collection>-get` | `{ id, with?, locale? }` | `Row` | readonly |
| `<app>/<collection>-create` / `-update` / `-delete` | `Insert` / `{ id, patch }` / `{ id }` | `Row` | delete: destructive |
| `<app>/<collection>-revisions` | `{ id }` | `{ revisions: [...] }` | readonly |
| `<app>/<collection>-sync-read\|apply\|trash` (when `sync`) | as §5.3 | as §5.3 | read: idempotent, not readonly |
| `<app>/<action-kebab>` | action input | action result (`any` when the compiler can't type it) | from `idempotent`; destructive when the handler calls `db.delete` (compiler flag `writes`) |
| `<app>/global-<g>-get` / `-update` | — / patch | values | |
| `<app>/media-list\|get\|delete` | | | (no upload: abilities carry no files) |
| `<app>/job-<name>` (when `agents: true`) | job input | `{ id }` | |

Names: collection table/action/global names kebab-cased (`shopping_list` →
`shopping-list`); a collision after kebab-casing is rejected at build. Each
registration: `label`, `description` (generated: "List posts of the Blog
app"), `category`, `input_schema`/`output_schema` (`JsonSchema::column()`:
integer→`integer`, real→`number`, text/enum→`string`+`enum`, boolean, timestamp
`string format date-time`, date `format date`, json `{}`, media `integer`,
mediaList `array of integer`, group `object`, repeater `array of object`,
blocks `array of oneOf`; localized collections add `locale` enum input and
`translationOf` on create, §7.3),
`permission_callback` = `Access::evaluate(rule, Viewer(WpAuth::current()))`
where a filter counts as allowed (the row filter is applied in execute),
`execute_callback` = `Invoke::call($op, $input)` which calls a new
`App::invoke(string $method, string $path, array $query, mixed $body, Viewer): mixed`
(the `route()` body without HTTP envelope; errors throw `HttpError` → mapped to
`WP_Error('zero_' . $code, $detail, ['status' => $status, 'pointer' => …])`),
`meta => ['show_in_rest' => $agents, 'mcp' => ['public' => $agents], 'annotations' => [...], 'zero' => ['collection', 'op']]`.
`wp zero run <ability> --input=<json> --user=<login>` executes one (runtime-owned,
no dependency on WP-CLI having an ability command). MCP: the WordPress MCP
Adapter plugin (`mcp-adapter`) exposes abilities with `mcp.public`; the
runtime registers nothing MCP-specific. `agents: false` therefore means: PHP
`wp_get_ability()` and `wp zero run` still work; core REST
(`/wp-abilities/v1`) and MCP don't list it.

Leans on: the core Abilities API (`wp_register_ability`, WP 6.9; `meta.public`
7.1) and the **WordPress MCP Adapter** plugin ≥ 0.7.1 (required, §2.7). The
adapter's default server exposes only three meta-tools (`discover-abilities`,
`get-ability-info`, `execute-ability`); agents are first-class users here, so
the runtime also registers a **named server** on `mcp_adapter_init`:
`McpAdapter::create_server('zero-<app>', 'mcp', 'zero-<app>', '<App label>',
'Zero app <name>', '<zeroVersion>', [transports: HTTP + STDIO], [error/observability: adapter defaults], $abilityNames)`
listing every ability with `agents: true` as a named tool, served at
`/wp-json/mcp/zero-<app>` (HTTP, application-password auth) and
`wp mcp-adapter serve --server=zero-<app> --user=<login>` (STDIO). The default
server stays enabled (other plugins' abilities). Zero adds no transport, auth
or schema code of its own.

Rejected: kebab collisions; `agents` on `media`.

Owner files: `runtime/Zero/Wp/Abilities/**`, `App::invoke` (added by seams A1
as a thin extraction of `route()`; F only calls it), `tests/wp/abilities.test.ts`.

Tests: ability list/schemas for the blog pinned against a committed JSON
(`tests/wp/fixtures/abilities.json`; a generated↔source drift guard) via
`wp zero abilities --json`; `permission_callback` 401/403 for anonymous and
subscriber on update, filter rules pass; execute creates a post visible in
`/zero/v1`; `agents: false` ability absent from `/wp-abilities/v1/abilities`
and from the MCP adapter's `tools/list` but present to `wp zero run`;
`tools/call` on `blog-posts-list` returns rows (the adapter's default-server
endpoint is read from its README at implementation time; the test logs in with
an application password).

Acceptance: `wp zero abilities` lists every operation of the blog; MCP
`tools/call` works as `editor`, is forbidden for `subscriber` on writes.

### 7.2 Feature 6 — image sizes, focal point, private files. Lane **G** (G1 images, G2 files).

#### Config

```ts
export interface ConfigInput { media?: { sizes?: Record<string, { width: number; height?: number; fit?: "cover" | "inside" }> }; files?: Record<string, AnyFileBucket> }
export declare function files(name: string, options: { accept: string[] /* mime types or "image/*" */; maxBytes: number; access?: { read?: FileRule; create?: FileRule; delete?: FileRule } }): FileBucket;
export type FileRule = AccessShorthand | "owner" | ((ctx: AccessCtx) => boolean);   // "owner" = the uploader
export declare function file(config: { bucket: string }): ColumnBuilder<"file", number, false, false>;
```

Media row (both targets) gains `sizes: Record<string, { url: string; width: number; height: number }>` (empty for non-images) and `focal: { x: number; y: number } | null` (0..1 from top-left). New route `PATCH /media/{id}` `{ alt?, focal? }` (access: `update` = `"editor"`, fixed like the rest of media); changing `focal` regenerates every `cover` size. Size names: `^[a-z][a-z0-9_]*$`, max 12 sizes; `fit: "inside"` needs only `width` (height derived); `"cover"` needs both.

#### Runtime

G1 — `runtime/Zero/Media/Images.php` (GD: `imagecreatefromstring`,
`imagecopyresampled`, focal-aware crop origin
`x0 = clamp(focal.x * W - w/2, 0, W - w)`), used by `SqliteMedia` (sizes
written next to the original as `<uuid>-<size>.<ext>`, recorded in
`__zero_media.sizes` JSON + `focal` JSON via `SystemTables` ALTER steps) and
by `WpMedia` through WP's own pipeline: `add_image_size('zero_<name>', w, h,
crop)` on `init`; an `image_resize_dimensions` filter that, for Zero sizes and
when the attachment has `_zero_focal`, returns the focal crop rectangle;
`focal` stored as meta `_zero_focal`; regeneration = `wp_update_attachment_metadata($id, wp_generate_attachment_metadata($id, $file))`;
URLs via `wp_get_attachment_image_src`. SVG/GIF-animated: no sizes.

Leans on: WordPress core only (`add_image_size`, `wp_get_image_editor`,
`image_resize_dimensions`). Core has no attachment focal point (Gutenberg
#75221 is an unmilestoned proposal), so `_zero_focal` is Zero's. **Optional
adapter** `Zero\Wp\Media\ImageCdn` (G1, ≤ 80 lines): when Jetpack ≥ 16 or
Jetpack Boost with Image CDN is active and connected
(`class_exists(\Automattic\Jetpack\Image_CDN\Image_CDN::class)` and
`!Status::is_offline_mode()`), size URLs in media rows are rewritten to
`i0.wp.com/<host>/<path>?resize=W,H&crop=x,y,w,h` (cover, from the focal
rectangle; the package drops crop positions by itself, hence the
`jetpack_photon_pre_args` hook) or `?fit=W,H` (inside), and no local size
files are generated. Not a dependency: Automattic's terms allow the CDN only on
connected sites, so an unconnected install keeps GD. Reported in
`GET /_schema` `runtime.wp.imageCdn: bool`. Private files (G2) never use the
CDN.

G2 — `runtime/Zero/Media/Files.php` + `runtime/Zero/Wp/WpFiles.php`:

```
__zero_files(id PK, bucket TEXT, filename TEXT, mime TEXT, size INT, path TEXT, ownerId INT NULL, createdAt TEXT)
POST   /files/{bucket}          multipart `file`  → 201 { id, bucket, filename, mime, size, ownerId, createdAt, url }   (mime sniffed with finfo and checked against `accept`; `maxBytes` → 413 `payload_too_large`)
GET    /files/{bucket}/{id}     → 200 same shape, fresh `url` (signed, 300 s)
DELETE /files/{bucket}/{id}     → 200 row
GET    /files/{bucket}/{id}/download?exp=<unix>&sig=<hex>   → streams: Content-Type from the row, Content-Disposition: attachment; filename*=…, X-Content-Type-Options: nosniff, Content-Security-Policy: sandbox, Cache-Control: private, no-store. No auth; `sig = hmac_sha256(secret, "<bucket>/<id>/<exp>")`, `exp` ≤ now+300.
```

Secret: standalone `ZERO_SECRET` env else `data/secret`; WP option
`zero_runtime_secret` (random, written by the runtime activation). Storage:
standalone `<appRoot>/private/<bucket>/<uuid>`; WP `WP_CONTENT_DIR/uploads/
zero-private/<app>/<bucket>/<uuid>` with `.htaccess` (`Require all denied`)
and `index.php`. Activation (and `admin_init` daily) writes a probe file and
`wp_remote_get`s its direct URL: a 200 means the web server ignores
`.htaccess` (nginx) → option `zero_runtime_private_ok = false` → uploads
answer 503 `files_unavailable` ("private files are reachable at <url>; deny
`/wp-content/uploads/zero-private/` in your web server config") and `zero
doctor` fails. `file({ bucket })` columns hold ids; existence + bucket are
checked on write (422 pointer); deleting a file nulls referencing columns
(same mechanism as media). `with: { deck: true }` populates the row (with a
fresh signed url) — only when the viewer passes the bucket's `read` rule
(`"owner"` compares `ownerId` to `ctx.user.id`), else the id stays. Sweeping
orphans is out of scope (files are rows; delete them).

Leans on: nothing. Core attachments are public by URL; Jetpack has no private-
file product; "download manager" plugins are commercial or unmaintained and
none expose a signed-URL API. Signed streaming is ~150 lines over `hash_hmac`.

#### Rejected

`fit: "cover"` without height; size name invalid; `file({ bucket })` naming an
unknown bucket; `"owner"` outside `files`; `accept` entries that aren't
`type/subtype` or `type/*`; `files` named `media`.

#### Owner files

G1: `runtime/Zero/Media/Images.php`, `runtime/Zero/Store/SqliteMedia.php`,
`runtime/Zero/Wp/WpMedia.php`, `App::mediaRoute` PATCH (via the `App::route`
seam replacing the media route wholesale: G1 owns `runtime/Zero/Media/Routes.php`
and A1 moves the phase-1 media route there). G2: `runtime/Zero/Media/Files.php`,
`runtime/Zero/Media/FileRoutes.php`, `runtime/Zero/Wp/WpFiles.php`,
`runtime/Zero/Signer.php`. Types: `types/zero/tests/files.ts`. Client:
`files.<bucket>.upload/get/delete`, `media.update` in `runtime/client/index.ts`
(G1+G2 edit disjoint blocks; G2 stacks on G1).

#### Tests

| Behaviour | Level | File |
|---|---|---|
| GD sizes + focal crop rectangle math (pure) | PHP unit | `tests/php/images_test.php` (fixture PNGs under `tests/php/fixtures/`) |
| upload returns sizes; PATCH focal regenerates (different bytes); non-image has `sizes: {}` | PHP in-process | `tests/php/db_test.php` media section (extend) |
| files: accept/maxBytes/413, signed url valid then expired/forged → 403, `owner` rule, nulling on delete, `with` populate gated | PHP in-process | `tests/php/files_test.php` |
| WP: `wp_get_attachment_image_src` for `zero_thumb` honours focal; `.htaccess` probe → 503 path (simulated by deleting `.htaccess` and resetting the option through `wp option`); download streams with the headers | WP e2e | `tests/wp/media.test.ts` |
| client `files`/`media.update` | node:test stub fetch | `runtime/client/index.test.ts` |

#### Acceptance

Blog: `media: { sizes: { card: { width: 600, height: 400, fit: "cover" } } }`,
`files: { decks }`, `posts.deck: file({ bucket: "decks" })`; the public page
shows `cover.sizes.card.url`; `tests/wp/media.test.ts` green.

### 7.3 Feature 7 — localization (Polylang model). Lane **H**.

**Research ruling (Oct 2026):** WordPress core has no multilingual content
support in 7.0–7.2 and Phase 4 has no design or ETA; Automattic ships no
multilingual content plugin (WordPress.com's own docs recommend Polylang);
WPML is GPL but not installable from wordpress.org and paid; MultilingualPress
is multisite-only; TranslatePress translates rendered strings, not fields.
**Polylang (free, GPLv3, `wp plugin install polylang`, 3.9+)** is the one
option that is open, non-interactively installable, programmatically
configurable (`pll_get_post_types`, `pll_insert_post`, `pll_set_post_language`,
`pll_save_post_translations`, `pll_get_post_translations`, `pll_copy_post_metas`,
`wpml-config.xml`), and whose model (one post per language, translation
groups) is the ecosystem's model. Zero adopts that model on **both** targets
so one config behaves the same everywhere.

#### Config

```ts
export interface ConfigInput { locales?: { default: Locale; all: Locale[]; /** Read the default-locale row when a locale has no translation. Default true. */ fallback?: boolean } }
// ColumnBuilder gains (text, richText, json, select, group, repeater, blocks; not id/slug/system/media/file/numbers/booleans/dates):
/** This column is translated per locale. Every other column of a localized collection is synced across its translations. */
localized(): this-shaped builder;
export type Locale = string;   // narrowed to the configured union in zero.gen.ts via Register

// A collection with at least one localized column is a *localized collection* and gains two system columns:
export type LocalizedColumns = { locale: Locale; /** locale → id of the translation (self included) */ translations: Partial<Record<Locale, number>> };
// Query option on findMany/findFirst/list/get and the REST query string:
locale?: Locale | "*";        // default: locales.default; "*" = every locale (rows of every language)
// Insert on a localized collection accepts:
{ locale?: Locale /* default locales.default */; translationOf?: number /* id of an existing row in another locale: join its group, copy its synced columns */ }
```

Semantics (both targets):

- A localized collection stores **one row per locale**. `translations` is
  derived (the group), read-only, always complete for the row's group.
- Reads with `locale=de` return the `de` rows; with `fallback`, a group that
  has no `de` row contributes its default-locale row (so a list is "every
  group once, in the best available language"). `locale=*` returns every row.
  Relations (`with`) resolve to the related row **in the same locale**
  (fallback applies); `references()` always store the id of a specific row,
  and the typed client's `translations` lets a frontend switch.
- Create: `locale` defaults to the default locale; `translationOf: id` puts
  the new row in that row's group and pre-fills every **non-localized**
  column from it (the caller may override localized columns only; a non-
  localized column in the payload that differs from the source → 422
  `invalid_input`, pointer `/<col>`, "synced across translations; change it on
  any row to change all"). A group has at most one row per locale (409
  `unique_violation`, pointer `/locale`).
- Update: a change to a non-localized column on any row is applied to every
  row of its group in the same transaction (pipeline-level, hooks run once per
  row, revisions per row). `status`/`publishedAt`/`slug`/`uid` are per row
  (not synced): a translation is published on its own. `locale` is immutable.
- Delete: deletes that row only; the group shrinks.
- Hooks and `db` see rows as stored (`locale`, `translations` present);
  `db.query.<c>.findMany({ locale })` works the same way.
- Non-localized collections are untouched; `locale` on them → 400
  `invalid_query`.

#### schema.php

`locales` block (§3.1). Collection: `'localized' => true|false`; the two
system columns emitted last after `status`/`publishedAt`:
`'locale' => ['type' => 'text', 'enum' => [...all], 'notNull' => true, 'default' => ['value' => '<default>'], 'system' => true]`,
`'translations' => ['type' => 'json', 'system' => true, 'derived' => true]`;
and per column `'localized' => true` on translated columns (absent on synced
ones). `GET /_schema` lists `locales`, each column's `localized`, and the
collection's `localized` flag.

#### Runtime — tables and standalone

`locale` is a real column; `translationGroup` (hidden, text, uuid) links the
group (the compiler emits both in migrations with an index on
`(translationGroup, locale)` UNIQUE). `translations` is assembled by
`Extensions::onRead` from one extra query per page (`WHERE translationGroup IN (...)`).
Locale filtering/fallback is one `Sql` rule for the store (`Sql::select`
gets `$locale`): `WHERE locale = ?` or, with fallback,
`WHERE locale = ? OR (locale = <default> AND translationGroup NOT IN (SELECT translationGroup FROM t WHERE locale = ?))`.
Group sync on update runs in `Db::onWritten` (`Zero\Locale\GroupSync`).

#### Runtime — WordPress post-backed (Polylang)

- `Zero\Wp\Polylang` (lane H): `add_filter('pll_get_post_types', …)` registers
  every localized collection's post type as translatable (and hides it from
  Polylang's own settings UI). Languages are **Polylang's** (created from
  `locales.all` via `PLL()->model->add_language()` when missing, on the first
  request after activation or a `locales` change, under a lock; until they
  exist, Zero refuses writes with 503;
  `zero doctor` reports a mismatch between `locales.all` and
  `pll_languages_list()`).
- `WpPostStore::insert` calls `pll_set_post_language($id, $locale)` and, for
  `translationOf`, `pll_save_post_translations($group + [$locale => $id])`;
  `select` fills `locale` from `pll_get_post_language($id)` and
  `translations` from `pll_get_post_translations($id)` (both cached per
  request; primed per page with one `wp_get_object_terms` over the
  `language`/`post_translations` taxonomies — the new `onLookup` seam, §9.1).
  `Source` gains `locale` as a joined term expression
  (`{a}.ID IN (SELECT object_id FROM wp_term_relationships tr JOIN wp_term_taxonomy tt … WHERE tt.taxonomy='language' AND t.slug=?)`)
  so `Sql`'s locale rule compiles the same on this store.
- Synced columns: Zero does the syncing itself in the pipeline (as on
  tables) **and** emits `wpml-config.xml` into the app plugin so Polylang's
  own "create translation" button in wp-admin copies/translates the right
  metas: `<custom-types><custom-type translate="1">zero_posts</custom-type>`,
  `<custom-fields><custom-field action="copy">zero_<syncedCol></custom-field>
  <custom-field action="translate">zero_<localizedCol></custom-field>
  <custom-field action="ignore">_zero_uid</custom-field>` (uid and slug are per
  row; `zero_<col>` wildcards for SCF sub-rows: `zero_<col>_*`). The same file
  makes the generated post types WPML-aware for free; Zero does not otherwise
  support WPML. A wp-admin-created translation gets its uid and synced
  columns through the existing editor-save hooks (`afterEditorSave` → GroupSync).
- `status` per row is native (Polylang publishes translations independently).
- Field access (§4) applies per row; sync (§5) writes one file per row with
  `locale` and `translations` (as uids) in front matter.
- Abilities (§7.1): `locale` input (enum), `translationOf` on create; no
  `oneOf` maps.

#### Rejected

`.localized()` on `slug()`, `id()`, system columns, `media`, `file`, numbers,
booleans, dates ("translate text, not values; put it in a localized `group`
if it must vary"); `.localized()` without `locales`; `locales.default` not in
`all`; a locale not matching `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$`; `.unique()`
on a localized column (uniqueness is per locale: hint "add a second column or
use `slug()`"); `auth: true` on a localized collection; `editor: true`
localized collections when the target is WP are fine; user columns named
`locale`/`translations`/`translationOf`/`translationGroup`.

#### Owner files

`runtime/Zero/Locale/{Module,GroupSync,Read}.php`, `runtime/Zero/Sql.php`
(locale rule; H owns `Sql.php` for phase 2), `runtime/Zero/Wp/Polylang.php`,
`runtime/Zero/Wp/WpPostStore.php` (after C1's `_zero_uid` line: language
set/get, `Source` locale expr), `src/wpml_config.rs` (emit; called from
`src/commands/build.rs`), `src/migrate.rs` (`locale`/`translationGroup`
columns + index), `src/types.rs` (`LocalizedColumns`, insert `translationOf`),
`src/client.rs` (`locale` option, `translations` type), `types/zero/tests/locales.ts`,
`tests/wp/cache/polylang-3.9.x.zip` pin + `harness.sh` activation (H edits
the harness's plugin list only).

#### Tests

| Behaviour | Level | File |
|---|---|---|
| rejections | compiler | `tests/fixtures/reject-localized` |
| `locale` option typed; hook reads `row.locale`/`row.translations` identically in Node and PHP | differential | `tests/differential/cases.ts` |
| SQL text per dialect for the locale rule with/without fallback, on a plain `Source` and the post-backed (term-join) fixture | pure PHP | `tests/php/sql_test.php` (extend) |
| create default/explicit locale, `translationOf` copies synced + refuses divergent synced column, one row per locale per group, update syncs the group (hooks per row), delete shrinks group, read fallback, `with` same-locale, `locale=*`, non-localized collection rejects `locale` | PHP in-process | `tests/php/db_test.php` locale section |
| migration DDL for the two columns + index | Rust unit | `src/migrate.rs` tests |
| `wpml-config.xml` golden for the blog | compiler golden (drift guard) | `tests/compiler.rs` + `tests/fixtures/blog.wpml-config.xml` |
| WP: Polylang sees the CPT as translatable; API create sets `pll_get_post_language`; `translationOf` shows in `pll_get_post_translations`; `/zero/v1/posts?locale=de` with fallback; a wp-admin "+ translation" (simulated with `pll_insert_post` via WP-CLI `eval`) gets uid + synced columns; synced-column update propagates | WP e2e | `tests/wp/locales.test.ts` |
| client `locale`/`translationOf` types | tsc | `examples/blog/client-tests/negative.ts` |

#### Acceptance

Blog: `locales: { default: "en", all: ["en", "de"] }`, `posts.title`,
`posts.body`, `posts.excerpt` localized (so `posts` is a localized collection,
`cover`/`tags`/`authorId`/`seo` synced); the scenario creates an `en` post,
a `de` translation via `translationOf`, reads `?locale=de` and sees the
fallback for an untranslated group; the generated plugin ships
`wpml-config.xml`; both lanes green with Polylang 3.9 active in the harness.

---

## 8. Judgment calls and cross-cutting rulings (per feature, condensed)

See §10 for the ones that need the user. Fixed here:

- `agents` defaults `true` for collections/actions/globals, `false` for jobs.
- `sync` never includes media bytes or `auth: true` rows.
- Localized collections are one row per locale everywhere; synced columns are
  synced by the pipeline, Polylang only owns language + group on WP.
- Third-party PHP is bundled via Strauss at maintainer time (§3.3); a new
  dependency needs a line in `docs/dependencies.md` and the vendor drift guard
  green.
- `enqueue` only inside a transaction (every request/CLI command is one).
- `"self"` and `"owner"` are scoped shorthands (auth collections / file
  buckets) and are rejected elsewhere, so the vocabulary doesn't leak.
- Guests are a role, not a flag.
- One app plugin per site; the runtime refuses a second.

---

## 9. Work partition, stacks, review gate

### 9.1 Seams stack **A** (sequential, one agent, merges before anything else)

Branches `p2/a1-runtime-seams` → `p2/a2-config-surface` → `p2/a3-plugin-split`
→ `p2/a4-ci`, one `gh stack` (`gh stack init --base main` in the A worktree,
then `gh stack add` per branch, `gh stack submit`).

**A1 — runtime extension points (PHP only; zero behaviour change; all
phase-1 suites green).**

```php
// runtime/Zero/Extensions.php
final class Extensions {
    /** @param callable(string $collection, array &$opts, ?Viewer, string $pointer): void $fn   before option validation and SQL */
    public static function beforeRead(callable $fn): void;
    /** @param callable(array $rows, string $collection, ?Viewer): array $fn   after decode, before `with`; retain primary keys */
    public static function onRead(callable $fn): void;
    /** @param callable(string $op, string $collection, array &$data, ?array $existing, ?Viewer, array $provided): void $fn   create: after defaults, before required/access checks and beforeCreate; update: after onUpdate, before beforeUpdate; delete: before beforeDelete */
    public static function onWrite(callable $fn): void;
    public static function normalizeWrite(callable $fn): void;  // same input signature, before unknown-column rejection; no persistent effects
    public static function aroundOperation(callable $fn): void; // (scope, spec, rawBody, headers, ?viewer, next): Response; wraps authorized actions and creates
    /** @param callable(string $op, string $collection, array $row, ?array $previous): void $fn   after the after* hook, still inside the transaction */
    public static function onWritten(callable $fn): void;
    public static function afterCommit(callable $fn): void;        // delegates to the active Db's Store; outermost commit, discarded on rollback, immediate outside a transaction
    public static function route(string $prefix, callable $handler): void;   // App::route tries registered prefixes before collections: $handler(string $method, array $segments, array $query, string $body, Viewer $v, array $files, array $form): array{int, mixed}|Response
    public static function beforeAction(callable $fn): void;       // $fn(array $actionSpec, string $name, string $rawBody, array $headers, ?Viewer): void (may throw; null = trusted CLI)
    public static function cli(string $command, callable $fn): void;   // zero/bin/zero.php + `wp zero`
    public static function schemaDescribe(callable $fn): void;     // $fn(array $describe): array
    /** @param callable(string $collection, list<int|string> $pks): void $fn   before store hydration/decode or saved-result presentation; prime per-page caches here (meta, terms, Polylang language/group) */
    public static function onLookup(callable $fn): void;
}
// runtime/Zero/SystemTables.php
final class SystemTables { public static function register(string $table, array $sqlite, array $mysql): void; /* lists of SQL strings or callable(Store): void guarded upgrades; idempotent */ public static function apply(Store $store): void; }
// runtime/Zero/Wp/Scf.php
public static function fieldFilter(callable $fn): void;   // $fn(array $field, array $def, string $col, array $spec): array — applied to every generated field incl. sub-fields
// runtime/Zero/Features.php — the registration order (one static list; each feature file is `Zero\<Feature>\Module::register()`), loaded by bootstrap.php
```

Db/App/stores and the WP editor bridge call these. The phase-1 media route
moves to `Zero\Media\Module` behind `Extensions::route('media', …)`;
`Features` registers it once from bootstrap. `App::dispatch(method, path, query, rawBody, Viewer, headers, files, form)`
is the operation entry point shared by HTTP and Abilities. It joins/opens a
transaction, binds the explicit actor and restores the caller actor. Its result
is `Response`; errors throw. `App::invoke(method, path, query, body, Viewer)`
returns JSON operation data without an HTTP envelope or repeat authentication.
The private action path is shared by HTTP/CLI: authorize, call `beforeAction`
with exact bytes and normalized headers, validate input, then wrap/execute the
compiled handler. JSON syntax parsing retains its phase-1 precedence
before action lookup/authorization. It joins the caller's request/command transaction.
`Schema::load` remains v2-only in A1, with a disabled v3 reader flag for A2;
`Schema::version()` and `runtime()` expose the version and nullable runtime
series string without changing v2 output.

**A1 architecture corrections (from the phase-1 runtime):**

- `promoteDue` stays at the **start** of HTTP/CLI transactions (phase 1 §6.3).
  Moving it to `afterCommit` would make the first due read stale and change
  rollback semantics. Store-owned media cleanup already uses commit callbacks;
  `Extensions::afterCommit` delegates to that same store/connection queue,
  rather than adding a second global queue. Nested transactions join the outer
  transaction; an exception that escapes it discards callbacks. A caught inner
  exception does not create a savepoint or cancel the outer transaction.
  Callback exceptions propagate after COMMIT; they cannot trigger rollback
  cleanup for committed effects. Remaining callbacks are not retried.
- The original hooks could not implement §4.3's filter checks or distinguish
  submitted fields from defaults. `beforeRead` can reject selectors or consume
  feature query options before `Sql::select`; the sixth `onWrite` argument is
  the original supplied row/patch, before defaults/onUpdate. Create extensions
  run before required checks so they can fill system values such as uid.
  `normalizeWrite` can consume virtual `password`/`translationOf` before column
  validation while preserving original input. HTTP list/item queries forward
  feature options to `beforeRead`; unconsumed unknown options remain invalid.
  These are extension points only; A1 adds no field-access or locale policy.
- `onRead` also transforms revision reads and returning write responses.
  Restore uses the authorized full stored revision, never the display
  transform, then transforms only its response. Internal mutation selection
  preserves authorization filters without invoking display transforms; hooks,
  validators and stored revisions receive full decoded storage rows. Relation attachment privately keeps
  the original decoded linkage columns, so stripping a foreign key cannot
  break `with`; stripped media columns are not repopulated. Transforms retain
  primary keys. WP editor writes remain trusted: after-save/delete notify
  `onWritten` after application hooks; editor create/update do not replay the
  API's before-write pipeline over already-saved core data. Previous/delete
  captures use `Db::editorRow` to keep stored values outside display transforms.
- `onLookup` fires once per nonempty **collection** page, inside each concrete
  store, before WP SCF hydration and before schema decode. System-media queries
  are not app collections. Mutation result pages (including receipt replay)
  and revision snapshots prime lookup caches before their read transforms;
  callbacks may repeat after write hooks. Existing WP nested-meta priming remains store-owned;
  new feature caches use `onLookup` without relying on plugin construction.
- `Store` gains `afterCommit(callable)` and
  `applySystemStatements(list<string>)`. `SystemTables` selects the dialect;
  WP replaces `{prefix}` on its shared connection. Registration rejects a
  duplicate table owner. SQLite applies registered DDL on store construction;
  WP applies it in the existing activation/update/CLI migrator. MySQL DDL must
  stay outside request transactions because it commits implicitly. SQLite has
  no `ADD COLUMN IF NOT EXISTS`, so each dialect's registered list also accepts
  `callable(Store): void` upgrade steps: inspect the real schema, then alter
  only when needed. The transaction guard runs before either SQL or callbacks.
  A3 moves shared-table lifecycle ownership to the runtime plugin.
- Route prefixes match one complete first segment, receive the full decoded
  segment list and own the path before built-ins/collection dispatch. The auth
  module can replace `/auth/token`; absent an owner, built-in behavior remains.
  CLI extension handlers get
  `(argsWithoutCommand, flags)`, run in `App::cli`'s transaction and share its
  receipts on standalone and `wp zero`. Duplicate route/command registrations
  fail rather than overwrite an owner.
- `aroundOperation(scope, spec, rawBody, headers, viewer, next)` wraps actions
  and collection creates after authorization (including replay), within the
  transaction. It can return cached data/status/headers without running `next`,
  or persist the result after `next`; failures roll back both effects. For
  creates, normalization/required/access checks precede the wrapper, while
  application hooks and persistence remain in the continuation. Returning
  field transforms apply after create replay. No receipt policy is in A1.
- `Response::raw(bytesOrEmitter, status, headers)` enables extension downloads.
  Both transports emit only after commit; the emitter performs file I/O, not
  database mutations. Normal JSON operations use `Response::json`.
- `Scf::fieldFilter` runs after each field is fully built, including nested
  group/repeater/layout fields. Its `spec` is the collection/global at the top
  level, or `['fields' => siblingDefinitions]` for a nested field. This supplies
  the sibling context §4.3's conditional logic needs without implementing it.

**A2 — config surface + schema.php v3 + d.ts + golden.** Everything in §3.1
is parsed (`eval.rs` column methods `.access/.showIf/.localized`, `file()`,
`files()`, `job()`, `env()`, `once`, `jobs` identifiers; `extract.rs`
collection options `sync/uid/auth/agents`, config keys
`jobs/webhooks/files/media/locales`; `schema.rs` fields; `schema_php.rs` v3
render; `types.rs` nothing; `compile.rs` only `Slot::FieldAccess` and
`Slot::JobHandler` through the existing closure path, with `enqueue/once/env`
calls **rejected** with "not implemented until lane D" so the differential
suite stays green), `types/zero/index.d.ts` with the complete phase-2 surface
verbatim from §4–§7, `types/zero/tests/phase2-surface.ts` (compiles only),
`tests/fixtures/blog.schema.json` regenerated, every §"Rejected" list
implemented as fixtures `tests/fixtures/reject-*` **except** those marked as
lane-owned above (field-access/showIf/jobs/webhooks/auth/localized/files
rejections are A2's — they are all static config checks; lanes add none).
`Schema.php` learns the v3 keys as pass-through (no behaviour). Runtime reads
v3.

**A3 — plugin split + wp-content output + platform + vendoring + harness.**
§2 entirely: `src/main.rs` emit (`emit_wp` → `emit_wp_content`),
`runtime/wp-plugin/{zero-runtime.php,zero-app.php}`, `Zero\Wp\Runtime`,
`runtime/Zero/Wp/Platform.php` + `src/platform.rs` + `tests/fixtures/platform.json`
(§2.7), `runtime/identity/` **placeholder** (a `zero-identity.php` that boots
nothing, so the tree shape and harness activation order are exercised before
E1 lands), the vendoring mechanism (§3.3: `scripts/vendor.sh`, the Strauss
PHAR pin, `runtime/Zero/composer.json` with the two php-toolkit packages,
the committed `runtime/Zero/vendor-prefixed/`, `tests/php/vendor_drift.php`,
`docs/dependencies.md`, `bootstrap.php` autoload require, `build.rs` skip
list), harness `--wp-content` with pinned zips for SCF, Action Scheduler, MCP
Adapter and Polylang in `cache/` (Polylang activation gated on the manifest),
`zero doctor`, `src/commands/*.rs` dispatcher (one file per command; `main.rs`
only parses args and dispatches).

**A4 — CI** (§9.5).

### 9.2 Feature lanes (parallel after A merges)

| Lane | Stack (bottom → top) | Owns (exclusive) | Touches shared files? |
|---|---|---|---|
| **B** field access | `p2/b1-field-access` | `runtime/Zero/FieldAccess.php`, `runtime/Zero/Wp/Scf/ConditionalLogic.php`, `tests/php/db_test.php` §field-access, `tests/wp/editor.test.ts`, `tests/differential/cases.ts` §fields | `src/client.rs` (one `col?:` branch) |
| **C** sync | `p2/c1-sync-runtime` → `p2/c2-sync-cli` | `runtime/Zero/Sync/**`, `src/sync/**`, `src/commands/sync.rs`, `tests/php/sync_test.php`, `tests/sync.rs`, `tests/wp/sync.test.ts`, `tests/fixtures/{canon,sync}/`, `Cargo.toml` deps | `runtime/Zero/Wp/WpPostStore.php` (one line, C1); uses `vendor-prefixed/` toolkit from A3, adds no dependency |
| **D** jobs | `p2/d1-jobs-outbox` → `p2/d2-webhooks` | `runtime/Zero/Jobs/**`, `runtime/Zero/Env.php`, `runtime/Zero/Http.php`, `runtime/Zero/Wp/Jobs/**`, `src/commands/jobs.rs`, `tests/php/{jobs,webhooks}_test.php`, `tests/wp/jobs.test.ts`, `runtime/bin/zero.php` §jobs | `src/compile.rs` (enqueue/once/env; **the only lane that edits compile.rs**) |
| **E** auth | `p2/e1-identity-plugin` → `p2/e2-auth-runtime` | `runtime/identity/**` (incl. `composer.json`, `vendor-prefixed/`), `tests/identity/**`, `runtime/Zero/Auth/**`, `runtime/Zero/Identity.php`, `runtime/Zero/Wp/{WpAuth,WpUserStore,IdentityBridge}.php`, `tests/php/auth_test.php`, `tests/wp/auth.test.ts` | `runtime/Zero/Wp/CompositeStore.php` (E2 owns the user-store selection branch), `runtime/client/index.ts` §auth, `src/client.rs` (User/member/hidden), `scripts/vendor.sh` (adds the `identity` root), `docs/dependencies.md` (three lines) |
| **F** abilities | `p2/f1-abilities` | `runtime/Zero/Wp/Abilities/**` (incl. the named MCP server registration), `tests/wp/abilities.test.ts`, `tests/wp/fixtures/abilities.json` | none |
| **G** media/files | `p2/g1-image-sizes` → `p2/g2-private-files` | `runtime/Zero/Media/**`, `runtime/Zero/Signer.php`, `runtime/Zero/Store/SqliteMedia.php`, `runtime/Zero/Wp/{WpMedia,WpFiles}.php`, `runtime/Zero/Wp/Media/ImageCdn.php`, `tests/php/{images,files}_test.php`, `tests/wp/media.test.ts` | `runtime/client/index.ts` §media/files |
| **H** localization | `p2/h1-locales` | `runtime/Zero/Locale/**`, `runtime/Zero/Sql.php`, `runtime/Zero/Wp/Polylang.php`, `src/wpml_config.rs`, `tests/wp/locales.test.ts`, `tests/php/sql_test.php` §locale, `tests/fixtures/blog.wpml-config.xml`, `types/zero/tests/locales.ts` | `runtime/Zero/Wp/WpPostStore.php` (language set/get + `Source` locale expr, after C1), `src/types.rs`, `src/migrate.rs`, `src/client.rs` (locale option), `src/commands/build.rs` (emit `wpml-config.xml`), `tests/wp/harness.sh` (Polylang activation line) |

Shared test files: `tests/php/db_test.php` sections are owned per lane (B:
field access, G: media, H: locale) and are appended as separate `section()`
blocks at the end of the file; `tests/differential/cases.ts` likewise gets
one `// ---- lane X` block per lane at the end. `examples/blog/zero.config.ts`
is edited only in the **integration PR** (§9.3 step 3); lanes never touch the
examples. Each lane tests against `tests/php/blog_app.php` (hand-written
schema.php fixture; lanes append their own section) and against the WP test
app **through a per-lane config fragment** `tests/wp/app/lanes/<lane>.ts`
imported by `tests/wp/app/zero.config.ts` (A3 adds the import list with every
lane's fragment present and empty, so a lane only fills its own file).

Every lane: one git worktree (`git worktree add ../zero-wt/<lane> -b <branch>
main` after A merges), `gh stack init --base main` in it, `gh stack add` per
PR, `gh stack submit`. Nobody rebases another lane's stack.

### 9.3 Merge order

1. A1 → A2 → A3 → A4 (strict).
2. B, C, D, E, F, G, H are independent and may merge in any order **except**:
   C1 before H (both touch `WpPostStore.php`; C1's change is one line, H
   rebases); B before E2 before H for `src/client.rs` (each rebases on the
   previous; the edits are in different functions, so conflicts are
   mechanical); D before H for `tests/differential/cases.ts` only if D lands
   first (either order works; blocks are appended).
3. Integration PR `p2/z-integration` (one agent, after all lanes): the blog
   example gets every acceptance change from §4–§7, `README.md`/`config-api.md`
   gain the phase-2 surface, `examples/blog/public/index.html` exercises
   sign-in + sizes + locale, the full scenario runs on both lanes.

### 9.4 Review gate (every PR, including A1–A4 and integration)

Run from the PR's worktree, on the merge-base diff:

```sh
base=$(git merge-base origin/main HEAD)        # for stacked PRs: the parent branch instead of origin/main
git diff "$base"...HEAD > /tmp/review-$(git branch --show-current | tr / -).diff
~/.local/bin/codex-t3-proxy exec -m gpt-6.1-sol -c model_reasoning_effort=high --sandbox read-only -C "$PWD" \
  "Review the diff at /tmp/review-<branch>.diff against docs/design-phase2.md §<section> and docs/design-wp-parity.md. \
   Focus: (1) contract drift from the design (names, keys, routes, problem codes, rejections); (2) correctness bugs, especially \
   transaction/rollback, auth/access leaks, idempotency and signature checks; (3) the AGENTS.md testing rules: no source-text \
   assertions, one behaviour at the lowest level, no sleeps, no .only/.skip, no mock-was-called; (4) anything that would break \
   the other phase-2 lanes listed in §9.2. Output: numbered findings with file:line, severity (blocking/should/nit), and the fix. \
   Say 'no blocking findings' explicitly if so."
```

The reviewer output goes into the PR body under "Sol review" verbatim
(trimmed to findings), with a line per finding: fixed in `<sha>` / rebutted
because `<reason>`. Re-run after fixes until the latest run reports no
blocking findings. A PR without this block doesn't merge. Merge with
`gh pr merge --squash` bottom-up per stack (or `gh stack` merge once the
bottom is green), keeping the stack's base links updated (`gh stack sync`).

### 9.5 CI (A4)

`.github/workflows/ci.yml`, on `pull_request` and `push: main`:

| Job | Runner | Steps | Needs docker |
|---|---|---|---|
| `rust` | ubuntu-24.04 | `rustup` from `rust-toolchain`, `php8.3-cli php8.3-sqlite3 php8.3-mbstring php8.3-gd`, `node 22`, `cargo test` (includes pantry over HTTP + differential) | no |
| `php` | ubuntu-24.04 | `tests/php/run.sh` (includes `vendor_drift`) | no |
| `vendor` | ubuntu-24.04, `php:8.2-cli` container | `composer` + the pinned Strauss PHAR; `scripts/vendor.sh all`; `git diff --exit-code -- '**/vendor-prefixed/**'` — proves the committed trees are what the locks produce (§3.3) | no |
| `types` | ubuntu-24.04 | `tsc -p types/zero/tests`, `tsc -p examples/blog/client-tests`, `node --test runtime/client/index.test.ts` | no |
| `wp` | ubuntu-24.04 (docker preinstalled) | `tests/wp/run.sh`; required-plugin zips (SCF, Action Scheduler, MCP Adapter, Polylang) restored from `actions/cache` keyed by `tests/wp/cache/*.sha256`, downloaded on miss, hash-verified by `harness.sh` | yes |
| `identity` | ubuntu-24.04 | `tests/identity/run.sh` (identity compose, PHP 8.2 + 8.5 images as in the source repo's workflow) | yes (E1 adds the job; A4 ships it as `if: hashFiles('tests/identity/run.sh') != ''`) |

Lanes needing docker to prove their behaviour: C (wp sync), D (Action
Scheduler), E (everything WP + identity), F (abilities/MCP), G (WP media
probe), H (Polylang). B is docker-free except `editor.test.ts`.
Every job runs on every PR; stacked PRs show the same six checks. Raising a
required-plugin minimum (§2.7) = new zip + sha256 in `tests/wp/cache/` +
the `Platform` constants, in one PR.

---

## 10. Judgment calls for the user, and risks

1. **Bundling mechanism: Strauss at maintainer time, committed
   `vendor-prefixed/`** (ruling: Composer allowed, bundle properly). Decided
   over (a) php-scoper — needs a maintained WordPress symbol exclusion list,
   the exact thing that bit spacefast-identity; (b) Composer at `zero build`
   time — would require PHP + Composer on every user's machine for a Rust
   single-binary tool. Cost: ~6 MB of committed third-party PHP and a `vendor`
   CI job. Still open for you: whether to keep `league/oauth2-server` instead
   of the ~300 lines of plain-PHP auth-code + OIDC-client transport (§3.3). I
   chose the plain PHP because the plugin already owns the OIDC semantics and
   League only contributed PKCE verification + code encryption; keeping
   League would add 12 packages but remove that rewrite from lane E1. Say
   "keep League" and E1 shrinks by a day and `docs/dependencies.md` grows.
2. **Sync scope is still the biggest risk**, now smaller: Markdown⇄blocks and
   body merge are the php-toolkit's (one implementation, the one the monorepo
   proved), leaving the CLI with YAML subset I/O, per-field merge, bases,
   conflict files, git. Deferred inside this feature: media bytes (ids only),
   `.html` as the escape hatch, polling-only `--watch`. Residual risk: the
   toolkit is 0.10.x and vendors commonmark/yaml unprefixed in
   `vendor-patched/` — Strauss must prefix those too (A3 proves it with the
   drift guard); and toolkit upgrades can change round-trip output, so the
   `tests/fixtures/sync/` golden set is the contract. If anything is cut, cut
   `--watch` and `resolve`.
3. **Localization = Polylang's model on both targets** (ruling: existing
   plugins, Automattic first; research found nothing Automattic-owned and no
   core support through 7.2). One row per locale with pipeline-level sync of
   non-localized columns is the design that stays true when Phase 4 lands
   (a translation group is the same concept). What you give up vs. the
   previous map-per-column design: `GET /posts` for a locale is "one row per
   group" via a `NOT IN` subquery (fine for CMS sizes; `editor: false` is the
   fast path as ever), and a translation is its own row with its own uid,
   slug, status and revisions. Polylang **free** suffices (REST `lang` and
   ACF per-field toggles are Pro-only, but Zero does both itself); Polylang's
   ACF integration on SCF is unverified and unused. WPML gets
   `wpml-config.xml` compatibility, nothing more.
4. **Guests become a role** (`guest` below `subscriber`; approved).
5. **Standalone feature 4 is deliberately thin** (password + refresh + guests,
   no OIDC). Building a second OIDC issuer in SQLite is wasted work; frontends
   that need real sign-in on standalone can point `auth.issuer` at any OIDC
   provider in a later phase.
6. **Abilities/MCP have no standalone counterpart.** `agents: false` is the only
   standalone effect. A `zero mcp` stdio server over `/_schema` is cheap and
   could be a later lane; not in phase 2.
7. **Cut from the original's CLI list:** `inspect`, `logs`, `seed`, `snapshot`
   are deferred; `doctor` and `jobs` are in. `logs` would need a capped table
   and a hook on every call; `snapshot` overlaps with sync + a DB dump.
8. **One app per site.** Multi-app needs a namespaced REST prefix and client
   base path; deferred until someone needs it.
9. **Conditional fields are UI-only.** Payload semantics; no data is dropped
   or rejected by the pipeline because of `showIf`.
10. **Binary size** grows by ~6 MB of embedded PHP (identity ~4 MB incl.
    webauthn-lib's 29 packages, runtime ~2 MB of php-toolkit) plus the two JS
    bundles. Acceptable; if not, A3 can gate identity embedding behind a cargo
    feature.
11. **Risk: `compile.rs` edits (lane D) and `types.rs`/`migrate.rs` (lane H)**
    are the only compiler changes outside the seams; they are small but the
    differential suite must stay green on both, and D's "rejected until lane
    D" stub in A2 means `once`/`enqueue` are unusable in configs until D merges.
12. **Required-plugin surface grew** (ruling: enforce WP/PHP/plugin
    versions): every WP install needs SCF + Action Scheduler + MCP Adapter,
    plus Polylang when localized. `Requires Plugins` makes activation refuse
    until they're installed, but it can't install them; `zero doctor` and the
    admin notice say exactly what to `wp plugin install`. If MCP Adapter as a
    hard requirement for apps that never use agents feels heavy, the
    alternative is "required only when any `agents: true`" — but the default
    is `true`, so it would be required for nearly every app anyway; kept
    unconditional for one predictable platform.
13. **Risk: private-file probe** can false-negative behind caches/CDNs
    (probe 200 from cache). The 503 fallback protects data at the cost of
    availability; `zero doctor` explains. nginx users must add the deny rule.
14. **Risk: identity's salt-dependent sealing** (keys, MFA secrets) survives
    the move unchanged; rotating WP salts bricks the issuer. Document in
    `docs/identity-security.md`; fixing it (own sealed root key in an option)
    is a follow-up.
15. **Jetpack Image CDN is an optional adapter, not a dependency.** It is
    technically usable without a connection, but Automattic's terms restrict
    it to connected sites and the package drops crop positions (needs the
    `jetpack_photon_pre_args` hook for focal crops). Making it required would
    tie every Zero site to a WordPress.com connection; making it optional
    costs ~80 lines. If you want Jetpack to be the *only* image path on WP
    (no GD sizes), say so and G1 drops the local generation on WP.
16. **Polylang is not Automattic-owned** — but it is what WordPress.com's own
    documentation points users to, and nothing Automattic-owned exists. If
    an Automattic multilingual plugin or core Phase 4 ships, `Zero\Wp\Polylang`
    is the one adapter file to replace (the pipeline model stays).
