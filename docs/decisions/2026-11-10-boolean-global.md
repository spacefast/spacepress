# `Boolean` as a function value

## Problem

picomatch 4.0.7 (a files-sdk dependency) uses the global `Boolean` twice:

- `lib/parse.js:143`: `branches.map(normalizeSimpleBranch).filter(Boolean)` passes it as a value;
- `lib/picomatch.js:155`: `isMatch: Boolean(match)` calls it.

On main `6c55f778`, `first check` of picomatch's `makeRe` path stops at
`parse.js:143:61` with Z4001 "`Boolean` can't be used as a value; call one of
its functions".

What already works on main:

- `Boolean(x)` as a call, in typed TS and imported JS, compiles to
  `First\Js::truthy` (or a native truthiness test when the type allows it), and
  the evaluator computes `Value::truthy`.
- `.filter(Boolean)` written as a *direct callback argument* in typed TS has a
  special case in `Compiler::callback`.
- The evaluator already treats `Boolean` as a value (`Builtin::Global`), and
  `.filter(Boolean)` works there.

What doesn't:

- `Boolean` anywhere else as a value: `const f = Boolean`, `apply(Boolean, xs)`,
  and every use in imported JavaScript, whose array methods don't go through
  the typed callback path (`ident` refuses every global without a case).
- A configuration value holding `Boolean` (`const B = Boolean` at module scope)
  captured by a handler: "`B` is Global("Boolean"), which only exists while the
  config is built".
- `new Boolean(x)` is refused, but with a generic help ("use plain objects and
  arrays…") in the compiler and "can't use `new` with Global("Boolean")" in the
  evaluator.

## Decision

Reuse the `Number.isFinite` mechanism (`number_is_finite_function` in
`src/compile.rs`, `Js::numberIsFiniteFunction` in the runtime):

1. The runtime gets `Js::booleanFunction(): \Closure`, one static closure
   `fn (mixed $value = null): bool => self::truthy($value)`. It is the same
   object on every read, so `Boolean === Boolean` and aliases compare equal.
   `Js::truthy` already implements ToBoolean: `0`, `-0`, `NaN`, `""`, `null`,
   `undefined`, `false` and `0n` are false; every other value, including `"0"`,
   `"false"`, arrays, objects and functions, is true. Extra arguments are
   ignored, as in JavaScript (`.filter` passes index and array).
2. The compiler emits `\First\Js::booleanFunction()` with type
   `(value: unknown) => boolean` for:
   - the identifier `Boolean` read as a value (`ident`), in typed TS and in
     imported JavaScript;
   - a captured configuration value that is `Builtin::Global("Boolean")`;
   - `globalThis.Boolean`.
   The typed-callback special case in `Compiler::callback` is deleted; the
   general path now covers it.
3. Calls stay as they are: `Boolean(x)` keeps compiling to an inline
   truthiness test, not a closure call.
4. The evaluator needs no new semantics; it already calls `Builtin::Global`
   values. Only its `new Boolean` message changes.
5. `new Boolean(x)` (and `new String(x)`, `new Number(x)`, the same wrapper-object
   case) stays refused, with a located diagnostic in the compiler and the
   evaluator: "`new Boolean(...)` creates a wrapper object, which isn't
   supported", help "call `Boolean(value)` without `new` for a primitive".
   Wrapper objects are truthy even when they wrap `false`; compiling them as
   primitives would diverge silently.

Native and WASM share this code path (no `cli`-only code), so their output is
identical.

## Not covered

`Boolean.name`, `Boolean.length` and `Boolean.prototype` stay refused.

## Tests

- `tests/differential/language/boolean.ts` (+ `boolean-helpers.mjs`):
  `.filter/.map/.some/.every(Boolean)`, `Boolean(x)`, aliases, a user
  higher-order function, captured configuration values, typed TS and imported
  JS, over every falsy value plus `"0"`, `"false"`, `[]`, `{}` and a function.
  Run by `language_constructs_match_node_through_generated_php`.
- An evaluator unit test in `src/eval.rs` for aliases and higher-order use.
- Refusal fixture `tests/fixtures/reject-new-boolean` in the registry.
