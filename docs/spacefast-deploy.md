# Deploy Zero on Spacefast

Publish a project containing `zero.config.ts` to run its collections, hooks,
and actions on Spacefast's WordPress runtime. Spacefast compiles the source
on the host and initializes the candidate before making it ready.

Generated REST endpoints, actions and [live updates](#live-updates) work on
the Space hostname. Zero Pages are not hosted yet. Keep your frontend in public
assets or publish it separately.

## Publish an app

1. Install the `spacefast` CLI and authenticate with `sf login`.
2. Check the project from its root:

   ```sh
   sf zero check
   ```

3. Publish to your Space:

   ```sh
   sf publish --space spc_example
   ```

   The CLI captures `.zero-source/app.zero.json`, `vendor.zero.json`, and
   `manifest.json`, then uploads those private bundles and the public assets.
   Capture, check, and source migration use the CLI's bundled WebAssembly
   compiler. Publishing does not need a native Zero executable.

4. Wait for the publish receipt to report readiness. Open its Space URL and
   exercise a collection read and an action before handing the app back.

The hosted MCP publish tool also accepts raw `zero.config.ts`, relative `.ts`
modules, and `public/`. The host captures raw source when `.zero-source/` is
absent. Host capture resolves relative imports and the `zero` module.

If host capture reports `zero_source_needs_local_capture`, an import needs
local package resolution. Install the project's dependencies locally and publish
with `sf publish`. The CLI captures supported installed package sources into
the vendor bundle. The host never runs npm install.

Use `sf zero build` to emit local WordPress plugins and `sf zero dev` to run
WordPress Studio. These two commands use the native optional platform package
shipped with the CLI. See the [local development guide](../CONTRIBUTING.md#the-commands).

## Call a REST endpoint or action

Collections use `/wp-json/zero/v1/<collection>`. An action named `hello` uses
`POST /wp-json/zero/v1/actions/hello` on the Space hostname:

```sh
curl --fail-with-body 'https://your-space.example/wp-json/zero/v1/actions/hello' \
	-H 'Content-Type: application/json' \
	--data '{"name":"Sam"}'
```

Use the action's declared input and access rule. A successful call returns
`{ "data": ... }`. The generated client supplies the same contracts at
`/__spacefast/client.js` and `/__spacefast/client.d.ts`. The version-specific
app companion is `/__spacefast/zero/client.js` with its `client.d.ts`.

Port a 0.8 custom method/path endpoint to a named action and update its callers.
The source migrator refuses old `endpoints` declarations with a pointer.
Generated v2 endpoints and actions need no additional Spacefast route setup.

## Live updates

`watch` works with no setup on Spacefast:

```ts
import { createClient } from "/__spacefast/client.js";

createClient().todos.watch({ where: { done: false } }, (todos) => render(todos));
```

Spacefast registers a Publisher that sends each commit's change notice to the
Space's realtime room. The `/__spacefast/client.js` bundle registers the
matching Cast transport, so every client on the page uses it. Without a live
connection, watched reads poll. See [Live updates](realtime.md) for the API.

## Migrate an existing 0.8 Space

Follow [Migrate a Spacefast app](migrating-from-zero.md#migrate-a-spacefast-app).
Run `sf zero migrate --space spc_example --dry-run --json` first. The report
names unsupported source with RFC 6901 pointers. Resolve every refusal before
starting the real operation.

The migration preserves supported content and user IDs. Imported logins keep
their original expiry through an isolated legacy-session upgrade. Google
provider values become managed variables of the candidate version. Never copy
those values into project source or print them in a report.

The transition to v2 is one-way. After it commits, Spacefast refuses 0.8
publication and promotion. Old immutable 0.8 URLs return
`410 zero_legacy_retired` with the live hostname. Restoring older v2 code still
uses the environment's latest database schema.

## Prepare the WordPress host

This section is for host operators. Ordinary publication uses the CLI or MCP.

Bind the Space before WordPress loads normal plugins, roles, identity, or Action
Scheduler. The table prefix is `sfz_<first 24 hex digits of SHA-256(space ID)>_`,
including `users`, `usermeta`, posts, options, identity, and job tables. Namespace
all object-cache groups, including WordPress's global user groups. A cache flush
must affect only the selected Space.

Initialize the selected candidate explicitly under the Space's migration lock.
Managed visitor requests must not apply migrations. Check the installed
WordPress, PHP, and plugin versions before readiness. Required plugins include
SCF 6.9.7+, Action Scheduler 4.2.0+, and MCP Adapter 0.7.1+; localized apps also
need Polylang 3.9+.

The native finalizer embeds the pinned Zero Rust crate with its `host` feature.
It runs source capture and `compile_sources` in process. The engine ships one
native runtime executable. Its compiler source revision also pins the CLI's
wasm and native assets. No private Git dependency is needed to build the runtime.

Keep `.zero-source/` and `.zero-compiled/` private. Reject author PHP and uploads
to reserved compiler output paths. Retain source hashes and compiler revision
with each immutable version. Mount that version's runtime and app before
WordPress bootstrap; never substitute the newest app during an old-version
request.

Archive uploaded `zero/migrations` SQL and snapshots as source metadata. Generate
executable migrations from the candidate schema and the host's trusted previous
compiled schema. Uploaded SQL must never select the baseline or execute during
initialization.

Versions in one environment share its latest forward schema. Bind media and
request origins to that Space. Preserve the original auth salt during a 0.8
migration so pending imported sessions can authenticate once and upgrade.

Unscoped cron and WP-CLI must load no app. Each scoped job needs the Space,
environment, and version before entering the same database and cache scope as
HTTP. Multisite, hosted Pages, and Atomic SQLite are outside this
hosting contract. Qualify MU-plugin ordering, persistent object-cache isolation,
auth-salt continuity, and action routing on the actual provider before rollout.

## Verify the compiler and migration

In the Zero repository, run the targeted host and data proofs:

```sh
cargo test --no-default-features --features host --test host_feature
cargo build --no-default-features --features host --target x86_64-unknown-linux-musl
cargo build --lib --no-default-features --profile wasm --target wasm32-unknown-unknown
node --test tests/wasm/host.test.mjs
ZERO_WP_PROJECT=zero-wp-spacefast ZERO_WP_PORT=8892 tests/wp/legacy/spacefast-run.sh
```

The host-feature test compares pantry capture against native `zero sources`
byte for byte. The WordPress/MariaDB proof covers cross-prefix copying,
dry-run and conflict rollback, repeat execution, scoped cookies, lazy session
upgrade, expiry, forgery rejection, and revocation. It uses disposable local
credentials intentionally tracked only for isolated test infrastructure. It does
not qualify a production provider or exchange a real Google authorization code.
