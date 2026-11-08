# files-sdk as an end-to-end compatibility target

Date: 2026-11-07. Status: accepted.

## Context

The goal is that `npm install files-sdk` (3.1.2) plus an import in a Zero app
compiles the root `files-sdk` entry and `files-sdk/memory` to PHP, runs on
WordPress, and deploys. Six agents work on separate compiler areas. Without one
shared measurement, each agent sees only its own layer, and fixes in one layer
expose refusals in the next one that nobody tracks.

## Decision

1. `examples/files-sdk` is the shared measurement. It pins `files-sdk@3.1.2` in
   `package-lock.json` (registry tarball integrity) and records the tarball
   integrity, the upstream tag `files-sdk@3.1.2` (commit
   `fd304f1c38e71d184c13a6c317e19f270649fbae`) and the SHA-256 of every
   compiled entry file in `provenance.json`, in the same style as
   `examples/npm-compat`.
2. Two variants of the same probe app:
   - **dist**: the npm package as installed, Bun-bundled ESM under `dist/`.
     This is the primary target.
   - **raw-src**: `raw-src.mjs` fetches `packages/files-sdk` at the pinned
     commit from GitHub's tarball endpoint, checks its SHA-256, and installs
     it into a separate `node_modules` with every `exports` entry pointing at
     `./src/<entry>/index.ts`. Dependencies (`picomatch`, `safe-regex2`, …)
     are the same locked copies as the dist variant.
3. `table.mjs` runs `zero check --json` on both variants and prints one stable
   Markdown table: count per (code, message), sorted by count descending,
   then code, then message. Locations are left out so the table diffs cleanly
   between runs. `--json` writes the same data for machines.
4. `verify.mjs` is the differential test. It runs a fixed scenario list
   (upload, download, exists, head, list, delete, copy, `file()` handles,
   `FilesError` codes) under Node against the installed package, then through
   the generated PHP with the shipped runtime (`run-php.php`, like
   npm-compat), and compares the JSON output byte for byte. Values that depend
   on the clock (`lastModified`) are normalised by the scenario itself, in
   both runtimes, not by the comparer.
5. CI runs `verify.mjs --expect-red` in the `rust` job. While the probe does
   not compile, the step passes and prints the table. Once it compiles, the
   flag makes any mismatch fail, and the flag is removed in the PR that turns
   it green. The step never blocks other PRs while red.
6. The merged state of all open files-sdk branches is measured locally
   (`scripts/files-sdk-merged.sh`, never pushed) and posted as a comment on the
   harness PR, so each agent can see which refusals its layer uncovered.

## Ownership of the remaining gaps (agent 1)

Separate PRs, each off `origin/main`:

- CommonJS loader: static relative `require("./x")`, `module.exports = {…}`,
  `exports.x = …`. Dynamic `require` stays a located refusal.
- `Symbol` runtime (description, `Symbol.for`, well-known `iterator`,
  `asyncIterator`, `toStringTag`, `hasInstance`). Agent 5 owns the
  `unique symbol` type.
- `WeakMap` / `WeakSet` on PHP's native `WeakMap`.
- `globalThis` feature detection that can be resolved at compile time.
- The "this type" diagnostic.
- The PHP 8.3 bump, only if a PR needs it.

## Rejected

- Patching files-sdk sources to get a pass. The harness compiles the published
  bytes and checks their hashes.
- Comparing only "does it compile". A build that compiles but diverges from
  Node is worse than a refusal, so the end state is byte equality of outputs.
