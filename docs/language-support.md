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

Locally installed source packages resolve through nearest node_modules: exact exports with import/default conditions, module entries, and ESM main entries. Scoped packages and exact exported subpaths are supported. Every reachable TypeScript/ESM line is compiled under the same language restrictions. CommonJS, Node built-ins, export patterns, package aliases, declaration-only entries and package-target escapes are refused. Resolving a package does not establish compatibility with its JavaScript language features or effects.

[Evidence](../src/loader.rs) (`installed_sources_follow_nearest_packages_exact_exports_and_relative_ts_imports`)

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

Compiled PHP represents undefined as null (including typeof); pure configuration evaluation still distinguishes undefined. The differential oracle normalizes undefined results explicitly.

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

Global isFinite accepts zero or one argument and applies numeric coercion; Number.isFinite checks numbers without coercion. Number.isFinite is available as a stable function value, including local and captured aliases and feature detection. The differential numeric owner compares NaN, infinities, numbers, strings, null, booleans and arrays in pure configuration evaluation and PHP. The existing undefined-as-null PHP boundary still applies.

[Evidence](../tests/compiler.rs) (`compiled_php_matches_node_on_every_differential_case`)
