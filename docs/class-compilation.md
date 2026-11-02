# Class compilation and library reuse

Zero parses TypeScript with OXC 0.152.0, evaluates configuration as pure data,
and compiles saved callbacks to PHP. Classes participate in that same pipeline.
The [authoring reference](config-api.md#classes-in-callbacks) defines the supported
surface and refusals. This is a bounded TypeScript backend, not an npm executor.

## Representation and initialization

`src/compile/classes.rs` emits descriptor factories and ordinary PHP functions
with explicit receivers. `runtime/Zero/JsClass.php` supplies dispatch and ancestry;
instances remain the existing `JsObject` handles. Field storage, aliasing,
closures, object enumeration and JSON therefore use the existing runtime owners.
Descriptors live outside enumerable own fields. Parent dispatch keeps the actual
receiver, while `super` starts lookup at the lexical parent.

Base fields run before constructor defaults. Derived fields run after the first
`super(...)`, including through an omitted forwarding constructor. Parameter
properties follow TypeScript's ES2022 field emit: their fields exist before
ordinary field initializers and receive argument values before the authored
constructor body. Early field reads include null. Calling methods or allowing
instances to escape during initialization is refused, keeping inference away
from partially initialized virtual receivers.

`src/compile/effects.rs` remains the mutation-analysis owner. Constructors,
initializers and methods become call edges; receiver arguments participate in
existing alias, capture and read-invalidation analysis. The class instance type
keeps nominal ancestry and an own-field shape. Wire/client types, clones and
persisted snapshots erase that ancestry. JSON schemas cannot claim to hydrate
an instance.

## Maintained Rust library reuse

The following assessment uses the existing pinned OXC release
[`crates_v0.152.0`](https://github.com/oxc-project/oxc/tree/dfbc0d1ea752f021ba4a68e4703b3a9031082a46)
and SWC [`v1.16.21`](https://github.com/swc-project/swc/tree/v1.16.21), released
2026-10-31. Both are actively released Rust compiler toolchains. No upstream
implementation was copied and no dependency was added for this change.

| Component | Concrete reuse opportunity | Boundary that remains Zero's responsibility |
| --- | --- | --- |
| [OXC semantic](https://github.com/oxc-project/oxc/blob/crates_v0.152.0/crates/oxc_semantic/src/lib.rs) | `SemanticBuilder` and `Scoping` provide symbol/reference/scope IDs, class tables and an optional CFG on the AST already parsed here. A future binding pass can use these identities for shadowing and capture analysis. | This is not the TypeScript type checker. It does not supply Zero's schema types, interprocedural mutation effects or PHP receiver/value semantics. Scope IDs alone do not implement runtime TDZ checks. |
| [OXC visitors](https://github.com/oxc-project/oxc/blob/crates_v0.152.0/crates/oxc_ast_visit/src/lib.rs) and `oxc_traverse` | Generated `Visit`/`VisitMut` walkers fit the existing AST. Semantic-aware traversal can keep scopes synchronized while applying a narrowly selected transform. | A walker cannot decide which JS operations are sound on PHP. Located refusals and evaluation-order rules still belong in lowering. |
| [OXC transformer](https://github.com/oxc-project/oxc/blob/crates_v0.152.0/crates/oxc_transformer/src/lib.rs) | `Transformer::build_with_scoping` offers TypeScript erasure, class-property/decorator and language-target transforms. Selected normalization is a credible future experiment after capturing the annotations needed by this backend. | Its output targets JavaScript and may introduce JavaScript helpers and prototype operations. Running all transforms first would erase annotations and move class semantics into helpers this backend does not implement. It is not a PHP emitter. |
| [SWC](https://github.com/swc-project/swc/tree/v1.16.21/crates) | Its parser, visitors, resolver/hygiene and TypeScript/compatibility transforms are another maintained implementation source and a useful independent JS normalization oracle. | Adopting it here requires a second AST/span/hygiene ecosystem or a parser migration. It also targets JavaScript, not PHP, and cannot replace the runtime/effects/schema boundary. |

OXC semantic and visitor reuse best fits the next binding/traversal work because
it preserves the current parser and source locations. Class emission stays on
Zero's typed IR in this change, retaining annotations and the existing value
model. A library migration needs a measured benefit beyond additional syntax;
SWC does not currently remove a PHP-specific obligation that justifies that cost.
Broader TypeScript support should add behavior to the existing owners and run
Node/generated-PHP comparisons before widening accepted syntax.

OXC is [MIT](https://github.com/oxc-project/oxc/blob/crates_v0.152.0/LICENSE);
SWC is [Apache-2.0](https://github.com/swc-project/swc/blob/v1.16.21/LICENSE).
Any future vendored portion must retain its copyright/license, exact upstream
revision and local modifications; dependency reuse must retain lockfile and
package license metadata. Apache reuse also retains applicable NOTICE material.
The compiler remains MIT and the WordPress runtime GPL-2.0-or-later under the
repository's component license map. This assessment changes neither license.

## Executable evidence and ownership

`tests/compiler_contracts.rs` owns class compilation, source-located refusals,
JSON/Seam detachment and strict generated-client checks. Its differential case
uses `tests/differential/classes.ts`, TypeScript's ES2022 emit, the existing Node
oracle, and the actual generated PHP loaded with the emitted runtime. It compares
complete action results, including constructor order, inherited/overridden
methods, static receiver behavior, identity and mutations. It does not assert
implementation source text.

The shared PHP suite continues to own object/array and WordPress boundary
behavior. Class evidence adds descriptor-specific behavior at the compiler seam;
it does not duplicate storage, configuration migration or WordPress fixture
suites. The browser compiler uses the same Rust pipeline; its existing parity
owner also checks the class fixture against the native compiler.
