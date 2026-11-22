# Contributing to TypedPress

This is the developer's view of the repo: how the compiler works, how to run
the suites, and where things live. The [README](README.md) is the front page.

## Toolchain

Rust 1.97 (`rust-toolchain` pins it), PHP 8.2+ with `pdo_sqlite`, `mbstring`,
`gd`, `fileinfo`, `curl` and `zip` (the PHP suites boot WordPress in-process on
the SQLite Database Integration plugin; `typedpress build` also lints with `php -l`
when a host PHP executable is available),
Node 22.18+, npm, and TypeScript 5.9
(`npm install --global typescript@5.9.3`). `cargo build --release` produces
`target/release/typedpress`, stripped of debug symbols (`[profile.release]` in `Cargo.toml`).

`typedpress dev` uses pinned WordPress Studio CLI 2.2.0 through npm and needs no
Docker or host PHP. It selects the stable WordPress update offered from the 7.1 floor,
then pins that version for the site, with PHP 8.4 and SQLite Database
Integration 3.1.3. The host PHP requirements above are for the PHP suites.
The reference WordPress/MariaDB suites and the separate
showcase launcher still need Docker with Compose, plus `bash` 4+, `python3`,
`curl`, `sha256sum` and `rsync` on the host.

## How it works

1. **Parse.** [oxc](https://oxc.rs) parses `typedpress.config.ts` and the local `.ts`
   and supported installed source packages it imports.
2. **Lower.** The syntax tree becomes TypedPress's own IR. Anything outside the
   supported subset (abstract/generic classes, dynamic `require`, Node host APIs,
   ...) fails the build with `file:line:col` and a suggested fix.
   Installed JavaScript uses checked PHP operations; authored TypeScript keeps
   static checking. CommonJS is limited to static top-level `require` and
   `module.exports`/`exports.name` assignments, which run once at build time.
3. **Evaluate.** The config runs in a small, pure Rust evaluator: no I/O, no
   clock, a step budget. So composition works: helpers, factories, spreads, and
   shared field sets. The result is the schema as plain data.
4. **Compile.** Hooks and actions keep their captured scope. They're
   type-checked against the schema and compiled to PHP: native operators where
   the types make it safe, `TypedPress\Js` helpers where JavaScript and PHP differ,
   and a build error where neither is sound.
5. **Emit.** The output is MySQL migrations (diffed against one committed
   snapshot), `schema.php`, `functions.php`, `tp/_generated/db.d.ts` (types `db` in your
   editor), the typed client, `tp/_generated/openapi.json`, and the PHP runtime: the database
   layer, the REST API, the hook pipeline, and the JS-semantics helpers.

The crate is a library plus the `typedpress` binary. The core (`loader`, `lower`, `eval`, `extract`,
`compile`, `migrate`, `client`, `schema_php`, tied together by `pipeline`) does no I/O of its own:
sources come through `loader::Fs` and the previous snapshot is a value. The `cli` feature (on by
default) adds `commands/`, `sync/`, `config_migrate/`, plugin downloads and the embedded runtime.
`src/wasm.rs` exports the core to the browser; `www/` builds it with
`cargo build --lib --no-default-features --profile wasm --target wasm32-unknown-unknown` and
serves it as the website's playground compiler (see [`www/README.md`](www/README.md)).

`build.rs` also embeds the documentation pages under `www/content/docs/` for `typedpress mcp`'s
`docs_search` and `docs_read`, so a documentation change needs a rebuild to show there.
It embeds `skills/` the same way: each `skills/<name>/SKILL.md` is an agent skill in the layout of
[WordPress/agent-skills](https://github.com/WordPress/agent-skills), and `typedpress init` writes them
into a project. Every command a skill names must exist: run it before you write it down. `tests/cli.rs`
checks the layout, that each `typedpress <command>` is in the command table, that each linked page is
committed, and that the TypeScript in the skills compiles as one project.

The runtime under `runtime/` is embedded into the binary by `build.rs` and
written out by `typedpress build` into the `typedpress-runtime`, `typedpress-identity` and
`typedpress-app-<name>` plugins. `typedpress build` decides which files go where; new
files under `runtime/` are picked up without code changes.

## The commands

`typedpress help` prints every command, grouped. **Build** commands (`dev`, `build`,
`check`, `add`, `doctor`, `init`, `mcp`, `sync`, `abilities pull`, `styles pull`, `migrate app|config`, `deploy`) run in the `typedpress`
binary against the project's files (`abilities pull` reads a site's abilities
into the committed `tp/_generated/abilities.json`; `styles pull` reads a site's Global Styles
into `tp/theme.json`). **Site** commands (`migrate`, `seed`,
`jobs`, `run`, `identity`, …) are implemented once, as `wp typedpress <command>` in
the `typedpress-runtime` plugin; `typedpress <command>` forwards to it unchanged, and
`typedpress wp <args>` forwards any WP-CLI command. `--site` picks the site: absent,
the project's dev site; a project directory; an offline deployment workspace;
or a WP-CLI `@alias`. Credentials come only from `TP_APP_PASSWORD` or
`TP_TOKEN`. The single command table is `runtime/TypedPress/Cli/commands.json`
(see `docs/decisions/2026-11-07-one-cli.md`); add a site command with one row
there and one PHP handler.

`typedpress add <module> [dir]` writes an optional part of TypedPress into a project as files the author
owns (`src/commands/add.rs`). A module is one row in `MODULES` there plus its files under
`src/commands/add/<module>/`, which are embedded in the binary. `db` is the first one. See
`docs/decisions/2026-11-13-first-add.md` for the rules every module keeps.

`typedpress build` writes new migrations to `tp/_generated/migrations/`, the typed client to
`tp/_generated/client/`, `tp/_generated/db.d.ts`, `tp/_generated/openapi.json`,
`tp/_generated/wp-plugins.lock.json` and, with plugin
packages, `tp/_generated/plugins.lock.json` (all committed; `--frozen` or `CI` refuses
plugin grants the lock doesn't hold),
and the artifact to `tp/dist/wp-content`: plugin folders, ZIPs, pinned
dependencies and one `typedpress-manifest.json`. `typedpress dev` installs that artifact
into a persistent Studio site at `<project>/.tp/dev/wordpress`, activates
its manifest plugins, and watches TypeScript, config and public files. It
preserves the database, uploads and unrelated plugins on rebuilds. Full
WordPress administration is available with the disposable local login
`admin` / `typedpress-test-admin`.

Ctrl+C stops the foreground site without deleting its data. `--no-watch`
starts it and returns; `--detach` returns once the site is up and leaves the
watcher running in the background, logging to `.tp/dev/dev.log`;
`typedpress dev stop [dir]` stops either later. When the site is up, `typedpress dev`
writes `.tp/dev/state.json` (URL, port, the watcher's PID), which
`typedpress dev status --json` and `typedpress mcp` read without starting Studio. `--port` selects
a new site's port; an existing site retains its original port, printed at
startup. Different project directories have independent sites. Create API
credentials explicitly with WP-CLI:

```sh
typedpress wp user application-password create admin typedpress-local --porcelain
```

## The blog tour

`examples/blog` is the full tour: field access, sync, members, media, jobs,
webhooks and translations, with a browser page. How to build and run it is in
[`docs/examples.md`](docs/examples.md).

## Tests

```sh
cargo test                       # rejections, goldens, the examples on WordPress-on-SQLite, Node↔PHP differential, generated client (needs tsc)
node --test scripts/dev/studio.test.mjs scripts/dev/acceptance.test.mjs # local Studio workflow; build target/debug/typedpress first
TP_DEPLOY_BIN="$PWD/target/debug/typedpress" node --test scripts/deploy/artifact.test.mjs scripts/deploy/wordpress.test.mjs # offline preflight and recovery
tests/php/run.sh                 # runtime: JS parity (checked against node) + the suites on an in-process WordPress
tsc -p types/typedpress/tests          # the "typedpress" types catch real mistakes
tests/wp/run.sh                  # the runtime on real WordPress (Docker)
tests/system/run.sh              # examples/site end to end on WordPress
(cd www && npm run wasm && npm run showcase && bun run build && ../target/release/typedpress check .) # the website & browser compiler
```

CI runs `cargo fmt --check`, `cargo clippy --locked --all-targets -- -D
warnings`, `cargo test --locked`, the PHP suites, `tsc` on the types and
examples, the client's Node tests, the WordPress suites, the identity
acceptance suite on two PHP versions, the admin screens' unit tests and a
rebuild that must match the committed bundle, and a check that the prefixed
PHP dependencies regenerate byte-for-byte (see
[`docs/dependencies.md`](docs/dependencies.md)).

### Kept sources: a PR that changes what the authoring surface accepts

Two suites hold source that hosts keep and compile again later. A PR that changes what
`typedpress.config.ts` and `tp/` accept runs both:

- `cargo test --test zero_bundle`: source bundles the 0.3.0 compiler captured (before the rename to
  TypedPress). They must keep compiling as 0.3.0 served them, with no new migration. Only
  `src/zero_bundle.rs` reads their old forms.
- `cargo test --test tp_sources`: TypedPress source bundles captured at chosen commits
  ([`tests/fixtures/typedpress-sources/`](tests/fixtures/typedpress-sources/README.md)). Each compiles with the
  current compiler, plans exactly its committed plan against its own baseline, loses no data, and
  stores what it stored when captured. Until the first release is tagged, a PR that deliberately
  changes an authoring form recaptures them (`tests/fixtures/typedpress-sources/capture.sh head`) and adds a
  row to the README's table of breaks. From the first release on, a release's captures are never
  recaptured: a release may not refuse source an earlier release accepted.

Dev uses `typedpress build --preserve-data <snapshot.json>` to check the candidate
against its last applied schema before writing migrations. It also checks the
accepted migration history. To apply field removals, changed types or constraints,
or migration files built outside dev, stop the watcher, run `typedpress build` and
inspect the SQL, then start once with `typedpress dev --allow-destructive`. Later
watched saves are protected again. This is a development safeguard, not a
production backup or rollback mechanism. If the first Studio creation is
interrupted with a nonempty site directory, TypedPress refuses to adopt or delete it;
inspect the reported directory and its Studio registration before retrying.

Compiler diagnostic codes and compatibility claims are linked to executable
fixtures in `tests/compatibility/registry.json`. Run
`python3 scripts/compiler-contracts.py` when changing it; the contract suite
checks generated documentation with `--check` and runs the refusal fixtures.
See [compiler diagnostics](docs/compiler-diagnostics.md) and the
[research adoption decisions](docs/research-adoption.md) for the implementation
boundaries and source provenance.

The WordPress lane builds its disposable app from fresh source so stale ignored
migrations cannot contaminate a fresh database's migration ledger. It stages the
generated client at the test import path and the plugins in a stable bind-mount
directory; existing fixture migration output is left alone.

The admin browser journey is part of `tests/wp/run.sh` and runs against the
shipped plugin on the same disposable stack, then checks mounting under `/blog`.
The harness explicitly activates manifest dependencies, the runtime, identity
when included, the app, and finally TypedPress Admin. This setup is a prerequisite for
the browser proof: `typedpress build` packages plugins but does not activate or configure
them on a site. For a site installation, follow the generated manifest and the
[admin installation steps](runtime/admin/readme.txt), preserving existing plugin
settings and completing each plugin's own setup.

Install its browser once before running the lane:

```sh
cd runtime/admin/apps
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm typecheck
pnpm test --runInBand
pnpm build
```

From the repository root, `tests/wp/admin/browser-run.sh` reruns only the browser
owner against an existing harness receipt (`TP_WP_HARNESS` selects another
receipt). `TP_WP_PROJECT` and `TP_WP_PORT` isolate the Docker stack.
`TP_WP_SKIP_BROWSER=1` is an explicit opt-out for PHP-only iteration; missing
browser dependencies otherwise fail the lane. Screenshots and failure traces
go to a fresh `typedpress-admin-browser/run-*` folder (`subdirectory-*` for the
subdirectory lane) below the system temporary directory, printed at the start
of the run, or to `TP_ADMIN_BROWSER_OUTPUT`.
The committed admin bundle is rebuilt on Linux; CI checks it byte-for-byte.

`tests/wp/coediting/run.sh` runs the separate Gutenberg 24.4.1 collaboration
fixture after building the compiler and admin bundle. It creates a new local
WordPress/MariaDB stack and retains its database, audit history, and ownership
receipt. `TP_COEDITING_COMPILER` selects a compiler outside `target/debug`.
The journey pauses both users' sync requests, edits the same paragraph in both
sessions, then checks merging before save, typed fields, presence, persisted
content, hooks, revisions, and rejoining. `tests/php/run.sh coediting` checks
the server's access boundaries against the real pinned Gutenberg plugin.

## Releases

The repository publishes four npm packages:

| Package | Directory | Version | What |
|---|---|---|---|
| `typedpress` | `packages/cli` | the Cargo version | the command; downloads the matching prebuilt compiler |
| `create-typedpress` | `packages/create-typedpress` | the Cargo version | `npm create typedpress` |
| `@typedpress/astro` | `packages/astro` | its own | the Astro content loaders |
| `@typedpress/blocks` | `packages/blocks` | its own | TSX for Gutenberg content and block themes |

`typedpress` and `create-typedpress` share the compiler's version: root `Cargo.toml` and both
manifests must agree (`node scripts/release/version.mjs` checks them). The adapters are
versioned independently.

[`.github/workflows/release.yml`](.github/workflows/release.yml) runs on PRs that touch the
release tooling, on a manual dispatch, and on a pushed `v<Cargo version>` tag. It builds seven
native compiler archives (`typedpress-v<version>-<rust target>.tar.gz`, each with a `.sha256`)
and `typedpress.wasm`, packs all four npm packages and checks each tarball's file list
(`scripts/release/pack-check.mjs`: required files present, no tests, fixtures, environment
files or keys), installs the packed `typedpress` from a local copy of the release assets,
and runs the packed starter end to end on WordPress. Every archive carries its source
revision, editor types, `Cargo.lock`, both license texts and every upstream notice.

PRs and manual runs keep everything as an Actions artifact. A tag also attaches the archives,
checksums, wasm, `compiler-assets.json` (the revision and SHA-256 of each asset), the exact
source archive and the four npm tarballs to a GitHub release. The workflow never publishes
to npm: a maintainer publishes the reviewed tarballs from that release, `typedpress` first.
The [installation guide](docs/installation.md#maintainer-release-steps) has the steps.

## Layout

| Path | What |
|---|---|
| `src/lower.rs` | oxc AST → IR, enforcing the subset |
| `src/loader.rs` | module graph and import rules |
| `src/eval.rs`, `src/value.rs` | the build-time evaluator |
| `src/extract.rs` | evaluated config → schema + functions to compile |
| `src/compile.rs`, `src/types.rs` | typed TS → PHP compiler |
| `src/migrate.rs` | snapshots and migration planning |
| `src/schema_php.rs` | `schema.php` and `tp/_generated/db.d.ts` |
| `src/client.rs` | `tp/_generated/client/types.ts` and `schema.ts` |
| `src/openapi.rs`, `src/json_schema.rs` | `tp/_generated/openapi.json`, with the JSON Schemas the Abilities publish |
| `src/wp_plugins/` | plugin acquisition, checksums and the lock |
| `src/sync/` | the `typedpress sync` CLI |
| `src/cli.rs`, `src/commands/site.rs` | the command table, and forwarding to WP-CLI |
| `src/config_migrate/` | `typedpress migrate config` importers |
| `runtime/TypedPress/` | the PHP runtime (`Wp/` is the WordPress binding) |
| `runtime/identity/` | the `typedpress-identity` plugin and its screens |
| `runtime/admin/` | the `typedpress-admin` plugin and its screens, emitted unless `admin: false` |
| `runtime/wp-plugin/` | the `typedpress-runtime` and `typedpress-app` plugin templates |
| `runtime/client/` | the handwritten half of the typed client |
| `types/typedpress/` | TypeScript declarations for `"typedpress"` |
| `examples/` | pantry, blog, site, wp-plugins, reusable field recipes |
| `tests/` | Rust, PHP, WordPress and system suites, fixtures |
| `packages/` | the npm packages (see [Releases](#releases)) |
| `www/` | the SpacePress website and documentation (`www/content/docs/`), itself a SpacePress app |

## Licensing

Changes under `runtime/TypedPress`, `runtime/identity`, `runtime/admin` and
`runtime/wp-plugin` are GPL-2.0-or-later; everything else
is MIT, and bundled third-party code keeps its own license. [`LICENSING.md`](LICENSING.md) has the map.
Don't add a dependency to the runtime whose license is incompatible with
GPL-2.0-or-later, and don't copy GPL code into the MIT side.

Use the Node version in `.node-version` for verification. The differential sort
tests compare the runtime with that V8 version, including comparator call order;
updating Node requires checking that oracle explicitly. 22.23.4 is the floor Astro 7.4
sets (`packages/astro`), and ships the same V8 (12.4.254.21) as 22.22.3.
