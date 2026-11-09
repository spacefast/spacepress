# files-sdk end-to-end probe

Compile the published `files-sdk` 3.1.2 (root entry and `files-sdk/memory`) to
PHP, run it, and compare with Node running the same package. The decision
record is [`docs/decisions/2026-11-07-files-sdk-harness.md`](../../docs/decisions/2026-11-07-files-sdk-harness.md).

```sh
cd examples/files-sdk
npm ci --ignore-scripts --no-audit --no-fund
FIRST_BIN=/absolute/path/to/first node table.mjs     # diagnostic table, both variants
FIRST_BIN=/absolute/path/to/first node verify.mjs    # table, then Node vs PHP per action
```

## Variants

| Variant | What compiles | Built by |
| --- | --- | --- |
| dist | `node_modules/files-sdk/dist`, the Bun-bundled ESM npm ships | `npm ci` |
| raw | `packages/files-sdk/src` at tag `files-sdk@3.1.2` (`fd304f1c`), every export pointed at `./src/<entry>/index.ts` | `node raw-src.mjs` → `.work/raw/app` |

Both use the same `app/` and the same locked dependencies (`picomatch`,
`safe-regex2`, `ret`). `raw-src.mjs` downloads the GitHub tarball once into
`.work/` and refuses it if its SHA-256 differs from `provenance.json`. Set
`FILES_SDK_SRC_TARBALL=/path/to.tgz` to use a copy you already have.

## Files

| File | Purpose |
| --- | --- |
| `app/first.config.ts` | `probe` (the baseline action from the brief) plus one action per scenario |
| `app/scenarios.mjs` | upload/download/exists/head/list/delete/copy, `file()` handles, `FilesError` codes. Node imports it directly; First compiles it |
| `table.mjs` | `first check --json` on both variants, counted by code and message, as a Markdown table (`--json` for raw data) |
| `verify.mjs` | checks installed hashes, prints the table, then runs each action under Node and through `run-php.php` and compares the JSON strings byte for byte |
| `run-php.php` | loads the generated runtime and calls one action handler; no WordPress, database or network |
| `probes.mjs` | one small app per host API (Symbol, Promise, streams, Blob, …), in typed TS and imported JS; `table.mjs --probes` adds it as a second section |
| `sources.mjs` | the files the dist probe reaches (static imports and relative `require`) |
| `provenance.mjs` / `provenance.json` | registry integrity, the upstream tag, commit and tarball hash, and SHA-256 of every reached file |

Clock-dependent fields (`lastModified`) are reported as their type by the
scenarios, in both runtimes, so the comparison itself stays exact.

## CI

The `rust` job runs `verify.mjs --expect-red`. While the dist probe has
diagnostics, or an action differs from Node, the step prints the state and a
warning annotation and exits 0. The PR that makes every action match removes
`--expect-red`, after which a regression fails CI.

## Merged state

`scripts/files-sdk-merged.sh` merges every pushed `origin/` branch of the
files-sdk effort, with or without a PR, into a local scratch worktree (never
pushed), oldest commit first. It builds the compiler and prints both tables,
then lists the merged branches and each conflicting branch with its files. The
harness PR carries the latest run as a comment.
