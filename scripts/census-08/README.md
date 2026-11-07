# Zero 0.8 production census

Measures how many live Zero 0.8 Spaces `zero migrate app --from zero-0.8` converts with no human
edit, and ranks why the rest are refused. [`docs/zero-08-parity.md`](../../docs/zero-08-parity.md#production-census-2026-11-07)
has the bar, the formula, the export query and the latest numbers.

- `census.mjs` runs one or more `zero` binaries over every Space and prints accepted, refused and
  not-recoverable counts with ranked reasons. `--json` writes the same summary; it has counts
  only.
- `reconstruct.mjs` rebuilds a capsule from a stored finalize payload: the server bundle becomes
  `server/index.ts` and each page becomes a stub.
- `classify.mjs` assigns each converter error a fixed reason and a kind: *refusal* (the original
  source would hit it too) or *source* (only the original source can settle it).

```sh
cargo build
node scripts/census-08/census.mjs --data <scratch-dir> --users \
  --zero base=<baseline>/zero --zero head=target/debug/zero --json summary.json
ZERO_BIN=target/debug/zero node --test scripts/census-08/census.test.mjs
```

`<scratch-dir>` holds customer data: one `<version_id>.json` per Space, and optionally
`sources/<version_id>/`, the original source, which is used only when every recorded SHA-256
matches. Keep it outside any repository and delete it when you are done. `--per-space` writes version
ids; keep that file with the data. TypeScript comes from a local install or the global one
(`npm install --global typescript@5.9.3`).
