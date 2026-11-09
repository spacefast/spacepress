# Null-prototype object literals

## Problem

picomatch 4.0.7, a files-sdk dependency, builds two lookup tables in
`lib/constants.js` with `__proto__: null`:

```js
const POSIX_REGEX_SOURCE = { __proto__: null, alnum: 'a-zA-Z0-9', /* … */ };
REPLACEMENTS: { __proto__: null, '***': '*', '**/**': '**', '**/**/**': '**' },
```

`lib/parse.js` reads them with untrusted keys (`REPLACEMENTS[input] || input`,
`POSIX_REGEX_SOURCE[rest]`). The `null` prototype is what makes those reads
safe: `REPLACEMENTS["constructor"]` is `undefined`, not `Object`.

Zero refused every `__proto__: value` literal key in `src/lower.rs` ("prototype
setter syntax"), so both tables failed the build.

## What already exists

The PHP runtime already models a null prototype as a per-object flag:
`JsObject::$nullPrototype`, set today for regex named-capture groups. Every
inherited-key path checks it:

- `JsDynamic::dynamicGet` / `dynamicMethodValue`: an absent key is `undefined`
  instead of an `Object.prototype` method;
- `JsDynamic::dataGet` (typed reads): skips the "inherited properties are not
  supported" refusal;
- `Js::hasProperty` (`in`): own keys only;
- `JsDynamic::dynamicCallMethod`: a missing method is called as `undefined`,
  which throws `TypeError: … is not a function`;
- `JsDynamic::dynamicPrimitive`: no inherited `toString`/`valueOf`, so string
  and number conversion throw `Cannot convert object to primitive value`;
- `Js::set` / `Js::delete`: `__proto__` is an ordinary own key;
- `Js::clone` keeps the flag; `structuredClone` drops it, as in JS.

Enumeration (`Object.keys`, `for…in`, spread, `JSON.stringify`) reads only
`$p`, so it already matches an ordinary object with the same own keys.

The build-time evaluator (`src/eval.rs`) has no prototype model: a plain object
is `Rc<RefCell<IndexMap<String, Value>>>` and reads of `Object.prototype` names
that the object doesn't own are refused ("reading inherited configuration
properties isn't supported").

## Decision

Support exactly `__proto__: null` — a non-computed, non-shorthand, non-method
key whose value is the literal `null` — in object literals, in imported
JavaScript and in typed TypeScript. Every other `__proto__:` value stays
refused with the existing Z1002 diagnostic: an object, a variable, a call,
`__proto__` shorthand and `__proto__() {}` methods. A computed
`['__proto__']: x` stays what it already was, an own data property.

**IR.** `lower` drops the `__proto__: null` entry and emits
`Prop::NullPrototype` in its place. It is a marker, not a property: it defines
no key and evaluates nothing (JavaScript sets the prototype when the literal is
created, and defining the other keys never consults it). A second
`__proto__:` in one literal is a JavaScript early error that oxc reports.

**Build time.** `Obj` is `Rc<ObjCell>`, and `ObjCell` carries the same
per-object `null_prototype` flag as `JsObject::$nullPrototype` in the PHP
runtime (`src/value.rs`). A literal with the marker is created with the flag
set. Then:

- `get_prop` on a null-prototype object returns the own value or `undefined`,
  never the inherited-read refusal;
- `in` checks own keys only;
- `obj.__proto__ = v` and `obj["__proto__"] = v` define an own key instead of
  being refused as prototype mutation;
- string or number conversion of a null-prototype object at build time is
  refused with a located diagnostic (JavaScript throws a TypeError there);
- spread, `Object.keys/values/entries`, `JSON.stringify` and `Object.assign`
  read only the map, so they are unchanged. A spread copy is an ordinary
  object, as in JavaScript.

**Captured data.** When a handler captures a null-prototype object built at
module scope, `captured_data` constructs its singleton with
`new \Zero\JsObject(nullPrototype: true)`, so the flag survives into PHP. A
static namespace (an object holding functions) with a null prototype resolves
a missing `Object.prototype` name to `undefined` instead of refusing it.

**Compiled literals.** A literal created inside a handler compiles as before
and is wrapped in `\Zero\Js::nullPrototype(...)`, which sets the flag on the
fresh `JsObject` and returns it. The typed literal's type is its own fields;
TypeScript's phantom `__proto__: null` field is not added, so typed code that
reads `.__proto__` on it gets Zero's missing-field error rather than a wrong
`null`.

**Not supported.** `Object.getPrototypeOf`, `Object.create` and
`Object.setPrototypeOf` are not Zero built-ins today, and this change does not
add them.

## Tests

- `tests/differential/language/null-proto.ts` with `null-proto-helpers.mjs`:
  the picomatch tables, reads of own and `Object.prototype` names, `in`,
  `Object.keys`, spread, `JSON.stringify`, `for…in`, mutation after creation
  and the TypeError from `obj.hasOwnProperty(...)`, both built at module scope
  (build-time evaluation, captured) and inside handlers.
- Refusal fixtures for `__proto__: {}` and `__proto__: someVar`.
- Registry entry `null-prototype-literals`; `docs/language-support.md`
  regenerated.
