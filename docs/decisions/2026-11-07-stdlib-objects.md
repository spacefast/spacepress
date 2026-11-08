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

The compiler gains `Ty::MapOf(K, V)`, `Ty::SetOf(T)` and `Ty::Iter(T)` from `Map<K,V>`, `Set<T>`,
`ReadonlyMap` and `ReadonlySet` annotations and from `new Map<K,V>(iterable?)`. The
typed methods are `get` (returns `V | undefined`), `set`, `has`, `delete`, `clear`,
`size`, `forEach`, `keys`/`values`/`entries`, `for…of`, spread and `Array.from`.
They compile to direct method calls on the runtime classes. Untyped `new Map()`
with no type arguments and no entries is refused with a fix ("add type arguments").
That is the single exception to inference. Type arguments are invariant
(`Set<number>` isn't assignable to `Set<number | string>`): both are mutable handles,
and TypeScript's covariance here is unsound for writes.

Module-level constants such as `const NOT_FOUND = new Set([404])` are built once by
the configuration evaluator as a read-only `Value::Coll` (has/get/size), and compiled
code captures one runtime collection per request, the way captured arrays are.

Checked JavaScript also gains Map/Set/array `keys`/`values`/`entries` iterators
(`Zero\JsIterator`, live, with `next()`), and array-pattern destructuring of an
iterable (`const [first, ...rest] = map.keys()`), which takes exactly the elements
the pattern names. Receipts serialize the live entries and rebuild the index on
unserialize, because `spl_object_id` is per-process.

The runtime gains `delete`, `clear`, `forEach`, live iterators and an O(1) lookup
index. Scalar keys go through a hash table. Object keys go through `spl_object_id`
plus the stored handle, and keeping the handle stops the id being reused. Deleted
entries leave tombstones, so a live iterator sees JavaScript's semantics: entries
added during iteration are visited, and deleted ones are skipped. Checked JavaScript
dispatch uses the same methods.

## URL and URLSearchParams

Don't port anything. `rowbot/url` 4.2.1 (MIT, a WHATWG URL Standard implementation that
passes the WPT suite) is a direct runtime dependency, Strauss-prefixed as
`Zero\Vendor\Rowbot\URL`. Earlier, a copy came in through `wp-php-toolkit/data-liberation`,
but #150 removed that copy as unused. It pulls in `rowbot/idna`, `rowbot/punycode`,
`brick/math` and `symfony/polyfill-intl-normalizer`, all MIT. `DS` is excluded from
constant prefixing: rowbot/idna aliases `DIRECTORY_SEPARATOR` as `DS`, and Strauss would
otherwise rewrite it to an undefined `ZERO_VENDOR_DS`, so every host parse would fatal.

`Zero\JsUrl` and `Zero\JsUrlSearchParams` wrap the vendored classes and expose
JavaScript property and method names. Parse failures throw `TypeError`, matching
`new URL`'s error, and `URL.canParse` / `URL.parse` exist. The contract test runs
every case in WPT `urltestdata.json` (886, at a pinned revision) through compiled
checked JavaScript and compares each one with WPT's own expected values. All 886
pass. Node 22 passes 879: it lags the standard on seven newer cases (spaces before
`?`/`#` in opaque paths, and `^` in paths) that rowbot/url 4.2.1 already implements.
So WPT is the oracle for parsing, and Node remains the oracle for the URLSearchParams
and setter vectors, which urltestdata doesn't cover.

One rowbot defect diverged from Node: its percent-encoder used `rawurlencode()`,
which leaves `~` alone although the form-urlencoded set contains it. Vendoring now
patches that line (`scripts/vendor-metadata.php`), and generation fails if the line
changes upstream.

`fetch(string | URL)` belongs to the host-globals thread (#147, agreed with it).
`JsUrl` and `JsUrlSearchParams` implement `\Stringable` (href and the
serialization), so fetch reads both. #147's own `Zero\SearchParams` goes away, so
there is one implementation.

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
- `setTimeout` returns an opaque `Zero\JsTimeout` handle, as Node's Timeout
  object, and `clearTimeout` accepts it. `Timers::run()` wraps every action, route
  and job handler, and nested handlers share the outermost timer list.
- `new Promise` is agent 4's, so there is no interim await shape here. Until their
  queue lands, a timer can only be created, cleared and checked at handler end.
  That covers files-sdk's per-attempt timeout (`mergeSignals` + `cleanup`). Its
  backoff sleep needs `new Promise` and arrives with agent 4's queue.

Capability: `setTimeout` and `AbortSignal.timeout` call
`Compiler::uses("timers", ..)`, the recognition point `feat/plugin-capabilities`
(#142) defines. Until #142 lands, `uses` is a no-op stub with #142's signature.
Whichever PR merges second keeps #142's body and adds a `("timers", "sets timers
with")` row to `src/plugins.rs` `KINDS`.

## Date, Math, JSON

Only after the layers above are gone. The core path uses `Date.now`, `Math.min/max/
floor/ceil/trunc`, and `JSON.stringify` of arrays of strings, all already
supported. (`Math.sin` appears only in a comment: `md5.ts` writes its table out.)

## PRs

A stack: each one needs the one below it.

1. `feat/stdlib-objects`: Map/Set in typed TS, runtime delete/clear/forEach/live
   iteration, iterators, module-level constants.
2. `feat/stdlib-url`: URL/URLSearchParams, the vendor `DS` fix and `~` patch, and WPT.
3. `feat/stdlib-abort`: AbortController/AbortSignal and timers.
4. Date/Math/JSON gaps, from the merged-state table. None are exposed yet: the core
   path's `Date.now`, `Math.min/max/floor/ceil/trunc` and `JSON.stringify` of
   string arrays are already supported.
