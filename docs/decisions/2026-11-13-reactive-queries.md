# Reactive queries without a push transport

## Problem

`watch()` re-reads a list every 30 seconds unless a host supplies a push transport. Convex and
Supabase keep a query current over a socket. Plain PHP hosting has no socket and no process that
outlives a request, so the question is how close a request-per-poll design can get, and what it
must never reveal: a subscription is a standing question, and its answers ("changed" or "not
changed") are information too.

## Decision

**One table of counters, `first__versions (kind, scope, version)`.** Each kind has an `all`
counter, and a kind with drafts also a `published` counter that moves only when a row is
published before or after the write. Every write through First's write path reports to
`Extensions::onWritten` inside its transaction: API and action writes, hooks, jobs, the CLI, and
wp-admin and core REST saves of kinds First owns (they already report there, for change notices).
Scheduled promotion reports too. The counters are written as the transaction's last statements,
through a new `Connection::beforeCommit`, so they commit or roll back with the write and a kind's
counter row is locked only while the commit runs. Kinds are taken in name order.

**One endpoint, `POST /__first/api/v1/_live`.** The body lists up to 20 reads, each a kind query
call (`list`, `paginate`, `get`, `count`, as landed in #302) with the token of the answer the
client last got. Each is answered `{ changed: false, token }` or `{ changed: true, token, data }`,
or with the read's own problem document. Reads run through `Seam::kindList` and its siblings as
the calling visitor, so the read rule, draft visibility and field masks decide every answer as
they do for `posts.list()`.

**"Not modified" is decided in two ways, and the visitor can't tell which.**

- *By counter, without running the read*: only when the visitor may read every row and every
  field the counter covers. That is `all` when the visitor's read scope is empty, and `published`
  when it is exactly "published rows". A kind with a field that may be hidden from the visitor, a
  read rule that returns a filter for them, the users kind, or a media or file column loaded
  through `with` has no counter for that visitor. A read uses counters only if every kind it
  depends on has one: its own kind, each kind loaded through `with`, each kind a relation filter
  looks into.
- *By result hash*: otherwise the read runs on every poll and its result is compared with the hash
  in the token.

**Tokens are sealed.** A token holds the counters the answer was computed at, the result hash,
the time, and a hash of the query and the visitor. It is encrypted with a key derived from the
site's salt (`sodium_crypto_secretbox`, fresh nonce), so a client can't read a counter out of it,
and a new one is issued on every answer whether or not anything changed. A token presented with
another query, or by another visitor, is no token: the answer is the full result.

**Why this leaks nothing the visitor may not read.**

| Channel | Why it is closed |
|---|---|
| A row or field | The result is the visitor's own access-checked read. |
| `changed` | It flips only when a counter the visitor may read all of moved, or when the visitor's own result differs. |
| The token | Sealed; a new one every answer. |
| A kind the visitor can't read | The answer is the read's 401 or 403, with no token. The counters are not looked at. |
| Whether the read ran | For a visitor without a counter the read runs on every poll, written to or not. For a visitor with one, everything it covers is theirs to read. |

**A counter is trusted for five minutes after the read last ran** (`Live\Module::TRUST_SECONDS`).
A write that never passed First's write path (another plugin's SQL, `update_post_meta` on one of
First's post types) moves no counter. The window bounds how long such a write can stay unseen by a
subscription answered by counter.

**Bounds.** 20 reads and 32 KiB per request; lists capped at the API's 100 rows; once a request's
reads have run for one second the rest answer `pending` and are asked again. The response is
`private, no-store`.

**The client polls adaptively.** Every subscription of a client travels in one request. The gap
starts at the server's `minMs` (2 s), grows by half after each poll that changed nothing up to
`maxMs` (30 s), and returns to `minMs` after a change. Each gap is jittered by 20%. Errors double
the gap. A hidden tab stops polling and polls once when it becomes visible. A write made through
the same client polls the subscriptions that read that kind at once. A host changes the window
with the `first_live_poll` filter.

**With a push transport** the same subscriptions poll the moment a notice names a kind they read,
and the interval poll becomes the slow safety poll (`livePollMs`, 60 s). Notices are unchanged:
ids only, per [the earlier decision](2026-11-07-realtime-notices-carry-ids-only.md).

## Measured cost

`tests/wp/bench-live.mjs` on the repo's WordPress harness (WordPress 7.1.4, PHP 8.5 under Apache,
MariaDB 11.4, Docker on a shared development machine, no persistent object cache), 200 requests
per shape after 20 warm-up requests, one at a time. Time is wall time from the client; SQL
statements are MariaDB's `Questions` counter divided by the request count.

| Request | p50 | p95 | Bytes | SQL statements |
|---|---|---|---|---|
| `_live`, 1 list, not modified, by counter | 37.8 ms | 51.9 ms | 339 | 42.2 |
| `_live`, 10 lists, not modified, by counter | 39.8 ms | 67.8 ms | 2,868 | 42.2 |
| `_live`, 1 list of 50 rows, changed | 53.0 ms | 73.9 ms | 3,061 | 45.2 |
| `GET /me` signed out (WordPress boots, nothing is read) | 37.2 ms | 47.2 ms | 13 | 41.1 |
| `GET /guest_notes?limit=50` (what `watch()` polled) | 95.1 ms | 114.9 ms | 2,754 | 49.4 |
| `GET /` (a WordPress page render) | 67.3 ms | 81.2 ms | 63,948 | 56.3 |
| `_live`, 1 list, not modified, signed in | 85.8 ms | 119.0 ms | 339 | 247.3 |
| `GET /me` signed in | 89.4 ms | 108.1 ms | 287 | 255.3 |

Reading these:

- A "not modified" poll costs what booting WordPress costs on that host, plus one statement. Ten
  subscriptions cost the same as one.
- It is under half the time of the list request `watch()` used to repeat, and sends an eighth of
  the bytes.
- It is not a page render: the endpoint is served on `do_parse_request`, before the theme loads.
- The signed-in rows use an application password, which is what the harness has. WordPress
  itself spends about 210 statements and 50 ms checking it, with or without this endpoint. A cookie
  or a First Identity bearer token costs less; that difference is the sign-in method's, not the
  endpoint's.

The floor is WordPress's boot. Serving the endpoint before WordPress loads (`SHORTINIT`) was
rejected: the visitor comes from WordPress's own authentication (cookie and nonce, application
password, identity bearer), and field rules may call compiled app code.

## Freshness to expect

| | Another visitor's write shows after | Your own write shows after |
|---|---|---|
| No push transport | 2 to 30 s: 2 to 10 s on a subscription that changed within the last minute, up to 30 s on an idle one | one request |
| A push transport, live | the notice's delivery plus one request | one request |
| A push transport, a notice lost | up to 72 s (the safety poll) | one request |
| A write outside First's write path | the above, plus up to 5 minutes for a subscription answered by counter | |
| A hidden tab | when it becomes visible | |

On a site that reads from database replicas, replica lag adds to every row above. A counter read
from a fresher replica than the data can hide a write from a subscription answered by counter
until the five-minute window ends.

## What this is not

- It is not Convex's or Supabase's push. On shared hosting without a transport there is no
  sub-100 ms update from another visitor's write; the floor is the poll gap, 2 seconds by default.
- It is not a consistent snapshot across subscriptions: two reads in one request are two reads.
- It is not incremental: a changed list is sent whole, not as a diff.
- It does not track which rows a query matched. A write to any row of a kind makes every
  subscription on that kind either re-run or, for a visitor answered by hash, run as it always does.
- It adds no process, cron or worker. Nothing runs between requests.

## Rejected

- **A counter per row.** It can answer only `get(id)`, which is already one indexed read. It adds
  a statement per written row and a table that grows with the data. The `published` counter is the
  split that pays: it lets anonymous visitors of a kind with drafts be answered without a read
  while editors work on drafts.
- **Sending counters to the client**, or an `ETag` made of them. A counter on a kind the visitor
  reads only part of says when someone else's rows were written.
- **A counter per visitor or per access rule.** Access rules are functions; the rows they admit
  can't be enumerated at write time without running each visitor's rule on every write.
- **Bumping counters at each write statement** rather than at commit. A handler that writes early
  and then calls a slow service would hold the kind's counter row, and every other writer of the
  kind, for its whole duration.
- **Long polling or server-sent events from PHP.** Each open subscription would hold a PHP worker;
  shared hosts give a site a handful.

## Seam for server-rendered live data

`First\Live\Module::evaluate($db, $viewer, $queries)` is what the endpoint calls. Server code that
renders a read can call it with a descriptor and no token, embed `data` in the page and hand
`token` to the browser, whose first poll is then "not modified". In the browser,
`first.<kind>.list(args).subscribe(onData, onError)` is the whole client side.
