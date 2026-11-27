# Node Built-ins on WP Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compiled SpacePress code can import `node:crypto` (keys, sign/verify, ciphers, KDFs), `Buffer`/`node:buffer`, `crypto.subtle`, `node:path`, `node:querystring`, `node:string_decoder`, `node:events`, `node:util` and `node:zlib`, with results identical to Node, on WP Cloud's PHP extensions.

**Architecture:** Every Node built-in module becomes a runtime *namespace object* (`SpacePress\Node\Module`) reached through the existing checked-JavaScript dispatch (`Js::dynamicCallMethod` / `dynamicGet` / `dynamicConstruct`). Its functions return PHP runtime objects (`Buffer` is the existing `JsTypedArray` Uint8 view flagged as a Buffer; `KeyObject`, `Sign`, `Hash`, `Cipheriv`, `EventEmitter`, ...) that the same dispatch handles. The compiler stops special-casing `node:crypto` exports: an import of any supported built-in yields a `Ty::Dynamic` module value in both imported JavaScript and typed TypeScript, so typed code uses them like any imported JavaScript value (assign to `unknown`-free locals, narrow with `typeof`/`as`). The existing hash chain lowering and `Buffer.from`/`byteLength` special cases are deleted, which is the main simplification.

**Tech Stack:** Rust compiler (`src/`), PHP 8.2+ runtime (`runtime/SpacePress/`), PHP extensions `openssl`, `sodium`, `hash`, `zlib`, `mbstring`; Node 22 for the differential suite.

**Spec:** `docs/superpowers/specs/2026-11-26-node-builtins-design.md`

## Global Constraints

- Only PHP extensions WP Cloud ships: `openssl`, `sodium`, `hash`, `zlib`, `mbstring`. No new Composer dependency, no pure-PHP crypto.
- PHP floor stays 8.2. RSA-PSS and RSA-OAEP with a non-SHA-1 hash need PHP 8.5 (`openssl_sign`/`openssl_verify` `padding`, `openssl_public_encrypt` `digest_algo`); below 8.5 they throw `Error` with `code` `ERR_OSSL_UNSUPPORTED` and a message naming PHP 8.5.
- Results match Node; anything that can't is refused at build time with a fix, never approximated.
- Existing documented differences stay: HMAC key from `process.env` is trimmed, blank env key refused (500), 1 MiB input cap on hash/HMAC data (413), `randomBytes` size 0–1024.
- New caps: zlib output ≤ 16 MiB (`RangeError`, `code` `ERR_BUFFER_TOO_LARGE`), `pbkdf2Sync` iterations ≤ 1,000,000 (`RangeError`, `code` `ERR_OUT_OF_RANGE`).
- Module functions run only in compiled code; calling one while a module's top level is evaluated at build time stays refused ("move it into a function"). `path.sep`, `path.delimiter` and `os`-free constants are folded at build time.
- `KeyObject` and `CryptoKey` never print key material: `util.inspect`/`String()` give `KeyObject { type: 'private' }` / `CryptoKey { type: 'secret' }`.
- Differential tests compare error `name` and `code`, not message text.
- `getHashes()`: `md5 sha1 sha224 sha256 sha384 sha512 sha512-224 sha512-256 sha3-256 sha3-384 sha3-512`. `getCiphers()`: `aes-128-cbc aes-128-gcm aes-256-cbc aes-256-gcm`.
- `JSON.stringify(buffer)` = `{"type":"Buffer","data":[...]}`; bytes in an action/query/ability result keep the existing TypeError.
- No `node` package export condition is added.
- Typed use of `EventEmitter` subclassing, `util.promisify`, `util.inherits`, `StringDecoder` and zlib callbacks is refused in typed TypeScript ("use it from a JavaScript helper").

## Review Focus

1. **A Buffer from one module handed to another** (`createHash().update(buf)`, `zlib.gzipSync(buf)`, `Buffer.concat([sig, iv])`, `key.export()` → `createPrivateKey(pem)`): every entry point accepts `string | Buffer | Uint8Array | ArrayBuffer | DataView` like Node. Test: Task 2 `interop` case.
2. **Non-ASCII text and odd encodings**: `Buffer.from("é😀")`, invalid base64 padding, hex with odd length (Node truncates), `latin1` round trip. Test: Task 2 `encodings` case.
3. **Wrong key types and bad input**: verifying with a private key (Node accepts), signing with a public key (throws `ERR_OSSL_*`), AES-GCM with a wrong tag (throws `Error` `Unsupported state or unable to authenticate data`), wrong IV length (`ERR_CRYPTO_INVALID_IV`). Test: Task 4 `errors` case.
4. **Keys moving between Node and PHP** (bunq's case): a PEM made by Node imports in PHP and the reverse; a JWK round-trips; a signature from one verifies in the other. Test: Task 4 cross-check cases.
5. **Typed TypeScript ergonomics**: `const sig = sign("sha256", Buffer.from(body), key).toString("base64")` compiles in typed code without a helper file and yields a `string`. Test: Task 1 typed case.

---

### Task 1: Built-in modules become dynamic namespace values

Replace the `node:crypto`-only special case with a general built-in module table; `createHash`/`createHmac`/`randomBytes`/`randomUUID`/`timingSafeEqual` keep working through dispatch instead of compile-time lowering.

**Files:**
- Modify: `src/builtins.rs` (`BuiltinModule` enum, `exports()`, `module()`)
- Modify: `src/value.rs:306-307` (`Builtin::NodeCrypto` → `Builtin::NodeModule(BuiltinModule, Option<&'static str>)`)
- Modify: `src/eval.rs` (lines 1049-1050, 1330-1346, 1426-1436, 2743-2744, 3407, 4830-4844)
- Modify: `src/compile.rs:5089` (value use of a module function), and the module-value lowering
- Modify: `src/compile/host.rs` (delete `hash_chain`, `digest`, `random_bytes`, `node_crypto_call`, `buffer_from`, `buffer_call`'s `Buffer.from` special case, `NODE_CRYPTO`, `unknown_node_crypto`; keep `fetch`, env, platform, `Headers`)
- Modify: `src/compile/javascript.rs:39-61` (`binary_global`: allow `Buffer`, `Uint8Array`, `ArrayBuffer`, `TextEncoder`, `TextDecoder` in typed code as `Ty::Dynamic`)
- Modify: `src/eval.rs:413` `GLOBALS` / `BINARY_GLOBALS` (add `Buffer`)
- Create: `runtime/SpacePress/Node/Module.php`
- Modify: `runtime/SpacePress/JsDynamic.php` (dispatch `Node\Module` receivers; `dynamicNamespace` unchanged)
- Test: `tests/differential/node/typed.ts` (new), `tests/compiler_contracts.rs` (new test `node_modules_typed_use_matches_node`), existing `host_globals_match_node_through_generated_php` must still pass unchanged except where noted.

**Interfaces:**
- Produces (Rust): `pub enum BuiltinModule { Crypto, Buffer, Path, QueryString, StringDecoder, Events, Util, Zlib }`; `BuiltinModule::specifier(self) -> &'static str` (`"node:crypto"` ...); `BuiltinModule::exports(self) -> &'static [&'static str]`; `pub fn module(spec: &str) -> Option<BuiltinModule>` accepting both `node:x` and bare `x`.
- Produces (PHP): `final class SpacePress\Node\Module { public static function get(string $name): self; public function member(string $key): mixed; public function call(string $key, array $args): mixed; }` — `$name` is the bare module name (`"crypto"`). Each module's members are registered by later tasks via `Module::register(string $name, array $members)` where `$members` maps an export name to a `\Closure` (functions) or a value (constants, classes as `JsConstructor`-like `Node\Ctor` objects).
- Compiler emits: module value → `\SpacePress\Node\Module::get('crypto')`; named import `x` → `\SpacePress\Node\Module::get('crypto')->member('x')`; call of a named import → `\SpacePress\Node\Module::get('crypto')->call('x', [...])`. All typed as `Ty::Dynamic`.
- Global `Buffer` → `\SpacePress\Node\Module::get('buffer')->member('Buffer')`.

- [ ] **Step 1: Write the failing typed test** `tests/differential/node/typed.ts`:

```ts
import { defineConfig, mutation } from "spacepress";
import { createHash, createHmac, randomBytes } from "node:crypto";
import * as nodeCrypto from "node:crypto";

export const typedHashes = mutation({}, () => {
  const hex = createHash("sha256").update("a").update(Buffer.from("b")).digest("hex") as string;
  const h = createHmac("sha256", "k");
  h.update("x");
  const b64 = h.digest().toString("base64") as string;
  const n = (randomBytes(16) as Uint8Array).length as number;
  const viaNs = nodeCrypto.createHash("md5").update("").digest("base64url") as string;
  return [hex, b64, n, viaNs];
});
export default defineConfig({ name: "node-typed" });
```

and in `tests/compiler_contracts.rs` a test `node_modules_typed_use_matches_node` that runs it through the same Node-vs-PHP harness as `host_globals_match_node_through_generated_php` (reuse `project_from`, `run-node.mjs`, `build_wp`) and asserts equal output.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test --test compiler_contracts node_modules_typed_use_matches_node`
Expected: FAIL at build with "a hash is compiled as one expression" (the separate `h.update`).

- [ ] **Step 3: Implement the module table and dispatch** in the files above. `Node\Module::get('crypto')` registers today's five functions over the existing `SpacePress\Crypto` (hash/HMAC now return a stateful `Node\Hash` object with `update(data, encoding?)` and `digest(encoding?)`; `digest()` without an encoding returns a Buffer; the 1 MiB cap applies to the total updated bytes). `process.env` HMAC key trim: `createHmac` keeps a `hmacEnv` path only when the compiler sees `process.env.NAME` as the key argument — emit `Module::get('crypto')->call('createHmac', [$alg, \SpacePress\Crypto::envKey('NAME')])` where `envKey` trims and refuses blank. Buffer here may be a minimal `Node\Buffer` stub with `from(string)`, `toString(enc)`, `length`; Task 2 completes it.

- [ ] **Step 4: Run tests**

Run: `cargo test --test compiler_contracts node_modules_typed_use_matches_node host_globals_match_node_through_generated_php binary_data_matches_node_through_generated_php`
Expected: PASS. Then `cargo test --test compiler_contracts` (whole file) — fixtures that asserted the removed refusals ("a hash is compiled as one expression", "randomBytes() returns a Buffer", "Buffer values aren't available") are deleted or updated to the new behavior; any registry entry pointing at them in `tests/compatibility/registry.json` is updated.

- [ ] **Step 5: Commit** `git commit -m "Compile Node built-in modules as checked namespace values"`

---

### Task 2: Buffer and node:buffer

**Files:**
- Create: `runtime/SpacePress/Node/Buffer.php`
- Modify: `runtime/SpacePress/JsTypedArray.php` (a `public bool $nodeBuffer = false` flag; `Buffer` instances are `JsTypedArray('Uint8Array', ...)` with the flag set so `instanceof Uint8Array` holds as in Node)
- Modify: `runtime/SpacePress/JsBinary.php` (route Buffer methods; `json()` returns `{type:"Buffer",data:[...]}` for flagged arrays)
- Test: `tests/differential/node/buffer.mjs` (new, run by `binary_data_matches_node_through_generated_php`-style harness: extend that test's file list to include it)

**Interfaces:**
- Consumes: `Node\Module::register` (Task 1).
- Produces (PHP): `Node\Buffer::bytes(mixed $value, string $what): string` — accepts string (UTF-8), flagged/unflagged `JsTypedArray` (its bytes), `JsArrayBuffer`, `JsDataView`; throws `TypeError` `code` `ERR_INVALID_ARG_TYPE` naming `$what` otherwise. `Node\Buffer::wrap(string $bytes): JsTypedArray` (flagged). `Node\Buffer::decode(string $text, string $encoding): string`, `Node\Buffer::encode(string $bytes, string $encoding): string` for `utf8|utf-8|hex|base64|base64url|latin1|binary|ascii|utf16le|ucs2`. **Every later task converts inputs with `bytes()` and returns bytes with `wrap()`.**
- Exports of `buffer` module: `Buffer`, `constants` (`MAX_LENGTH`), `kMaxLength`, `atob`, `btoa`.
- `Buffer` statics: `from`, `alloc(size, fill?, enc?)`, `allocUnsafe` (zero-filled), `concat(list, totalLength?)`, `isBuffer`, `isEncoding`, `byteLength(value, enc?)`, `compare`. Instance methods: `toString(enc?, start?, end?)`, `equals`, `compare`, `slice`/`subarray` (views), `write(string, offset?, enc?)`, `copy`, `fill`, `indexOf`, `includes`, `toJSON`, `readUInt8/16BE/16LE/32BE/32LE`, `writeUInt8/16BE/16LE/32BE/32LE`, `readInt32BE/LE`, `readBigUInt64BE/LE` (returns `JsBigInt`); plus every inherited Uint8Array method.

- [ ] **Step 1: Write the failing test** `tests/differential/node/buffer.mjs` exporting async functions, each returning plain JSON, including:
  - `encodings`: for `"é😀 ok"` → `toString` in every encoding above; `Buffer.from("abc", "hex")` (odd → `"ab"` then stops), `Buffer.from("YQ", "base64")`, `Buffer.from("YQ==", "base64url")`, latin1 round trip of `"\xff\x00"`.
  - `interop`: `Buffer.concat([Buffer.from("a"), new Uint8Array([98]), Buffer.alloc(2, 1)]).toString("hex") === "616201 01"` (without space), `Buffer.isBuffer(new Uint8Array(1)) === false`, `new Uint8Array(Buffer.from("x")) instanceof Uint8Array`, `Buffer.from(Buffer.from("x").buffer)` length.
  - `json`: `JSON.stringify({ b: Buffer.from([1, 2]) })` → `'{"b":{"type":"Buffer","data":[1,2]}}'`.
  - `ints`: write/read every int method at offsets 0 and 3, out-of-range read → `RangeError` `ERR_OUT_OF_RANGE`.
  Register it in `binary_data_matches_node_through_generated_php` (add to the `for file in [...]` list and update `names.len()` lower bound).

- [ ] **Step 2: Run to verify it fails** — `cargo test --test compiler_contracts binary_data_matches_node_through_generated_php` → FAIL (Buffer methods missing).

- [ ] **Step 3: Implement `Node\Buffer`** with PHP `base64_encode`/`sodium_bin2base64(…, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING)`, `bin2hex`/`hex2bin` (truncate at the first invalid pair as Node does), `mb_convert_encoding` for latin1/utf16le, `pack`/`unpack` for ints. Node's lenient base64 decoding (ignores whitespace and invalid chars, accepts missing padding): strip non-alphabet chars, then decode.

- [ ] **Step 4: Run** the same test → PASS; also `cargo test --test compiler_contracts` → PASS.

- [ ] **Step 5: Commit** `git commit -m "Add Buffer and node:buffer over Uint8Array"`

---

### Task 3: node:crypto hashes, HMAC, random, KDFs

**Files:**
- Create: `runtime/SpacePress/Node/Crypto.php` (module registration), `runtime/SpacePress/Node/Hash.php`
- Modify: `runtime/SpacePress/Crypto.php` (keep `envKey`, caps and `randomUUID`; move the rest into `Node/`, delete duplicates)
- Test: `tests/differential/node/crypto-basic.mjs`, vectors in `tests/differential/node/vectors.json`

**Interfaces:**
- Consumes: `Node\Buffer::bytes/wrap/encode` (Task 2).
- Produces exports: `createHash(alg, opts?)` (`Hash` with `update(data, inputEncoding?)`, `digest(enc?)`, `copy()`), `createHmac(alg, key)` (key: string | Buffer | KeyObject secret), `hash(alg, data, enc = "hex")` (Node 22 one-shot), `randomBytes(n, cb?)`, `randomInt(min?, max, cb?)`, `randomFillSync(buf)`, `randomUUID()`, `getRandomValues(typedArray)`, `timingSafeEqual(a, b)`, `pbkdf2Sync(password, salt, iterations, keylen, digest)`, `pbkdf2(…, cb)`, `hkdfSync(digest, ikm, salt, info, keylen)` (returns ArrayBuffer, as Node), `hkdf(…, cb)`, `getHashes()`, `getCiphers()`, `constants` (`RSA_PKCS1_PADDING`=1, `RSA_PKCS1_OAEP_PADDING`=4, `RSA_PKCS1_PSS_PADDING`=6, `RSA_PSS_SALTLEN_DIGEST`=-1, `RSA_PSS_SALTLEN_MAX_SIGN`=-2, `RSA_PSS_SALTLEN_AUTO`=-2).
- Algorithm name map (case-insensitive, Node aliases `RSA-SHA256`→`sha256`, `sha-256` refused as Node does): to PHP `hash` names `sha512/224`, `sha512/256`, `sha3-256`... Callbacks run synchronously-resolved through `JsPromise` microtask (`Js::queueMicrotask`) so ordering matches Node's "after current sync code".

- [ ] **Step 1: Write the failing test** with: RFC 4231 test cases 1–4 and 6 (HMAC-SHA-256/512), RFC 6070 PBKDF2-SHA1 cases 1–3 (c=1,2,4096), RFC 5869 HKDF cases 1–3, every `getHashes()` algorithm over `"abc"` in hex, `hash("sha1","x")`, `createHash("sha256").update("a").copy().digest("hex")`, `randomBytes(8).length`, `randomInt(5, 6) === 5`, `pbkdf2Sync(...,2_000_000,...)` → `RangeError` `ERR_OUT_OF_RANGE` (documented difference: Node allows it; the test asserts PHP side only and Node side is skipped via a `phpOnly` export prefix the harness ignores on Node).
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** with `hash_init/hash_update/hash_copy/hash_final`, `hash_hmac`, `hash_pbkdf2(..., binary: true)`, `hash_hkdf`, `random_bytes`, `random_int`.
- [ ] **Step 4: Run** → PASS, including `host_globals_match_node_through_generated_php` (its `secrets` case still diverges only at index 0).
- [ ] **Step 5: Commit** `git commit -m "node:crypto: stateful hashes, HMAC, random and PBKDF2/HKDF"`

---

### Task 4: node:crypto keys, signatures, asymmetric encryption

**Files:**
- Create: `runtime/SpacePress/Node/KeyObject.php`, `runtime/SpacePress/Node/Sign.php` (Sign and Verify), `runtime/SpacePress/Node/Asn1.php` (only the fixed DER prefixes for Ed25519 PKCS#8/SPKI and JWK↔PEM via `openssl_pkey_get_details`)
- Modify: `runtime/SpacePress/Node/Crypto.php` (register exports)
- Test: `tests/differential/node/crypto-keys.mjs`, fixtures `tests/differential/node/keys/` (Node-generated RSA 2048 PKCS#8 + SPKI + PKCS#1 PEM, P-256 PEM, Ed25519 PEM, committed)

**Interfaces:**
- Consumes: Task 2 byte helpers.
- Produces exports: `generateKeyPairSync(type, options)` for `rsa` (`modulusLength`, `publicExponent`), `ec` (`namedCurve` `P-256`/`prime256v1`/`P-384`/`secp384r1`), `ed25519`; with `publicKeyEncoding`/`privateKeyEncoding` returning strings/Buffers like Node, otherwise `KeyObject`s. `generateKeyPair(…, cb)`. `createPrivateKey(pem | der Buffer | {key, format, type} | {key: jwk, format: "jwk"})`, `createPublicKey(same | private KeyObject)`, `createSecretKey(buf)`. `KeyObject`: `type`, `asymmetricKeyType`, `asymmetricKeyDetails` (`modulusLength`, `publicExponent` as bigint, `namedCurve`), `symmetricKeySize`, `export({type: "pkcs1"|"pkcs8"|"spki"|"sec1", format: "pem"|"der"} | {format: "jwk"})`, `equals`. `createSign(alg)`/`createVerify(alg)` (`update`, `sign(key | {key, padding, saltLength, dsaEncoding}, enc?)`, `verify(key, sig, enc?)`), `sign(alg|null, data, key)`, `verify(alg|null, data, key, sig)`, `publicEncrypt`, `privateDecrypt`, `privateEncrypt`, `publicDecrypt` (`{key, padding, oaepHash}`).
- ECDSA signatures are DER by default; `dsaEncoding: "ieee-p1363"` converts with `Asn1::derToP1363` / `p1363ToDer`.
- Ed25519 sign/verify via `sodium_crypto_sign_detached`/`_verify_detached`; Ed25519 PEM ↔ raw via fixed prefixes `302e020100300506032b657004220420` (PKCS#8) and `302a300506032b6570032100` (SPKI).
- KeyObject `__toString`/inspect → `KeyObject { type: '<type>' }`; never exposes PEM through `dynamicGet`.

- [ ] **Step 1: Write the failing test** including:
  - Deterministic byte equality: RSA PKCS#1 v1.5 `sign("sha256", data, fixturePrivate)` base64 equals Node's; Ed25519 signature equals Node's; `export()` of every fixture key in every format equals Node's output.
  - Cross-checks (randomized): PHP `generateKeyPairSync("rsa", {modulusLength: 2048})` → export PEMs; Node verifies a PHP signature and PHP verifies a Node signature (harness passes Node's outputs as action input on the PHP side — add `input` support to the case runner: a case `x` may export `x.input` computed in Node first). Same for ECDSA P-256 (DER and ieee-p1363), RSA-PSS (PHP ≥ 8.5 only; on < 8.5 assert the `ERR_OSSL_UNSUPPORTED` error), OAEP-SHA-256 decrypt of a Node ciphertext.
  - `errors`: sign with a public key → `code` starts with `ERR_OSSL`; `createPrivateKey("nope")` → `ERR_OSSL_UNSUPPORTED` (Node 22's code); verify with a private key → `true`.
  - `inspect`: `String(createSecretKey(Buffer.alloc(16)))` → `"[object KeyObject]"`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** with `openssl_pkey_new`, `openssl_pkey_export`, `openssl_pkey_get_private/public`, `openssl_pkey_get_details` (JWK fields from `rsa`/`ec` arrays, base64url), `openssl_sign/verify` (8.5 `padding` arg when PSS), `openssl_public_encrypt/private_decrypt` (8.5 `digest_algo` arg when `oaepHash` ≠ sha1), `sodium_crypto_sign_*`. DER ↔ PEM: base64 + header lines (64-char wrap, as Node).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "node:crypto: KeyObject, sign/verify and RSA encryption over openssl and sodium"`

---

### Task 5: node:crypto symmetric ciphers

**Files:**
- Create: `runtime/SpacePress/Node/Cipher.php`
- Modify: `runtime/SpacePress/Node/Crypto.php`
- Test: `tests/differential/node/crypto-cipher.mjs`

**Interfaces:**
- Produces exports: `createCipheriv(alg, key, iv, {authTagLength}?)`, `createDecipheriv(...)` for `aes-128-gcm`, `aes-256-gcm`, `aes-128-cbc`, `aes-256-cbc`. Object methods: `update(data, inEnc?, outEnc?)`, `final(outEnc?)`, `setAAD(buf)`, `getAuthTag()`, `setAuthTag(buf)`, `setAutoPadding(bool)`. Buffers input to `final()`: GCM encrypts/decrypts all data at `final()` (PHP `openssl_encrypt` is one-shot); `update()` returns an empty Buffer for GCM and the full block-aligned prefix for CBC (so concatenated output equals Node's). Unsupported algorithm → `Error` `ERR_CRYPTO_UNKNOWN_CIPHER`; wrong key length → `RangeError` `ERR_CRYPTO_INVALID_KEYLEN`; wrong IV → `ERR_CRYPTO_INVALID_IV`; GCM auth failure → `Error` message `Unsupported state or unable to authenticate data` (no code, as Node).

- [ ] **Step 1: Failing test**: NIST GCM test case 14/15 (AES-256, 96-bit IV, with and without AAD) bytes equal; CBC with fixed key/IV over 0, 15, 16, 17-byte inputs, `update` chunked as `"a"`, `"bc…"` concatenated equals Node; `setAutoPadding(false)` on unaligned input → Node's error code `ERR_OSSL_WRONG_FINAL_BLOCK_LENGTH`; tampered tag → the authenticate error; round trip of a Node-encrypted GCM blob.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** with `openssl_encrypt/decrypt(OPENSSL_RAW_DATA [| OPENSSL_ZERO_PADDING], $iv, $tag, $aad, $tagLength)`; CBC buffers unaligned remainder between `update` calls.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -m "node:crypto: AES-GCM and AES-CBC ciphers"`

---

### Task 6: Web Crypto (`crypto.subtle`, `crypto.getRandomValues`)

**Files:**
- Create: `runtime/SpacePress/Node/Subtle.php`, `runtime/SpacePress/Node/CryptoKey.php`
- Modify: `src/compile/host.rs` (global `crypto`: `crypto.subtle` and `crypto.getRandomValues` lower to `\SpacePress\Node\Module::get('crypto')->member('webcrypto')->…` as `Ty::Dynamic`, in typed code too; delete `subtle_digest` and the `getRandomValues` refusal); `runtime/SpacePress/Crypto.php` (delete `subtleDigest`)
- Test: `tests/differential/node/subtle.mjs`; existing `tests/differential/language/subtle-digest.ts` keeps passing

**Interfaces:**
- Consumes: Tasks 3–5 PHP classes (call them, no duplicate crypto).
- Produces: `crypto.subtle` methods returning `JsPromise`: `digest`, `importKey(format, keyData, algorithm, extractable, usages)` for `raw` (HMAC, AES, PBKDF2, HKDF, Ed25519 public), `pkcs8`, `spki`, `jwk`; `exportKey`; `generateKey`; `sign`/`verify` (`RSASSA-PKCS1-v1_5`, `RSA-PSS`, `ECDSA` with P1363 signatures, `Ed25519`, `HMAC`); `encrypt`/`decrypt` (`AES-GCM`, `AES-CBC`, `RSA-OAEP`); `deriveBits`/`deriveKey` (`PBKDF2`, `HKDF`). `CryptoKey`: `type`, `extractable`, `algorithm`, `usages`. Errors are `DOMException`-shaped: `JsError` with `jsName` `NotSupportedError`/`InvalidAccessError`/`OperationError`/`DataError`, matching Node's `name`. `crypto.webcrypto` and `crypto.subtle` on the `node:crypto` module are the same object. `getRandomValues(typedArray)` fills and returns the same view; > 65536 bytes → `QuotaExceededError`.

- [ ] **Step 1: Failing test**: HMAC sign over JWK-imported key equals Node; RS256 sign with pkcs8 import equals Node (deterministic); ES256 cross-verify; AES-GCM encrypt with fixed iv equals Node; PBKDF2 `deriveBits` 256 equals Node; `exportKey("jwk")` of an imported RSA key equals Node's JSON; non-extractable export → `InvalidAccessError`. Plus a pinned `jose@6.1.0` probe in `examples/npm-compat` (`SignJWT` HS256 + ES256 verify), added to `cases.mjs`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS, plus `node examples/npm-compat/verify.mjs`.
- [ ] **Step 5: Commit** `git commit -m "Web Crypto subtle and getRandomValues over the node:crypto runtime"`

---

### Task 7: node:path, node:querystring, node:string_decoder, node:util, node:events

**Files:**
- Create: `runtime/SpacePress/Node/Path.php`, `runtime/SpacePress/Node/Util.php`, `runtime/SpacePress/Node/Events.php`, `runtime/SpacePress/Node/StringDecoder.php`
- Modify: `runtime/SpacePress/QueryString.php` only if its parse/stringify already match Node's `querystring` (reuse); else `runtime/SpacePress/Node/QueryString.php`
- Modify: `src/eval.rs` (build-time constant folding: `path.sep` → `"/"`, `path.delimiter` → `":"`, `path.posix` → the module; any other module member read at build time stays refused); `src/compile/classes.rs` + `runtime/SpacePress/JsClass.php` (a JavaScript class may `extends EventEmitter`: `JsClass::builtin('EventEmitter')` root like the Error roots, whose methods dispatch to `Node\Events`)
- Test: `tests/differential/node/modules.mjs` (imported JavaScript), plus refusal fixture `tests/fixtures/reject-typed-event-emitter/` (typed `class X extends EventEmitter` → "use it from a JavaScript helper"), registered in `tests/compatibility/registry.json`

**Interfaces:**
- `path` (POSIX, Node's algorithms): `join`, `resolve` (cwd is `"/"`), `normalize`, `relative`, `dirname`, `basename(p, ext?)`, `extname`, `isAbsolute`, `parse`, `format`, `sep`, `delimiter`, `posix`, `toNamespacedPath`. `path.win32` → refused at build ("SpacePress runs on Linux").
- `querystring`: `parse`/`decode(str, sep?, eq?, {maxKeys})`, `stringify`/`encode(obj, sep?, eq?)`, `escape`, `unescape`.
- `string_decoder`: `StringDecoder(enc)` with `write(buf)` and `end(buf?)` for utf8, utf16le, base64, hex, latin1 (holds incomplete multi-byte sequences across writes).
- `util`: `format(fmt, ...args)` (`%s %d %i %f %j %o %O %%`), `inspect(value, {depth})` for primitives, arrays, plain objects, Map, Set, Date, Error, Buffer (`<Buffer 61 62>`), KeyObject; `promisify(fn)` (callback-last → `JsPromise`), `callbackify`, `inherits(ctor, superCtor)`, `deprecate(fn)` (returns fn, warns once via `error_log`), `types.{isUint8Array, isArrayBuffer, isDate, isRegExp, isPromise, isKeyObject, isCryptoKey}`, `isDeepStrictEqual`, `TextEncoder`, `TextDecoder`.
- `events`: `EventEmitter` (`on`/`addListener`, `once`, `off`/`removeListener`, `removeAllListeners`, `emit`, `listeners`, `listenerCount`, `eventNames`, `prependListener`, `setMaxListeners`, `'error'` with no listener throws), `once(emitter, name)` → `JsPromise`, `EventEmitter.defaultMaxListeners`; default export is `EventEmitter` (CommonJS `require("events")` returns the class, as Node).

- [ ] **Step 1: Failing test** with Node's own documented examples for each function (e.g. `path.relative("/data/orandea/test/aaa", "/data/orandea/impl/bbb")` → `"../../impl/bbb"`), multi-byte `StringDecoder` split (`"€"` bytes fed one at a time), `util.format("%s:%d:%j", "a", 1.5, {x: 1})`, `inspect` of nested object depth 2, EventEmitter subclass in JavaScript with `once` and error throwing, `require("events") === require("events").EventEmitter`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `cargo test --test compiler_contracts registered_refusals_have_live_codes_and_no_stale_fixture_links` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add node:path, querystring, string_decoder, util and events"`

---

### Task 8: node:zlib

**Files:**
- Create: `runtime/SpacePress/Node/Zlib.php`
- Test: `tests/differential/node/zlib.mjs`

**Interfaces:**
- Exports: `gzipSync`, `gunzipSync`, `deflateSync`, `inflateSync`, `deflateRawSync`, `inflateRawSync`, `unzipSync`, the callback forms (`gzip(buf, opts?, cb)` …), `constants` (`Z_NO_COMPRESSION`…`Z_BEST_COMPRESSION`, `Z_DEFAULT_COMPRESSION`), options `level`, `windowBits`, `memLevel`, `strategy`. Streams (`createGzip`, …) and brotli refused at build ("use the Sync form"). Output > 16 MiB → `RangeError` `ERR_BUFFER_TOO_LARGE`; corrupt input → `Error` `code` `Z_DATA_ERROR`.
- gzip header bytes must match Node's (OS byte `0x03`, mtime 0): build via `deflate_init(ZLIB_ENCODING_GZIP)` and patch byte 9 to `0x03` if PHP writes another value.

- [ ] **Step 1: Failing test**: `gzipSync("hello".repeat(100)).toString("base64")` equals Node at levels 1, 6, 9; round trips; `inflateSync(Buffer.from("x"))` → `Z_DATA_ERROR`; `gunzipSync` of a Node-made blob.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** with `deflate_init/deflate_add` and `inflate_init/inflate_add` (`ZLIB_ENCODING_RAW|DEFLATE|GZIP`), checking accumulated length against the cap after each `inflate_add` chunk of 64 KiB.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -m "Add node:zlib sync and callback forms"`

---

### Task 9: Types, docs, CI and the compatibility registry

**Files:**
- Modify: `types/spacepress/index.d.ts` / `server.d.ts` only if they declare `node:crypto` themselves (they must not conflict with `@types/node`); `packages/create-spacepress` already adds `@types/node`.
- Modify: `tests/compatibility/registry.json` (new `supported` entries `node-buffer`, `node-crypto`, `web-crypto`, `node-path`, `node-querystring`, `node-string-decoder`, `node-util`, `node-events`, `node-zlib`, each with `evidence` + `test` names from Tasks 1–8; new `divergence` entry `node-crypto-caps` for the caps and env-key trim; update `installed-source-packages` and `subtle-digest` guidance; delete stale wording "Node built-ins other than node:crypto … are refused")
- Regenerate: `www/content/docs/reference/language-support.md` via `python3 scripts/compiler-contracts.py`
- Modify: `www/content/docs/core/actions-jobs-routes.md` (a short "Node built-ins" section listing modules and the PHP 8.5 note), `skills/` only if a skill names the old refusal text
- Modify: `.github/workflows/ci.yml` — the `compiler` shard installs PHP 8.5 (`ppa:ondrej/php`, `php8.5-cli php8.5-sqlite3 php8.5-mbstring php8.5-gd php8.5-curl php8.5-zip`) so PSS/OAEP-256 cases run; other jobs stay on 8.3 and exercise the < 8.5 refusal path.

- [ ] **Step 1:** `python3 scripts/compiler-contracts.py --check` (or the script's check flag) fails until the registry and generated page agree; update both.
- [ ] **Step 2:** Run the full local gate: `cargo fmt --all --check && cargo clippy --locked --workspace --all-targets -- -D warnings && cargo test --locked` and `tests/php/run.sh` and `node examples/npm-compat/verify.mjs` → all PASS.
- [ ] **Step 3: Commit** `git commit -m "Document Node built-ins, register evidence, run crypto parity on PHP 8.5 in CI"`

---

## Delivery

- One PR from branch `node-builtins` to `main` in `spacefast/spacepress`, ready for review, body listing modules, PHP requirements, documented differences, and what was deleted (the `node:crypto` chain lowering, `Buffer` special cases, `subtle_digest`, refusal fixtures they made obsolete).
- Before merge: merge current `origin/main` in, CI green, one independent review (fresh reviewer agent on the whole diff), then `gh pr merge`.
