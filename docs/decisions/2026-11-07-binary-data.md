# Bytes are PHP strings shared through buffer objects

files-sdk moves every upload and download through `Uint8Array`, `ArrayBuffer`,
`TextEncoder`/`TextDecoder` and `Blob`. Its npm build reaches them from checked
JavaScript (bundled `.js`), so the runtime needs exact JavaScript semantics for
those objects before the library can compile.

## Representation

An `ArrayBuffer` is a PHP object holding one binary string. A typed array or
`DataView` is a separate object holding that buffer, a byte offset and a length.
`subarray` and `new Uint8Array(buffer, offset, length)` share the buffer object,
so a write through one view is visible through every other view. `slice`, `new
Uint8Array(view)` and `ArrayBuffer.prototype.slice` copy with `substr`.

Measured on PHP 8.5, 5 MiB, one byte at a time:

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

`TextEncoder.encode` returns the string's bytes as stored: Zero strings are
UTF-8 already, and lone surrogates are refused before they exist.
`TextDecoder` is UTF-8 only (the WHATWG UTF-8 labels, case-insensitive), with
`fatal` and `ignoreBOM`; other labels throw a TypeError. Valid input takes the
`mb_check_encoding` fast path. Invalid input runs the WHATWG UTF-8 decoder,
replacing each maximal subpart with U+FFFD, because `mb_scrub` and
`mb_convert_encoding` replace different spans on truncated and surrogate
sequences. `stream: true` is refused at runtime.

`Blob` holds an immutable string and a type. Parts are strings (UTF-8),
`ArrayBuffer`s, views and Blobs; `endings: "native"` rewrites string parts to
`PHP_EOL`, the host's line separator, as Node does on the same host. `text()`,
`arrayBuffer()` and `bytes()` return through `JsBlob::settle()` so the promise
model can wrap them in one place; today `await` is a blocking value
pass-through. `stream()` calls the factory registered with `JsBlob::onStream()`,
which the streams work installs; until then it throws a TypeError. `File` adds
`name` and `lastModified` (default `Date.now()`).

`FileReader` is a known global whose construction throws a TypeError: files-sdk
references it only on a branch that runs when `Blob.prototype.arrayBuffer` is
missing, and refusing the name at build time would block the whole library.

`Buffer` stays undefined. files-sdk's core path never reaches it.

Module-scope constructions such as `const SINES = Uint32Array.of(...)` or
`const textEncoder = new TextEncoder()` evaluate at build time to a deferred
value whose arguments must be plain data; compiled code rebuilds each one once
per request.

## Boundaries

This change covers checked JavaScript, which is how npm builds compile. Typed
TypeScript handlers can receive and pass library byte values but get no static
`Uint8Array` type yet; using a byte global there is refused with a fix. Action
and ability results that contain byte objects throw a TypeError naming the path
and a text fix, because JSON has no byte form and silently emitting an object of
indexes would be a different wire contract. WordPress request bodies and media
uploads accepting and producing `Blob`/`Uint8Array` directly is a follow-up.

## Cost

A 5 MiB text body through the memory adapter's byte path (encode, copy, 64 KiB
chunked concatenation, Blob, decode) takes 40 ms and 18 MB peak in PHP, against
10 ms in Node. files-sdk's pure-JavaScript MD5 ETag over the same body takes
about 78 s in compiled PHP (52 s with the opcache JIT) against 18 ms in Node:
every arithmetic and bitwise operation in its loop goes through checked dynamic
dispatch. Recognizing that function and routing it to PHP's `md5()` would be
unsound in general; the useful fix is typed lowering of numeric loops in checked
JavaScript, which is outside this change.

## Reuse

No maintained Composer package implements JavaScript typed array or WHATWG
encoding semantics; PHP packages that wrap byte strings differ on views,
wraparound and replacement. We write the runtime classes and use PHP core for
the bytes (`substr`, `pack`/`unpack`, `mb_check_encoding`, `base64_*`).
