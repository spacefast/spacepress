# Kept TypedPress sources

A host that serves a TypedPress app keeps the source bundle it compiled (`typedpress sources`, format
`typedpress.source-bundle.v1`) so it can compile it again: to roll back, to rebuild with a newer TypedPress, or
after a restore. `tests/tp_sources.rs` checks that the current compiler still accepts every
bundle here, and that recompiling one against the baseline it was compiled to plans exactly its
committed `plan.json` (normally empty), loses no data, and stores what it stored when it was
captured.

## Layout

```
<label>/<example>/sources/    what `typedpress sources examples/<example>` wrote
<label>/<example>/baseline/   snapshot.json, migrations/ and storage.json from
                              `typedpress compile-sources sources <out> sources`
<label>/<example>/plan.json   migration files a recompile against baseline/ adds: [] normally
```

Labels:

| label | captured at | how |
|---|---|---|
| `head` | the commit that replaced `action()` with `query()` and `mutation()` (2026-11-17) | `tests/fixtures/typedpress-sources/capture.sh head`, with the compiler built from that commit |

The examples are `pantry` (SQL tables, references, a job, actions), `blog` (post-backed kinds, a user
projection, a global, files, synced content, `public/`) and `full-site` (`tp/app/` pages and
layouts).

## The rule

- **Until the first release is tagged:** TypedPress has no released authoring API and no managed site
  holds TypedPress source yet (sites that ran the 0.3.0 compiler hold 0.3 bundles; `tests/zero_bundle.rs`
  covers those). A PR that deliberately changes what the authoring surface accepts recaptures `head`
  in the same PR (`capture.sh head`) and adds a row to the table of breaks below. The suite still
  catches every change nobody meant: a plan, a storage description or a refusal that differs from the
  capture fails it.
- **From the first release on:** each release adds a label captured with that release's compiler,
  which is never recaptured. A later compiler must compile it, plan nothing that loses data, and
  store the same things. A release may not refuse source an earlier release accepted.
- A changed `plan.json` shows up in the PR's diff. Say why the plan changed in the PR.

## Authoring changes

The current `head` capture includes the HTTP guard change. The earlier rows describe captures
compiled with main at `6ca0f37fe` (2026-11-14), before the first kept fixture.

| captured at | example | form before | form after | what the current compiler says |
|---|---|---|---|---|
| current `head` | full-site | `export const access = "anyone"` on an HTTP route | `export const guard = "anyone"` | The captured source recompiles against its existing migration and storage baseline. |
| `4ff013b52` (#243, the rename to TypedPress) | pantry | `timestamp().notNull().defaultNow()` | required by default; `.optional()` for one that may be empty (#273) | `` `.notNull()` is gone: fields are required by default `` |
| `4ff013b52` | blog | `text().notNull().max(80)` | `text().max(80)` (#273) | `` `.notNull()` is gone: fields are required by default `` |
| `4ff013b52` | full-site | TSX pages for the old pages renderer (`tp/pages.json`) | pages under `tp/app/` (#315) | `this bundle has TSX pages from the old pages renderer (tp/pages.json), which TypedPress no longer has` |
| `83b7c4f24` (#315, full-site on `tp/app/`) | pantry | compiles | compiles | plans `0002_update.sql`: indexes `expiresOn_queried` and `quantity_queried`, which #403 infers for fields a compiled `where` or `orderBy` names |
| `83b7c4f24` | blog | `file({ bucket: "decks" })` | `file(decks)`, the exported bucket (#408) | `` `file({ bucket: "decks" })` is now `file(decks)` `` |
| `83b7c4f24` | full-site | compiles | compiles | no new migration |
| `277ad98f9` (the first `head` capture) | pantry, blog, full-site | `defineConfig({ collections, tables, users, globals, files, actions, jobs, hooks })` | each registers by its export; hooks are `.on({ ... })` on the kind (authoring-surface ruling 36) | `` `collections` is gone: a kind registers by its export `` |
| `head` before the server API change (main, 2026-11-14 to 2026-11-17) | pantry, blog, full-site | `action({ input, handler })`, `job({ input, handler })`, `jobs.x.enqueue()` | `query(options, handler)` or `mutation(options, handler)` and `job(options, handler)`, the input from the handler's parameter type; `x.enqueue()` on the job's export | `` `action()` is gone: a server function is `query()` when it only reads and `mutation()` when it writes `` |

Each capture was made with the compiler of its own commit (`cargo build --bin typedpress` there, then
`typedpress sources examples/<example> --out <dir>`), and compiled against the baseline that compiler wrote
(`typedpress compile-sources`).
