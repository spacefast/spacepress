# A Zero v2 0.3.0 app, as deployed hosts hold it

The First compiler at commit `61c22fc2` (0.3.0, before the rename to First) produced these files.
Released clients that predate the rename (the `spacefast` CLI and `@spacefast/mcp` 0.9.0) upload
`sources/`; hosts that compiled them keep `compiled/`. Tests read them as frozen data.

- `app/`: the project (`zero.config.ts`, a relative helper, and its ledger after `zero build`).
- `sources/`: `zero sources app --out sources` (format `zero.source-bundle.v1`).
- `compiled/`: `snapshot.json`, `manifest.json` and `migrations/` from
  `zero compile-sources sources compiled sources` (the plugin trees are left out).

Regenerate from a detached checkout of `61c22fc2`: `cargo build --bin zero`, then run the two
commands above from this directory with that binary. Do not edit these files by hand.
