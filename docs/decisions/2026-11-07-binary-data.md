# Bytes are PHP strings shared through buffer objects

files-sdk moves every upload and download through `Uint8Array`, `ArrayBuffer`,
`TextEncoder`/`TextDecoder` and `Blob`. Its npm build reaches them from checked
JavaScript (bundled `.js`), so the runtime needs exact JavaScript semantics for
those objects before the library can compile.

This record was first written on 2026-11-07 for a branch that predates the rename to First
and the promise, generator and stream runtime (#174). It was rechecked on 2026-11-11 against
`main` after both; the sections below describe the code as it is now.

## Representation

An `ArrayBuffer` (`First\JsArrayBuffer`) is a PHP object holding one binary string. A typed
array (`First\JsTypedArray`) or `DataView` (`First\JsDataView`) is a separate object holding
that buffer, a byte offset and a length. `subarray` and `new Uint8Array(buffer, offset,
length)` share the buffer object, so a write through one view is visible through every other
view. `slice`, `new Uint8Array(view)` and `ArrayBuffer.prototype.slice` copy with `substr`.

Measured on PHP 8.5, 5 MiB, one byte at a time (2026-11-07):

| store                       | write  | read   | memory |
| --------------------------- | ------ | ------ | ------ |
| string (`$s[$i] = chr(..)`) | 50 ms  | 46 ms  | 5 MB   |
| string as object property   | 79 ms  | 57 ms  | 5 MB   |
| `SplFixedArray` of ints     | 38 ms  | 34 ms  | 80 MB  |
| packed PHP array of ints    | 32 ms  | 22 ms  | 128 MB |

Per-byte access is within 2× across stores, but integer stores cost 16× to 25×
the memory, and a 5 MB upload would exceed WordPress's default 128 MB limit as a
packed array. Bulk operations (`set`, `slice`, encoding, Blob parts,
concatenation) are `substr`/`substr_replace`/`.` on strings, which run at memcpy
speed and dominate files-sdk's real workload. The buffer string is the only copy
of the bytes; writes mutate it in place because the buffer object holds the only
reference.

Element types other than `Uint8` read and write through `pack`/`unpack` in
little-endian order, which is what Node reports on every platform WordPress runs
on. files-sdk's core path needs `Uint8Array`, `Uint32Array.of` and `DataView`
`getUint8`/`getUint32`/`setUint32` (its MD5 ETag). We implement the integer
element types and `Float32`/`Float64`; `BigInt64Array`, `BigUint64Array`,
`SharedArrayBuffer`, resizable buffers and `transfer` are refused.

## Semantics

Integer element writes use the spec conversions (ToUint8, ToInt8, ToUint8Clamp,
ToUint16, ... modulo arithmetic on ToNumber). Out-of-range integer indexes read
`undefined` and ignore writes, as typed arrays do. `JSON.stringify` of a typed
array is an object of indexes; of an `ArrayBuffer`, `Blob` or `TextEncoder`, `{}`.
Spec algorithms (relative index clamping, `set` overlap through a temporary copy,
`fill` conversion order) follow ECMA-262 and Boa's `builtins/typed_array`.

`TextEncoder.encode` returns the string's bytes as stored: First strings are
UTF-8 already, and lone surrogates are refused before they exist.
`TextDecoder` is UTF-8 only (the WHATWG UTF-8 labels, case-insensitive), with
`fatal` and `ignoreBOM`; other labels throw a TypeError. Valid input takes the
`mb_check_encoding` fast path. Invalid input runs the WHATWG UTF-8 decoder,
replacing each maximal subpart with U+FFFD, because `mb_scrub` and
`mb_convert_encoding` replace different spans on truncated and surrogate
sequences. `decode(..., { stream: true })` throws a TypeError at runtime.

`Blob` (`First\JsBlob`) holds an immutable string, a type and the lengths of its parts.
Parts are strings (UTF-8), `ArrayBuffer`s, views and Blobs; `endings: "native"` rewrites
string parts to `PHP_EOL`, the host's line separator, as Node does on the same host.
`text()`, `arrayBuffer()` and `bytes()` return settled promises (`First\JsPromise`), so
`await` and `.then` order their continuations on the job queue like any other promise.

`stream()` returns a `First\JsReadableStream` that enqueues one `Uint8Array` chunk per pull.
Node streams an in-memory Blob as one chunk per non-empty part, and a slice cuts the parts it
spans, so `JsBlob` keeps the part lengths and the stream follows them; a reader that cancels
early never copies the remaining parts. A `ReadableStream` over a PHP resource
(`JsReadableStream::fromResource`) now yields `Uint8Array` chunks too, instead of strings.
On 2026-11-07 streams did not exist yet and `stream()` threw a TypeError; that limit is gone.

`File` adds `name` and `lastModified` (default `Date.now()`).

`FileReader` is a known global whose construction throws a ReferenceError, as in Node, which
has no `FileReader`: files-sdk references it only on a branch that runs when
`Blob.prototype.arrayBuffer` is missing, and refusing the name at build time would block the
whole library.

`Buffer` stays undefined. files-sdk's core path never reaches it.

Module-scope constructions such as `const SINES = Uint32Array.of(...)` or
`const textEncoder = new TextEncoder()` evaluate at build time (`src/eval.rs`) to a deferred
value (`Value::Native`) whose arguments must be plain data; compiled code rebuilds each one
once per request through the same runtime constructor. A deferred value can be called or have
its members read directly; storing one inside other module-scope data is refused, because the
data would be serialized at build time.

`Number.prototype.toString(radix)` is exact for safe integers in every radix (files-sdk's MD5
formats bytes with `toString(16)`). Fractions and integers beyond 2^53 in a non-decimal radix
throw a TypeError, because their digits depend on the engine's algorithm.

## Boundaries

This change covers checked JavaScript, which is how npm builds compile. Typed
TypeScript handlers can receive and pass library byte values but get no static
`Uint8Array` type yet; using a byte global there is refused with a fix. Action
and ability results that contain byte objects throw a TypeError naming the path
and a text fix, because JSON has no byte form and silently emitting an object of
indexes would be a different wire contract. WordPress request bodies and media
uploads accepting and producing `Blob`/`Uint8Array` directly is a follow-up.

## Cost

Release build, PHP 8.5.10 CLI, Node 22.23.1, on a shared Linux box under load. Both sides time
only the call, not compilation or process start; the PHP side is one action call through the
compiled handler (`hrtime` around it), Node is `performance.now()` around the same function.

files-sdk's MD5 (`tests/differential/files-sdk-md5.mjs`, its `src/internal/md5.ts` verbatim)
over `n` bytes `(i * 31) & 255`, digests equal to Node at every size:

| input | Node | PHP | PHP with opcache JIT (`tracing`) |
| ---: | ---: | ---: | ---: |
| 3 B | 0.1 ms | 4.7 ms | |
| 64 B | 0.1 ms | 5.7 ms | |
| 1 KiB | 0.7 ms | 17.9 ms | |
| 64 KiB | | 847 ms | |
| 1 MiB | 10.4 ms | 13.5 s | 5.2 s |

PHP peak memory stays at 4 to 6 MB. That is about 13 µs per byte against Node's 10 ns: every
arithmetic and bitwise operation in the compression loop goes through checked dynamic dispatch.
Recognizing that function and routing it to PHP's `md5()` would be unsound in general; the
useful fix is typed lowering of numeric loops in checked JavaScript, which is outside this
change. files-sdk computes this hash for every upload through the memory adapter, so uploads
of more than a few hundred KiB are slow until then.

A 5 MiB text body through the byte path without the hash (build the text, `encode`, copy, cut
into 64 KiB `subarray` chunks, concatenate with `set`, `Blob`, `text()`, compare with `decode`)
takes 129 to 139 ms and 28.5 MB peak in PHP against 45 to 46 ms in Node (two runs each).

## What did not carry over from the first branch

Everything on `feat/binary-data` (e3e09961) carried over under First names: the runtime
classes, compiler dispatch, build-time deferred values, the fast paths for typed array
indexing and `DataView` reads, the separate data-helper key for deferred values, the radix
cases and the refusal fixture. Two things changed rather than carried over:

- The `JsBlob::settle()` / `JsBlob::onStream()` seams were dropped. They existed so the
  promise and stream work could plug in later; that work landed first, so `JsBlob` uses
  `JsPromise` and `JsReadableStream` directly.
- The "Blob.stream() before ReadableStream exists" refusal was dropped from the registry and
  replaced by the per-part streaming above.

## Reuse

No maintained Composer package implements JavaScript typed array or WHATWG
encoding semantics; PHP packages that wrap byte strings differ on views,
wraparound and replacement. We write the runtime classes and use PHP core for
the bytes (`substr`, `pack`/`unpack`, `mb_check_encoding`, `base64_*`).
