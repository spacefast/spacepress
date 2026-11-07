# App migration fixtures

`board`, `content`, and `refused` use the Zero 0.8 capsule API documented in
`spacefast/monorepo`'s `packages/zero/src/server.ts` and the CLI starter apps.
The board stores public string IDs over BIGINT UNSIGNED auto-increment SQL IDs.
Fields use TEXT, except numbers use DOUBLE. Timestamps are ISO strings,
booleans may be `true`/`false` or `1`/`0` text, and optional SQL NULL fields are
omitted in responses. The board entry uses module-level declarators and a class
helper; its MariaDB seed includes IDs near the JavaScript safe integer limit.

`zero-all-features/runtime-compiler-finalize-input.json` is the existing
monorepo e2e fixture, copied unchanged from commit
`802678a413` under `e2e-tests/fixtures/zero-all-features`. It contains compiled
endpoint sources and physical column renames, not capsule source. The app
migrator must refuse it rather than fabricate a capsule or rename its columns.

`tests/app_migrate.rs` owns CLI generation, dry runs and refusals.
`tests/wp/app-migrate/run.sh` owns existing MariaDB rows and action behavior.

`language` uses each JavaScript construct the v2 compiler accepts for live 0.8
apps (zero#138) from a handler, one `shared/<construct>.ts` per construct group.
`language_constructs_convert_and_build` converts and builds it; the exact
semantics are proven by `tests/differential/language`.
