# What Spacefast changes to run a TypedPress release

The [host contract](host-contract.md) is what any host may rely on. This page applies it to one host,
Spacefast, whose engine still runs the 0.3.0 compiler it vendored before the rename to TypedPress. For each
item of the contract it names where TypedPress defines it and whether Spacefast's engine already does it.
Monorepo paths are relative to the Spacefast monorepo. "Unknown" means it was not checked.

Moving the vendored compiler to a TypedPress release is one change: every name below crosses the boundary
at once.

Item numbers are fixed, because other pages cite them; a number that is missing was removed.

| # | Contract item | Defined in TypedPress | Spacefast today | Change |
|---|---|---|---|---|
| 2 | **Manifest.** `typedpress.hosted.v1` with integer `hostContract` (2), `summary {name, collections, tables, actions, identity, admin}`, `routes`, `pagePaths`, `requires`, and `host` (paths, hooks, mount, jobs command, longest table prefix) | `src/bundle.rs`, `src/host_contract.rs` | reads `zero.hosted.v1`, then adds `compilerRevision` and a `summary` scraped from `client/schema.ts` (`crates/stattic-runtime-core/src/zero_v2.rs`, `app_summary`) | must change: read the manifest's own `summary`, refuse an unknown `hostContract`, delete the scrape |
| 3 | **Mount.** `TypedPress\Loader\Loader::load($root, $build, {variables, users, beforeIdentity, url})` before WordPress initializes; `Loader::initialize($root, $build)` once per build; `Loader::inspect($root, $build)` before selection; `Store::gc($root, $keep)` after deleting versions. Builds come from `typedpress compile-to-store` | `runtime/wp-plugin/typedpress-loader.php`, `src/store.rs` | requires `plugins/zero-runtime/zero/{Env,bootstrap}.php` by path and calls `\Zero\Env::isolate`, `\Zero\Schema::load`, `\Zero\Wp\Runtime::{mount,initialize}`, `\Zero\Sync\Seed::run`, requires `zero-identity/zero-identity.php`, schedules `zero_identity_maintenance` (`runtime/engine/shared/zero-v2.php`) | must change: compile to the build store and call only the public loader/store methods |
| 4 | **Hooks a host provides.** `tp_mail_transport` (filter: deliver `mail.send`); `tp_purge_urls` (action: URLs a committed write changed); `tp_private_probe_url` (filter); `tp_identity_rest_cookie_auth`, `tp_identity_providers` (filters, identity); `TypedPress\Realtime\Publisher` (interface) | runtime: `TypedPress/Mail.php`, `TypedPress/Wp/Purges.php`, `TypedPress/Wp/WpFiles.php`, `identity/src/Sessions.php`, `identity/src/Providers.php`, `TypedPress/Realtime/Publisher.php` | registers `zero_mail_transport` (`runtime/engine/shared/zero-v2.php`), `zero_identity_rest_cookie_auth` and `zero_identity_provider_account` (`runtime/engine/wordpress/space-users.php`), a `\Zero\Realtime\Publisher` (`runtime/engine/runtime/zero-v2-realtime-publisher.php`); no purge listener; no identity provider entry | must change: rename to `tp_*` and `TypedPress\`; add a `tp_purge_urls` listener for the page cache. `tp_identity_provider_account` (the Access bridge) and `tp_identity_providers` (Sign in with Spacefast) wait for the owner's sign-in ruling |
| 6 | **Reserved paths.** TypedPress owns `/__tp/*` (its API is `/__tp/api/v1`; never cache it), `/identity/*`, `/wp-json/typedpress-identity/v1/*`, `/wp-admin/new/*` (TypedPress Admin) | `src/host_contract.rs` (`RESERVED_PATHS`), `runtime/TypedPress/Wp/Facade.php` | serves `/__zero/client.js` and routes `/wp-json/zero/v1/*`; `actionPathPrefix` is `/wp-json/zero/v1/actions/` (`apps/control-plane/src/versions/zero-v2-app.ts`) | must change: route the TypedPress paths to WordPress; serve the compiled tree's `client/client.js` at a path the engine picks; `actionPathPrefix` becomes `/__tp/api/v1/actions/`; `/__zero/*` stays for 0.8 |
| 7 | **Live updates.** WordPress action `tp_realtime_changes`; `TypedPress\Realtime\Module::publish` and `::shared`; browser registry `globalThis.__tpRealtime` (`registerRealtimeTransport` from the generated client). The event name on the wire is the host's | `runtime/TypedPress/Realtime/Module.php`, `runtime/client/index.ts` | event `zero.changes` (`runtime/engine/runtime/zero-v2-realtime.php`, `apps/control-plane/src/zero/realtime.ts`); Cast admits `first.` events as well as `zero.` (`apps/cast/lib/cast/events/custom_event.ex`), but the control plane accepts only `zero.changes` (`apps/control-plane/src/runtime/callback-authorization.ts`); registry `__zeroRealtime` (`runtime/engine/runtime/zero-realtime.js`) | must change: `TypedPress\` classes, `__tpRealtime`; rename the event to `typedpress.changes` and accept it in the control plane |
| 8 | **Table prefix.** Every table is under `$wpdb->prefix`; the host owns it; at most 35 characters (the longest name TypedPress adds is 29) | `src/host_contract.rs` (`TABLE_PREFIX`, `MAX_SUFFIX`) | `sfz_<24 hex>_`, 29 characters (`runtime/engine/shared/zero-v2-scope.php`) | required for commerce: provision a prefix of at most 20 characters before Woo installation; the existing 29-character prefix cannot be used. Existing sites need a separately verified transition preserving all tables and data, or must refuse commerce; changing the prefix string alone hides existing data. No migration strategy is established here |

## Commerce host qualification

TypedPress now compiles `store()` and native Woo kinds and proves them on Playground; that does
not move Spacefast's compiler pin or provision Woo there. Before accepting a commerce build:

- Fulfil the manifest's `woocommerce >=11.3.0` platform requirement. Mount the build before
  Woo initializes, so the loader's commerce policy prevents automatic Woo pages and HPOS.
  Local `typedpress build` output carries the same early policy in
  `mu-plugins/typedpress-commerce.php`; preserve it when installing that artifact.
- Honour the manifest's `maxTablePrefix: 20`, including the first Woo installation. The
  ordinary 35-character TypedPress limit is insufficient for Woo's download-permission table.
- Initialize Woo before seeding products/terms and declaring the store ready. Keep Action
  Scheduler/WP-Cron, gateway callbacks, merchant administration and `wp_mail` operational.
- Give each preview its own fresh SQLite database and test payment/email configuration.
  Promotion publishes source; it never copies preview orders, customers or inventory.
- Qualify shipping changes as installation changes, not just a version-pointer switch.
  Block new checkout requests and drain active ones before changing shipping. Resume checkout
  after selecting a compatible build. Permit concurrent build selection
  or rollback only when the selected build's declared shipping policy matches the last committed
  shipping state. Use the public `Loader::inspect()` check described in the host contract and
  require `hostContract: 2`. Check this after initialization failures too: a later failed step does not undo
  a completed shipping transaction. Prove rejection of an incompatible older ready build and
  recovery through a newly initialized build that reapplies the intended policy, without restoring
  historical orders. Do not accept commerce builds until the host enforces this prerequisite.
- Route `/wp-json/wc/store/*` uncached. Cart, checkout and receipt paths are private/no-store.
  A guest's `wp_woocommerce_session_*` cookie does not invalidate shared catalog HTML.
- Repeat `docs-site/tests/playground/commerce.test.ts` on the host, prove preview isolation,
  then qualify the pilot gateway with a payment and refund. Playground coverage establishes
  neither host readiness nor compatibility with an arbitrary external gateway.
