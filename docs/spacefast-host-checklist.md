# What Spacefast changes to run a TypedPress release

The [host contract](host-contract.md) is what any host may rely on. This page applies it to one host,
Spacefast, whose engine still runs the 0.3.0 compiler it vendored before the rename to TypedPress. For each
item of the contract it names where TypedPress defines it and whether Spacefast's engine already does it.
Monorepo paths are relative to the Spacefast monorepo. "Unknown" means it was not checked.

Moving the vendored compiler to a TypedPress release is one change: every name below crosses the boundary
at once.

| # | Contract item | Defined in TypedPress | Spacefast today | Change |
|---|---|---|---|---|
| 1 | **Uploads.** `typedpress.source-bundle.v1` (`.typedpress-source/{app.typedpress.json,vendor.typedpress.json,manifest.json}`), and `zero.source-bundle.v1` from clients released before the rename (`.zero-source/{app.zero.json,vendor.zero.json,manifest.json}`), read as the same TypedPress bundle | `src/bundle.rs` (`compile_tree`), `src/zero_bundle.rs` | the CLI and MCP write only `zero.source-bundle.v1` (`packages/cli/src/zero-v2-source-publish.ts`, `packages/mcp/src/zero-v2.ts`); detection knows only `.zero-source/` and `zero.config.ts` (`apps/control-plane/src/versions/zero-generation.ts`, `crates/stattic-runtime-core/src/zero_v2.rs`) | must change: new clients write `.typedpress-source/` from `typedpress.config.ts`; detection accepts both directories; the release-compatibility baseline adds 0.9.0, whose clients still send the old format |
| 2 | **Manifest.** `typedpress.hosted.v1` with integer `hostContract` (1), `summary {name, collections, tables, actions, identity, admin}`, `routes`, `pagePaths`, `requires`, and `host` (paths, hooks, mount, jobs command, longest table prefix) | `src/bundle.rs`, `src/host_contract.rs` | reads `zero.hosted.v1`, then adds `compilerRevision` and a `summary` scraped from `client/schema.ts` (`crates/stattic-runtime-core/src/zero_v2.rs`, `app_summary`) | must change: read the manifest's own `summary`, refuse an unknown `hostContract`, delete the scrape |
| 3 | **Mount.** `TypedPress\Loader\Loader::load($root, $build, {variables, users, beforeIdentity, url})` before WordPress initializes; `Loader::initialize($root, $build)` once per build; `Store::gc($root, $keep)` after deleting versions. Builds come from `typedpress compile-to-store` | `runtime/wp-plugin/typedpress-loader.php`, `src/store.rs` | requires `plugins/zero-runtime/zero/{Env,bootstrap}.php` by path and calls `\Zero\Env::isolate`, `\Zero\Schema::load`, `\Zero\Wp\Runtime::{mount,initialize}`, `\Zero\Sync\Seed::run`, requires `zero-identity/zero-identity.php`, schedules `zero_identity_maintenance` (`runtime/engine/shared/zero-v2.php`) | must change: compile to the build store and call only these three |
| 4 | **Hooks a host provides.** `tp_mail_transport` (filter: deliver `mail.send`); `tp_purge_urls` (action: URLs a committed write changed); `tp_private_probe_url` (filter); `tp_identity_rest_cookie_auth`, `tp_identity_session_cookie_aliases`, `tp_identity_providers` (filters, identity); `TypedPress\Realtime\Publisher` (interface) | runtime: `TypedPress/Mail.php`, `TypedPress/Wp/Purges.php`, `TypedPress/Wp/WpFiles.php`, `identity/src/Sessions.php`, `identity/src/Providers.php`, `TypedPress/Realtime/Publisher.php` | registers `zero_mail_transport` (`runtime/engine/shared/zero-v2.php`), `zero_identity_rest_cookie_auth` and `zero_identity_provider_account` (`runtime/engine/wordpress/space-users.php`), a `\Zero\Realtime\Publisher` (`runtime/engine/runtime/zero-v2-realtime-publisher.php`); no purge listener; no identity provider entry | must change: rename to `tp_*` and `TypedPress\`; add a `tp_purge_urls` listener for the page cache. `tp_identity_provider_account` (the Access bridge) and `tp_identity_providers` (Sign in with Spacefast) wait for the owner's sign-in ruling |
| 5 | **Jobs.** `wp typedpress jobs tick [--limit=1..100] [--budget-ms=ms]`, one bounded pass, prints `{processed, failures, outboxDispatched, requeued, receiptsExpired, remaining}` (`outboxDispatched` is always 0) | `runtime/TypedPress/Jobs/Tick.php`, `runtime/TypedPress/Cli/commands.json` | its own bounded pass in PHP: `runtime/engine/runtime/zero-v2-worker-wp.php`, run from `zero-v2-worker.php`, calling `zero jobs run` and Action Scheduler and WP-Cron directly | must change: call the command; delete `zero-v2-worker-wp.php`; the idle probe reads `tp__jobs` (TypedPress no longer writes `tp__outbox`) |
| 6 | **Reserved paths.** TypedPress owns `/__tp/*` (its API is `/__tp/api/v1`; never cache it), `/identity/*`, `/wp-json/typedpress-identity/v1/*`, `/wp-admin/new/*` (TypedPress Admin), `/typedpress-admin/*` (its earlier address, redirected) | `src/host_contract.rs` (`RESERVED_PATHS`), `runtime/TypedPress/Wp/Facade.php` | serves `/__zero/client.js` and routes `/wp-json/zero/v1/*`; `actionPathPrefix` is `/wp-json/zero/v1/actions/` (`apps/control-plane/src/versions/zero-v2-app.ts`) | must change: route the TypedPress paths to WordPress; serve the compiled tree's `client/client.js` at a path the engine picks; `actionPathPrefix` becomes `/__tp/api/v1/actions/`; `/__zero/*` stays for 0.8 |
| 7 | **Live updates.** WordPress action `tp_realtime_changes`; `TypedPress\Realtime\Module::publish` and `::shared`; browser registry `globalThis.__tpRealtime` (`registerRealtimeTransport` from the generated client). The event name on the wire is the host's | `runtime/TypedPress/Realtime/Module.php`, `runtime/client/index.ts` | event `zero.changes` (`runtime/engine/runtime/zero-v2-realtime.php`, `apps/control-plane/src/zero/realtime.ts`); Cast admits `first.` events as well as `zero.` (`apps/cast/lib/cast/events/custom_event.ex`), but the control plane accepts only `zero.changes` (`apps/control-plane/src/runtime/callback-authorization.ts`); registry `__zeroRealtime` (`runtime/engine/runtime/zero-realtime.js`) | must change: `TypedPress\` classes, `__tpRealtime`; rename the event to `typedpress.changes` and accept it in the control plane |
| 8 | **Table prefix.** Every table is under `$wpdb->prefix`; the host owns it; at most 35 characters (the longest name TypedPress adds is 29) | `src/host_contract.rs` (`TABLE_PREFIX`, `MAX_SUFFIX`) | `sfz_<24 hex>_`, 29 characters (`runtime/engine/shared/zero-v2-scope.php`) | none |
| 9 | **Stored-name upgrade.** See below | `runtime/TypedPress/Wp/ZeroNames.php`, `runtime/identity/src/Legacy/ZeroNames.php`, `runtime/identity/src/Legacy/ZeroSession.php` | not applicable until the pin moves | the engine must refuse selecting a 0.3 version once a TypedPress build is ready on that Space; unknown whether it can today |

## The stored-name upgrade (item 9)

A site that ran a 0.3.0 build keeps its data under `zero` names. The first time a TypedPress runtime boots
on it, TypedPress renames them to its own: tables `{prefix}zero_*` and `{prefix}zero__*`, the identity
tables, post types and their revisions, TypedPress's post and user meta and their field references, options,
the `zero_guest` role, stored job names, Action Scheduler hooks and groups, WP-Cron events, and the
private files directory. A session created under the 0.3 digest is re-keyed the first time its cookie
is presented, so signed-in members stay signed in.

- **When.** On the first boot of a TypedPress runtime on a site the 0.3 runtime ran on: for a host, inside
  `Loader::initialize`, before migrations; for a site plugin, on its first request or activation. It
  runs only where the 0.3 runtime left its marker (`zero_runtime_tables`, `zero_runtime_site_id` or a
  `zero__migrations` ledger); elsewhere it records that it ran and touches nothing.
- **It never deletes a row.** Each step is a `RENAME TABLE` or an `UPDATE` of a name. A TypedPress name that
  is already taken stops it with the conflict named, and the old data stays where it is.
- **Safe to run twice.** It records completion in `tp_zero_names` and checks the database before
  each step, so a second run changes nothing.
- **Half finished.** If it stops (crash, timeout, conflict), some names are TypedPress's and the rest still
  `zero_`; no row is lost or under two names. WordPress keeps serving, TypedPress's API answers 503, and
  TypedPress's own typedpress-boot steps wait. The next request runs it again and continues.
- **One way.** A 0.3 build can't read the renamed data.
- **A collection name longer than 17 characters** would need a post type over WordPress's limit of 20:
  its posts stay under the old type, listed in `tp_zero_names.kept`, with an admin notice.

`tests/wp/zero-upgrade/` proves each of these on WordPress and MariaDB, starting from a database and
private files the real 0.3.0 runtime wrote. The decision is in
[docs/decisions/2026-11-12-rename-zero-data-once.md](decisions/2026-11-12-rename-zero-data-once.md).

## A Space's clients across the upgrade

After the pin moves, the host recompiles a 0.3 Space's stored `zero.source-bundle.v1` with the TypedPress
compiler. The recompiled site serves TypedPress's API at `/__tp/api/v1`, and its regenerated client
(`client/client.js` of the compiled tree) calls `/__tp/api/v1`. Nothing serves `/wp-json/zero/v1`
any more. A browser tab still running the 0.3 client gets a `ZeroError` with status 404 and code
`rest_no_route` on every call: an error the page can show, never a wrong answer or an empty list.
Reloading the page loads the new client. `tests/wp/zero-upgrade/upgrade.test.ts` runs both clients
against the upgraded site.

## Old bundles: removing or changing an authoring form

The host recompiles every stored `zero.source-bundle.v1` with the current compiler when the pin
moves, and again on each TypedPress release. Those sources were written for the 0.3.0 compiler, so a PR
that removes or changes an authoring form (a builder, a modifier, a config key, a `"first"` export, an
option, a default) can stop a deployed Space from publishing, or change its stored schema, with
nothing else failing.

Any such PR runs `cargo test --test zero_bundle`. It recompiles three 0.3.0 captures made by the
0.3.0 compiler (`tests/fixtures/zero-0.3/`; its README says how they were made), including `forms/`,
which uses every authoring form 0.3.0 accepted. It checks each one compiles, plans no migration,
keeps its snapshot, and serves the schema 0.3.0 served; that the stored routes answer as the 0.3.0
runtime answered; and that each removed form is still refused in a TypedPress project, with its fix.

When it fails:

1. **A 0.3.0 capture no longer compiles, or plans a migration.** Teach the old reading the form:
   `mod legacy` in `src/eval.rs` (field builders and modifiers) or `src/extract.rs` (config keys and
   options), reading it onto the model the current form builds. That reading is on only for a
   `zero.source-bundle.v1` capture (`Fs::legacy_fields`, set only in `src/zero_bundle.rs`). Never add a
   flag, config key or alias a TypedPress project can reach
   (docs/decisions/2026-11-11-authoring-surface.md, rulings 21 to 23).
2. **The served schema differs.** If the new value serves the same (a rename, a key the runtime
   reads the same way), add it to the listed differences in
   `every_0_3_authoring_form_recompiles_to_the_schema_0_3_served` with the reason. Otherwise it changes
   a deployed Space: fix the reading.
3. **A form can't be read onto the current model.** Take it to the owner with the Spaces it affects
   before merging. Never edit the fixtures to make the test pass: they are the 0.3.0 compiler's output.
4. **A form you removed is missing from the refusal table.** Add a case to
   `the_0_3_forms_other_lanes_removed_are_refused_in_a_first_project`, and, if 0.3.0 accepted it, make
   sure `forms/` uses it (recapture with the 0.3.0 compiler as the fixture README says).

Bundles with TSX pages (`pages/` and `zero/pages.json`) are refused with a message that tells the
owner to move each page to `tp/app/<path>/page.tsx` and publish again; nothing reads them.
