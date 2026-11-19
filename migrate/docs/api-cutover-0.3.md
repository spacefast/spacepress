# Moving a host from the 0.3.0 API to `/__tp/api/v1`

Historical design record. See the [migration guide](migrating-from-zero.md) for current commands and limits.

What a host, and every client it serves, sees change when its vendored compiler moves from 0.3.0
(`61c22fc2`, before the rename to TypedPress) to a TypedPress release. The engine-side names (mount, hooks,
worker, captured uploads, compiled tree) are the host contract's; this page is the HTTP API and the
generated client.

## Paths

| 0.3.0 | TypedPress |
|---|---|
| `/wp-json/zero/v1/*` (the app's API under WordPress's REST prefix) | `/__tp/api/v1/*`, served before the theme, outside `/wp-json` |
| `GET /wp-json/zero/v1/_schema` | `GET /__tp/api/v1` (no trailing segment) |
| `GET`/`PATCH /globals/<name>` | `GET`/`PATCH /<name>` |
| `POST /actions/<name>` | `POST /actions/<name>`; a `readonly` action also answers `GET /actions/<name>?input=<json>` |
| `/__zero/client.js` (served by the host) | the compiled tree's `client/client.js`, at a URL the host picks |
| `/wp-json/zero-identity/v1/*` | `/wp-json/typedpress-identity/v1/*` |
| `actionPathPrefix: "/wp-json/zero/v1/actions/"` | `"/__tp/api/v1/actions/"` |

Nothing serves the 0.3.0 paths once a site runs a TypedPress build: `/wp-json/zero/v1/*` is WordPress's
own 404 `rest_no_route`, and `/__zero/client.js` is a 404. TypedPress serves no alias for them.

Route `/__tp/*` to WordPress and never cache it: every answer carries
`Cache-Control: private, no-store` and `Vary: Origin, Cookie, Authorization`.

## Shapes

| 0.3.0 | TypedPress |
|---|---|
| The schema lists `collections` (and `tables`) | It lists `kinds`: every kind with its core `route` and `type` (`post`, `table`, `users`, or `builtin` for WordPress's own: `posts`, `pages`, `comments`, `media`, `categories`, `tags`, `menus`, `settings`), plus `globals`, `actions` (with `readonly`, `destructive`, `output`), `runtime` and `site` |
| A list answers `{ data: rows }` | `{ data: rows, cursor }`; `cursor` is an opaque string for the next page, `null` on the last one |
| List `limit`: default 50, at most 200 | default 50, at most 100; `offset` or `cursor` (`?cursor=<the previous cursor>`) for the next page |
| `GET /<kind>/<id>/revisions` answers `{ data }` | `{ data, cursor }`, paged like every list; the generated client's `revisions.list()` follows the cursor |
| `GET /me` answers `{ id, name, role, member }` with the users row under `member` | `{ id, name, role, ...the users row as you read it }` flat; `null` when signed out |
| An application password of a suspended account authenticated | 403 `account_unavailable` |

Errors stay RFC 9457 problem documents (`type`, `title`, `status`, `code`, `detail`, `pointer`).
Core's codes reach clients as TypedPress's: `rest_forbidden` and the other permission codes become
`unauthenticated` (401) or `forbidden` (403), a missing item `not_found` (404), a bad parameter
`invalid_input` with its `pointer`. A row or media item the caller may not read is a 404, never a 403.

## The generated client

- `createClient()` defaults to `/__tp/api/v1` on the page's origin.
- Its error class is `TypedPressError` (was `ZeroError`); fields are unchanged.
- `paginate(q)` returns `{ rows, cursor }`; `list(q)` still returns the rows.
- `client.globals.<name>` calls `/<name>`; `client.schema()` calls `GET /`; `client.me()` returns the
  flat user.
- The realtime registry is `globalThis.__tpRealtime` (was `__zeroRealtime`);
  `registerRealtimeTransport()` is unchanged.

## A Space built by 0.3.0, after the pin moves

- Its next version compiles from its stored `zero.source-bundle.v1` (the TypedPress compiler reads that
  format). That version's client calls `/__tp/api/v1`. On its first initialize the site renames
  its stored `zero_*` names once, deleting nothing; signed-in members stay signed in.
- A browser tab still running the 0.3.0 client gets `ZeroError` 404 `rest_no_route` on every call
  until it reloads. A form it submits is not saved. Nothing in TypedPress keeps it working.
- A page that hard-codes `/wp-json/zero/v1` outside the generated client breaks the same way until it
  is rewritten or republished.
- Whether the host bridges those tabs during the cutover (keep routing `/wp-json/zero/v1/*` to the
  0.3.0 runtime for a while, or answer it with a reload prompt) is the host's decision.
