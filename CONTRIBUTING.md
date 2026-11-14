# Contributing to First

This is the developer's view of the repo: how the compiler works, how to run
the suites, and where things live. The [README](README.md) is the front page.

## Toolchain

Rust 1.96 (`rust-toolchain` pins it), PHP 8.2+ with `pdo_sqlite`, `mbstring`,
`gd`, `fileinfo`, `curl` and `zip` (the PHP suites boot WordPress in-process on
the SQLite Database Integration plugin; `first build` also lints with `php -l`
when a host PHP executable is available),
Node 22.18+, npm, and TypeScript 5.9
(`npm install --global typescript@5.9.3`). `cargo build --release` produces
`target/release/first`.

`first dev` uses pinned WordPress Studio CLI 2.2.0 through npm and needs no
Docker or host PHP. It supplies WordPress 7.1.4, PHP 8.4 and SQLite Database
Integration 3.1.3. The host PHP requirements above are for the PHP suites.
The reference WordPress/MariaDB suites and the separate
showcase launcher still need Docker with Compose, plus `bash` 4+, `python3`,
`curl`, `sha256sum` and `rsync` on the host.

## How it works

1. **Parse.** [oxc](https://oxc.rs) parses `first.config.ts` and the local `.ts`
   and supported installed source packages it imports.
2. **Lower.** The syntax tree becomes First's own IR. Anything outside the
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
   the types make it safe, `First\Js` helpers where JavaScript and PHP differ,
   and a build error where neither is sound.
5. **Emit.** The output is MySQL migrations (diffed against one committed
   snapshot), `schema.php`, `functions.php`, `first/_generated/db.d.ts` (types `db` in your
   editor), the typed client, `first/_generated/openapi.json`, and the PHP runtime: the database
   layer, the REST API, the hook pipeline, and the JS-semantics helpers.

The crate is a library plus the `first` binary. The core (`loader`, `lower`, `eval`, `extract`,
`compile`, `migrate`, `client`, `schema_php`, tied together by `pipeline`) does no I/O of its own:
sources come through `loader::Fs` and the previous snapshot is a value. The `cli` feature (on by
default) adds `commands/`, `sync/`, `config_migrate/`, plugin downloads and the embedded runtime.
`src/wasm.rs` exports the core to the browser; `docs-site/` builds it with
`cargo build --lib --no-default-features --profile wasm --target wasm32-unknown-unknown` and
serves it as the docs site's playground compiler (see [`docs-site/README.md`](docs-site/README.md)).

`build.rs` also embeds the guides in `docs/` and the pages of `docs-site/docs/` for `first mcp`'s
`docs_search` and `docs_read`, so a documentation change needs a rebuild to show there. A new page in
`docs/` fails the build until it is added to `GUIDES` (embedded) or `NOT_GUIDES` (left out) in
`build.rs`. It embeds `skills/` the same way: each `skills/<name>/SKILL.md` is an agent skill in the layout of
[WordPress/agent-skills](https://github.com/WordPress/agent-skills), and `first init` writes them
into a project. Every command a skill names must exist: run it before you write it down. `tests/cli.rs`
checks the layout, that each `first <command>` is in the command table, that each linked page is
committed, and that the TypeScript in the skills compiles as one project.

The runtime under `runtime/` is embedded into the binary by `build.rs` and
written out by `first build` into the `first-runtime`, `first-identity` and
`first-app-<name>` plugins. `first build` decides which files go where; new
files under `runtime/` are picked up without code changes.

## The commands

`first help` prints every command, grouped. **Build** commands (`dev`, `build`,
`check`, `add`, `doctor`, `init`, `mcp`, `sync`, `abilities pull`, `migrate app|config`, `deploy`) run in the `first`
binary against the project's files (`abilities pull` reads a site's abilities
into the committed `first/_generated/abilities.json`). **Site** commands (`migrate`, `seed`,
`jobs`, `run`, `identity`, …) are implemented once, as `wp first <command>` in
the `first-runtime` plugin; `first <command>` forwards to it unchanged, and
`first wp <args>` forwards any WP-CLI command. `--site` picks the site: absent,
the project's dev site; a project directory; an offline deployment workspace;
or a WP-CLI `@alias`. Credentials come only from `FIRST_APP_PASSWORD` or
`FIRST_TOKEN`. The single command table is `runtime/First/Cli/commands.json`
(see `docs/decisions/2026-11-07-one-cli.md`); add a site command with one row
there and one PHP handler.

`first add <module> [dir]` writes an optional part of First into a project as files the author
owns (`src/commands/add.rs`). A module is one row in `MODULES` there plus its files under
`src/commands/add/<module>/`, which are embedded in the binary. `db` is the first one. See
`docs/decisions/2026-11-13-first-add.md` for the rules every module keeps.

`first build` writes new migrations to `first/_generated/migrations/`, the typed client to
`first/_generated/client/`, `first/_generated/db.d.ts`, `first/_generated/openapi.json`,
`first/_generated/wp-plugins.lock.json` and, with plugin
packages, `first/_generated/plugins.lock.json` (all committed; `--frozen` or `CI` refuses
plugin grants the lock doesn't hold),
and the artifact to `first/dist/wp-content`: plugin folders, ZIPs, pinned
dependencies and one `first-manifest.json`. `first dev` installs that artifact
into a persistent Studio site at `<project>/.first/dev/wordpress`, activates
its manifest plugins, and watches TypeScript, config and public files. It
preserves the database, uploads and unrelated plugins on rebuilds. Full
WordPress administration is available with the disposable local login
`admin` / `first-test-admin`.

Ctrl+C stops the foreground site without deleting its data. `--no-watch`
starts it and returns; `--detach` returns once the site is up and leaves the
watcher running in the background, logging to `.first/dev/dev.log`;
`first dev stop [dir]` stops either later. When the site is up, `first dev`
writes `.first/dev/state.json` (URL, port, the watcher's PID), which
`first dev status --json` and `first mcp` read without starting Studio. `--port` selects
a new site's port; an existing site retains its original port, printed at
startup. Different project directories have independent sites. Create API
credentials explicitly with WP-CLI:

```sh
first wp user application-password create admin first-local --porcelain
```

## The blog tour

`examples/blog` is the full tour: field access, sync, members, media, jobs,
webhooks and translations, with a browser page. How to build and run it is in
[`docs/examples.md`](docs/examples.md).

## Tests

```sh
cargo test                       # rejections, goldens, the examples on WordPress-on-SQLite, Node↔PHP differential, generated client (needs tsc)
node --test scripts/dev/studio.test.mjs scripts/dev/acceptance.test.mjs # local Studio workflow; build target/debug/first first
FIRST_DEPLOY_BIN="$PWD/target/debug/first" node --test scripts/deploy/artifact.test.mjs scripts/deploy/wordpress.test.mjs # offline preflight and recovery
tests/php/run.sh                 # runtime: JS parity (checked against node) + the suites on an in-process WordPress
tsc -p types/first/tests          # the "first" types catch real mistakes
tests/wp/run.sh                  # the runtime on real WordPress (Docker)
tests/system/run.sh              # examples/site end to end on WordPress
(cd docs-site && pnpm check)     # the docs site: generated pages current, browser compiler ≡ first check --json, pages in Chromium
```

CI runs `cargo fmt --check`, `cargo clippy --locked --all-targets -- -D
warnings`, `cargo test --locked`, the PHP suites, `tsc` on the types and
examples, the client's Node tests, the WordPress suites, the identity
acceptance suite on two PHP versions, the admin screens' unit tests and a
rebuild that must match the committed bundle, and a check that the prefixed
PHP dependencies regenerate byte-for-byte (see
[`docs/dependencies.md`](docs/dependencies.md)).

Dev uses `first build --preserve-data <snapshot.json>` to check the candidate
against its last applied schema before writing migrations. It also checks the
accepted migration history. To apply field removals, changed types or constraints,
or migration files built outside dev, stop the watcher, run `first build` and
inspect the SQL, then start once with `first dev --allow-destructive`. Later
watched saves are protected again. This is a development safeguard, not a
production backup or rollback mechanism. If the first Studio creation is
interrupted with a nonempty site directory, First refuses to adopt or delete it;
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
when included, the app, and finally First Admin. This setup is a prerequisite for
the browser proof: `first build` packages plugins but does not activate or configure
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
owner against an existing harness receipt (`FIRST_WP_HARNESS` selects another
receipt). `FIRST_WP_PROJECT` and `FIRST_WP_PORT` isolate the Docker stack.
`FIRST_WP_SKIP_BROWSER=1` is an explicit opt-out for PHP-only iteration; missing
browser dependencies otherwise fail the lane. Screenshots and failure traces
are written below the system temporary directory, or `FIRST_ADMIN_BROWSER_OUTPUT`.
The committed admin bundle is rebuilt on Linux; CI checks it byte-for-byte.

## Releases

The existing unsigned release workflow also builds the static musl Linux and
Windows compiler archives and `first.wasm` for Spacefast. It never publishes npm
packages. PRs and manual runs retain Actions artifacts. A maintainer-created
`v<Cargo version>` tag attaches the archives, wasm, and `compiler-assets.json`
to a GitHub release. The manifest records the exact Git revision and SHA-256 of
each asset. Every native archive retains its source revision, editor types,
Cargo lockfile, and original dependency license notices.

The `spacefast` npm release owns the platform packages and their versions.
Its `packages/cli/first-compiler.json` is the package-name and compiler pin
constant. Each platform package has the same exact npm version as `spacefast`,
which depends on it directly through `optionalDependencies`. The compiler's
Cargo version can differ from that npm version. Its Git source revision must
match both the downloaded manifest and each archive's `SOURCE.json`.
Changing that pin requires a Spacefast changeset. Users install `spacefast`
and run `sf first`; there is no `@spacefast/first-v2` wrapper.

The independent upstream `@spacefast/first-cli` scaffolding and acceptance
checks remain available. They are not dependencies of `spacefast`.

## Layout

| Path | What |
|---|---|
| `src/lower.rs` | oxc AST → IR, enforcing the subset |
| `src/loader.rs` | module graph and import rules |
| `src/eval.rs`, `src/value.rs` | the build-time evaluator |
| `src/extract.rs` | evaluated config → schema + functions to compile |
| `src/compile.rs`, `src/types.rs` | typed TS → PHP compiler |
| `src/migrate.rs` | snapshots and migration planning |
| `src/schema_php.rs` | `schema.php` and `first/_generated/db.d.ts` |
| `src/client.rs` | `first/_generated/client/types.ts` and `schema.ts` |
| `src/openapi.rs`, `src/json_schema.rs` | `first/_generated/openapi.json`, with the JSON Schemas the Abilities publish |
| `src/wp_plugins/` | plugin acquisition, checksums and the lock |
| `src/sync/` | the `first sync` CLI |
| `src/cli.rs`, `src/commands/site.rs` | the command table, and forwarding to WP-CLI |
| `src/config_migrate/` | `first migrate config` importers |
| `runtime/First/` | the PHP runtime (`Wp/` is the WordPress binding) |
| `runtime/identity/` | the `first-identity` plugin and its screens |
| `runtime/admin/` | the `first-admin` plugin and its screens, emitted with `admin: true` |
| `runtime/wp-plugin/` | the `first-runtime` and `first-app` plugin templates |
| `runtime/client/` | the handwritten half of the typed client |
| `types/first/` | TypeScript declarations for `"first"` |
| `examples/` | pantry, blog, site, wp-plugins, reusable field recipes |
| `tests/` | Rust, PHP, WordPress and system suites, fixtures |
| `docs/` | API, contracts, design documents |

## Licensing

Changes under `runtime/First`, `runtime/identity`, `runtime/admin` and
`runtime/wp-plugin` are GPL-2.0-or-later; everything else
is MIT, and bundled third-party code keeps its own license. [`LICENSE`](LICENSE) has the map.
Don't add a dependency to the runtime whose license is incompatible with
GPL-2.0-or-later, and don't copy GPL code into the MIT side.
