# Class features for npm libraries: private names, accessors, builtin bases

files-sdk 3.1.2 builds its public API on JavaScript class features that Zero
refuses today: `#private` fields and methods (`Files`, 260 uses in
`src/index.ts`), accessors (`get raw()`, `UploadControl.status`), `class
FilesError extends Error`, a generic `Files<A extends Adapter>`, and classes in
imported JavaScript whose fields and parameters carry no types. Static blocks,
`new.target` and `super` property access in object methods appear in neither
files-sdk's core nor picomatch, so they stay refused.

Instances stay `Zero\JsObject` handles dispatched through `Zero\JsClass`
descriptors ([class compilation](../class-compilation.md)). We do not move to
one native PHP class per JavaScript class. Checked JavaScript, JSON, cloning and
enumeration all operate on `JsObject`, and a JavaScript class value can be
created per evaluation, which a PHP class declaration cannot.

## Private names live in the declaring class evaluation

Each class evaluation owns a private-name table: a `\WeakMap` on its `JsClass`
descriptor from receiver object to that class's private slots. This is the
specification's model, where private names are per class evaluation and are not
properties of the object.

- When a class initializes an instance, it adds the receiver to the table
  (the brand) before running field initializers. Private methods and accessors
  need only the brand. Each private field is a key in the slot array, added
  when its initializer finishes.
- `this.#x` reads `JsClass::privateGet($class, $receiver, 'x')`. A missing
  brand or a missing slot throws `TypeError`, as JavaScript does for an object
  the class did not initialize or a field read before its initializer.
- `#x in o` is `JsClass::privateHas`. It is false for non-objects and for
  objects from a sibling or parent class that declares its own `#x`.
- `#m()` calls the private method's PHP function directly after the brand
  check. Private methods are not virtual and do not appear in `hasMethod`.
- Static private members use the descriptor itself as the key.

Private state never enters `$p`, so `Object.keys`, JSON, spread,
`structuredClone` and snapshots cannot see it. PHP `private` was rejected: it
is keyed by PHP class, not by class evaluation, and instances are not
per-class PHP objects.

## Accessors are descriptor entries, consulted after own properties

Class `get`/`set` (instance and static) become `getters`/`setters` maps on the
descriptor, inherited along `parent`. A property read checks own data first,
then the accessor chain, then methods. This is the prototype order, since
classes define accessors on the prototype. A write to a name with an inherited
setter calls the setter. A getter-only accessor makes the write throw
`TypeError` in strict code. Typed code resolves accessors at compile time from
the class type, so a known getter compiles to a direct call with its declared
return type.

Object-literal accessors are own properties with ordinary enumeration order.
They are stored as a `Zero\JsAccessor` value in `$p`. Every runtime reader of
`$p` that can observe values goes through one resolver: property reads,
enumeration with values, JSON, spread, `Object.assign` and cloning. Typed code
gives such literals a type that disables the native `$o->p[k]` fast path.

Computed method names with static keys, such as `[Symbol.asyncIterator]()` and
`static [Symbol.hasInstance]`, wait for agent 1's `Symbol`. Until then they keep
a located refusal.

## Builtin bases start with `Error`

`extends Error` (and `TypeError`/`RangeError`) uses a builtin root descriptor.
Its initializer installs the JavaScript `Error` own properties: `message` and
`cause` only when given, plus `stack`. These go in a new non-enumerable own-property
array on `JsObject`, so `Object.keys`/JSON match Node: assigned `name` and fields
appear, `message`/`stack`/`cause` do not. `name` resolves through the
prototype to the root's name unless assigned. `String(e)` follows
`Error.prototype.toString`. `instanceof Error` walks the descriptor chain to the
root. `Error.captureStackTrace` is a no-op that keeps the existing `stack` value.

`stack` is the first line of Node's format (`Name: message`) followed by no
frames. Callers that parse frames get none, which a header-only stack in Node
also produces. We do not report PHP frames: they would expose compiler
internals and differ from Node.

Throwing is the PHP boundary. `throw v` for a non-`JsError` value throws
`Zero\JsThrown` (a `JsError` subclass) carrying the original value, and `catch`
binds the original value. Thrown error-class instances keep their identity,
fields and `instanceof` results. Builtin `Error` values keep their current
`JsError` representation.

Other builtins (`Map`, `Set`, owned by agent 6) extend the same way, by
registering a root descriptor whose initializer creates that builtin's internal
state. That hook lands with `Error`. Bases without a root descriptor keep the
current located refusal.

## Type-only class syntax is erased

`abstract` classes and members, class type parameters, `implements`,
`override`, `declare` fields, `readonly`, and `private`/`protected`/`public`
modifiers on members and parameter properties are erased after their TypeScript
meaning is checked. Constructing an abstract class is refused at compile time.
TypeScript `private` is not runtime privacy; it stays a public `$p` field,
matching emitted JavaScript. Generic class type parameters resolve the same
way as generic function parameters: by the constraint at use sites, or unknown
when there is none.

## Classes outside module scope and class expressions

Class declarations in functions and class expressions compile to a descriptor
created per evaluation (`new JsClass(...)`) rather than the memoized module
factory. Methods are closures over the enclosing scope. Each evaluation has
fresh identity and fresh private names, as in JavaScript. Module-scope classes
keep the memoized factory.

## Untyped classes in imported JavaScript

In `.js`/`.mjs`/`.cjs` modules, class fields and parameters without annotations
are `Dynamic`. Constructor and method writes `this.x = v` create own properties
in assignment order. Field order follows JavaScript: base fields, then derived
fields after `super()`. Authored TypeScript keeps its static field contract.

## Delivery

One PR per group, stacked where they share `src/lower.rs` class lowering. The
order: type erasure, untyped JavaScript classes plus private names, accessors,
`Error` bases with throw/catch, class expressions and nested classes. Each PR
adds Node↔PHP differential cases to `tests/differential/classes.ts` (or a JS
module fixture for checked JavaScript), updates
`tests/compatibility/registry.json`, and regenerates
`docs/language-support.md`.
