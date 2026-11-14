# Deploy First on Spacefast

Publish a project containing `first.config.ts` to run its collections, hooks,
actions and HTTP routes on Spacefast's WordPress runtime. Spacefast
compiles the source on the host and initializes the candidate before making it
ready. Each immutable version runs its own compiled code.

Generated REST endpoints, actions, [HTTP routes](config-api.md#http-routes)
and [live updates](#live-updates) work on the Space hostname, and so do the
pages and HTTP handlers under `first/app/` with the stylesheets and SVGs they
import. Static files in `public/` are published as they are.

## Publish an app

No released `spacefast` CLI captures a `first.config.ts` project yet. The
current release, 0.9.0, captures a project only when it has `zero.config.ts`,
and has no `sf first` commands; run the checks below with the `first` command.

1. Install the `spacefast` CLI and authenticate with `sf login`.
2. Check the project from its root:

   ```sh
   first check
   ```

3. Publish to your Space:

   ```sh
   sf publish --space spc_example
   ```

   The CLI captures `.first-source/app.first.json`, `vendor.first.json`, and
   `manifest.json`, then uploads those private bundles and the public assets.
   The app bundle carries `first/app/` pages and components with the
   stylesheets and SVGs they import. Capture, check, and source migration use
   the CLI's bundled WebAssembly compiler. Publishing does not need a native
   First executable.

4. Wait for the publish receipt to report readiness. Open its Space URL and
   check a page, a collection read, an action and any route before handing the
   app back.

The hosted MCP publish tool also accepts raw `first.config.ts`, relative `.ts`
modules, and `public/`. The host captures raw source when `.first-source/` is
absent. Host capture resolves relative imports and the `first` module.

If host capture reports `first_source_needs_local_capture`, an import needs
package resolution. Install the project's dependencies and publish with
`sf publish`. The CLI captures supported
installed package sources into the vendor bundle. The host never runs npm
install or JavaScript.

`compile-sources` also accepts the bundle the compiler wrote before the rename to
First, format `zero.source-bundle.v1` (`app.zero.json`, `vendor.zero.json`, sources
importing `"zero"`), which the `spacefast` CLI and `@spacefast/mcp` 0.9.0 still
upload. It compiles to the same tree as the app captured as First. A capture with
0.3.0-rendered TSX pages is refused; publish it again with a current client.
`src/zero_bundle.rs` holds all of it, to be deleted once no released client sends
that format.

Use `first build` to emit local WordPress plugins and `first dev` to run
WordPress Studio. See the [local development guide](../CONTRIBUTING.md#the-commands).

## Call a REST endpoint, action or route

Collections use `/__first/api/v1/<collection>`. An action named `hello` uses
`POST /__first/api/v1/actions/hello` on the Space hostname:

```sh
curl --fail-with-body 'https://your-space.example/__first/api/v1/actions/hello' \
	-H 'Content-Type: application/json' \
	--data '{"name":"Sam"}'
```

Use the action's declared input and access rule. A successful call returns
`{ "data": ... }`. The generated client in `first/_generated/client/` supplies
the same contracts. `/__spacefast/client.js` is Spacefast's own client, for
connectors, the Spacefast Share session and collaboration, not the app's (see
[Connectors](#connectors)).

A custom method and path, such as `GET /api/feed.json` or a
`POST /webhooks/stripe` that answers plain text, is a
[route](config-api.md#http-routes) in `first.config.ts`:

```sh
curl --fail-with-body 'https://your-space.example/api/feed.json'
```

Generated endpoints, actions and routes need no additional Spacefast route
setup.

## Live updates

Subscriptions work with no setup on Spacefast:

```ts
import { createClient } from "./first/_generated/client/index.ts";

createClient().todos.list({ where: { done: false } }).subscribe((todos) => render(todos));
```

Spacefast registers a Publisher that sends each commit's change notice to the
Space's realtime room. Spacefast loads the matching Cast transport on the
Space's pages, and it registers with every client on the page. Without a live
connection, subscriptions poll. See [Live updates](realtime.md) for the API.

## Connectors

A First app uses [Spacefast connectors](https://spacefast.com/docs/connectors)
like any other Space. Declare roles in the Spacefast config, `connectors` in
`sf.jsonc` or `spacefast.config.ts` beside `first.config.ts`, and call them from
the page. Spacefast answers `/__spacefast/connectors/<role>/<tool>` and
`/__spacefast/client.js` before WordPress runs, so no First route can take
those paths. A root catch-all leaves them alone on other hosts too.

```jsonc
// sf.jsonc
{ "connectors": { "crm": { "connector": "hubspot", "tools": ["list_deals"] } } }
```

`sf client` writes the typed `spacefast.generated.ts` at the project root, for a
frontend you build yourself:

```ts
import { space } from "./spacefast.generated";

const deals = await space.connectors.crm.list_deals({ stage: "won" });
```

A page without a build imports `space` from `/__spacefast/client.js`. A
`"use client"` component under `first/app/` can't import packages, so it calls
the route itself:

```tsx
"use client";
import { useState } from "first/client";

export function Deals() {
  const [deals, setDeals] = useState("");
  const load = async () => {
    const response = await window.fetch("/__spacefast/connectors/crm/list_deals");
    const answer = await response.json();
    setDeals(answer.state === "ok" ? JSON.stringify(answer.data) : answer.message);
  };
  return <button onClick={load}>Load deals {deals}</button>;
}
```

Server code can't call connectors on First yet: there is no connector API in
`first`, and actions, hooks and routes can't reach a role.

## Migrate an existing 0.8 Space

To move an existing Space from an earlier Zero, follow
[Migrate a Spacefast app](migrating-from-zero.md#migrate-a-spacefast-app).

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

The native finalizer embeds the pinned First Rust crate with its `host` feature.
It runs source capture and `compile_sources` in process. The engine ships one
native runtime executable. Its compiler source revision also pins the CLI's
wasm and native assets. No private Git dependency is needed to build the runtime.

Keep `.first-source/` and `.first-compiled/` private. Reject author PHP and uploads
to reserved compiler output paths. Retain source hashes and compiler revision
with each immutable version. Mount that version's runtime and app before
WordPress bootstrap; never substitute the newest app during an old-version
request.

Archive uploaded `first/_generated/migrations` SQL and snapshots as source metadata. Generate
executable migrations from the candidate schema and the host's trusted previous
compiled schema. Uploaded SQL must never select the baseline or execute during
initialization.

Versions in one environment share its latest forward schema. Bind media and
request origins to that Space. The [migration guide](migrating-from-zero.md#retire-imported-spacefast-sessions)
lists the extra rules for Spaces moved from an earlier Zero.

The app's `first/app/` pages (`pagePaths` in the manifest) and routes (`routes`)
are WordPress front-controller requests on the Space hostname, so send those
paths to WordPress rather than answering 404 at the edge. The stylesheets and
SVGs they import are static files of the version, under the app plugin's
`first/app/assets/`, named by a hash of their bytes: serve them with a long
cache lifetime. A bundle captured for the old pages renderer (`pages/`,
`first/pages.json`) is refused.

Unscoped cron and WP-CLI must load no app. Each scoped job needs the Space,
environment, and version before entering the same database and cache scope as
HTTP. Multisite, hosted Pages, and Atomic SQLite are outside this
publish contract. Qualify MU-plugin ordering, persistent object-cache isolation,
auth-salt continuity, and action routing on the actual provider before rollout.

## Verify the compiler and migration

In the First repository, run the targeted host and data proofs:

```sh
cargo test --no-default-features --features host --test host_feature
cargo build --no-default-features --features host --target x86_64-unknown-linux-musl
cargo build --lib --no-default-features --profile wasm --target wasm32-unknown-unknown
node --test tests/wasm/host.test.mjs
FIRST_WP_PROJECT=first-wp-pages FIRST_WP_PORT=8873 tests/wp/hosted-pages-run.sh
FIRST_WP_PROJECT=first-wp-spacefast FIRST_WP_PORT=8892 tests/wp/legacy/spacefast-run.sh
```

The host-feature and wasm tests compare pantry and `examples/full-site` capture
against native `first sources` byte for byte. The hosted-pages lane installs only
`compile-sources` output on real WordPress/MariaDB. It serves the pages, hydrates
the island in Chromium, calls the action, and calls both routes. The
cross-prefix lane is described in the [migration guide](migrating-from-zero.md#copy-data-under-the-hosts-migration-lock).
Both lanes use disposable local
credentials intentionally tracked only for isolated test infrastructure. It does
not qualify a production provider or exchange a real Google authorization code.
