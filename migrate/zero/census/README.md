# Zero 0.8 production census

Measures how many live Zero 0.8 Spaces `spacepress-migrate --from zero app` converts with no human
edit, and ranks why the rest are refused. [`migrate/docs/zero-08-parity.md`](../../migrate/docs/zero-08-parity.md#production-census-2026-11-07)
has the bar, the formula, the export query and the latest numbers.

- `census.mjs` runs one or more `spacepress` binaries over every Space and prints accepted, refused and
  not-recoverable counts with ranked reasons. `--json` writes the same summary; it has counts
  only.
- `reconstruct.mjs` rebuilds a capsule from a stored finalize payload: the server bundle becomes
  `server/index.ts` and each page becomes a stub.
- `usage.mjs` counts, for each 0.8 feature in `features.mjs`, the live Spaces that use it, their
  distinct teams, those teams minus internal ones, and Spaces with traffic in the last 30 days.
  It decides Support or Rewrite on v2 from `SUPPORT_THRESHOLD`. `extract.mjs` reads the facts
  each detector needs from a payload: the artifact, the server bundle and, where stored, `client.js`.
- `classify.mjs` assigns each converter error a fixed reason and a kind: *refusal* (the original
  source would hit it too) or *source* (only the original source can settle it).

```sh
cargo build
node migrate/zero/census/census.mjs --data <scratch-dir> --users \
  --zero base=<baseline>/sp --zero head=target/debug/spacepress-migrate --json summary.json
node migrate/zero/census/usage.mjs --data <scratch-dir> --json usage.json --markdown usage.md
SP_BIN=target/debug/spacepress-migrate node --test migrate/zero/census/census.test.mjs migrate/zero/census/usage.test.mjs
```

`<scratch-dir>` holds customer data: one `<version_id>.json` per Space (or under `out/`), the
usage files `meta.tsv`, `traffic-30d.tsv`, `parent-teams.tsv` and `internal-teams.tsv` (columns are listed at the top of
`usage.mjs`), and optionally
`sources/<version_id>/`, the original source, which is used only when every recorded SHA-256
matches. Keep it outside any repository and delete it when you are done. `--per-space` writes version
ids; keep that file with the data. TypeScript comes from a local install or the global one
(`npm install --global typescript@5.9.3`).
