# Symbols, weak collections and globalThis detection

files-sdk brands its errors and file wrappers with registered symbols
(`Symbol.for("files-sdk.FilesError")`) and keeps per-instance state in a
module-level `WeakMap`. Zero refused all three names, so these modules could
not compile once the syntax pass let them through.

## Symbols

A symbol is a PHP object, `Zero\JsSymbol`, with an optional description.
PHP object identity gives JavaScript's identity equality, and `typeof` reports
`"symbol"`. `Symbol.for` and `Symbol.keyFor` use one registry per request, the
same lifetime as every other module-level value in PHP. The well-known symbols
are fixed instances. Implicit string and number conversion throws TypeError, as
in JavaScript; `String(symbol)`, `symbol.toString()` and `description` work.

Module-level symbols are created by the build-time evaluator as their own
value kind. Captured into PHP, a registered symbol compiles to `Symbol.for`
with its key. An unregistered symbol compiles to one static per allocation, so
every function in the request sees the same symbol.

Symbol-keyed properties live in their own slot on `JsObject`, not in the string
property array. `Object.keys`, `for…in`, `JSON.stringify` and the other string
enumerations therefore never see them. Object spread copies enumerable symbol
properties, as in JavaScript, and `in`/`delete` read the same slot. Arrays,
arguments, functions and other values have no symbol slot. Their prototypes
carry well-known symbol methods (`Array.prototype[Symbol.iterator]`) that Zero
doesn't model, so a well-known symbol on them, any symbol on a class instance
without it as an own property, and every symbol write on them throws TypeError
instead of guessing. Other symbols on those values are absent, as in
JavaScript.

## Weak collections

`WeakMap` and `WeakSet` wrap PHP's native `WeakMap`. Keys must be JavaScript
objects or unregistered symbols. Primitives, `undefined` (a PHP enum case) and
registered symbols throw TypeError as in JavaScript. A module-level
`new WeakMap()` becomes one empty collection per request. The evaluator refuses
build-time entries and method calls; the fix is to populate the collection
inside the function that runs in PHP.

## globalThis

There is no global object in the PHP runtime. `typeof globalThis.X` and
`globalThis.X` compared with `undefined` are resolved at compile time when
`X` is a global Zero provides (its `typeof`) or a browser/runtime host Zero
never provides (`window`, `document`, `Bun`, `Deno`: `"undefined"`). Names owned
by the host-globals work (`process`, `fetch`, `crypto`, `Buffer`, timers) and
every other use of `globalThis` stay refused with a located diagnostic.

## Not in this change

Class computed keys such as `static [Symbol.hasInstance]()` belong to class
syntax and `unique symbol` to the TypeScript type work. Authored TypeScript keeps refusing `WeakMap`/`WeakSet`
like `Map`. `Object.defineProperty` and symbol keys on arrays are refused.
