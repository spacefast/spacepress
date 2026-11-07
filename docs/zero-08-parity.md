# Zero 0.8 parity

This page tracks what stands between each live Zero 0.8 Space on Spacefast and
Zero v2. For each 0.8 capability, in the SDK (`@spacefast/zero` 0.8.1) and the
engine (`runtime/engine/legacy/zero-0.8`), it gives:

- the v2 equivalent, or **missing**;
- what `zero migrate app --from zero-0.8` does with it;
- what still needs a person.

v2 runs only PHP at request time. Anything 0.8 did in its JavaScript isolate,
Preact client or Rust runner either has a PHP counterpart or is listed as
missing. [Migrate from Zero](migrating-from-zero.md) has the procedure.

Sources read: `spacefast/monorepo` branch `zero-v2-cutover` at `0cc0293a04`:
`legacy/zero-0.8/packages/{zero,zero-compile}/src`,
`runtime/engine/legacy/zero-0.8`, `crates/stattic-zero-runner/src/legacy/zero-0.8`
and `packages/cli/src/zero-commands.ts`.

## Census

`scripts/migrate-census.py` runs the converter over a corpus and counts
refusal reasons. Rerun it with:

```sh
cargo build
scripts/migrate-census.py --flag --users          # this branch
scripts/migrate-census.py --zero <old>/zero --flag --users   # a baseline binary
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

**Corpus.** The production replica was not reachable from the dev box. The
account's own Spacefast API (`sf`, scopes `spaces:read` and
`versions:download`) lists 100 Spaces, of which 3 have a runtime. Their
version downloads hold only published output (`index.html`, bundled
`client.js`), with no capsule source and no connected repository
(`sf source ls` answers `404 Repository connection not found`). So
the corpus is the eight 0.8 projects in
[`tests/fixtures/app-migrate/corpus`](../tests/fixtures/app-migrate/corpus):
the four `sf init --runtime zero` starters, `start-map-studio`, the dashboard's
`/push/new-repo` capsule, the compiler test's "Notes" capsule and the MCP test's
contact capsule. Its README lists where each came from. Converter fixtures
built for one mapping each are not counted.

The prod census from 2026-11-07 (758 live Spaces: 512 with pages, 462 with
custom endpoints) is not reproduced here. Rerun the script over real sources
once they can be read safely; the formula does not change.

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

"Auto" means `zero migrate app` maps it and a fixture proves it compiles.
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
| `query()`, `mutation()`, `action()` | `action()` at `POST /wp-json/zero/v1/actions/<name>` with named inputs | Auto, **WP** | Update callers to the v2 client |
| `type PaginationOptions`, `Id<T>` | Structural types in the candidate | Auto | — |
| `collections`, native `posts`, `content/posts/` | Collections and a post-backed `posts` collection; data copied with IDs | Auto, **WP** | Native `pages` and `media` collections; rich blocks; multiple references |
| `sync` declarations | `zero sync` (local) | Dropped with review | Hosted edits do not rebuild a frontend |
| `connectors` | `connector-roles.json` overlay | Role map only | Connector calls (`ctx.connectors`) |
| `favicon` | **missing** in config | Refused | Ship the file under `public/` |
| Pure helpers, classes, local `shared/` modules | Copied | Auto | Helpers outside the v2 subset (for example `in`, `URL`) |
| `declare const NAME` build globals | `env("NAME")` | Refused, names the fix | Replace the global |

### Identity

| 0.8 capability | v2 equivalent | Converter | Needs a person |
| --- | --- | --- | --- |
| `auth.requireSignIn` | A 401 gate on every generated action and route | Auto, **WP** | — |
| `auth.onGuestUpgrade` | `zero_identity_guest_upgraded` (keeps the same user id) | Refused | Usually unnecessary: v2 guests keep their id on upgrade |
| `ctx.auth.isSignedIn`, `isAuthenticated`, `isGuest`, `displayName` | `ctx.user` and its role | Auto | — |
| `ctx.auth.userId` with Space Users | The member's hidden `spacefastSubject`, which `migrate-spacefast` copies from `spacefast_app_subject_<id>_<space>` | Auto with `--users`, **WP** | New users answer `wp:<id>`; rows owned by `guest:<id>` or `account:<id>` principals have no v2 user |
| `ctx.auth.requireSignedIn()`, `requireIdentity()` | Same refusal (401), same returned fields | Auto with `--users` | — |
| `ctx.auth.userId` without Space Users (Spacefast accounts, guests) | **missing**: v2 users are WordPress users | Refused | Map principals to users explicitly |
| `ctx.auth.email`, `picture`, `provider`, `subject`, `identityAliases` | **missing** in handler context | Refused | Read the member row, or port |
| Users, passwords, sessions, Google bindings, Space Users subjects | `wp zero migrate-spacefast`; a users receipt without the candidate's subjects refuses (`zero_spacefast_subjects_missing`) and `--verify` reports `incomplete` | Data command, **WP** | Original auth salt and cookie alias on the host |
| `verifyUser()` (server SDK) | `GET /wp-json/zero-identity/v1/account` | Not applicable (runs outside the capsule) | Port callers |

### Context services

| 0.8 capability | v2 equivalent | Converter | Needs a person |
| --- | --- | --- | --- |
| `ctx.env.NAME` | `env("NAME")`: process environment, then a `wp-config.php` constant | Auto, **WP** | Move secrets to the host's variables; a name 0.8 left unset may now resolve to a host constant |
| `ctx.log.info/warn/error/debug` | `console.*` to the PHP error log | Auto | — |
| `ctx.invalidate(...)` | Committed writes announce themselves | Owned by the realtime PR (#128) | — |
| `ctx.email.send` | [services](services.md) forms and queued mail | Refused | **Gap**: no free-form send from a handler |
| `ctx.spam.check/reportSpam/reportHam` | **missing** | Refused | **Gap** |
| `ctx.gravatar` | **missing** | Refused | **Gap** (small: an HTTP GET with the email hash) |
| `ctx.crypto.sha256/hmacSha256/timingSafeEqual` | `signature` on actions and routes covers inbound webhooks | Refused | **Gap**: no hashing builtins in handlers |
| `ctx.jwt.sign` | **missing** | Refused | **Gap** |
| `ctx.storage.list/get/delete` | [files](config-api.md#files) buckets | Refused | Port to file buckets |
| `ctx.connectors.<role>.<tool>()` | **missing** | Refused | **Gap** (needs the connector broker in PHP) |
| `fetch()` in actions | **missing** in compiled handlers | Compile refusal | **Gap**: no outbound HTTP builtin |

### HTTP

| 0.8 capability | v2 equivalent | Converter | Needs a person |
| --- | --- | --- | --- |
| `endpoint({ method, path, readOnly })` for GET, POST, PUT, PATCH, DELETE | [`route()`](config-api.md#http-routes) at the same method and path; v2 prefers literal segments over `:params`, as 0.8 did | Auto, **WP** | Unsafe methods need `X-WP-Nonce` for a signed-in caller, otherwise they run anonymously (a review entry says so); v2 adds `Cache-Control: private, no-store` unless the endpoint sets its own |
| `json()`, `text()`, `empty()`, `redirect()`, plain values, `undefined` → 204 | The same status, headers and body | Auto, **WP** | — |
| `request.text()`, `json()`, `headers.get/has`, `query.get/getAll/has`, `params`, `method` | `req.body`, `req.headers`, `req.query` (URLSearchParams semantics: first value, byte-exact names), `req.params` | Auto, **WP** | — |
| `request.url`, `bytes()`, `arrayBuffer()`, `headers.entries` | **missing** on `RouteRequest` | Refused with pointer | Port |
| `HEAD`, `OPTIONS` endpoints | GET answers HEAD; **missing** OPTIONS | Refused | Port |
| `:param` segments | `:param` | Auto, **WP** | — |
| `*rest` catch-all segments | **missing** | Refused | **Gap** |
| A writing `GET` (`readOnly: false`) | **missing** by design: GET routes take cookies without a nonce | Refused | Move to POST |
| Paths under `wp-*`, `feed`, `auth`, `__zero`, … | Owned by WordPress or Zero | Refused | Move the endpoint |
| `ImageResponse` | **missing** (PHP has no JSX renderer) | Refused | Pre-render the image |
| `/llms.txt`, `/api/ping` defaults | Not converter work | — | The host serves them |

### Pages and client

| 0.8 capability | v2 equivalent | Converter | Needs a person |
| --- | --- | --- | --- |
| Static `pages/*.tsx` (no hooks, event attributes, browser globals, clocks, client or kit imports) | `pages/<path>/page.tsx`, rendered at capture, served by WordPress; relative imports are adjusted for the move | Auto, **WP** (hosted compile) | Run `zero-pages build` and commit `zero/pages.json` |
| `client/index.tsx` static `Layout` | `pages/layout.tsx` | Auto, **WP** | — |
| `"use client"` pages with `useQuery`, `useMutation`, `useAction`, `useState`, `useAuth` | `load()` reads as the visitor, plus `<Island>` with an Interactivity store calling actions | Refused, lists what each page uses | Port each page |
| `usePaginatedQuery` | An island over the paginated action | Refused | Port |
| `@spacefast/zero/kit` components | **missing**: plain markup and CSS | Refused | Restyle |
| `@spacefast/zero/charts` | **missing** | Refused | **Gap** |
| `@spacefast/zero/context` (`ContextPage`, editor) | **missing** | Refused | **Gap** |
| `@spacefast/zero/content` blocks (`PostLoop`, …) | `content.query` in `load()` | Refused | Port |
| Islands (`client/` components in document pages) | `<Island>` with an Interactivity API module | Refused | Port |
| `pages/[param].tsx` | `collectionPage()` for collection items | Refused | Port |
| `pages/*.md`, `pages/*.html` documents | **missing** (content-owned pages are not in this release) | Refused | Move the text into a TSX page or a collection |
| `_pages/` system pages (404, access gate) | The host's own pages | Refused | — |
| Tailwind `zero.css` | **missing** | Not converted | Ship CSS through the page imports |
| Live updates, realtime | `watch()` in the v2 client (#128) | Owned by #128 | Replace subscriptions |
| `Link`, `navigate`, `Router` | Plain links; WordPress routes the page | Refused with the page | Port |

### Engine routes

| 0.8 route | v2 equivalent | Notes |
| --- | --- | --- |
| `/__zero/run` | `/wp-json/zero/v1/actions/<name>` | Clients change |
| `/__zero/config` | `/__spacefast/client.js` | Clients change |
| `/__zero/auth/start`, `/sign-out` | `/wp-json/zero-identity/v1/*` | Identity plugin |
| `/__zero/realtime/*` | #128 transport | |
| `/__spacefast/zero/connectors/<role>/*` | **missing** | With `ctx.connectors` |

## v2 runtime gaps

Each gap below is a missing v2 runtime feature, not converter work. They are
ordered by how many 0.8 capsules need them, roughly. Each one goes in its own
PR stacked on #118, implemented in PHP:

1. **Outbound HTTP in handlers** (`fetch` in actions; connectors build on it).
   A `Zero\Http` builtin over `wp_remote_request`, with timeouts and an allow
   list. Medium size.
2. **Hashing builtins** (`ctx.crypto`): SHA-256, HMAC-SHA-256 and a constant-time
   compare are a few lines each over `hash`, `hash_hmac` and `hash_equals`.
   Small, but it needs compiler builtins and `types/zero` declarations.
3. **Free-form email from handlers** (`ctx.email.send`). The services outbox
   exists; a handler API onto it is medium size.
4. **Catch-all route segments** (`*rest`). Small in `App::matchRoute`, with
   matching type and conflict rules.
5. **`RouteRequest.url` and raw bytes**. Small, but the route request belongs to
   #129, so it is left to that PR.
6. **Gravatar, spam and JWT services**. Each is small to medium. Spam needs a
   provider decision first.
7. **Connector calls**. Large: the broker, tokens and approval states.
8. **Kit, charts and the context editor** for pages. Large and product-shaped,
   so they are not converter work.

None of these is implemented on this branch. Each touches the compiler's builtins
and `types/zero` as well as PHP, so each needs its own design-sized PR rather
than a tail on the converter.

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
