# Installed package TypeScript is type-erased

Zero statically checks authored TypeScript against a deliberate type subset.
Until now it applied the same checker to `.ts` sources installed under
`node_modules`, so a package's own type algebra (generic and optional
function-type parameters, call signatures, assertion functions, `this` types,
computed symbol keys, `unique symbol`) blocked compilation even when its
runtime code was inside the supported subset. Raw `files-sdk` 3.1.2 `src/`
produces 18 such type-only diagnostics, plus one for an abstract generic
class, that its published JavaScript does not.

## Decision

1. **Package TypeScript compiles through the checked-dynamic domain.** A
   `.ts`/`.mts`/`.cts` module whose path is inside `node_modules` (not `.d.ts`)
   is lowered with its annotations erased and compiled exactly like imported
   `.js`: the `Dynamic` type, `JsDynamic` runtime checks, and the same
   refusals for runtime constructs outside the value model. One predicate,
   `Program::dynamic_module`, replaces the three extension checks so that the
   compiler, the effect graph and the evaluator agree on the domain.

   This is what esbuild, swc and oxc do with TypeScript: strip, don't check.
   Package types are the author's contract with `tsc`, not with Zero, and
   modelling them all would mean reimplementing TypeScript. Erasure is exact
   for type-only syntax because types have no runtime semantics.

2. **Erasure happens in Zero's lowerer, not through `oxc_transformer`.** The
   transformer's TypeScript strip re-prints the program, so diagnostics would
   point into generated text instead of the package's bytes. It is also only
   compiled into the `host` feature, while the WASM compiler must give the same
   answer. The lowerer already walks the OXC AST; in erased mode it skips type
   annotations, type arguments, type parameters, type-only declarations and
   `abstract`/`declare`/`override`/accessibility modifiers.

3. **TypeScript syntax with runtime semantics is not erased.** `enum`,
   `namespace` with values, parameter properties, `import x = require()`,
   `export =`, decorators and `declare` fields with initializers keep their
   current diagnostics (or their owner's support). Erasing them would change
   behavior silently.

4. **Authored code stays strictly checked.** App modules (outside
   `node_modules`) keep the static checker. The constructs authors write in
   their own handlers gain checked support where Zero can model them soundly:
   optional and rest function-type parameters, overloads and call signatures
   on finite object types, assertion functions on named parameters, and `this`
   types on finite object methods. Generic function types stay refused in code
   that reaches PHP, matching the existing generic-function rule. Each keeps a
   located refusal for the unsound remainder.

5. **The app gets library types from declarations, checked at the boundary.**
   Values that cross from a package into authored code are `Dynamic` today; the
   author narrows them with `typeof`/`instanceof`. Declaration hydration reads
   the package's `types` condition (`dist/index.d.ts`), never its `.ts` source,
   because declarations are what `tsc` users get and they exist for both the
   npm dist and source packages. A declared type is trusted only where Zero can
   check it at runtime when the value crosses into typed code (scalars,
   literals, arrays and finite objects of those); anything else stays
   `Dynamic`. An unchecked `.d.ts` claim would let a wrong declaration make
   typed PHP diverge without an error, which the compiler-as-trust-boundary
   rule forbids.

## Consequences

- The raw `files-sdk` probe loses every type-layer diagnostic and reports the
  same runtime-construct set as the dist probe; the remaining gaps belong to
  the class, async, binary and language agents.
- Package `.ts` no longer gets static type errors from Zero. Its type errors
  are `tsc`'s job; its runtime errors are checked by `JsDynamic` like `.js`.
- Typed adapters in `examples/npm-compat` that relied on a package `.ts`
  source being statically typed now see `Dynamic` at the boundary.
