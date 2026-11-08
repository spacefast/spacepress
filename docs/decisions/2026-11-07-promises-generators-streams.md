# Promises run on a deterministic job queue; async bodies run on Fibers

Zero compiled `await` as a blocking call, and refused every promise-as-value,
generator, `for await` and stream construct. files-sdk needs all of them:
`Promise.all`/`allSettled`/`resolve`/`reject`, `new Promise(executor)`, async
generators (`listAll`, `search`), `for await`, `ReadableStream` bodies and
`p-map`. Ordering between promise jobs is observable in JavaScript, so a
plain blocking model would diverge silently as soon as two promises are alive
at once. This record fixes the model before the code lands.

## Two domains, one queue

- **Authored TypeScript** is unchanged. `await` on Zero database calls and on
  Zero's own async functions compiles to a plain blocking call. No job can be
  queued, so ordering cannot be observed, and the blocking call is exact.
- **Imported JavaScript** (`.js`/`.mjs`/`.cjs` modules) holds promises as
  values. An `async` function call returns a `\Zero\JsPromise`, and `await`
  compiles to `\Zero\JsJobs::await($value, 'file:line:col')`. When TypeScript
  awaits a value returned from JavaScript, it drives the same queue.

A program's generated PHP changes only when it can queue a job. Each root (an
action, route, hook or job handler) is then wrapped in `\Zero\JsJobs::run`. The
root starts on an empty queue and drains it at its end. A root called from
inside another root (a hook during an action) shares its caller's queue.

## The job queue (ECMA-262 §27.2, after QuickJS and Boa)

`\Zero\JsJobs` is one FIFO microtask queue per request. It follows the
specification's abstract operations, and QuickJS (`JS_EnqueueJob`,
`js_promise_resolve_thenable_job`) and Boa (`builtins/promise`, `job.rs`)
structure jobs the same way:

- `NewPromiseReactionJob` for each settled reaction;
- `NewPromiseResolveThenableJob` when a promise resolves with a thenable, so
  adoption costs the spec's two extra ticks;
- `await v` is `PerformPromiseThen(PromiseResolve(v))`, the post-2019 await. A
  native promise is not re-wrapped, and a non-promise costs exactly one tick.

`then`/`catch`/`finally`, `Promise.resolve`/`reject`/`all`/`allSettled`/`race`/
`any`/`withResolvers` and `new Promise(executor)` are the specification's
algorithms over that queue. The executor runs synchronously. A resolve function
called from it, or later from any job, settles the promise.

## Async bodies are Fibers

PHP 8.1+ `Fiber` (the runtime floor is 8.2, so no bump is needed) suspends a
whole call stack. That is exactly what `await` needs, and it composes with PHP
`Generator`, `array_map` callbacks and nested calls with no CPS rewrite:

- Calling an async function starts a Fiber and runs its body synchronously until
  its first `await`, then returns the pending `JsPromise`, as JavaScript does.
- `JsJobs::await($v)` inside a Fiber registers a reaction on `PromiseResolve($v)`
  that resumes the Fiber as a job, then calls `Fiber::suspend()`. A rejection
  resumes the Fiber with `throw`, so `try`/`catch`/`finally` work unchanged.
- `JsJobs::await` at the root (the handler, outside any Fiber) runs the queue until
  that promise settles.
- **Settling without a timer or I/O.** If the queue empties and the promise is
  still pending, the loop asks `\Zero\Timers::runNext()` (agent 6,
  `feat/stdlib-objects`) for the earliest due timer, then drains microtasks
  again. If no timer is pending, the promise can never settle. That is a runtime
  `Error` naming the `await` site, never a hang.

Real I/O such as `Zero\Fetch` or the database is synchronous inside the job that
performs it. JavaScript does not fix the order in which concurrent I/O
completes. Under Zero, each I/O completes before the next job runs, in issue
order. That is one legal JavaScript schedule, not a divergence: a program that
is correct for every I/O ordering is correct here. Wall-clock parallelism is
lost, and that is documented.

**Handler end.** After the root promise settles, the queue drains to empty. A
rejected promise that never got a handler (the HostPromiseRejectionTracker
"reject" without a later "handle") is then a runtime error, as Node's default
`--unhandled-rejections=throw` makes it. A user timer that is still pending is
agent 6's error.

## Generators

- **Sync generators** lower to PHP's native `Generator`. `yield` maps to
  `yield`, `yield*` to `yield from` over a JS iterator adapter, and `return v`
  to `return v`. A `\Zero\JsGenerator` wrapper gives the JavaScript protocol:
  - The first `next(x)` ignores `x` (it uses `current()`); later calls use
    `send(x)`. `done` comes from `valid()` and the return value from
    `getReturn()`.
  - `throw(e)` maps to `Generator::throw`.
  - `return(v)` throws a non-`JsError` `GeneratorReturn` into the generator.
    Compiled `catch` blocks only catch `JsError`, so only `finally` blocks run,
    including any `yield` inside a `finally`, as in JavaScript.
  - Leaving a `for…of` early (`break`, `return`, a throw) calls `return()` on
    the iterator, so `finally` runs at the exit point. It does not wait for
    garbage collection.
- **Async generators** run on a Fiber plus the specification's request queue
  (AsyncGeneratorRequest records). `next`/`return`/`throw` each return a
  `JsPromise`. `yield v` awaits `v`, resolves the head request with
  `{ value, done: false }`, and suspends until the next request. `await` inside
  the body is the ordinary Fiber `await`.
- **oxc downlevel was measured and rejected.** oxc 0.152 has
  `async_to_generator` and `async_generator_functions`, but no regenerator
  (generator to state machine). Its output is still `function*` plus babel
  helpers (`asyncToGenerator`, `wrapAsyncGenerator`, `awaitAsyncGenerator`), so
  it does not remove the need for generators. Fibers and native `Generator` are
  smaller and spec-exact.

## Iterator protocol

`for…of` over a non-array value calls `obj[Symbol.iterator]()`, then
`next()`/`return()`. `for await…of` prefers `Symbol.asyncIterator` and falls
back to the sync iterator through CreateAsyncFromSyncIterator. Arrays, strings,
`Map`/`Set` and `JsGenerator` keep their native PHP fast paths.

The well-known symbols come from agent 1's `Symbol` (`feat/files-sdk-harness`).
Until that lands, the runtime reads the two well-known keys through one
function, `\Zero\Js::wellKnownSymbol('iterator' | 'asyncIterator')`. The merge
then replaces only that function.

## WHATWG streams are pull-driven chunk queues

There is no event loop, so a `ReadableStream` is an explicit chunk queue with a
desired size:

- `start` runs at construction.
- `read()` returns a `JsPromise`. If the queue is empty, it calls the underlying
  source's `pull` and awaits that call on the job queue. Backpressure is just
  "do not pull while the queue is at or above `highWaterMark`".
- `cancel`, the default reader, `releaseLock`, `tee`, async iteration
  (`values()`, `Symbol.asyncIterator`), `pipeTo` and `pipeThrough` follow the
  Streams Standard. `WritableStream` (`write`, `close`, `abort`, its writer) and
  `TransformStream` (`transform`, `flush`) work the same way.

A pull that only completes through a timer uses agent 6's `Timers` seam. One
that can never complete is the "promise can never settle" error above.

At the PHP boundary, `\Zero\JsReadableStream::fromResource($fp)` wraps a PHP
stream resource (`fopen`, `php://temp`, WordPress upload temp files,
`Zero\Fetch` bodies). It pulls fixed-size chunks with `fread`, and `toResource()`
goes the other way, so large bodies never buffer whole. Chunks are agent 3's
`Uint8Array` (`feat/binary-data`). I merge that branch when streams need it.

## p-map

p-map 7 needs no special handling under this model, and its concurrency is not a
divergence. Its runners are ordinary async functions on Fibers, and they
interleave in exact microtask order. Mapper calls start in the same order, and
suspend at the same `await` points, as in JavaScript. What differs is wall-clock
time: each piece of real I/O blocks the request while it runs, so I/O completes
in issue order (a legal JavaScript schedule, per "The job queue" above). That is
documented, not refused. Refusing would block every library that uses
`Promise.all` for fan-out, when the result is still exact.

As measured on this branch merged with main `de46201a`, p-map's `index.js` has
one diagnostic left, and it isn't async. It is Z1002 at `pMapIterable`'s
destructured option bag, where binding an object pattern from a checked
JavaScript value refused every field. The language-gaps lane fixes this in #170.
Once it lands, p-map has no async construct left that this model refuses.

## TypeScript stays explicit

Authored TypeScript keeps the typed blocking model: `await` on Zero database calls
and Zero's own async functions. Awaiting a value from imported JavaScript drives
the job queue. `for await` and generators in authored TypeScript are located
refusals ("only work in imported JavaScript"). A program pays for the job queue
only when its generated code queues jobs. Otherwise its PHP does not change, and
each root is wrapped in `Zero\JsJobs::run` only when needed.

## Refusals that remain

- **Timers and I/O callbacks.** A promise that can only settle through a timer
  or an I/O callback Zero does not model (for example `FileReader.onload` or
  event emitters) is refused with a located diagnostic when the compiler can
  see it, and otherwise fails at runtime with the "can never settle" error.
- **Cross-request lifetime.** A promise, generator or stream stored in
  cross-request state (options, the database) is refused. Each one belongs to
  one request.
