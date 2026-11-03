# App migration fixtures

`board`, `content`, and `refused` use the Zero 0.8 capsule API documented in
`spacefast/monorepo`'s `packages/zero/src/server.ts` and the CLI starter apps.
The board stores public string IDs over BIGINT UNSIGNED auto-increment SQL IDs.
Fields use TEXT, except numbers use DOUBLE. Timestamps are ISO strings,
booleans are `1`/`0` text, and optional SQL NULL fields are omitted in responses.

`zero-all-features/runtime-compiler-finalize-input.json` is the existing
monorepo e2e fixture, copied unchanged from commit
`802678a413` under `e2e-tests/fixtures/zero-all-features`. It contains compiled
endpoint sources and physical column renames, not capsule source. The app
migrator must refuse it rather than fabricate a capsule or rename its columns.

`tests/app_migrate.rs` owns CLI generation, dry runs and refusals.
`tests/wp/app-migrate/run.sh` owns existing MariaDB rows and action behavior.
