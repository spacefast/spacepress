# Standard host globals instead of Zero-specific helpers

Handlers should read like ordinary TypeScript: outbound HTTP through the
global `fetch`, hashing and random values through `node:crypto` or the global
`crypto`, and runtime variables through `process.env`. Zero still runs only
PHP at request time, so the compiler recognizes these forms and lowers them
onto the existing PHP runtime classes. Anything it cannot lower soundly is a
located compile error with a fix.

We keep one way to do each thing. The `fetch` and `crypto` exports that the
previous two changes added to `"zero"` are removed with their types, docs and
tests; `env()` remains only as a deferred config reference (webhooks,
signatures, upload credentials) and is refused inside handlers in favor of
`process.env`. `mail` stays in `"zero"` because it has no standard equivalent.

## Where it happens

Every host form lowers in `src/compile/host.rs`. Each lowering reports what it
does through `Compiler::host_use(HostUse, span)` before emitting PHP:
`HostUse::Fetch`, `HostUse::Crypto(name)` and `HostUse::EnvRead(name)`. That
one function sees every outbound call, crypto call and env read, so a later
capability check has one place to hook.

- Calls: `Compiler::host_call` runs before the other builtin call dispatch.
  It handles `fetch(...)`, `crypto.*(...)`, `node:crypto` functions and their
  chains (`createHash(a).update(s).digest(e)`, `createHmac(a, k)...`,
  `randomBytes(n).toString("hex")`, `timingSafeEqual(Buffer.from(a), Buffer.from(b))`),
  `Buffer.byteLength(s)`, `process.*(...)` and `require(...)`.
- Reads: `Compiler::host_member` / `host_index` handle `process.env.NAME` and
  `process.env["NAME"]`, and refuse every other `process` read.
- `new Headers(...)`, `new URLSearchParams(...)` in `host_new`; `new URL`,
  `Request`, `Response` are refused with a fix.
- Values: `Ty::Host(HostTy::{Response, Headers, SearchParams})`, nominal, with
  members and methods in `host_property` / `host_method`. Runtime classes are
  `Zero\FetchResponse`, `Zero\FetchHeaders`, `Zero\SearchParams`.

## Decisions

- `fetch(input, init?)`: `input` is a string. `URL` objects are refused: the
  vendored WHATWG URL parser does not load in the runtime (its IDNA tables
  need a constant the prefixer drops), and a half-implemented URL would
  diverge. `init` takes `method`, `headers` (object, array of pairs, or
  `Headers`), `body` (string or `URLSearchParams`) and `redirect`
  (`follow`, `manual`, `error`). Every other `RequestInit` key is refused at
  its property.
- `redirect: "manual"` returns the 3xx response as Node does; `"error"` throws
  `HttpError(502, zero_fetch_redirect_denied)`, consistent with the other
  refusals. The egress policy is unchanged.
- Response: `status`, `statusText`, `ok`, `url`, `redirected`, `bodyUsed`,
  `headers.get/has/forEach`, `text()`, `json()`. A second body read throws the
  same TypeError as Node.
- `process.env.X` is `string | undefined` (missing is the `undefined`
  sentinel, not PHP null) and reads `Zero\Env::get`. Dynamic keys, iteration,
  writes and other `process` members are refused.
- `node:crypto` / `crypto` imports and a top-level
  `const ... = require("node:crypto")` lower to the same binding (the require
  is rewritten to an import in `lower.rs`). Other Node built-ins are refused in
  the loader.
- HMAC keys read as `process.env.NAME` (optionally with `!`) keep the 0.8
  rule: trimmed, and a missing or blank secret throws
  `500 crypto_key_unavailable`. Any other key expression is used as given.
- `timingSafeEqual` is accepted only as
  `timingSafeEqual(Buffer.from(a), Buffer.from(b))` over strings, which keeps
  Buffer semantics (UTF-8 bytes; unequal byte lengths throw RangeError).
  `Buffer.byteLength(s)` is supported so the length check is expressible.
- Web Crypto: `crypto.randomUUID()` only. No typed arrays in the compiler, so
  `getRandomValues` is refused; `crypto.subtle` is refused with a pointer to
  `node:crypto`.
- `zero migrate app` maps 0.8's global `fetch` with no rewrite, `ctx.env.X`
  to `process.env["X"]`, and `ctx.crypto.*` to `node:crypto`.
- Types come from the standard declarations (`@types/node`, which declares
  `fetch`, `crypto`, `process`, `Buffer`, `Headers`, `URLSearchParams`).
