# Closures that capture their own `const`/`let` binding

## Problem

picomatch 4.0.7 (`lib/parse.js`, a files-sdk dependency) defines a recursive
arrow inside `parse.fastpaths`:

```js
const create = str => {
  switch (str) {
    /* … */
    default: {
      const match = /^(.*?)\.(\w+)$/.exec(str);
      if (!match) return;
      const source = create(match[1]);
      /* … */
    }
  }
};
```

Zero refused it with "`create` is referenced before its lexical declaration".
The check (`require_initialized_local` in `src/compile.rs`, from
`2026-11-06-eager-lexical-capture-boundary.md`) refuses any reference to a
`const`/`let` local whose initializer hasn't finished. That is right for a
direct read (`const x = x + 1` throws in JavaScript) and for a closure that
might run before the binding is assigned. It is too strict for a closure that
*is* the initializer: that closure can't be called until the binding holds it.

#190 handled `function` declarations and named function expressions. It did
not cover a `const`/`let` arrow or function expression that names its own
binding.

## Decision

A reference to a `const`/`let` binding from inside a nested function compiles
when the binding's whole initializer is that function expression, optionally
wrapped in `as T`, `satisfies T` or `!`:

```js
const fact = n => (n <= 1 ? 1 : n * fact(n - 1));
const walk = function (node) { return node.children.map(walk); };
```

Why this is sound: evaluating a function expression runs none of its body.
The closure value exists only once the initializer completes, and the
declaration assigns it immediately. No code inside the closure, including
nested closures and default parameters, can run before the binding is
initialized. JavaScript therefore never throws a ReferenceError for these
references, and Zero needs no runtime check.

Everything else stays refused at compile time with the existing located
diagnostic:

- a direct read in the initializer: `const x = x + 1`, `const f = (f(), () => 1)`;
- a closure created anywhere other than as the whole initializer, for example
  `const f = (() => { const g = () => f; g(); return () => 1; })()` (Node
  throws a ReferenceError) or `const f = memo(n => f(n - 1))` (whether it throws
  depends on what `memo` does);
- forward references to a later binding, which includes mutual recursion
  between two `const` arrows. Use `function` declarations for mutual recursion;
  they are hoisted and already compile.

## Compilation

- **Marking.** When a lexical declaration binds a plain name to a function
  expression, the predeclared (uninitialized) local is marked
  `self_closure`. Only `resolve`'s walk through *enclosing* functions accepts
  that mark; a read in the declaring function itself still finds an
  uninitialized local and is refused.
- **PHP capture.** PHP captures `use ($x)` by value when the closure is
  created, before `$fact` is assigned. A self-reference is captured by
  reference (`use (&$fact)`) at every closure level between the reference and
  the declaration, the same mechanism `let` captures and #190's recursive
  local declarations use. This also turns a single-expression arrow into a
  full `function () use (&$fact)`, since PHP's `fn` captures by value only.
  The binding stays `const` for assignment checks.
- **Types.**
  - Imported JavaScript: every function is `(...dynamic) => dynamic`, from
    `declared_signature`, as for #190.
  - Typed TS: the self-reference is typed from the arrow's own parameter and
    return annotations (`declared_signature`), or from the declaration's
    annotation when that is a function type. Without either, the reference is
    refused: "`fact` refers to itself before its type is known", fix "annotate
    every parameter and the return type, e.g. `const fact = (n: number):
    number => ...`". Non-recursive unannotated arrows are unaffected.
  - A `let` may be reassigned before its closure runs, so the self-reference
    reads as the binding's declared type when it has one, and as dynamic in
    imported JavaScript. A call through it then goes through the checked
    dynamic call and throws a TypeError for a non-function, as JavaScript does.
    A `const`, or an unannotated typed `let` (whose later assignments must
    match the function's type), keeps the function's own signature.
- **Shadowing.** Parameters and inner bindings are found first by the normal
  scope walk, so a parameter named `fact` shadows the outer `fact`.

Native and WASM builds share this code path; nothing depends on the host.

## Not done

- Mutual recursion between `const` bindings (forward references). Supporting
  it needs deferred closure compilation plus a runtime TDZ check for calls
  made between the two declarations; the 2026-11-06 decision describes that
  cost.
- Class expressions and object literal methods that name their own binding.
