# Node built-ins on WP Cloud: crypto, Buffer and the common modules

Status: approved direction (owner, 2026-11-26), design for review.

## Why

SpacePress server code can hash and HMAC, and nothing more. Any API that signs
requests with a key pair (bunq, Apple, Google service accounts, GitHub Apps,
JWT/JOSE), encrypts a secret at rest, or uses a common npm package that imports
`buffer`, `events`, `path` or `zlib` fails to compile. The first consumer is
ledger's bunq sync, which must generate an RSA key, sign request bodies with
RSA-SHA256, verify bunq's response and callback signatures, and encrypt stored
tokens.

The owner asked for "all the basics, as soon as possible, in one PR, the most
efficient way: use existing PHP, WordPress or Composer code, and target only WP
Cloud."

## Goals

1. Authored TypeScript and installed JavaScript can use Node's own API for:
   - `Buffer` (and `node:buffer`): `Buffer.from` (string with utf8, hex, base64,
     base64url, latin1; array; ArrayBuffer; Uint8Array), `Buffer.alloc`,
     `Buffer.concat`, `Buffer.isBuffer`, `Buffer.byteLength`,
     `buf.toString(encoding?)`, `buf.equals`, `buf.slice`/`subarray`,
     `buf.length`, indexing, `buf.toJSON`.
   - `node:crypto`, in addition to today's subset:
     - keys: `generateKeyPairSync` (`rsa`, `ec` P-256/P-384, `ed25519`),
       `createPrivateKey`, `createPublicKey`, `createSecretKey`, and
       `KeyObject.export` (PEM pkcs8/spki/pkcs1, DER, JWK) and `.type`,
       `.asymmetricKeyType`.
     - signatures: `createSign`/`createVerify` (`update`, `sign`, `verify`),
       one-shot `sign`/`verify` (RSA PKCS#1 v1.5, RSA-PSS, ECDSA, Ed25519).
     - ciphers: `createCipheriv`/`createDecipheriv` for `aes-128/256-gcm` (with
       `getAuthTag`/`setAuthTag`/`setAAD`) and `aes-128/256-cbc`; `publicEncrypt`
       /`privateDecrypt` (OAEP and PKCS#1).
     - derivation: `pbkdf2Sync`, `hkdfSync`.
     - `getHashes`, `getCiphers`, and `createHash`/`createHmac`/`digest`
       accepting and returning Buffers.
   - global `crypto.subtle`: `digest` (exists), `importKey`, `exportKey`
     (raw, pkcs8, spki, jwk), `generateKey`, `sign`, `verify`, `encrypt`,
     `decrypt`, `deriveBits`, `deriveKey` for RSASSA-PKCS1-v1_5, RSA-PSS,
     RSA-OAEP, ECDSA (P-256/384), Ed25519, HMAC, AES-GCM, AES-CBC, PBKDF2 and
     HKDF; `crypto.getRandomValues`.
   - `node:path` (POSIX only; `path.posix` is the same object), `node:querystring`,
     `node:string_decoder`, `node:events` (`EventEmitter`, `once`), `node:util`
     (`format`, `inspect` for plain values, `promisify`, `types`,
     `TextEncoder`/`TextDecoder`, `isDeepStrictEqual`), `node:zlib` (sync and
     callback `gzip`/`gunzip`/`deflate`/`inflate`/`deflateRaw`/`inflateRaw`).
   - The bare names (`"crypto"`, `"buffer"`, ...) resolve the same as `node:`.
2. Every function returns what Node returns for the same input, proven by the
   existing differential suite (run in Node, run as generated PHP, compare).
3. Typed TypeScript gets static types for `Buffer`, `Uint8Array`, `ArrayBuffer`,
   `KeyObject`, `CryptoKey` and the other returned objects, so authored code
   does not need to drop to imported JavaScript to touch bytes.

## Non-goals

- Hosts other than WP Cloud. The PHP floor stays SpacePress's (8.2), but the
  only extensions relied on are the ones WP Cloud ships: `openssl`, `sodium`,
  `hash`, `zlib`, `mbstring`. No new Composer dependency, no pure-PHP crypto.
- `scrypt`, `diffieHellman`/ECDH, X25519, DSA, `createECDH`, streams-based
  crypto (`crypto.createHash().pipe`), `KeyObject` from a password-protected
  PEM, brotli, `zlib` streams, `node:fs`, `node:http`, `node:child_process`,
  `node:os`, `node:stream`. Each is refused at compile time with a fix.
- Windows path semantics (`path.win32`).

## Anti-goals

- A result that silently differs from Node's. Anything that cannot match Node
  exactly is refused at build time, never approximated at run time.
- Secret material in logs, error messages or `util.inspect` output. A
  `KeyObject` prints as `KeyObject { type: 'private' }` like Node does.
- A second byte representation. `Buffer` is the existing `Uint8Array`
  runtime value with Buffer's methods; there is one bytes type underneath.

## Approaches considered

1. **Node-compatible modules, built on PHP extensions (chosen).** Implement
   Node's API over `openssl_*`, `sodium_*`, `hash_*` and `zlib`. Code also runs
   under Node, `@types/node` types it in the editor, and npm packages that
   import these modules compile.
2. Raw PHP functions typed from php-src stubs (`spacepress/server/php/openssl`).
   General and cheap per extension, but the API is PHP's, not Node's, and it
   does nothing for npm packages. The owner chose 1 ("just add node compat").
3. Both. More to maintain for no current need.

## How it is built (decided)

- **One table, not one Rust function per method.** Today each `node:crypto`
  export is a hand-written lowering in `src/compile/host.rs`. Instead, add one
  declarative catalog (`src/node/catalog.json`, the same idea as
  `src/wordpress/catalog.json`) listing each module's exports, each class's
  methods and properties, their parameter and return types, and the PHP
  function they call. A generic emitter in the compiler reads it. The current
  `createHash`/`createHmac` chain lowering and `randomBytes`/`timingSafeEqual`
  move onto it, so there is one path for every Node built-in.
- **Runtime as PHP classes** under `runtime/SpacePress/Node/`: `Buffer` (extends
  the existing `JsTypedArray` Uint8 view), `KeyObject`, `Sign`, `Verify`,
  `Cipheriv`, `Decipheriv`, `Hash`, `Hmac`, `Subtle`, `CryptoKey`, `Path`,
  `QueryString`, `StringDecoder`, `EventEmitter`, `Util`, `Zlib`. The existing
  `SpacePress\Crypto` is folded into these. They are reachable from checked
  JavaScript dispatch (`Js::dynamicCallMethod`) too, so imported npm code and
  typed code call the same objects.
- **Typed bytes.** Add `Buffer`, `Uint8Array` and `ArrayBuffer` as static types
  in typed TypeScript (lifting the "byte globals only in imported JavaScript"
  refusal in `src/compile/javascript.rs:37` for these three; the other typed
  arrays, DataView and Blob stay JavaScript-only). Bytes still cannot cross
  into action results or the database without an explicit encoding; the
  existing TypeError for bytes in JSON results stays.
- **Missing extension.** Each runtime entry point checks its extension once
  and throws Node's error shape with a message naming the extension, so a host
  without it fails loudly instead of differently.
- **Capabilities.** New functions report through `host_use` as `Crypto` (no
  plugin capability, like today); `zlib` the same.

## Tests

- Extend `tests/differential/host-globals.ts` (or sibling files per module) so
  every export above runs in Node and as generated PHP, comparing outputs.
  Deterministic operations compare bytes (RSA PKCS#1 v1.5, Ed25519, HMAC,
  AES with a fixed IV, PBKDF2, HKDF, zlib). Randomized ones (ECDSA, RSA-PSS,
  OAEP, generated keys) cross-check: PHP signs, Node verifies, and the reverse.
- Known-answer vectors from RFCs (RFC 4231 HMAC, RFC 5869 HKDF, RFC 6070
  PBKDF2, RFC 8032 Ed25519, NIST GCM) in a vectors JSON, like
  `builtin-vectors.json`.
- One pinned npm probe per module family in `examples/npm-compat`
  (for example `jose` for JWS/JWE over `crypto.subtle`, `events`, `path`
  consumers) to prove real packages compile and match Node.
- Refusal fixtures for each non-goal API, with the diagnostic and fix.
- `www/content/docs/reference/language-support.md`: new entries for each
  module, with their evidence lines; drop "Node built-ins other than
  node:crypto ... are refused".

## Calls made after review (author's calls, not the owner's)

1. **PHP version.** Spacefast runs PHP 8.5 only (monorepo `runtime/README.md`).
   PHP 8.5 added `padding` to `openssl_sign`/`openssl_verify` and `digest_algo`
   to `openssl_public_encrypt`/`openssl_private_decrypt`, which RSA-PSS and
   RSA-OAEP with SHA-256 need. Ed25519 uses `sodium` (present on every
   supported PHP), wrapped in PKCS#8/SPKI DER by hand (fixed 16- and 12-byte
   prefixes). On PHP below 8.5, PSS and OAEP-SHA-256 throw Node's
   `ERR_OSSL_*`-shaped error naming PHP 8.5; everything else works from 8.2.
   The differential crypto job in CI runs on PHP 8.5 (the rest of CI keeps
   8.3).
2. **Build time.** The new modules run in compiled code only. Calling them while
   a module's top level is evaluated at build time stays refused, with the fix
   "move it into a function", as `node:crypto` is today. Top-level `class X
   extends EventEmitter` declarations compile (no call runs); `path.sep` and
   other constant reads are folded by the evaluator from the catalog. No second
   Rust implementation.
3. **Typed surface.** Typed TypeScript gets static types for `Buffer`,
   `Uint8Array`, `ArrayBuffer`, every `node:crypto` export and its objects
   (`KeyObject`, `Sign`, `Verify`, `Cipher`, `Decipher`, `Hash`, `Hmac`),
   `crypto.subtle` and `CryptoKey`, `node:path`, `node:querystring` and the
   sync `node:zlib` functions. `EventEmitter`, `util.promisify`, `util.inherits`,
   `StringDecoder` and zlib callbacks are available to imported JavaScript only;
   typed use is refused with "use it from a JavaScript helper".
4. **Existing differences from Node stay and are documented.** The `process.env`
   HMAC key trim, the blank-key refusal, the 1 MiB input cap and the
   `randomBytes` 0–1024 limit stay. New caps, each a documented difference:
   zlib output 16 MiB (decompression bombs), `pbkdf2Sync` iterations ≤ 1,000,000.
5. **Buffers and JSON.** `JSON.stringify(buf)` follows Node
   (`{"type":"Buffer","data":[...]}`). Bytes in an action, query or ability
   result keep the existing TypeError, which is a SpacePress boundary rule, and
   typed code gets it at compile time when the result type is `Buffer`.
6. **No `node` export condition.** The resolver keeps `import`, `require` and
   `default`; changing what every package resolves to is out of scope. The
   probes pin packages whose neutral builds use these modules (`jose` 6, which
   uses only `crypto.subtle`).
7. **Errors.** The differential suite compares `name` and `code`; messages are
   not compared (OpenSSL text varies by version).
8. **Hash list.** `getHashes()`/`getCiphers()` return what SpacePress supports.
   `createHash`/`createHmac` add `sha224`, `sha512-224`, `sha512-256`,
   `sha3-256`, `sha3-384`, `sha3-512` (all in PHP's `hash`).

## Left to the builder

- Exact catalog file shape and how the emitter handles overloads.
- Which `util.inspect` options are honoured beyond plain values.
- Splitting the work into commits inside the one PR.

## Rollout

One SpacePress PR. Spacefast then needs its bundled SpacePress compiler bumped
(a monorepo PR like #6183) before a Space can use these APIs; that bump is a
separate PR in `spacefast/monorepo`.
