# Zero 0.8 parity

This page tracks what stands between each live Zero 0.8 Space on Spacefast and
First. For each 0.8 capability, in the SDK (`@spacefast/zero` 0.8.1) and the
engine (`runtime/engine/legacy/zero-0.8`), it gives:

- the v2 equivalent, or **missing**;
- what `first migrate app --from zero-0.8` does with it;
- what still needs a person.

v2 runs only PHP at request time. Anything 0.8 did in its JavaScript isolate,
Preact client or Rust runner either has a PHP counterpart or is listed as
missing. [Migrate from Zero](migrating-from-zero.md) has the procedure.

Sources read: `spacefast/monorepo` branch `first-cutover` at `0cc0293a04`:
`legacy/zero-0.8/packages/{zero,zero-compile}/src`,
`runtime/engine/legacy/zero-0.8`, `crates/stattic-zero-runner/src/legacy/zero-0.8`
and `packages/cli/src/first-commands.ts`.

## Census

Two censuses measure the converter. The production census below is the
measure of record. The corpus census further down grades the converter on
known source.

### Production census (2026-11-07)

**The bar.** v2 can replace 0.8 on Spacefast when `first migrate app --from
zero-0.8` converts a live 0.8 Space, with no human edit, into a candidate that
compiles. The census reports the share it converts and ranks why the rest are
refused.

**Population.** For each non-deleted Space, the version with the latest
`ready_at` on its `live` channel (`stattic_channels.name = 'live'`), counted
when `stattic_versions.zero_declared`. The export read
`source_metadata_json -> 'statticZero' -> 'finalize'` for each one from the
read-only replica, paged by version id. It returned 767 versions; the
population count taken earlier that day was 766, so one Space went live
between the two reads. All shares below are of 767.

| Of 767 | Spaces |
| --- | ---: |
| With client-rendered pages | 489 |
| With document pages only | 25 |
| With custom endpoints | 469 |
| With neither pages nor endpoints | 63 |
| Requiring `db.v1` / `app-contract.v2` / `pages.v1` | 745 / 614 / 519 |
| Requiring `crypto.v1` / `connectors.v1` | 126 / 6 |

**What is stored, and what it can decide.** No live 0.8 version keeps its
authored TypeScript (see "Why the API cannot serve source" below). The
finalize payload keeps:

- `artifact`: the schema, handler names, endpoint methods, paths and modes,
  the pages with their files and render modes, the required capabilities, and
  `sourceManifest.files` (each source file's path and SHA-256, without its
  bytes);
- `bundles[0]` (`server.qjs.mjs`): esbuild's bundle of the server entry
  (`createRuntimeBundle` in 0.8's `zero-compile/src/compile.ts`). Every
  local module is inlined, whitespace is removed and identifiers are kept,
  but TypeScript types are erased;
- `endpointSources[]` and `runSources[]`: the same server code wrapped
  with the runtime host, once per endpoint and per handler. They add nothing
  the bundle does not have.

Each feature is decided from whichever of these can decide it:

| Feature | Decided from | Without the original source |
| --- | --- | --- |
| Endpoint method, path, mode (reserved paths, OPTIONS) | `artifact.server.endpoints` | Decided |
| Writing GET endpoint | `artifact.server.endpoints` lists it; whether its body reads the visitor decides it | Needs the source |
| Document pages (`.md`, `.html`) | `artifact.pages[].render`, `file` | Decided (refused) |
| Client app with no pages | `artifact.pages` empty, client entry in `sourceManifest`; what it imports from the uploaded `client.js` | Converted; refused only for imports with no v2 bridge (census rule), else its body needs the source |
| `ctx` services, request APIs, database calls, handler shapes | The bundle, run through the converter | Decided when refused |
| Language constructs outside the v2 subset in handlers or helpers | The bundle | Decided when refused |
| `favicon`, `auth` callbacks, collections | The bundle's `capsule({...})` options | Decided when refused |
| `ImageResponse` | The bundle's `@spacefast/zero/server` import (its JSX is compiled away) | Decided (refused, census rule) |
| Handler input types | Erased | Needs the source |
| Page bodies (TSX) | Not stored | Needs the source |
| Module structure (esbuild hoists, renames and inlines) | Changed by bundling | Needs the source |

**Method.** `scripts/census-08/census.mjs` rebuilds one capsule per Space from
its payload: the bundle becomes `server/index.ts`, with the default export
restored, `var X = class` written back as `class X`, and each untyped handler
input given a placeholder type. Each page becomes a stub of its file. Every
binary under test then runs `first migrate app --from zero-0.8 <capsule>
--dry-run --json` on the same rebuilt capsules. A version whose original source
is placed under `sources/<version_id>/`, and matches every recorded SHA-256, is
converted from that source instead.

**Formula.**

- `accepted(space)`: verified original source, and the dry run exits 0 with
  status `dry-run`. The stored payload alone never counts as accepted.
- `refused(space)`: at least one error of kind *refusal*. That is a converter
  error the original source would hit as well, or a census rule (a client app
  whose `client.js` imports something with no v2 bridge, `ImageResponse`). `scripts/census-08/classify.mjs` lists every
  rule.
- `not recoverable(space)`: no refusal and no verified source. Every remaining
  error is of kind *source* ("source not recoverable"): an erased input type, a
  page body, or a shape that bundling produced.
- Every Space is in exactly one of the three. `share = count / 767`.
- `count(reason)` is the number of refused Spaces with at least one error for
  that reason. A Space counts once per reason, so the reasons sum to more than
  the refused total.

**Validation.** The census tests (`scripts/census-08/census.test.mjs`) and a
run over the converter fixtures bundled the way 0.8 does both check that a
rebuilt capsule keeps the source's refusals and never gains an acceptance. On
the fixtures, every app the source run accepts lands in *not recoverable*.
Every reason the source run refuses for is found again, with one exception: a
`declare const` build global, which the bundle inlines. In that app the
rebuild found the request-API refusal that the source run reaches once the
global is replaced.

**Results.** Each column is one binary built at the PR head, and each PR in
the stack contains the ones to its left: #118 `138bfe46`, #129 `7af4ea87`,
#134 `6c67ab7a`, #130 `72dee2fd`, #131 `dbd6d336`, #132 `cf0cc344`,
#133 `5f413a2c`.

With `--users`, as for a Space that uses Space Users:

| | #118 | #129 | #134 | #130 | #131 | #132 | #133 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Accepted | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Refused | 766 (99.9%) | 766 (99.9%) | 766 (99.9%) | 543 (70.8%) | 543 (70.8%) | 543 (70.8%) | 539 (70.3%) |
| Not recoverable | 1 (0.1%) | 1 (0.1%) | 1 (0.1%) | 224 (29.2%) | 224 (29.2%) | 224 (29.2%) | 228 (29.7%) |

Without `--users`:

| | #118 | #129 | #134 | #130 | #131 | #132 | #133 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Accepted | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Refused | 766 (99.9%) | 766 (99.9%) | 766 (99.9%) | 591 (77.1%) | 591 (77.1%) | 591 (77.1%) | 589 (76.8%) |
| Not recoverable | 1 (0.1%) | 1 (0.1%) | 1 (0.1%) | 176 (22.9%) | 176 (22.9%) | 176 (22.9%) | 178 (23.2%) |

No live Space is accepted: none has recoverable source. The refused share is a
floor on what still needs a person. Recovering source can move a Space from
*not recoverable* to accepted or refused, but never out of *refused*.

**Refusal reasons, with `--users`** (Spaces with at least one error for the
reason, ranked by the #133 column):

| Reason | #118 | #129 | #134 | #130 | #131 | #132 | #133 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ctx passed on or read dynamically | 117 | 116 | 116 | 184 | 184 | 184 | 184 |
| client app without pages (no v2 conversion) | 180 | 180 | 180 | 180 | 180 | 180 | 180 |
| language: bitwise operators | 57 | 56 | 56 | 56 | 56 | 56 | 56 |
| endpoint: request API (url, bytes, headers.entries) | 0 | 0 | 0 | 55 | 55 | 56 | 56 |
| favicon | 47 | 47 | 47 | 47 | 47 | 47 | 47 |
| language: the in operator | 47 | 47 | 47 | 47 | 47 | 47 | 47 |
| ctx.db: database handle use | 20 | 20 | 20 | 30 | 30 | 31 | 31 |
| pages: Markdown or HTML document | 0 | 0 | 0 | 22 | 22 | 22 | 22 |
| endpoint: writing GET | 0 | 0 | 0 | 21 | 21 | 21 | 21 |
| ImageResponse (JSX on the server) | 19 | 19 | 19 | 19 | 19 | 19 | 19 |
| ctx.auth: profile fields or methods | 0 | 0 | 0 | 19 | 19 | 19 | 19 |
| ctx.env | 26 | 26 | 26 | 17 | 17 | 17 | 17 |
| endpoint: path owned by WordPress or First | 0 | 0 | 0 | 16 | 16 | 16 | 16 |
| db: paginate, filter or other operation | 17 | 17 | 17 | 14 | 14 | 14 | 14 |
| language: delete | 14 | 14 | 14 | 14 | 14 | 14 | 14 |
| language: this outside a class | 14 | 14 | 14 | 14 | 14 | 14 | 14 |
| handler signature (rest, default or destructured parameters) | 16 | 16 | 16 | 11 | 11 | 11 | 11 |
| collections or sync | 8 | 8 | 8 | 8 | 8 | 8 | 8 |
| language: destructuring assignment | 8 | 8 | 8 | 8 | 8 | 8 | 8 |
| db: spread arguments | 5 | 4 | 4 | 8 | 8 | 8 | 8 |
| ctx.spam | 4 | 4 | 4 | 7 | 7 | 8 | 8 |
| endpoint: name shared with a handler | 0 | 0 | 0 | 8 | 8 | 8 | 8 |
| db: write outside a mutation | 0 | 0 | 0 | 6 | 6 | 6 | 6 |
| language: do-while | 5 | 5 | 5 | 5 | 5 | 5 | 5 |
| ctx.email | 2 | 2 | 2 | 10 | 10 | 10 | 4 |
| auth callbacks (onGuestUpgrade) | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| language: other construct | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| handler or table name | 3 | 2 | 2 | 2 | 2 | 2 | 2 |
| ctx.connectors | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| language: BigInt | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| language: tagged templates | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| schema: non-literal default | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| endpoint: OPTIONS or HEAD | 0 | 0 | 0 | 2 | 2 | 2 | 2 |
| language: labels | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| ctx.jwt | 0 | 0 | 0 | 1 | 1 | 1 | 1 |
| ctx: other service | 0 | 0 | 0 | 1 | 1 | 1 | 1 |
| db: handle escapes a handler | 0 | 0 | 0 | 1 | 1 | 1 | 1 |
| db: range on an optional field | 0 | 0 | 0 | 1 | 1 | 1 | 1 |
| pages: no page conversion | 403 | 403 | 403 | 0 | 0 | 0 | 0 |
| endpoint: no endpoint conversion | 326 | 326 | 326 | 0 | 0 | 0 | 0 |
| ctx.auth: principal id or profile | 133 | 133 | 133 | 0 | 0 | 0 | 0 |
| ctx.invalidate | 96 | 0 | 0 | 0 | 0 | 0 | 0 |
| ctx.auth: whole object passed on | 24 | 24 | 24 | 0 | 0 | 0 | 0 |
| ctx.log | 4 | 4 | 4 | 0 | 0 | 0 | 0 |
| ctx.crypto | 1 | 1 | 1 | 12 | 12 | 0 | 0 |

Without `--users`, the same table also has `ctx.auth.userId without Space
Users` (126 Spaces at #133). The `ctx.auth` reasons shift with it: 33 Spaces
refused for profile fields or methods, and 33 for passing the whole auth
object on.

**What each PR changes.** The refused total moves only when a Space loses its
last refusal. Most gains show in the per-reason rows first:

- #129 removes `ctx.invalidate` (96 Spaces).
- #130 removes the blanket page (403) and endpoint (326) refusals and the
  `ctx.auth` principal refusal (133). This moves 223 Spaces from refused to
  *not recoverable*: their remaining blockers need the source to decide. The
  specific page and endpoint refusals that replace the blanket ones become
  visible here.
- #131 maps `fetch`, which 120 Spaces' bundles call. No outcome changes: the
  v2 compile step that refuses `fetch` runs only when the converter has found no
  other error, and each of those Spaces stops at an earlier one.
- #132 removes `ctx.crypto` (12 Spaces), but each of those Spaces has another
  refusal.
- #133 removes `ctx.email` from 6 of 10 Spaces and moves 4 Spaces to *not
  recoverable*. The other 4 use `ctx.email` in endpoints in a form other than a
  direct `ctx.email.send(message)` call, which #133 does not map.

**Sole refusals at #133, with `--users`** (Spaces whose only refusal is this
one, and so what fixing it alone would release to source review):

| Reason | Spaces |
| --- | ---: |
| client app without pages (no v2 conversion) | 56 |
| ctx passed on or read dynamically | 53 |
| language: bitwise operators | 42 |
| language: the in operator | 40 |
| endpoint: request API (url, bytes, headers.entries) | 14 |
| pages: Markdown or HTML document | 13 |
| ctx.db: database handle use | 10 |
| favicon | 9 |
| language: delete | 9 |
| endpoint: path owned by WordPress or First | 7 |
| language: destructuring assignment | 6 |
| ctx.env | 5 |

**Not recoverable, by what is missing** (Spaces):

| Missing | #118 | #129 | #134 | #130 | #131 | #132 | #133 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| page body | 0 | 0 | 0 | 208 | 208 | 208 | 211 |
| bundle shape | 1 | 1 | 1 | 45 | 45 | 45 | 46 |
| erased parameter types | 0 | 0 | 0 | 10 | 10 | 10 | 10 |
| stored payload only | 0 | 0 | 0 | 2 | 2 | 2 | 2 |

**Source for the build-backed versions.** The brief counted 168 live 0.8
versions that came from a build (150 with a connected repository, 18 without).
The census did not read their source, for these reasons:

- **Build source archives** (`apps/control-plane/src/builds/source-archive-storage.ts`)
  live on the Space's runtime box under `/build-sources/<buildId>`. The control
  plane deletes each archive when its build ends (`cleanupBuildSourceArchive`
  in `builds/runner.ts`), so no live version's archive remains. Reading one
  would also need a runtime-management JWT signed with
  `SPACEFAST_RUNTIME_JWT_PRIVATE_KEY`.
- **Connected repositories** are the source of the 150. Reading them at the
  version's `git_commit_sha` needs a GitHub App installation token
  (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`) with read access to repository
  contents for each installation.
- The other 598 versions were direct uploads or settings republishes from a
  local checkout. Their source exists nowhere on Spacefast.

With read-only contents access, check out each version at its commit into
`sources/<version_id>/` and rerun. `verifySource` uses only checkouts whose
files match `sourceManifest.files`.

**Rerun.** Export the payloads read-only from the replica into a scratch
directory outside any repository, one `<version_id>.json` per Space:

```sql
-- page through the population by version id, 50 at a time
select v.id, v.source_metadata_json -> 'statticZero' -> 'finalize'
from stattic_channels c
join stattic_versions v on v.id = c.version_id
join stattic_spaces s on s.id = c.space_id
where c.name = 'live' and s.deleted_at is null and v.zero_declared
  and v.id > :after
order by v.id limit 50;
```

Retry a read the replica cancels ("conflict with recovery"). Then:

```sh
node scripts/census-08/census.mjs --data <dir> --users \
  --zero 118=<#118>/first --zero head=target/debug/first --json summary.json
```

The summary has counts only. `--per-space` writes version ids, so keep that
file with the data and never commit it. Delete the directory when done.

### Corpus census

`scripts/migrate-census.py` runs the converter over known 0.8 source and
counts refusal reasons. Rerun it with:

```sh
cargo build
scripts/migrate-census.py --flag --users          # this branch
scripts/migrate-census.py --zero <old>/first --flag --users   # a baseline binary
scripts/migrate-census.py --json                  # per-app detail
```

**Formula.** An app is *accepted* when the dry run exits 0 with status
`dry-run`; otherwise it is *refused*. Each error is assigned the first
category whose pattern matches its pointer, or its reason when the pointer is
empty (the table is in the script). `count(category)` is the number of refused
apps with at least one error in that category. An app counts once per
category, so the counts can sum to more than the number of refused apps.
"Pages only", "endpoints only" and "both" partition the refused apps by
whether `pages` and/or `endpoints` are among their categories.

**Why the API cannot serve source.** The public API cannot serve 0.8 capsule
source at all:

- `GET /v1/spaces/{id}/versions/{versionId}/files?view=uploaded` lists what
  the publisher uploaded. For a 0.8 Space (`start-map-studio`,
  `ver_cb889f98…`) that is the built shell, `client.js` and platform chunks:
  the 0.8 CLI compiles before uploading, and `isZeroProjectOnlyPath`
  (`zero-compile/src/capsule.ts`) excludes every `.ts`/`.tsx` file and
  `server/`, `shared/` and `pages/` sources from the upload.
- `GET /v1/spaces/{id}/source/archive` serves a hosted or connected
  repository. Of the account's three runtime Spaces only `batuhan-tasks` has
  one, and it is a Functions app (`functions/api/v1/*.js`), not a capsule.
  Versions published from a local checkout record only the commit
  (`source.kind: "git"`, `commit`, `repository`), which needs access to that
  repository, not to Spacefast.
- What the finalizer keeps (`sourceMetadata.statticZero.finalize`) is the
  artifact (schema, handler names, endpoint routes, pages and a list of source
  files with their SHA-256) and one esbuild bundle per endpoint and handler.
  The bundles are compiled JavaScript without types, so they cannot be turned
  back into the authored TypeScript.

**Converting from a finalize manifest.** `first migrate app --from zero-0.8
--manifest <finalize.json> [<source-dir>]` reads that stored payload (or its
bare `artifact`):

- Without a source directory, it reports what the manifest decides on its own:
  sockets, endpoint methods and paths (reserved prefixes, HEAD/OPTIONS, writing
  GETs, `:splat` placement) and document pages, with the same pointers as a
  source run. It then refuses at `/source` with "source not recoverable". Such
  an app is never counted as accepted.
- With a source directory (for example a checkout at the published commit),
  every file in `sourceManifest.files` must match its recorded SHA-256, or the
  app is refused at `/source` ("source differs from the published version").
  Then it converts as a source run does.

`scripts/migrate-census.py` counts a directory holding `finalize.json` (and,
when recovered, `source/`) as one app, so a production census can run on the
stored manifests. The `source` category counts apps refused for missing or
differing source.

Making more Spaces recoverable needs one of these, read-only and scoped like
the copier:

1. **Capture source at 0.8 publish time** from now on: upload the capsule tree
   (`server/`, `shared/`, `pages/`, `client/`, `content/`, `sf.jsonc`) as a
   private version artifact, as v2 already does with `.first-source/`. This does
   nothing for versions already live.
2. **An internal endpoint** for the migration operation,
   `GET /v1/internal/spaces/{id}/versions/{versionId}/first-source`, returning
   the capsule tree for versions whose `source.kind` is `git` with a
   repository the control plane can read (GitHub App installations), or a
   hosted repository at the version's commit. Spaces published from an
   unconnected local checkout have no recoverable source; their owners must
   publish once from source, or the census counts them as unknown.

The corpus census uses the eight 0.8 projects in
[`tests/fixtures/app-migrate/corpus`](../tests/fixtures/app-migrate/corpus):
the four `sf init --runtime zero` starters, `start-map-studio`, the dashboard's
`/push/new-repo` capsule, the compiler test's "Notes" capsule and the MCP test's
contact capsule. Its README lists where each came from. Converter fixtures
built for one mapping each are not counted.

Both columns use `--users`, as a Space with Space Users enabled would. Without
it, `starter-todo` and `starter-guestbook` also refuse `ctx.auth.userId` on both
binaries.

| | #118 (`138bfe46`) | This branch |
| --- | --- | --- |
| Accepted | 0 of 8 | 1 of 8 (`mcp-contact`) |
| Refused | 8 | 7 |
| Refused with a `pages` error | 5 | 4 |
| Refused with an `endpoints` error | 3 | 0 |
| Refused with an `auth-identity` error | 2 | 0 |
| Refused for another reason | 4 | 4 |
| Pages only / endpoints only / both | 2 / 0 / 3 | 4 / 0 / 0 |

The four apps refused for another reason are the same before and after. Each
now has a specific reason:

- `starter-context`: native `pages` content;
- `dashboard-push`: a `declare const` build global (before: a generic
  statement refusal);
- `compile-notes`: JSX on the server (before: the converter ignored
  `sf.jsonc`'s server entry and found no `server/index.ts`);
- `start-map-studio`: a copied helper uses the `in` operator.

With `--users`, every remaining refusal in the corpus is an interactive page
(`useQuery`, `useMutation`, `useState`, event handlers or the 0.8 kit) or one of
those four. No refused corpus app is blocked by endpoints any more.

## Capability table

"Auto" means `first migrate app` maps it and a fixture proves it compiles.
**WP** means a WordPress/MariaDB lane proves the behavior
(`tests/wp/app-migrate/run.sh`, `tests/wp/legacy/spacefast-run.sh`).

### Capsule and data

| 0.8 capability | v2 equivalent | Converter | Needs a person |
| --- | --- | --- | --- |
| `capsule({ name })` | `defineConfig({ name })`; display titles become plugin slugs | Auto | — |
| Server entry from `sf.jsonc` `runtime.server` (and its aliases) | `server/index.ts` in the candidate | Auto | An executable `spacefast.config.ts`; an entry nested below `server/` (its relative imports would move) |
| `table()` with `string`, `number`, `boolean`, `id`, `userId`, `.optional()`, `.default()` | `table()` over the existing `sf_<space>_<table>_<hash>` table with `existingTable`; string IDs over `BIGINT` | Auto, **WP** | IDs above `Number.MAX_SAFE_INTEGER` |
| `.index(name, fields)`, `by_creation` | Index order plus `createdAt`, `id`, as 0.8 ordered | Auto, **WP** | — |
| `ctx.db.<t>.get/insert/update/delete` | Generated row helpers keeping 0.8's string ids, defaults and optional omission | Auto, **WP** | — |
| `withIndex(...).order().collect/take/first/count` | `db.query.<t>.findMany` with the same order; `eq: null` matches `IS NULL` | Auto, **WP** | — |
| `withIndex(...).paginate({ numItems, cursor })` | A keyset helper per call site: same order, `numItems` clamp 1–1000, `{ page, isDone, continueCursor }`; the cursor carries its call site and filter values | Auto, **WP** | Clients restart from page one after cutover (old cursors are refused); optional index fields |
| Range on an optional field, `.where()`, `.orderBy()`, `.limit()`, `.offset()` | `db.query` filters exist; not mapped | Refused | Port the query |
| `query()`, `mutation()`, `action()` | `action()` at `POST /__first/api/v1/actions/<name>` with named inputs | Auto, **WP** | Update callers to the v2 client |
| `type PaginationOptions`, `Id<T>` | Structural types in the candidate | Auto | — |
| `collections`, native `posts`, `content/posts/` | Collections and a post-backed `posts` collection; data copied with IDs | Auto, **WP** | Native `pages` and `media` collections; rich blocks; multiple references |
| `sync` declarations | `first sync` (local) | Dropped with review | Hosted edits do not rebuild a frontend |
| `connectors` | `connector-roles.json` overlay | Role map only | Connector calls (`ctx.connectors`) |
| `favicon` | Nothing to map: no 0.8 compiler, engine or runner read it, so the icon was always the published `/favicon.ico` | Dropped with a review entry | Keep the icon file in `public/` |
| Pure helpers, classes, local `shared/` modules | Copied | Auto | Helpers outside the v2 subset (for example `in`, `URL`) |
| `declare const NAME` build globals | `process.env.NAME` in handlers, `env("NAME")` in webhook and upload settings | Refused, names the fix | Replace the global |

### Identity

| 0.8 capability | v2 equivalent | Converter | Needs a person |
| --- | --- | --- | --- |
| `auth.requireSignIn` | A 401 gate on every generated action and route | Auto, **WP** | — |
| `auth.onGuestUpgrade` | `first_identity_guest_upgraded` (keeps the same user id) | Refused | Usually unnecessary: v2 guests keep their id on upgrade |
| `ctx.auth.isSignedIn`, `isAuthenticated`, `isGuest`, `displayName` | `ctx.user` and its role | Auto | — |
| `ctx.auth.userId` with Space Users | The member's hidden `spacefastSubject`, which `migrate-spacefast` copies from `spacefast_app_subject_<id>_<space>` | Auto with `--users`, **WP** | New users answer `wp:<id>`; rows owned by `guest:<id>` or `account:<id>` principals have no v2 user |
| `ctx.auth.requireSignedIn()`, `requireIdentity()` | Same refusal (401), same returned fields | Auto with `--users` | — |
| `ctx.auth.userId` without Space Users (Spacefast accounts, guests) | **open owner decision**: v2 users are WordPress users, and how a Spacefast account or a 0.8 `guest:<id>` becomes one waits on Sign in with Spacefast | Refused (`Z08_CTX_AUTH_USERS`, which names the decision) | Keep the app on 0.8 until the decision lands |
| `ctx.auth.email`, `emailVerified`, `picture`, `provider`, `subject`, `identityAliases` | With Space Users: what 0.8 gave a Space Users session, `provider` `"space-users"` (`"guest"` for a guest, `null` signed out) and the rest unset. Without them: **open owner decision**, tied to Sign in with Spacefast | Auto with `--users`; otherwise refused (`Z08_CTX_AUTH_PROFILE`, naming the decision) | Keep the app on 0.8 until the decision lands |
| Users, passwords, sessions, Google bindings, Space Users subjects | `wp first migrate-spacefast`; a users receipt without the candidate's subjects refuses (`first_spacefast_subjects_missing`) and `--verify` reports `incomplete` | Data command, **WP** | Original auth salt and cookie alias on the host |
| `verifyUser()` (server SDK) | `GET /wp-json/first-identity/v1/account` | Not applicable (runs outside the capsule) | Port callers |

### Context services

| 0.8 capability | v2 equivalent | Converter | Needs a person |
| --- | --- | --- | --- |
| `ctx.env.NAME` | `process.env["NAME"]`: process environment, then a `wp-config.php` constant | Auto, **WP** | Move secrets to the host's variables; a name 0.8 left unset may now resolve to a host constant |
| `ctx.log.info/warn/error/debug` | `console.*` to the PHP error log | Auto | — |
| `ctx.invalidate(...)` | Committed writes announce themselves | Owned by the realtime PR (#128) | — |
| `ctx.email.send` | `mail.send` from `"zero"` (#133), queued with the write, sent after commit | Auto once #133 lands | Spacefast engine connects `first_mail_transport` to the Space sender (#5063) |
| `ctx.spam.check/reportSpam/reportHam` | **missing** | Refused | **Gap** |
| `ctx.gravatar` | **missing** | Refused | **Gap** (small: an HTTP GET with the email hash) |
| `ctx.crypto.sha256/hmacSha256/timingSafeEqual` | `createHash`/`createHmac`/`timingSafeEqual` from `"node:crypto"`, byte for byte 0.8's output on the 452 recorded vectors; a named key reads `process.env` trimmed | Auto | — |
| `ctx.jwt.sign` | **missing** | Refused | **Gap** |
| `ctx.storage.list/get/delete` | [files](config-api.md#files) buckets | Refused | Port to file buckets |
| `ctx.connectors.<role>.<tool>()` | **missing** | Refused | **Gap** (needs the connector broker in PHP) |
| `fetch()` in actions | The same global `fetch`, unchanged: HTTPS only, private and special-purpose addresses refused after every redirect, 10 s, 1 MiB | Auto | — |

### HTTP

| 0.8 capability | v2 equivalent | Converter | Needs a person |
| --- | --- | --- | --- |
| `endpoint({ method, path, readOnly })` for GET, POST, PUT, PATCH, DELETE | [`route()`](config-api.md#http-routes) at the same method and path; v2 prefers literal segments over `:params`, as 0.8 did | Auto, **WP** | Unsafe methods need `X-WP-Nonce` for a signed-in caller, otherwise they run anonymously (a review entry says so); v2 adds `Cache-Control: private, no-store` unless the endpoint sets its own |
| `json()`, `text()`, `empty()`, `redirect()`, plain values, `undefined` → 204 | The same status, headers and body | Auto, **WP** | — |
| `request.text()`, `json()`, `headers.get/has`, `query.get/getAll/has`, `params`, `method` | `req.body`, `req.headers`, `req.query` (URLSearchParams semantics: first value, byte-exact names), `req.params` | Auto, **WP** | — |
| `request.json().catch(fn)`, `text().catch(fn)`, and a returned `json()`/`text()` | The same read; invalid JSON calls `fn` as 0.8's rejection did | Auto | — |
| The request passed to a function in the same module (`readBody(req)`, `authed(ctx, req)`) | The function takes a `RouteRequest`; its request reads convert under the same rules | Auto | — |
| `request.url` | `req.url` (#203), which v2 builds as 0.8 did: `https://`, the host without its port, share-link secrets redacted | Auto, **WP** | — |
| `bytes()`, `arrayBuffer()`, `headers.entries`, `query.entries`, `path`, the request or its `headers`/`query`/`params` as a value, a body read held as a promise | **missing** on `RouteRequest` or not yet mapped | Refused with pointer | Port |
| `HEAD`, `OPTIONS` endpoints | GET answers HEAD; **missing** OPTIONS | Refused | Port |
| `:param` segments | `:param` | Auto, **WP** | — |
| A final `:splat` (0.8's only catch-all; `*` is refused at publish) | `*splat` (#134), one or more decoded segments joined with `/`, plus a second route at the bare prefix, which 0.8's `:splat` also answered with an empty `params.splat` | Auto, **WP** | — |
| A writing `GET` (`readOnly: false`) | **missing** by design: GET routes take cookies without a nonce | Refused | Move to POST |
| Paths under `wp-*`, `feed`, `auth`, `__zero`, … | Owned by WordPress or First | Refused | Move the endpoint |
| `ImageResponse` | **missing** (PHP has no JSX renderer) | Refused | Pre-render the image |
| `/llms.txt`, `/api/ping` defaults | Not converter work | — | The host serves them |

### Pages and client

| 0.8 capability | v2 equivalent | Converter | Needs a person |
| --- | --- | --- | --- |
| Static `pages/*.tsx` (no hooks, event attributes, browser globals, clocks, client or kit imports) | `pages/<path>/page.tsx`, rendered at capture, served by WordPress; relative imports are adjusted for the move | Auto, **WP** (hosted compile) | Run `first-pages build` and commit `first/pages.json` |
| `client/index.tsx` static `Layout` | `pages/layout.tsx` | Auto, **WP** | — |
| Client app without pages (`client/` served as a single-page app) | Static files in `public/`: the client compiled to browser modules, mounted by `public/index.html`, with `public/first/client.js` answering `@spacefast/zero/client` | Auto (native CLI and the WebAssembly compiler give the same files) | Check each screen on the candidate; reads refresh on this browser's writes and on focus |
| `"use client"` pages with `useQuery`, `useMutation`, `useAction`, `useState`, `useAuth` | `load()` reads as the visitor, plus `<Island>` with an Interactivity store calling actions | Refused, lists what each page uses | Port each page |
| `usePaginatedQuery` | In a client app without pages: the bridge calls the paginated action, passing `{ numItems, cursor }` to the handler's `PaginationOptions` parameter. In a `"use client"` page: an island over the paginated action | Auto in a client app; refused in a page | Port pages |
| `@spacefast/zero/kit` components | **missing**: plain markup and CSS | Refused | Restyle |
| `@spacefast/zero/charts` | **missing** | Refused | **Gap** |
| `@spacefast/zero/context` (`ContextPage`, editor) | **missing** | Refused | **Gap** |
| `@spacefast/zero/content` blocks (`PostLoop`, …) | `content.query` in `load()` | Refused | Port |
| Islands (`client/` components in document pages) | `<Island>` with an Interactivity API module | Refused | Port |
| `pages/[param].tsx` | `collectionPage()` for collection items | Refused | Port |
| `pages/*.md`, `pages/*.html` documents | **missing** (content-owned pages are not in this release) | Refused | Move the text into a TSX page or a collection |
| `_pages/` system pages (404, access gate) | The host's own pages | Refused | — |
| Tailwind `zero.css` | No generator: First does not compile Tailwind | Client app without pages: the published `zero.css` goes to `public/zero.css`, linked first as 0.8 linked it. It comes from `--zero-css <file>` (wasm `zeroCss`) or from a `--manifest` payload that kept its bytes; without it the app is refused with `Z08_CLIENT_STYLES` | For a version whose payload kept no bytes, compile it with 0.8's `compileZeroUtilityStylesheet` over the published source |
| Live updates, realtime | `watch()` in the v2 client (#128) | Owned by #128 | Replace subscriptions |
| `Link`, `navigate`, `Router` | Plain links; WordPress routes the page | Refused with the page | Port |

### Engine routes

| 0.8 route | v2 equivalent | Notes |
| --- | --- | --- |
| `/__zero/run` | `/__first/api/v1/actions/<name>` | Clients change; a converted client app calls it through `public/first/client.js` |
| `/__zero/config` | `/__spacefast/client.js` | Clients change; the converted client app's bridge needs no config |
| `/__zero/auth/start`, `/sign-out` | `/wp-json/first-identity/v1/*` | Identity plugin |
| `/__zero/realtime/*` | #128 transport | |
| `/__spacefast/zero/connectors/<role>/*` | **missing** | With `ctx.connectors` |

## v2 runtime gaps

Each gap below is a missing v2 runtime feature, not converter work. They are
ordered by how many 0.8 capsules need them, roughly. Each one goes in its own
PR stacked on #118, implemented in PHP:

1. **Outbound HTTP in handlers** (`fetch`): done in #131; the global `fetch` since the host-globals change.
2. **Hashing builtins** (`ctx.crypto`): done in #132; mapped to `node:crypto` since the host-globals change.
3. **Free-form email from handlers** (`ctx.email.send`): done in #133. The
   Spacefast engine still has to connect its sender (see #133).
4. **Catch-all route segments**: done in #134 as v2's `*rest`. The converter
   maps 0.8's final `:splat` onto it.
5. **Raw request bytes**. `RouteRequest.url` landed in #203; `bytes()` and
   `arrayBuffer()` still need the raw body on the route request.
6. **Gravatar, spam and JWT services**. Each is small to medium. Spam needs a
   provider decision first.
7. **Connector calls**. Large: the broker, tokens and approval states.
8. **Kit, charts and the context editor** for pages. Large and product-shaped,
   so they are not converter work.

Items 1–4 each have their own PR. The converter maps the 0.8 calls once those
land; the rest remain open.

## Executable evidence

| Claim | Proof |
| --- | --- |
| Candidates compile and type-check | `cargo test --test app_migrate` (12 tests, `tsc` on each candidate) |
| Retained rows, generated actions, rollback | `tests/wp/app-migrate/run.sh`: `adoption.test.ts` |
| Pagination order, clamp, cursor scoping | `tests/wp/app-migrate/run.sh`: `feed.test.ts` |
| Endpoints at their original paths, `ctx.env` from wp-config | `tests/wp/app-migrate/run.sh`: `endpoints.test.ts` |
| Static pages served from the hosted compile | `tests/wp/app-migrate/run.sh`: `site.test.ts` |
| Space Users subjects copied and masked | `tests/wp/legacy/spacefast-run.sh` (`copied` phase) |
| Census | `scripts/migrate-census.py` |
