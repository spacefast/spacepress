# CommonJS interop helpers at build time

Date: 2026-11-12. Status: accepted.

## Problem

`ret` 0.5 (reached from files-sdk through `safe-regex2`) is TypeScript compiled to
CommonJS. Every module starts with tsc's interop helpers:

```js
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : /* ... */);
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "types", { enumerable: true, get: function () { return types_1.types; } });
```

and `ret`'s entry ends with `module.exports = tokenizer; module.exports.types = …`, which
`safe-regex2` reads as `const { types } = require('ret')`. The build-time evaluator
(`src/eval.rs`), which runs every module's top level once, refused the first of these:
`Object.create`, then three-argument `Object.defineProperty`, `Object.prototype`,
`Object.getOwnPropertyDescriptor`, and destructuring a function. This was the first
refusal of the files-sdk probe for both the dist and raw-source variants.

All of this runs at module top level. The helpers' functions also exist at request time,
but files-sdk never calls them there.

## Decision

Model property attributes in the evaluator, with the same observable behavior as
JavaScript, and refuse what reaches compiled code with an attribute it can't keep.

1. **Attributes.** `ObjCell` (plain objects, and now also a function's own properties)
   keeps an attribute record `{ enumerable, writable, configurable }` for each property that
   isn't ordinary. An accessor property's slot holds `Value::Accessor { get, set }`. Reads
   call the getter with the object as `this`; writes call the setter. A write that strict
   mode would reject (a getter with no setter, `writable: false`) and deleting a
   non-configurable property are refused with a location: the evaluator doesn't build
   catchable TypeError objects.
2. **`Object.defineProperty(target, key, descriptor)`** on a plain object, `exports` or a
   function, with `value`, `get`, `set`, `enumerable`, `writable` and `configurable`:
   JavaScript's defaults (absent fields are `false` or `undefined` for a new property and
   unchanged for an existing one), a generic descriptor that keeps an accessor an accessor,
   the non-configurable redefinition check (refused where JavaScript throws), and the
   target as its return value. Mixing accessors with `value`/`writable` is refused as
   JavaScript's TypeError. Symbol keys stay a run-time feature, and so do class prototypes
   (`define_prototype_symbol`, #264).
3. **`Object.getOwnPropertyDescriptor`** returns a fresh descriptor object for objects,
   functions, arrays (`length`, indexes), strings, regexes (`lastIndex`) and `arguments`,
   with JavaScript's key order (`value, writable` or `get, set`, then `enumerable,
   configurable`), and `undefined` for an absent key.
4. **`Object.create(null)`** builds a null-prototype object (the #250 model), and
   **`Object.create(Object.prototype)`** builds an ordinary one. Any other prototype and the
   properties argument are refused (`reject-object-create-proto`).
5. **`Object.prototype`** is a value. Its `hasOwnProperty`, `propertyIsEnumerable` and
   `toString` methods can be read and called through `.call`/`.apply`. Reading any other
   member is refused.
6. **Enumeration.** `for…in`, `Object.keys/values/entries`, spread, object rest and
   `Object.assign` read own enumerable keys only, and call getters. `in` and own-property
   checks still see non-enumerable keys.
7. **Function values as namespaces.** Object destructuring of a function reads its own
   properties, so `const { types } = require('ret')` works.
8. **`this` in method calls.** A build-time call `o.m(x)` binds `this` to `o` for an
   ordinary function that reads `this`. Before this change, the first argument was bound as
   `this`, which getters and helper objects exposed. A plain call binds `undefined`.

## Compiled code: refused for now

Compiled code reads build-time objects as constants (captured data or static namespaces).
A PHP `JsObject` has no attribute model for string keys: `$hidden` covers only an Error's
fields, and accessors don't exist. So when a build-time value reaches a handler with an
accessor or a non-default attribute, the compiler refuses it with a location instead of
silently turning a live getter into a snapshot or making a hidden key visible:

- reading `ns.key` where `key` is an accessor (`reject-captured-getter`, F1002);
- capturing an object with attributes as data, or using it as a method receiver
  (`receiver_value`).

This is not a gap for files-sdk: `ret` and `safe-regex2` replace `module.exports` with a
function, and its properties are ordinary assignments.

**Next slice:** the same model in the PHP runtime. That means `JsObject` attributes for
string keys and accessor slots, `Js::dynamicGet`/`dynamicSet`/`dynamicKeys`/JSON honoring
them, `Object.create`, `getOwnPropertyDescriptor` and `Object.prototype.*.call` in compiled
JavaScript, and `captured_data` emitting attributes. That would lift both refusals above.
Today, run-time `Object.defineProperty` accepts symbol keys and ordinary string-keyed data
descriptors only (`JsDynamic::dynamicDefineProperty`).

## Consequences

- The files-sdk probe moves past `ret`/`safe-regex2`. The next refusal is files-sdk's own
  `array.toSorted()` (being added on another branch).
- Differential coverage: `tests/differential/language/commonjs-interop*.cjs` reproduce
  `ret`'s and `safe-regex2`'s module shapes statement for statement (`__createBinding`,
  `__exportStar`, `__importStar`, `__setModuleDefault`, a getter export, a function
  `module.exports` with properties, a destructured `require`), and
  `commonjs-descriptors.cjs` covers live getters, setters, non-enumerable keys, the return
  value, redefinition, descriptors of each value kind, and `hasOwnProperty.call` on
  objects, arrays, functions, strings and null-prototype objects. Results are compared
  byte for byte with Node.
