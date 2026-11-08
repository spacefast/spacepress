# Deploy Zero on Spacefast

Publish a project containing `zero.config.ts` to run its collections, hooks,
actions and HTTP routes on Spacefast's WordPress runtime. Spacefast
compiles the source on the host and initializes the candidate before making it
ready. Each immutable version runs its own compiled code.

Generated REST endpoints, actions, [HTTP routes](config-api.md#http-routes)
and [live updates](#live-updates) work on the Space hostname. TSX pages are not
hosted yet: keep your frontend in public assets or publish it separately.
Static files in `public/` are published as they are.

## Publish an app

1. Install the `spacefast` CLI and authenticate with `sf login`.
2. Check the project from its root:

   ```sh
   sf zero check
   ```

   If the project has `pages/`, render them locally first and commit the
   result:

   ```sh
   sf zero build
   npx @spacefast/zero-pages build
   ```

   `zero-pages build` writes `zero/pages.json`, the render artifact. The host
   cannot run page modules, so it builds the pages plugin from this file.

3. Publish to your Space:

   ```sh
   sf publish --space spc_example
   ```

   The CLI captures `.zero-source/app.zero.json`, `vendor.zero.json`, and
   `manifest.json`, then uploads those private bundles and the public assets.
   The app bundle carries `zero/pages.json` and the page sources it was
   rendered from. Capture, check, and source migration use the CLI's bundled
   WebAssembly compiler. Publishing does not need a native Zero executable.

   Capture refuses a stale render with `zero_source_needs_local_capture`, for
   example after a page or `zero.config.ts` changed. Run `zero-pages build`
   again and publish.

4. Wait for the publish receipt to report readiness. Open its Space URL and
   check a page, a collection read, an action and any route before handing the
   app back.

The hosted MCP publish tool also accepts raw `zero.config.ts`, relative `.ts`
modules, and `public/`. The host captures raw source when `.zero-source/` is
absent. Host capture resolves relative imports and the `zero` module.

If host capture reports `zero_source_needs_local_capture`, the project needs a
local step. Either an import needs package resolution, or `pages/` has no
current render. Install the project's dependencies, run `zero-pages build` when
the project has pages, and publish with `sf publish`. The CLI captures supported
installed package sources into the vendor bundle. The host never runs npm
install or JavaScript.

Use `sf zero build` to emit local WordPress plugins and `sf zero dev` to run
WordPress Studio. These two commands use the native optional platform package
shipped with the CLI. See the [local development guide](../CONTRIBUTING.md#the-commands).

## Call a REST endpoint, action or route

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

A custom method and path, such as `GET /api/feed.json` or a
`POST /webhooks/stripe` that answers plain text, is a
[route](config-api.md#http-routes) in `zero.config.ts`:

```sh
curl --fail-with-body 'https://your-space.example/api/feed.json'
```

Generated endpoints, actions and routes need no additional Spacefast route
setup.

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
request origins to that Space.

A compiled version with `"pages": "zero-pages-<app>"` in its manifest ships a
third plugin beside `zero-runtime` and `zero-app-<app>`. Mount it after the app,
from the same version: `plugins/zero-pages-<app>/zero-pages-<app>.php` under
`.zero-compiled/`. Its URLs (pages and their `assets/`) and the app's routes
are WordPress front-controller requests on the Space hostname, so send unknown
paths to WordPress rather than answering 404 at the edge. Serve the plugin's
`assets/` directory as static files of that version.

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
ZERO_WP_PROJECT=zero-wp-pages ZERO_WP_PORT=8873 tests/wp/hosted-pages-run.sh
```

The host-feature and wasm tests compare pantry and `examples/full-site` capture
against native `zero sources` byte for byte. The hosted-pages lane installs only
`compile-sources` output on real WordPress/MariaDB. It serves the pages, hydrates
the island in Chromium, calls the action, and calls both routes. It uses
disposable local credentials tracked only for isolated test infrastructure. It does
not qualify a production provider or exchange a real Google authorization code.
