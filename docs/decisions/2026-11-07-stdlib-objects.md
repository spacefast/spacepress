# Standard objects for files-sdk: Map/Set, URL, AbortSignal, timers

files-sdk 3.1.2 (root entry plus `files-sdk/memory`, 19 source files) uses
these standard objects on its core path. Counts are source lines, src / npm dist:

| Object | Uses | Where |
|---|---|---|
| `new Map` / `new Set` | 8 / 8, 10 / 10 | memory store, receipts, sync, error code sets |
| `Map<..>` / `Set<..>` annotations | 15, 8 (src only) | same |
| `AbortController` / `AbortSignal` | 7, 44 (src) | retry, resumable, stored-file, core read loop |
| `AbortSignal.any` / `timeout` | 4 (src) / 1 (dist) | `retry.ts` feature-detects `AbortSignal.any` |
| `addEventListener("abort")` | 6 / 6 | always `{ once: true }` paired with `removeEventListener` |
| `setTimeout` / `clearTimeout` | 6 / 3 | per-attempt timeout and backoff sleep in `retry.ts` |
| `URLSearchParams` | 1 / 1 | memory adapter's signed-URL query |
| `new URL`, `EventTarget`, `Event`, `structuredClone`, `queueMicrotask`, `AggregateError`, `Map.groupBy` | 0 | not on the core path |
| `Error` `cause` | via `this.cause = cause` in `FilesError` | a field assignment, not the `{ cause }` constructor option |

So `EventTarget`/`Event`, `structuredClone`, `queueMicrotask` and `AggregateError`
are out of scope. `internal/events.ts` is a hook registry, not DOM events. The
abort listener surface is the only event surface needed. It lives on `AbortSignal`
and isn't a general `EventTarget`.

## Map and Set in typed TypeScript

Typed TS already models objects and arrays as `JsObject`/`JsArray` handles. So the
existing `JsMap`/`JsSet` runtime classes give JavaScript semantics directly:
- insertion order;
- SameValueZero keys (`NaN` equals `NaN`, `-0` is normalized to `+0`);
- object keys by handle identity.

The compiler gains `Ty::JsMap(K, V)` and `Ty::JsSet(T)` from `Map<K,V>`, `Set<T>`,
`ReadonlyMap` and `ReadonlySet` annotations and from `new Map<K,V>(iterable?)`. The
typed methods are `get` (returns `V | undefined`), `set`, `has`, `delete`, `clear`,
`size`, `forEach`, `keys`/`values`/`entries`, `for…of`, spread and `Array.from`.
They compile to direct method calls on the runtime classes. Untyped `new Map()`
with no type arguments and no entries is refused with a fix ("add type arguments").
That is the single exception to inference.

The runtime gains `delete`, `clear`, `forEach`, live iterators and an O(1) lookup
index. Scalar keys go through a hash table. Object keys go through `spl_object_id`
plus the stored handle, and keeping the handle stops the id being reused. Deleted
entries leave tombstones, so a live iterator sees JavaScript's semantics: entries
added during iteration are visited, and deleted ones are skipped. Checked JavaScript
dispatch uses the same methods.

## URL and URLSearchParams

Don't port anything. `rowbot/url` (MIT, a WHATWG URL Standard implementation that
passes the WPT suite) is already in the runtime bundle, Strauss-prefixed as
`Zero\Vendor\Rowbot\URL`, through `wp-php-toolkit/data-liberation`. It wasn't
usable as shipped: Strauss rewrote rowbot/idna's `use const DIRECTORY_SEPARATOR as DS`
alias into an undefined `ZERO_VENDOR_DS`, so every host parse fataled. The fix
adds `DS` to `exclude_constants` and regenerates the bundle. That changes no lock
and adds no package.

`Zero\JsUrl` and `Zero\JsUrlSearchParams` wrap the vendored classes and expose
JavaScript property and method names. Parse failures throw `TypeError`, matching
`new URL`'s error, and `URL.canParse` / `URL.parse` exist. The differential suite
runs a committed subset of WPT `urltestdata.json`, and the PR reports the pass count.

`fetch(string | URL)` belongs to the host-globals thread. `JsUrl` implements
`__toString` returning `href`, which is the seam it needs.

## AbortController and AbortSignal

`Zero\JsAbortController` / `Zero\JsAbortSignal` provide:
- `abort(reason?)`, where the default reason is a `DOMException`-shaped `JsError`
  named `AbortError`;
- `aborted`, `reason` and `throwIfAborted()`;
- `addEventListener("abort", fn, { once })` and `removeEventListener`;
- `onabort`;
- `AbortSignal.abort(reason)`, `AbortSignal.any(signals)` and `AbortSignal.timeout(ms)`.

There's no event loop, so `abort()` runs listeners synchronously in registration
order, exactly as Node dispatches the abort event. The only asynchronous source is
`AbortSignal.timeout`, which is a timer (below). It fires only when the request
drains timers. A timeout never interrupts PHP code mid-statement; it's observed at
the next await. Zero\Fetch cancellation is the host-globals seam: a signal passed
to `fetch` is checked before the request and its timeout bounds the cURL timeout.

## Timers

Model: a timer callback runs at the next point where the request waits, and that
is the only point where it can run.

- `Zero\Timers` owns a min-heap of `(due, seq, callback, args)`. `Timers::runNext()`
  sleeps (`usleep`) until the earliest due time, runs that callback and returns
  true. It returns false when no timers are pending.
- The clock is `Js::now()`. With `ZERO_NOW` pinned, `runNext` advances a virtual
  clock instead of sleeping, so differential tests are deterministic and instant.
- Total waiting is capped by the request budget: the smaller of the remaining
  `max_execution_time` and `ZERO_TIMER_BUDGET_MS` (default 30000). A wait past the
  budget throws `RangeError("timer budget exceeded")` at the await. It never hangs.
- The promise job queue belongs to agent 4 (`feat/async-streams`, agreed in
  `docs/decisions/2026-11-07-promises-generators-streams.md`). Its root drain,
  `\Zero\JsJobs::runUntilSettled`, called from `Js::await`, calls
  `Timers::runNext()` whenever microtasks are empty and the awaited promise is
  still pending. If no timer is pending, the promise can never settle, and agent
  4's loop throws that error, naming the await site.
- `runNext()` runs exactly one callback and never drains microtasks itself; the
  job loop drains after every macrotask, so spec order lives in one place. It is
  only called from the root, never inside a Fiber. An exception from a timer
  callback propagates out of `runNext()` as the request error, the way Node's
  uncaught exception ends the process.
- At handler end, the order is: the root promise settles, microtasks drain to
  empty, the unhandled-rejection check runs, then `Timers::assertNonePending()`.
  Timers created by `AbortSignal.timeout` or cleared by `clearTimeout` are
  discarded. A still-pending user `setTimeout` is a runtime `Error` naming its
  creation site: in Node it would fire after the response, and in PHP the
  request would end first. That's a divergence we refuse.
- Until agent 4's queue lands, this branch emits `setTimeout` and `clearTimeout`
  against `Zero\Timers`. The typed sleep shape
  `await new Promise<void>((r) => setTimeout(r, ms))` is the one pattern
  files-sdk's backoff uses. A follow-up PR wires it once `new Promise` exists.

Capability: timers are recorded as a `timers` kind at the single
`Compiler::uses(kind, value, span)` recognition point that
`feat/plugin-capabilities` reads (`src/plugins.rs` `KINDS`). That's one row there
and one call where `setTimeout`/`AbortSignal.timeout` compile. If that branch
hasn't merged when this lands, the row is added by whichever PR merges second.

## Date, Math, JSON

Only after the layers above are gone. The core path uses `Date.now`, `Math.min/max/
floor/ceil/trunc`, and `JSON.stringify` of arrays of strings, all already
supported. (`Math.sin` appears only in a comment: `md5.ts` writes its table out.)

## PRs

1. Map/Set in typed TS (+ runtime delete/clear/forEach/live iteration).
2. URL/URLSearchParams (+ vendor `DS` fix, WPT subset).
3. AbortController/AbortSignal + timers (stacked on 1 for listener sets).
4. Date/Math/JSON gaps, from the merged-state table.
