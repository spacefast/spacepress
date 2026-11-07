# Tested compiler compatibility

Generated from `tests/compatibility/registry.json`; run `python3 scripts/compiler-contracts.py` to update.

This is a growing evidence inventory, not an exhaustive language specification. Refusals are verified by running
`zero check --json` on each registered fixture in `tests/compiler_contracts.rs`. Supported behavior and intentional
differences link to their executable evidence. A silent, undocumented mismatch is a bug, not an exclusion.

String semantics here describe the current implementation; changes require updating the evidence and this registry.

## classes

Status: **supported**.

Named module-level classes compile inside callbacks: constructors, public fields and typed parameter properties, methods, lexical this in arrows, static members, named inheritance, super and instanceof. Instances share object identity; JSON and clone boundaries expose only own fields and drop class identity. See config-api.md for initialization, inference and refusal limits.

[Evidence](../tests/compiler_contracts.rs) (`classes_match_node_through_generated_php_and_wire_client_types`)

## class-metaprogramming

Status: **refused**. Diagnostic: `Z1101`.

Use concrete named classes with public fields and methods. See config-api.md for the supported surface.

[Evidence](../tests/fixtures/reject-class)

## uninstalled-package

Status: **refused**. Diagnostic: `Z1102`.

Install the package with your package manager. Zero reads supported local TypeScript/ESM sources; it does not install packages or execute JavaScript.

[Evidence](../tests/fixtures/reject-uninstalled-package)

## installed-source-packages

Status: **supported**.

Locally installed source packages resolve through nearest node_modules: exact exports with import/default conditions, module entries, and supported main/index entries. Scoped packages and exact exported subpaths are supported. The CommonJS subset accepts one static top-level function export; require, named CommonJS exports, implicit sloppy arguments, Node built-ins other than node:crypto, export patterns, package aliases, declaration-only entries and package-target escapes are refused. Raw JavaScript uses checked runtime operations; TypeScript keeps static checking. Resolving a package does not establish compatibility with its host APIs or every export. Pinned npm probes compare selected real imports to Node.

[Evidence](../src/loader.rs) (`installed_sources_follow_nearest_packages_exact_exports_and_relative_ts_imports`)

## unannotated-javascript

Status: **supported**.

Raw .js/.mjs/.cjs functions compile supported property access, calls, mutations and coercions through checked PHP dispatch. Missing values preserve undefined identity, invalid methods and null receivers throw TypeError, and TypeScript unknown still requires refinement. This supplies no Node/browser APIs, arbitrary prototypes, accessors, sparse arrays or custom iterators. The pinned npm matrix separately qualifies selected original library algorithms and combinations.

[Evidence](../tests/compiler_contracts.rs) (`unannotated_javascript_uses_checked_value_operations_without_weakening_typescript_unknown`)

## build-time-clock

Status: **refused**. Diagnostic: `Z2101`.

Use the clock in a handler or timestamp().defaultNow(). Configuration evaluation stays pure.

[Evidence](../tests/fixtures/reject-build-time-clock)

## access-database-query

Status: **refused**. Diagnostic: `Z4101`.

Return a row filter; put database effects in a hook or action.

[Evidence](../tests/fixtures/reject-access-query)

## field-ui-width

Status: **refused**. Diagnostic: `Z3101`.

Use an integer percentage from 1 to 100 for .ui({ width }).

[Evidence](../tests/fixtures/reject-field-ui)

## undefined-as-null

Status: **divergence**.

Explicit undefined preserves typeof, coercion and JSON omission in compiled PHP. Some statically typed missing reads and annotation-only undefined/void still normalize to null; raw imported JavaScript uses a distinct undefined sentinel. The differential oracle normalizes final undefined results explicitly.

[Evidence](../tests/compiler_contracts.rs) (`documented_runtime_differences_are_measured_in_evaluation_and_compiled_php`)

## unicode-codepoint-indexing

Status: **divergence**.

Configuration evaluation and compiled PHP index and slice strings in UTF-16 code units, like JS. A result that would split a surrogate pair is refused at build time or throws a RangeError at runtime, because UTF-8 cannot represent a lone surrogate. Diagnostic columns also count UTF-16 code units.

[Evidence](../tests/compiler_contracts.rs) (`documented_runtime_differences_are_measured_in_evaluation_and_compiled_php`)

## uri-encoding

Status: **supported**.

encodeURI and encodeURIComponent accept one string in configuration and handlers. Component punctuation is preserved; whole-URI delimiters are preserved only by encodeURI. Values must be valid Unicode scalar strings.

[Evidence](../tests/compiler_contracts.rs) (`uri_vectors_agree_in_node_pure_evaluation_and_generated_php`)

## field-presentation

Status: **supported**.

Field .ui() metadata survives nested schema emission and schema description and maps to native SCF. It does not affect data paths, validation or access.

[Evidence](../tests/compiler_contracts.rs) (`nested_presentation_reaches_scf_and_public_schema_without_storage_migrations`)

## finite-type-algebra

Status: **supported**.

Finite object interface inheritance and intersections, generic aliases/interfaces with constraints and defaults, finite keyof/indexed access and dynamic key reads, mapped types and selected utility/conditional types retain literal and optional boundaries. Concrete aliases also preserve class identity, typed fields/constructor parameter properties and method results while generated clients erase methods at the wire boundary. See runtime-contract.md (TypeScript type normalization) for the supported domains and refusals; the strict type-semantics fixture also checks generated-client boundaries and native/WASM parity.

[Evidence](../tests/compiler.rs) (`compiled_php_matches_node_on_every_differential_case`)

## declared-type-predicates

Status: **supported**.

Synchronous concrete helpers and inline callbacks can return named-parameter type predicates. The target must be a subtype of the parameter and the body must return booleans. Calls narrow their checked argument on the true branch; filter, find and findLast narrow elements when their first callback parameter is refined. Function aliases preserve predicates; map produces booleans. As in TypeScript, the authored predicate declares the refinement; the compiler does not prove nested runtime checks. Assertions, this predicates and predicate function-type annotations are refused. Direct Boolean callbacks retain JavaScript truthiness. Required tuple destructuring positions retain their declared types; array positions remain nullable, and mutation widens tuple read views. The type-semantics fixture checks native/WASM emission and strict client types.

[Evidence](../tests/compiler.rs) (`compiled_php_matches_node_on_every_differential_case`)

## finite-key-validation

Status: **refused**. Diagnostic: `Z4001`.

A finite keyof is a literal union, not string.

[Evidence](../tests/fixtures/reject-type-keyof)

## generic-constraint-validation

Status: **refused**. Diagnostic: `Z4001`.

Generic arguments must satisfy their declared structural constraints.

[Evidence](../tests/fixtures/reject-type-constraint)

## generic-required-argument

Status: **refused**. Diagnostic: `Z4001`.

Provide every required argument; missing arguments never widen to unknown.

[Evidence](../tests/fixtures/reject-type-arity)

## indexed-union-missing-key

Status: **refused**. Diagnostic: `Z4001`.

An indexed key must exist in every member of an object union.

[Evidence](../tests/fixtures/reject-type-index)

## open-keyof

Status: **refused**. Diagnostic: `Z4001`.

Use an explicit string key type for open maps. Array/prototype and symbol key spaces are not modeled.

[Evidence](../tests/fixtures/reject-type-open-keyof)

## recursive-type-expansion

Status: **refused**. Diagnostic: `Z4001`.

Recursive types are refused by bounded expansion; type operations also have a step and finite-key budget.

[Evidence](../tests/fixtures/reject-type-recursion)

## runtime-generic-functions

Status: **refused**. Diagnostic: `Z4001`.

Use generic aliases with concrete PHP-reachable function signatures. There is no generic runtime specialization.

[Evidence](../tests/fixtures/reject-type-runtime-generic)

## finite-record-presence

Status: **refused**. Diagnostic: `Z4001`.

Record with finite string keys requires every declared key; it is not an open string map.

[Evidence](../tests/fixtures/reject-type-record-keys)

## boxed-structural-conditional

Status: **refused**. Diagnostic: `Z4001`.

Conditional matching of primitive/array prototype properties is refused; use concrete scalar, array or finite object comparisons.

[Evidence](../tests/fixtures/reject-type-structural-predicate)

## type-declaration-merging

Status: **refused**. Diagnostic: `Z4001`.

Combine interface declarations explicitly or use interface extends. Repeated declarations never silently replace earlier fields.

[Evidence](../tests/fixtures/reject-type-merging)

## conditional-check-provenance

Status: **refused**. Diagnostic: `Z4001`.

Use direct type parameters for distributive checks, or tuple-wrap alias/type-operation checks to make non-distributivity explicit. Alias reduction can otherwise change TypeScript distributivity before instantiation.

[Evidence](../tests/fixtures/reject-type-conditional-alias)

## mapped-key-provenance

Status: **refused**. Diagnostic: `Z4001`.

Use direct keyof T, a direct key parameter constrained by keyof T, or literal key domains. Aliased or reduced mapped key expressions (including Keys<T>, Identity<K> and keyof T | never) are refused before shape emission because reduction can change optional presence. Aliased or reduced key-parameter constraints are also refused.

[Evidence](../tests/fixtures/reject-type-mapped-provenance)

## scalar-typeof-guards

Status: **supported**.

Equality and inequality comparisons of typeof with number, string or boolean narrow unknown values and known scalar unions, including reversed operand order, property paths, conjunctions and early returns. False branches remove matching known union members; the complement of unknown remains unknown. Object, function, symbol, bigint and undefined guard domains are not added. The type-semantics fixture checks identical native/WASM output and strict generated-client types.

[Evidence](../tests/compiler.rs) (`compiled_php_matches_node_on_every_differential_case`)

## numeric-finiteness

Status: **supported**.

Global isFinite accepts zero or one argument and applies numeric coercion; Number.isFinite checks numbers without coercion. Number.isFinite is available as a stable function value, including local and captured aliases and feature detection. The differential numeric owner compares NaN, infinities, numbers, strings, null, booleans and arrays in pure configuration evaluation and PHP. Typed missing values retain the documented nullable boundary; explicit undefined is distinct from null.

[Evidence](../tests/compiler.rs) (`compiled_php_matches_node_on_every_differential_case`)

## host-globals

Status: **supported**.

Handlers use the standard host forms, type-checked by @types/node: the global fetch(url, { method, headers, body, redirect }) with a Response (status, statusText, ok, url, redirected, bodyUsed, headers.get/has/forEach, text(), json()), Headers and URLSearchParams; process.env.NAME and process.env["NAME"] (string | undefined); crypto.randomUUID(); and from "node:crypto" (import or a top-level const require) createHash and createHmac chains ending in digest("hex" | "base64" | "base64url"), randomBytes(n).toString(encoding), randomUUID and timingSafeEqual(Buffer.from(a), Buffer.from(b)). They lower in src/compile/host.rs onto Zero\Fetch (HTTPS-only egress policy), Zero\Env and Zero\Crypto. See config-api.md.

[Evidence](../tests/compiler_contracts.rs) (`host_globals_match_node_through_generated_php`)

## fetch-signal

Status: **refused**. Diagnostic: `Z4001`.

Every call already ends after 10 s. credentials, mode, cache and the other browser options are refused because they have no effect server-side.

[Evidence](../tests/fixtures/reject-fetch-signal)

## fetch-binary-body

Status: **refused**. Diagnostic: `Z4001`.

Send a string (JSON.stringify(value) for JSON) or URLSearchParams. Blob, FormData, ArrayBuffer and stream bodies are not available.

[Evidence](../tests/fixtures/reject-fetch-body)

## url-objects

Status: **refused**. Diagnostic: `Z4001`.

fetch() takes a URL string. Build it with encodeURIComponent and URLSearchParams.toString(). URL and Request objects are not compiled.

[Evidence](../tests/fixtures/reject-fetch-url-object)

## response-streams

Status: **refused**. Diagnostic: `Z4001`.

The body is read in full (at most 1 MiB) before fetch() resolves. Read it with text() or json(); arrayBuffer, blob, formData and clone are refused.

[Evidence](../tests/fixtures/reject-response-stream)

## process-env-dynamic

Status: **refused**. Diagnostic: `Z4001`.

Name the variable: process.env.NAME or process.env["NAME"]. Computed names, iterating process.env and writes are refused, so request input cannot choose a server variable.

[Evidence](../tests/fixtures/reject-process-env-dynamic)

## process-members

Status: **refused**. Diagnostic: `Z4001`.

Handlers run in PHP. Only process.env.NAME is supported.

[Evidence](../tests/fixtures/reject-process-member)

## env-in-handlers

Status: **refused**. Diagnostic: `Z4001`.

env("NAME") is a deferred reference inside defineConfig (webhook URLs and secrets, action signatures, upload credentials). Handlers read runtime variables with process.env.NAME.

[Evidence](../tests/fixtures/reject-env-handler)

## web-crypto-subtle

Status: **refused**. Diagnostic: `Z4001`.

SubtleCrypto needs ArrayBuffers and is not compiled. Hash and sign with createHash and createHmac from "node:crypto".

[Evidence](../tests/fixtures/reject-crypto-subtle)

## web-crypto-random-values

Status: **refused**. Diagnostic: `Z4001`.

Typed arrays are not compiled. Use randomBytes(n).toString("hex") from "node:crypto", or crypto.randomUUID().

[Evidence](../tests/fixtures/reject-crypto-random-values)

## node-crypto-members

Status: **refused**. Diagnostic: `Z2001`.

node:crypto provides createHash, createHmac, randomBytes, randomUUID and timingSafeEqual. Ciphers, keys, KDFs and streams are not compiled.

[Evidence](../tests/fixtures/reject-node-crypto-member)

## node-crypto-buffers

Status: **refused**. Diagnostic: `Z4001`.

Finish a hash in one expression with a string encoding: createHash("sha256").update(text).digest("hex"). Buffers exist only inside timingSafeEqual(Buffer.from(a), Buffer.from(b)) and Buffer.byteLength(text).

[Evidence](../tests/fixtures/reject-digest-buffer)

## timing-safe-equal-strings

Status: **refused**. Diagnostic: `Z4001`.

Pass Buffer.from(a) and Buffer.from(b). As in Node, inputs of different byte lengths throw RangeError, so check Buffer.byteLength first.

[Evidence](../tests/fixtures/reject-timing-safe-equal)

## node-builtins

Status: **refused**. Diagnostic: `Z1102`.

Handlers run in PHP. Use the global fetch, process.env.NAME and "node:crypto".

[Evidence](../tests/fixtures/reject-node-builtin)

## require

Status: **refused**. Diagnostic: `Z1002`.

A top-level const declaration may require("node:crypto"). Every other require is refused; use import.

[Evidence](../tests/fixtures/reject-require-module)

## zero-fetch-import

Status: **refused**. Diagnostic: `Z2001`.

fetch and crypto are the standard globals, not "zero" exports. Remove them from the import.

[Evidence](../tests/fixtures/reject-zero-fetch-import)
