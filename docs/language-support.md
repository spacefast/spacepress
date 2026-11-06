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

Locally installed source packages resolve through nearest node_modules: exact exports with import/default conditions, module entries, and supported main/index entries. Scoped packages and exact exported subpaths are supported. The CommonJS subset accepts one static top-level function export; require, named CommonJS exports, implicit sloppy arguments, Node built-ins, export patterns, package aliases, declaration-only entries and package-target escapes are refused. Raw JavaScript uses checked runtime operations; TypeScript keeps static checking. Resolving a package does not establish compatibility with its host APIs or every export. Pinned npm probes compare selected real imports to Node.

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

Synchronous concrete helpers and inline callbacks can return named-parameter type predicates. The target must be a subtype of the parameter and the body must return booleans. Calls narrow their checked argument on the true branch; filter, find and findLast narrow elements when their first callback parameter is refined. Function aliases preserve predicates; map produces booleans. As in TypeScript, the authored predicate declares the refinement; the compiler does not prove nested runtime checks. Assertions, this predicates and predicate function-type annotations are refused. Direct Boolean callbacks retain JavaScript truthiness. Required tuple destructuring positions retain their declared types; array positions may be undefined, and mutation widens tuple read views. The type-semantics fixture checks native/WASM emission and strict client types.

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

Global isFinite accepts zero or one argument and applies numeric coercion; Number.isFinite checks numbers without coercion. Number.isFinite is available as a stable function value, including local and captured aliases and feature detection. The differential numeric owner compares NaN, infinities, numbers, strings, null, booleans and arrays in pure configuration evaluation and PHP. Missing reads, built-in results and explicit undefined preserve their identity separately from null.

[Evidence](../tests/compiler.rs) (`compiled_php_matches_node_on_every_differential_case`)

## builtin-overloads

Status: **supported**.

src/builtins.rs owns JavaScript built-in overloads, arity and phase support. Unsupported arguments are refused at the call site; runtime-only dynamic receivers throw a TypeError. Captured and runtime vectors compare UTF-16 ordering, replacement substitution, ECMAScript whitespace, modulo radix conversion and signed-zero rounding to Node. Positioned includes/startsWith/endsWith are refused in typed code and configuration evaluation; checked imported JavaScript implements those positions. Callback thisArg and nondecimal numeric toString are refused. Object.freeze is refused because freezing is not modeled. JSON parsing/serialization and Error construction are runtime-only; configuration evaluation refuses them. Custom object and function coercion are refused during configuration evaluation; handlers use the checked runtime conversion path. parseInt supports correctly rounded large values in base 10 and power-of-two bases; other radices require safe integer results. Database builders, configuration/schema factories and column modifiers share the source arity contract. Build-time function-coercion refusals include extracted methods; typed replacement callbacks preserve undefined captures and receive named groups. Captured explicit undefined remains distinct from null in both language modes. Dynamic method values use the shared built-in contract. Unknown built-in properties are refused during configuration evaluation. Powers accept safe integer results, integral binary scaling, squares, square roots and IEEE special values; other powers are refused at source or explicitly at runtime. Prototype setter literals are refused; computed __proto__ data properties remain supported. Extracted method calls are refused during configuration evaluation. Database writes require static collection references. Configuration for-of and destructuring use live iterators. Addition uses default primitive conversion. Sorting keeps undefined last and excludes it from comparators. JSON schemas must accept serialized values, and custom toJSON callbacks are refused. Typed Dates require explicit toISOString/toJSON before JSON.stringify or action returns. Imported JavaScript for-of uses live iterators. Non-Unicode ignore-case regex on non-ASCII text requires the u flag; unsupported case folding throws explicitly. RegExp source and string conversion escape delimiters and line terminators. Regex split on astral text requires the u flag. Typed invalid-Date toJSON returns null. Generated undefined defaults become null at the storage boundary. Object overwrites preserve key order. Stored JSON defaults omit undefined object properties and normalize undefined array slots to null. Numeric string conversion uses ECMAScript shortest ties-to-even formatting. Nullish narrowing retains undefined. Cyclic array string conversion omits recursive visits. Dynamic array/arguments prototype writes are refused. Typed Date string coercion requires explicit formatting. Function call/apply property values use the function contract; unmodeled function metadata/bind reads and function string conversion are refused. Optional Error/RegExp reads preserve undefined. Date construction runs default-hint object coercion. Typed Date addition/concat requires explicit formatting. Typed and imported Dates share JsDate identity and numeric primitive conversion; timestamp/date storage and filters convert explicitly. Date JSON schemas must describe their serialized text/null form. Non-ISO Date syntax receives a source diagnostic for literals and an explicit runtime refusal for computed values. Default sorting of multiple object values requires an explicit comparator; singleton sorting does not coerce. Negative-zero expanded Date years are refused. Custom sorting accepts only a numeric difference between the two parameters or matching property paths, with finite primitive keys. Other comparator shapes and cross-family borrowed methods are refused. Unary minus performs ToNumber, and parsed JSON retains negative zero. Missing indexed and optional-property logical assignment operands retain undefined in runtime narrowing and serialized client types. Regex source escaping uses explicit UTF-8 regardless of ambient PHP multibyte settings. Configuration refuses extracted built-in method values, including identity comparisons; direct and computed receiver calls remain supported. JSON negative-zero preservation leaves exponent signs intact. Non-Unicode regex classes support digit/underscore control escapes. Runtime hasIndices and unicodeSets are false because d/v flags are refused. Runtime Error messages are own nonenumerable properties only when a defined message is supplied; name is inherited. Configuration refuses restricted arguments access instead of fabricating native Error descriptors. Error stack metadata is refused.

[Evidence](../tests/compiler_contracts.rs) (`builtin_vectors_agree_in_evaluation_generated_php_and_node`)

## locale-collation

Status: **refused**. Diagnostic: `Z4001`.

Locale collation depends on the host and cannot be reproduced deterministically. localeCompare is refused in configuration and typed handlers; checked imported JavaScript throws TypeError. Use < or > for deterministic UTF-16 ordering. No byte-order substitute is exposed under the localeCompare name.

[Evidence](../tests/fixtures/reject-locale-compare)
