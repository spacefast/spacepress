# Contributing to Zero

This is the developer's view of the repo: how the compiler works, how to run
the suites, and where things live. The [README](README.md) is the front page.

## Toolchain

Rust 1.96 (`rust-toolchain` pins it), PHP 8.2+ with `pdo_sqlite`, `mbstring`,
`gd` and `curl`, Node 22.18+, TypeScript 5.9 (`npm install --global
typescript@5.9.3`), and for the WordPress suites Docker plus `curl`, `rsync`
and `python3` on the host. `cargo build --release` produces
`target/release/zero`.

## How it works

1. **Parse.** [oxc](https://oxc.rs) parses `zero.config.ts` and the local `.ts`
   files it imports.
2. **Lower.** The syntax tree becomes Zero's own IR. Anything outside the
   supported subset (classes, `this`, `==` other than `== null`, `var`, npm
   imports, ...) fails the
   build with `file:line:col` and a suggested fix.
3. **Evaluate.** The config runs in a small, pure Rust evaluator: no I/O, no
   clock, a step budget. So composition works: helpers, factories, spreads, and
   shared field sets. The result is the schema as plain data.
4. **Compile.** Hooks and actions keep their captured scope. They're
   type-checked against the schema and compiled to PHP: native operators where
   the types make it safe, `Zero\Js` helpers where JavaScript and PHP differ,
   and a build error where neither is sound.
5. **Emit.** The output is SQLite and MySQL migrations (diffed against one
   committed snapshot), `schema.php`, `functions.php`, `zero.gen.ts` (types
   `db` in your editor), the typed client, and the PHP runtime: the database,
   the REST API, the hook pipeline, and the JS-semantics helpers.

The runtime under `runtime/` is embedded into the binary by `build.rs` and
written out by `zero build`: into `.zero/app/zero/runtime` for standalone, and
into the `zero-runtime`, `zero-identity` and `zero-app-<name>` plugins for
WordPress. `zero build` decides which files go where; new files under
`runtime/` are picked up without code changes.

## The commands

```
zero build [dir] [--target standalone|wp] [--out <dir>] [--quiet]
zero check [dir]                      compile for both targets; write nothing
zero dev [dir] [--port <n>]           build, then serve with `php -S` and a jobs worker
zero dev [dir] --wp [--port <n>]      build the plugins and boot them in a Docker WordPress (tests/wp)
zero doctor [dir] [--site <url> --token <t>]
zero users|tokens <args...> [--dir d] the standalone user and token CLI
zero jobs <list|run|retry|cancel|work> [--dir d]
zero sync [status|resolve <uid>] [dir] --site <url> <credential>
zero migrate config --from emdash|payload|sanity|zero <input> --out <new/zero.config.ts>
zero migrate site <content-model.php> [--dry-run]
```

`zero build` writes new migrations to `zero/migrations/{sqlite,wp}/`, the
typed client to `zero/client/`, `zero.gen.ts`, and the app to `.zero/app`
(standalone) or `.zero/wp-content` (WordPress: plugin folders, ZIPs, pinned
dependencies and one `zero-manifest.json`). `zero dev --wp` boots that
artifact with `tests/wp/harness.sh`; set `ZERO_WP_PROJECT` and `--port` to run
several stacks side by side, and stop one with `tests/wp/harness.sh down`.

## The blog tour

`examples/blog` is the full tour: field access, sync, members, media, jobs,
webhooks and translations, with a browser page. How to build and run it on
each target is in [`docs/examples.md`](docs/examples.md).

## Tests

```sh
cargo test                       # rejections, goldens, HTTP, Node↔PHP differential, generated client (needs tsc)
tests/php/run.sh                 # runtime: JS parity (checked against node) + DB/HTTP suites
tsc -p types/zero/tests          # the "zero" types catch real mistakes
tests/wp/run.sh                  # the runtime on real WordPress (Docker)
tests/system/run.sh              # examples/site end to end on WordPress and standalone
```

CI runs `cargo fmt --check`, `cargo clippy --locked --all-targets -- -D
warnings`, `cargo test --locked`, the PHP suites, `tsc` on the types and
examples, the client's Node tests, the WordPress suites, and a check that the
prefixed PHP dependencies regenerate byte-for-byte (see
[`docs/dependencies.md`](docs/dependencies.md)).

## Layout

| Path | What |
|---|---|
| `src/lower.rs` | oxc AST → IR, enforcing the subset |
| `src/loader.rs` | module graph and import rules |
| `src/eval.rs`, `src/value.rs` | the build-time evaluator |
| `src/extract.rs` | evaluated config → schema + functions to compile |
| `src/compile.rs`, `src/types.rs` | typed TS → PHP compiler |
| `src/migrate.rs` | snapshots and SQLite/MySQL migration planning |
| `src/schema_php.rs` | `schema.php` and `zero.gen.ts` |
| `src/client.rs` | `zero/client/types.ts` and `schema.ts` |
| `src/wp_plugins/` | plugin acquisition, checksums and the lock |
| `src/sync/` | the `zero sync` CLI |
| `src/config_migrate/` | `zero migrate config` importers |
| `runtime/Zero/` | the PHP runtime (both targets; `Wp/` only on WordPress) |
| `runtime/identity/` | the `zero-identity` plugin and its screens |
| `runtime/wp-plugin/` | the `zero-runtime` and `zero-app` plugin templates |
| `runtime/client/` | the handwritten half of the typed client |
| `types/zero/` | TypeScript declarations for `"zero"` |
| `examples/` | pantry, blog, site, wp-plugins |
| `tests/` | Rust, PHP, WordPress and system suites, fixtures |
| `docs/` | API, contracts, design documents |

## Licensing

Changes under `runtime/Zero`, `runtime/identity`, `runtime/wp-plugin` and
`runtime/bin` are GPL-2.0-or-later; everything else is MIT, and bundled
third-party code keeps its own license. [`LICENSE`](LICENSE) has the map.
Don't add a dependency to the runtime whose license is incompatible with
GPL-2.0-or-later, and don't copy GPL code into the MIT side.
