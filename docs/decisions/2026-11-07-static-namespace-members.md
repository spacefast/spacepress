# Resolve members of build-time namespaces at compile time

## Problem

Zero evaluates module top level at build time, and a hook or action that reads a
module-level binding gets the build-time value compiled into PHP. Plain data
becomes a `captured_*()` singleton and a function becomes a compiled helper.
An object that holds functions has no PHP form, so every use of one failed with
`captured data contains a function, which can't be used in PHP`. That includes:

- `import * as u from "./u.js"; u.f(s)`,
- a module-level `const o = { f: (s) => s + "!" }` read as `o.f(s)`,
- `export default { f }` imported as a default and called as `d.f(s)`.

Functions with own properties failed earlier, in the evaluator:
`function p() {}; p.x = 1` was "can't set `x` on a function", and
`Object.assign(p, {...})` was "unsupported built-in property `Object.assign`".

picomatch 4.0.7, a files-sdk dependency, does both: `picomatch.makeRe = ...`,
`picomatch.scan = ...`, `picomatch.constants = constants` and
`Object.assign(picomatch, pico)` at module top level, and it calls
`utils.isObject(x)` and reads `constants.REGEX_X` on objects of functions.

## Decision

**Static member chains.** In compiled code, a member chain `a.b.c` whose root is
a captured module-level binding resolves at compile time while each step is a
build-time object (or a function with own properties) that holds code: a
function, a class or a regular expression, at any depth. The chain ends at the
first value that has its own PHP form, and that value is compiled through the
existing `captured()` path:

- a function compiles to its helper, so `u.f(s)` is a direct helper call;
- data compiles to the `captured_data` singleton for that sub-value, keyed by
  its `Rc` pointer, so its identity is shared with every other capture of it;
- a regular expression compiles to its `captured_regex` singleton;
- a missing own property is `undefined`, and an inherited `Object.prototype`
  name is refused as it is in the evaluator.

The object that holds functions is never built in PHP, so nothing at runtime can
mutate it and reading its constant members at compile time is exact. Every other
use of it (passing it, returning it, spreading it, iterating it, writing to it,
`typeof`) still fails with the located `captured data contains a function`
diagnostic. Its help now suggests calling or reading the member directly.

Objects with no code (plain data) keep the existing path: they are one PHP
singleton, readable and writable at runtime as before.

A call `o.f(x)` passes `this = o` in JavaScript. Zero refuses `this` outside
classes today, so no resolved function can observe its receiver. When `this`
outside classes is supported, a non-arrow function that reads `this` must be
refused on this path or called with the object as receiver.

**Functions with own properties.** `Closure` gets an own-property map.
`f.x = v` writes it, `f.x` reads it, and the build-time
`Object.assign(target, ...sources)` copies each source's own enumerable string
keys in order (integer keys first, as in JavaScript) through the same write and
returns the target. `null` and `undefined` sources are skipped. `name`,
`length` and `prototype` stay refused as targets, as before. Calling the
function is unchanged.

A PHP closure can't carry properties, and a dynamic `f.x` read on a closure
would differ from JavaScript without a diagnostic. So a function with own properties may be
called (`f(x)`) and its properties read through a static chain (`f.x`,
`f.makeRe(g)`), but using it as a value in compiled code (`const g = f`,
passing it, `typeof f`) is refused at the use site.

`Object.assign` at runtime, in handlers, stays refused; only the evaluator
implements it.

## Scope

Only non-computed member access (`a.b`) resolves statically; `a["b"]` keeps
the existing path. Arrays of functions are not resolved. Both are possible
later with the same mechanism.

This is in the shared core (`eval`, `compile`), so the native binary and the
WASM build behave the same.

## Effects analysis

The mutation-effects pass (`src/compile/effects.rs`) follows the same chains:
a static member read resolves to the build-time value and registers that
function, class or data singleton, so calls such as `ns.touch(record)` still
record the argument writes. The namespace object itself never becomes a graph
node.

## Known next layer

picomatch's `parse()` (1,400 lines, one function) now gets through the
evaluator and the member resolution, but the effects fixpoint doesn't finish
within minutes. The same happens on `main` with `parse.fastpaths` removed, so
it's an existing cost of that pass on very large functions and not something
this change introduced. It needs its own fix.
