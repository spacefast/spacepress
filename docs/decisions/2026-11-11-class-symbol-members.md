# Symbol-keyed class members and class prototypes

## Problem

files-sdk 3.1.2 stopped at its first two class layers (dist 2 / raw 2, F1101
"computed class methods", then F2001 "can't read `prototype` of class"):

```js
var FILES_ERROR_BRAND = Symbol.for("files-sdk.FilesError");
class FilesError2 extends Error {
  static [Symbol.hasInstance](value) {
    if (this !== FilesError2) {
      return Function.prototype[Symbol.hasInstance].call(this, value);
    }
    return isObject(value) && FILES_ERROR_BRAND in value;
  }
  // …
}
Object.defineProperty(FilesError2.prototype, FILES_ERROR_BRAND, { value: true });

class Files2 {
  [FOLD_PROVIDER_EVENT](event) { /* reads this.#prefix */ }
  #applyExtensions(plugins) {
    // …
    if (key === "then" || key in Files2.prototype) throw …;
  }
}
```

A cross-realm-safe `instanceof` (the brand lives on the prototype, the check is
the static method), a symbol-keyed internal method called as
`files[FOLD_PROVIDER_EVENT](event)`, and `key in Files2.prototype` for member
collisions.

## Decision

### Symbol-keyed methods

`[key](...) {}` lowers to `Class::symbol_methods` with its key expression. The
build-time evaluator evaluates every key once, in source order, when the class
is defined, and refuses a key that isn't a symbol (a computed string key would
need every member table to be dynamic). The compiled class descriptor gets the
methods keyed by symbol identity (`JsClass::$prototypeSymbols`,
`$staticSymbols`), and `Js::symbolLookup` walks the class chain for them, so
instances, subclasses and statics inherit and override them as with named
methods. A read returns one function per class and key; `call`/`apply` supply
the receiver.

Only symbol keys whose behavior First can reproduce are accepted. Well-known
symbols other than `static [Symbol.hasInstance]` (`Symbol.iterator`,
`Symbol.asyncIterator`, `Symbol.toStringTag`) would have to change `for…of`,
spread and tagging for class instances, which the runtime doesn't route through
class members; they stay refused with a located error. Computed accessors stay
refused.

### `instanceof` and `Symbol.hasInstance`

Every `instanceof` against a First class, typed or checked, now goes through
`JsClass::instanceOf`: when the class chain defines `static [Symbol.hasInstance]`
it is called with the class as `this` and its result is converted to a
boolean (ECMAScript InstanceofOperator); otherwise the prototype-chain walk runs
as before. `Function.prototype[Symbol.hasInstance]` is modeled as
OrdinaryHasInstance, which is what files-sdk's subclass fallthrough calls.
Other `Function.prototype` members throw TypeError.

Typed `instanceof` narrowing is unchanged: TypeScript itself narrows on
`instanceof` regardless of `Symbol.hasInstance`, and the only classes with one
are imported JavaScript classes, whose values are already dynamic.

### `C.prototype`

`C.prototype` is a `First\JsPrototype`, one per class descriptor, so `===`
holds. It owns no string-keyed state: its string members are the class's
methods, accessors and `constructor`, so `key in C.prototype` and method reads
answer from the descriptor (plus Object.prototype names, and Error.prototype
data for Error subclasses). Symbol-keyed data goes on the descriptor through
`Object.defineProperty(C.prototype, symbol, { value, … })`, with JavaScript's
attribute rules: instances inherit it for `symbol in instance` and
`instance[symbol]`, `Object.hasOwn(instance, symbol)` stays false, a
non-configurable definition can't be redefined, and a non-writable inherited
value makes an assignment on an instance throw (strict mode). The same
definition works while the module is evaluated (the evaluator records it on the
class value and the compiled descriptor starts with it) and inside handlers.
Module-evaluation definitions accept primitive or symbol values; anything else
is refused, because captured object values would need a per-request copy owned
by the prototype.

Refused at run time with TypeError, instead of answering wrongly: assigning or
deleting prototype properties, string-keyed or accessor descriptors on a
prototype, reading an accessor through the prototype (its getter would run
with the prototype as `this`), and enumerating, spreading, serializing,
cloning or `Object.hasOwn` on a prototype. `Object.hasOwn` and the other
`Object.*` helpers belong to the Object built-ins work; this change only gives
them a refusal for prototypes.

Class prototypes model the symbol keys of the whole chain exactly, so a class
instance without a symbol is now `undefined`/`false` for it instead of throwing
as #181 did. Well-known symbols the class doesn't define (`Symbol.iterator in
instance`) are `false`, which matches JavaScript for classes without them.

### TypeScript

Authored TypeScript has no symbol type, so typed classes keep refusing
symbol-keyed methods and `C.prototype` with located errors. Typed code uses the
imported classes through `instanceof` (which runs their `Symbol.hasInstance`)
and `in`.

### Module evaluation order

With these layers gone, the raw (TypeScript source) variant reached an
evaluator check that refused an import cycle through `index.ts ↔
internal/core.ts`. The back edge is `import type { … } from "../index.js"`,
which TypeScript erases. The loader already skipped type-only imports for
resolution; the evaluator now skips them for evaluation order too.

## Evidence

`tests/differential/language/class-symbols.ts` runs files-sdk's patterns
(copied from its dist) under Node and through generated PHP and compares the
JSON byte for byte: symbol methods on instances and statics with private state
and inheritance, generator and async symbol methods, `Symbol.hasInstance`
including subclass fallthrough, forged brands and non-instances, brands on the
prototype read through instances and plain objects, `key in C.prototype` for
methods, getters, statics, `constructor` and non-members, and typed TypeScript
using the classes. Refusals have fixtures `reject-class-computed-string-key`,
`reject-class-well-known-symbol-method` and
`reject-typescript-class-symbol-method`.
