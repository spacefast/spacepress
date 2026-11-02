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

## npm-imports

Status: **refused**. Diagnostic: `Z1102`.

Import from zero or a relative TypeScript module.

[Evidence](../tests/fixtures/reject-npm-import)

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
