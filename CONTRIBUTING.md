# Contributing to Zero

This is the developer's view of the repo: how the compiler works, how to run
the suites, and where things live. The [README](README.md) is the front page.

## Toolchain

Rust 1.96 (`rust-toolchain` pins it), PHP 8.2+ with `pdo_sqlite`, `mbstring`,
`gd`, `fileinfo`, `curl` and `zip` (the PHP suites boot WordPress in-process on
the SQLite Database Integration plugin, and `zero build` lints with `php -l`),
Node 22.18+,
TypeScript 5.9 (`npm install --global typescript@5.9.3`), and for anything
that boots WordPress: Docker with Compose, plus `bash` 4+, `python3`, `curl`,
`sha256sum` and `rsync` on the host. `cargo build --release` produces
`target/release/zero`.

## How it works

1. **Parse.** [oxc](https://oxc.rs) parses `zero.config.ts` and the local `.ts`
   files it imports.
2. **Lower.** The syntax tree becomes Zero's own IR. Anything outside the
   supported subset (classes, `this`, `==` other than `== null`, `var`, npm
   imports, ...) fails the build with `file:line:col` and a suggested fix.
3. **Evaluate.** The config runs in a small, pure Rust evaluator: no I/O, no
   clock, a step budget. So composition works: helpers, factories, spreads, and
   shared field sets. The result is the schema as plain data.
4. **Compile.** Hooks and actions keep their captured scope. They're
   type-checked against the schema and compiled to PHP: native operators where
   the types make it safe, `Zero\Js` helpers where JavaScript and PHP differ,
   and a build error where neither is sound.
5. **Emit.** The output is MySQL migrations (diffed against one committed
   snapshot), `schema.php`, `functions.php`, `zero.gen.ts` (types `db` in your
   editor), the typed client, and the PHP runtime: the database layer, the
   REST API, the hook pipeline, and the JS-semantics helpers.

The crate is a library plus the `zero` binary. The core (`loader`, `lower`, `eval`, `extract`,
`compile`, `migrate`, `client`, `schema_php`, tied together by `pipeline`) does no I/O of its own:
sources come through `loader::Fs` and the previous snapshot is a value. The `cli` feature (on by
default) adds `commands/`, `sync/`, `config_migrate/`, plugin downloads and the embedded runtime.
`src/wasm.rs` exports the core to the browser; `site/` builds it with
`cargo build --lib --no-default-features --profile wasm --target wasm32-unknown-unknown` and
serves it as the website's compiler (see [`site/README.md`](site/README.md)).

The runtime under `runtime/` is embedded into the binary by `build.rs` and
written out by `zero build` into the `zero-runtime`, `zero-identity` and
`zero-app-<name>` plugins. `zero build` decides which files go where; new
files under `runtime/` are picked up without code changes.

## The commands

```
zero build [dir] [--out <dir>] [--quiet]               write the plugins to .zero/wp-content
zero check [dir] [--json]                               compile; write nothing
zero dev [dir] [--port <n>]                             build, then boot the plugins in a Docker WordPress
zero doctor [dir] [--out <dir>] [--site <url> --token <t>]   check a build, and a running site
zero sync [status|resolve <uid>] [dir] --site <url> <credential>
zero migrate config --from emdash|payload|sanity|zero <input> --out <new/zero.config.ts>
zero migrate site <content-model.php> [--dry-run]
```

`zero build` writes new migrations to `zero/migrations/`, the typed client to
`zero/client/`, `zero.gen.ts` and `zero/wp-plugins.lock.json` (all committed),
and the artifact to `.zero/wp-content`: plugin folders, ZIPs, pinned
dependencies and one `zero-manifest.json`. `zero dev` boots that
artifact with the harness from `tests/wp`, which an installed binary carries
embedded; set `ZERO_WP_PROJECT` and `--port` to run several stacks side by
side, and stop one with the `harness.sh down` command it prints.

## The blog tour

`examples/blog` is the full tour: field access, sync, members, media, jobs,
webhooks and translations, with a browser page. How to build and run it is in
[`docs/examples.md`](docs/examples.md).

## Tests

```sh
cargo test                       # rejections, goldens, the examples on WordPress-on-SQLite, Node↔PHP differential, generated client (needs tsc)
tests/php/run.sh                 # runtime: JS parity (checked against node) + the suites on an in-process WordPress
tsc -p types/zero/tests          # the "zero" types catch real mistakes
tests/wp/run.sh                  # the runtime on real WordPress (Docker)
tests/system/run.sh              # examples/site end to end on WordPress
(cd site && pnpm check)          # the website: browser compiler ≡ zero check --json, page in Chromium
```

CI runs `cargo fmt --check`, `cargo clippy --locked --all-targets -- -D
warnings`, `cargo test --locked`, the PHP suites, `tsc` on the types and
examples, the client's Node tests, the WordPress suites, the identity
acceptance suite on two PHP versions, the admin screens' unit tests and a
rebuild that must match the committed bundle, and a check that the prefixed
PHP dependencies regenerate byte-for-byte (see
[`docs/dependencies.md`](docs/dependencies.md)).

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
owner against an existing harness receipt (`ZERO_WP_HARNESS` selects another
receipt). `ZERO_WP_PROJECT` and `ZERO_WP_PORT` isolate the Docker stack.
`ZERO_WP_SKIP_BROWSER=1` is an explicit opt-out for PHP-only iteration; missing
browser dependencies otherwise fail the lane. Screenshots and failure traces
are written below the system temporary directory, or `ZERO_ADMIN_BROWSER_OUTPUT`.
The committed admin bundle is rebuilt on Linux; CI checks it byte-for-byte.

## Layout

| Path | What |
|---|---|
| `src/lower.rs` | oxc AST → IR, enforcing the subset |
| `src/loader.rs` | module graph and import rules |
| `src/eval.rs`, `src/value.rs` | the build-time evaluator |
| `src/extract.rs` | evaluated config → schema + functions to compile |
| `src/compile.rs`, `src/types.rs` | typed TS → PHP compiler |
| `src/migrate.rs` | snapshots and migration planning |
| `src/schema_php.rs` | `schema.php` and `zero.gen.ts` |
| `src/client.rs` | `zero/client/types.ts` and `schema.ts` |
| `src/wp_plugins/` | plugin acquisition, checksums and the lock |
| `src/sync/` | the `zero sync` CLI |
| `src/config_migrate/` | `zero migrate config` importers |
| `runtime/Zero/` | the PHP runtime (`Wp/` is the WordPress binding) |
| `runtime/identity/` | the `zero-identity` plugin and its screens |
| `runtime/admin/` | the `zero-admin` plugin and its screens, emitted with `admin: true` |
| `runtime/wp-plugin/` | the `zero-runtime` and `zero-app` plugin templates |
| `runtime/client/` | the handwritten half of the typed client |
| `types/zero/` | TypeScript declarations for `"zero"` |
| `examples/` | pantry, blog, site, wp-plugins, reusable field recipes |
| `tests/` | Rust, PHP, WordPress and system suites, fixtures |
| `docs/` | API, contracts, design documents |

## Licensing

Changes under `runtime/Zero`, `runtime/identity`, `runtime/admin` and
`runtime/wp-plugin` are GPL-2.0-or-later; everything else
is MIT, and bundled third-party code keeps its own license. [`LICENSE`](LICENSE) has the map.
Don't add a dependency to the runtime whose license is incompatible with
GPL-2.0-or-later, and don't copy GPL code into the MIT side.
