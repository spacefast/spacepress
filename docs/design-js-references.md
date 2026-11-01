# Zero: JS reference semantics in compiled PHP

Status: accepted. Implementation follows the three-step rollout in §8. Zero is unreleased, so this
breaks the compiled-code contract without a migration. The standalone target was
removed before implementation; the pipeline and boundary coverage run on WordPress.

Scope: how compiled `zero.config.ts` code represents JS objects and arrays at
run time, every place that representation meets the rest of the runtime, and
the order in which the change lands.

---

## 0. Decisions in one screen

| Area | Decision |
|---|---|
| Representation | Two final PHP classes, `Zero\JsObject` and `Zero\JsArray`, each a handle around one PHP array (`->p` for properties, `->a` for elements). Compiled code holds and passes handles. Primitives stay PHP scalars. First-class function values are PHP `Closure`s. |
| Identity | PHP object identity is JS identity. `===` between handles compiles to PHP `===`. The compile-time refusal of `===` on containers goes away. |
| Key order | Property order is computed by one function, `Js::ownKeys`, at every enumeration: array-index keys ascending, then the rest in insertion order. Objects are only ever built by per-key assignment, never by PHP array spread, `array_merge` or `array_values`, so integer-like keys can't renumber. |
| Arrays | Dense, always. A valid index is an integer in `[0, 2^32 - 2]`. Writing past `length` or at a non-index number is a runtime `RangeError`; reading one is `undefined`. Holes can't exist: a fixed-length walk (`map`, `filter`, `find*`, `reduce`, …) that reaches an index its callback removed throws `RangeError` at run time, so no helper ever has to know about holes. |
| Evaluation order | Assignments, `===`, spreads, destructuring, `concat` and every array helper read their receiver, keys and old value exactly where JS reads them: a temporary or a helper call whose arguments PHP evaluates left to right. §4.2 gives the emission for each. |
| Boundary | Compiled code lives in "JS land" (handles). `Db`, `Schema`, `Sql`, stores, SCF codecs, Sync and WordPress live in "runtime land" (plain arrays). One file, `runtime/Zero/Seam.php`, owns every conversion in both directions, driven by the schema. `Db` calls it at its public entry points; nothing else converts. A user `json()` column's value is a handle at every layer and every callback receives its own deep copy of it. |
| Graphs | `structuredClone`, `JSON.stringify`, `String()` and `Seam::toPhp` all walk with an identity map: aliases are preserved by clone, cycles throw `TypeError` from `JSON.stringify` and a 422 `invalid_input` from `Seam` (§2.7), and `String()` renders a cycle as `""` as JS does. |
| Compiler analysis | `src/compile/effects.rs` stays for what it does for types (capture detection for fresh loop bindings, numeric and tuple widening, tuple-shape restoration, refinement invalidation). Refinement invalidation becomes alias-aware: it follows the copy edges the analysis already records, and a refinement on a value that has escaped (passed, stored, captured, returned) dies at the next call. The by-reference half (`by_ref`, `shared_parameter`, `argument_by_ref`, `replaces_argument`, capture anchors) and the four aliasing refusals are deleted. |
| Deleted | `check_aliasing`, `check_identity_eq`, `check_destructured_mutation`, by-ref parameters and `objectBinding`, capture anchors, `Js::write`/`at`/`obj`-marker/`copyObject`/`plain`, `Schema::plainOutsideJson` (moves into `Seam`), the empty-object marker and its 30 `instanceof JsObject` sites, `extract.rs`'s list-shaped-default refusal. |
| Acceptance | The 65-row sharing corpus (`CORPUS.md` on `archive/s2-ownership-rule`: 58 compile and differ from Node, 3 agree, 4 are refused) plus `tests/differential` run under Node and compiled PHP; results must be identical. |
| Cost | Historical representation microbenchmarks are in §6. Checked member reads/writes (§4.2) supersede their direct-access paths. The measured warm WordPress/SQLite pipeline is 1.864 → 3.194 ms/request, with 505 validated requests per side and zero errors. Production impact remains inconclusive; see `docs/spikes/js-references-pipeline.md` for raw samples and limits. |
| Rollout | Three PRs: a preparatory `Seam` extraction that changes no representation, one atomic representation switch (runtime, compiler, boundaries, corpus), then deletions. The switch bumps the runtime series to `0.3`; schema v3 remains unchanged, and older compiled callbacks are refused at load with a rebuild instruction. |

---

## 1. The problem

Compiled TS represents JS objects and arrays as PHP arrays. PHP arrays are
values: assignment, argument passing, storing into another array, and capture
each take a copy (lazily, by copy-on-write). JS objects and arrays are
references. The programs below run correctly under Node and silently return
something else as compiled PHP:

```ts
const b = a; b.x = 1;                       // a.x unchanged in PHP
bump(o); bump(o);                           // the callee's write lands on a copy
const box = { a }; a.push(1);               // box.a is still empty
const readers = items.map(i => () => i.n);  // the closure holds its own copy
new Array(3).fill(obj)[0].x = 1;            // three copies, not one object
```

Two static analyses tried to refuse every program where the copy is
observable. Twelve review rounds each found two to nine new false negatives,
and each round found a new class: stores, evaluation order, values escaping
through calls, closures, destructuring defaults, derived values such as
`slice` and `fill`. The second attempt (the sharing half of
`src/compile/effects.rs`, plus a 1059-line `aliasing.rs` on the archived
branch) also made the compiler's output worse for correct programs:
parameters became PHP references, loop bindings grew "capture anchors", and
users were told to rewrite `reduce` as a `for` loop. The analyses were
abandoned.

The decision is to stop approximating. PHP shares objects by handle, exactly
as JS does, so compiled JS objects and arrays become PHP objects.

A second bug falls out of the same move. PHP converts the string key `"1"` to
the integer key `1` and treats a list of integer keys as a list. Compiled
object spread (`[...$a, ...$b]`), `reduce` into a record, `Object.fromEntries`
and `array_merge` all renumber integer keys, so `{ "1": "a", "0": "b" }` becomes
`["a", "b"]` and encodes as a JSON array. §2.3 makes that impossible rather
than patching each site.

---

## 2. Representation

### 2.1 Decision: two final classes around a PHP array

```php
namespace Zero;

final class JsObject
{
    /** @param array<array-key, mixed> $p */
    public function __construct(public array $p = []) {}
}

final class JsArray
{
    /** @param list<mixed> $a */
    public function __construct(public array $a = []) {}
}
```

That is the whole representation. The classes have no methods compiled code
calls; every operation is either direct PHP (`$o->p['x']`, `count($a->a)`) or
a `Js::*` helper. Both are `final` so `instanceof` is exact and the engine can
inline property access.

Why not the alternatives:

- **`stdClass` for objects.** Fastest build (1.4x plain versus 2.8x for the
  handle), but it can't hold a property named `"\0…"` (the runtime already
  carries a workaround in `decodeJson`), it iterates in insertion order only,
  so JS integer-first order still needs a sort at every read, and it leaves
  arrays as PHP arrays, which is the bug we are fixing. Half the programs in
  the corpus mutate arrays.
- **`ArrayObject` / `ArrayAccess`.** Member read/write is 1.6x slower than
  the handle (19.2 versus 12.5 ms per million) because every access is a
  method call, and it still leaves `[]` versus `{}` ambiguous inside. The
  syntax sugar buys nothing the compiler needs.
- **A handle around a PHP array.** One pointer indirection over today's code,
  the array inside keeps PHP's hash ordering and copy-on-write for internal
  helpers, and the two classes make `[]` versus `{}` unambiguous for the
  first time. This is the decision.

### 2.2 Identity and equality

A handle is a PHP object; `$a === $b` is identity. Compiled `===`/`!==`
between two values typed as containers emits PHP `===` when the right operand
is pure (a variable, literal or member chain without calls or assignments);
otherwise `\Zero\Js::strictEq(<a>, <b>)`, because PHP evaluates `$o === f()`
by calling `f()` first and reading `$o` after, while JS reads the left operand
first (`let o = {}; const old = o; o === (o = {}, old)` is `true` in Node and
`false` as a direct PHP `===`; verified). A call's arguments are evaluated
left to right in PHP, which restores JS order. `Js::strictEq` keeps
its number handling and falls through to `===` for everything else, which is
now right for handles too. `includes` uses `sameValueZero` (`NaN` equals
`NaN`); `indexOf`/`lastIndexOf` use `strictEq` (`[NaN].indexOf(NaN)` is -1),
as the current helpers already do. So `[o].includes(o)` is true and
`[{}].includes({})` is false, as in JS.


Named function values have one memoized closure per source function across access,
validation, hook, and action contexts. Context-specific helper compilation still
checks database restrictions; it does not create additional function identities.

### 2.3 Key order and integer-like keys

PHP canonicalizes array keys: `"1"` becomes `1`, `"01"`, `"1.5"`, `"-0"`
and `" 1"` stay strings, `"-1"` becomes `-1`, `"4294967295"` becomes the
integer 4294967295 on 64-bit builds. JS has a different rule for *order*:
canonical array indices (integers in `[0, 2^32 - 2]`) ascending first, then
every other key in insertion order. The existing `Js::ownKeys` already
implements the JS rule over a PHP array: integer keys in `[0, 4294967294]`
sorted, then the rest as inserted (`-1` and `4294967295` are "the rest", and
come out in insertion order, matching JS).

Decision: `ownKeys` is the only way the runtime or compiled code enumerates an
object. `Object.keys`, `Object.values`, `Object.entries`, `JSON.stringify`,
object spread, object rest, `structuredClone`, `Seam::toPhp` and
`Sync\Canon` all walk `ownKeys($o->p)`. Keys come back as strings.

Decision: an object is only ever built by three primitives, each of which
writes keys one at a time:

```php
new JsObject(['k' => $v, …])          // literal with static keys only
Js::obj(array ...$parts)              // literal with spread or computed keys: parts in source order
$o->p[Js::key($k)] = $v               // any compiled write
```

`Js::obj` iterates each part and assigns `$out->p[$k] = $v`, which preserves
canonical PHP keys and insertion order. There is no `[...$a, ...$b]`, no
`array_merge`, no `array_values`, no `+` over object storage anywhere in
compiled output or in `Js::*` object helpers. `Js::fromEntries`, `Js::omit`
(object rest) and `Seam::toJs` use the same assignment loop. That is what
makes the renumbering bug impossible: the only operations that renumber PHP
keys are ones that compiled objects never pass through.

`Js::key(mixed $k): string` is `Js::str` for computed keys: `o[1]` and
`o["1"]` both write key `"1"`, which PHP stores as `1`, which `ownKeys`
reports as `"1"` in index order; `o[1.5]` writes `"1.5"`; `o[null]` writes
`"null"`; `o[true]` writes `"true"`.

A differential case pins the whole chain: build `{ "1": 1, "0": 2, b: 3, "-1": 4 }`
via literal, via spread, via `reduce`, via `Object.fromEntries`, via
`JSON.parse`, then `Object.keys` and `JSON.stringify` each. Node and PHP must
agree byte for byte.

### 2.4 Arrays: dense, indexed, `length`

`JsArray::$a` is always a PHP list (`array_is_list` holds). `length` is
`count($a->a)`.

Decision: Zero arrays are dense. JS holes are unreachable by construction:

- A **valid index** is a number `i` with `Number.isInteger(i)` and
  `0 <= i <= 2^32 - 2`. `Js::index(int|float $i): ?int` returns it as an
  int or `null`.
- **Read** `a[i]` compiles to `\Zero\Js::get($a, $i)`: `$a->a[Js::index($i)] ?? null`,
  so `a[0.5]`, `a[NaN]`, `a[-1]`, `a[Infinity]` and `a[length]` all read
  `undefined`. This is exact: JS would look up a non-index property on the
  array object, and Zero arrays can't have any (next bullet). The current
  `(int) $i` cast, which made `a[0.5]` read element zero, is deleted.
- **Write** `a[i] = v` compiles to `\Zero\Js::setAt($a, $i, $v)`: an index
  below `count` overwrites; `count` appends; anything else (past the end, a
  non-index number) throws `JsError('Zero arrays are dense: index … is past
  length …', 'RangeError')`. JS would create a hole or a non-index property.
  This is a deliberate subset restriction, documented in `config-api.md`
  with `push`/`Array.from({ length })` as the way to grow an array.
  Compound (`a[i] += v`) and `++`/`--` on an element go through the same
  `get`/`setAt` pair.
- **Still compile errors:** elisions in array literals, `new Array(n)`,
  `delete a[i]`, `a.length = n`, non-numeric index types.

With density, every "missing element" rule in the array methods collapses to
one test, `$i >= count($a->a)`. One case can still ask for a hole: a
callback that shrinks the array being iterated (`const a = [1, 2, 3]; a.map(() => a.pop())`)
makes JS visit a missing index, and for `map` that puts a hole in the result.
Storing `undefined` there instead would not be one deviation but many:
`filter`, `some`, `every`, `reduce` and `forEach` skip holes and would visit
the `undefined`; `indexOf(undefined)` is -1 on a hole and 0 on the stored
value; `Object.keys`, `in` and object spread differ too (array spread turns
a hole into `undefined`, so it alone would agree). Decision: the case is
**refused**, not approximated. Every helper that reads `length` once and
walks by index (the eleven in §4.1) throws
`JsError('Array shrank while being iterated', 'RangeError')` when its walk
reaches an index that is no longer present (`$i >= count($a->a)`). The
restriction is exactly that: a shrink the walk never reaches (on the last
visit, after an early return, in a `findLast*` walking downward past the
removed tail, or undone by regrowth before the walk gets there) does not
throw and gives the JS result. Growing the array inside the callback is fine
(JS doesn't visit the new elements either, and neither does Zero). The one
remaining difference from JS is "a fixed-length walk that reaches an index
its callback removed throws", which `config-api.md` states next to the
dense-array rule. `for…of` and `Array.from(arr, f)` use the live
array-iterator length and need no check; `Array.from({ length: n }, f)`
keeps its fixed-count `range` path.

### 2.5 Prototype-less plain objects, functions

Handles have no prototype chain. `o.constructor`, `o.toString`,
`o.hasOwnProperty` and `o.__proto__` are not fields of any Zero object type,
so reading them is a compile error on a typed object and reads `null` on a
`Record` or `unknown` value, where JS would return a function. This is an
accepted difference: no program in the corpus or the examples touches a
prototype member, and `Object.hasOwn` is the supported spelling.

Decision: a named function used as a value (`list.forEach(bump)`,
`const f = helper`) compiles to a memoized closure,
`\ZeroApp\__fn_bump()`, a generated helper holding
`static $f; return $f ??= \ZeroApp\bump(...);`, so every function value is a
PHP `Closure` and every read of the same function yields the same `Closure`
(`bump === bump` and `[bump].includes(bump)` are true; a bare `bump(...)` on
each read would allocate a new closure each time and make them false). Today
the value is the string `'\ZeroApp\bump'`, which `typeof` reports as
`"string"` and `JSON.stringify` encodes as a string. With one representation,
`typeOf` (`"function"`), `jsonStringify` (dropped from objects, `null` in
arrays), `str` (`function () { [native code] }`) and `clone`
(`DataCloneError`) all recognize functions.

`typeof` returns `"object"` for both handles. `Js::truthy` is true for every
handle, including empty ones. `Js::str` gives `[object Object]` for a
`JsObject` and the comma-joined elements for a `JsArray` (the existing list
branch, over `->a`, with the cycle guard of §2.7). `Js::toNumber` of a
`JsArray` follows the existing array rules over `->a`; of a `JsObject` it is
`NAN`.

### 2.6 Primitives stay unboxed; `undefined` stays `null`

Only values whose static type is `Obj`, `Map`, `Array`, `Tuple`,
`ArrayLiteral` or `Unknown` can be handles. Numbers, strings, booleans,
`null`/`undefined`, `Date` (epoch ms), `RegExp` (`Zero\RegExp`) and closures
are what they are today. Nothing boxes a scalar, and `Unknown` values are
handles or scalars at run time, which `Js::*` helpers dispatch on with
`instanceof` / `is_*`.

Zero already erases `undefined` into PHP `null`, and this design keeps that.
The observable consequences are unchanged and stay documented in
`config-api.md`: `typeof undefined` is `"object"` (PHP `null` reports as
JS `null`), `JSON.stringify({ x: undefined })` writes `{"x":null}` instead
of `{}`, `String(undefined)` is `"null"`, and a destructuring default fires
on an explicit `null` (`const { x = 1 } = { x: null }` gives 1, JS gives
`null`). The differential corpus avoids these four forms by construction, and
the parity table in §5 lists them as known deviations.

### 2.7 Graphs: aliases and cycles

Handles make shared descendants and cycles expressible for the first time.
Every recursive walk in the runtime handles both:

- `Js::clone` (`structuredClone`) keeps an `SplObjectStorage` map from old
  handle to new, so `clone([p, p])` has one shared `p` and a cyclic graph
  clones to a cyclic graph. `RegExp` clones to a new `RegExp` with the same
  source and flags; an `Error` clones to a new error with the same name and
  message, preserving shared references through the identity map. A `Closure` throws `JsError('… could not be cloned', 'DataCloneError')`.
- `Js::jsonStringify` keeps a stack of handles on the current path and throws
  `JsError('Converting circular structure to JSON', 'TypeError')` on a
  revisit. Shared non-cyclic descendants serialize twice, as in JS.
- `Js::str` / `join` on an array keeps the same stack and renders a revisited
  handle as `""`, which is what `Array.prototype.join` does.
- `Seam::toPhp` throws `HttpError::invalidInput('… contains a cycle')` on a
  revisit: a cyclic value can't be stored or sent. Shared descendants become
  separate arrays, which is the only thing a PHP array can be.

---

## 3. Boundaries: where a handle meets a PHP array

Rule: compiled code and `Js::*` speak handles. `Db`, `Schema`, `Sql`, the
stores, `Scf`, `WpPostStore`, `WpUserStore`, Sync, Abilities, `EditorSave`,
`Locale`, `WpMedia` and every WordPress function speak plain arrays. The
two meet in one new file, `runtime/Zero/Seam.php`, which holds every
conversion. Compiled output never contains a conversion call. `Db` calls
`Seam` once at each public entry point and nowhere inside.

```php
final class Seam
{
    /** JS value → runtime value, by shape (a column spec, an input spec, a relation spec, or null for a free value). */
    public static function toPhp(mixed $v, ?array $shape = null): mixed;
    /** Runtime value → JS value, by shape. `[]` is a list or an object only as the shape says. */
    public static function toJs(mixed $v, ?array $shape = null): mixed;
    /** A result row: columns, attached relations (recursively by relation spec), populated media. */
    public static function rowToJs(string $collection, array $row, array $with = []): JsObject;
    /** The data a before-hook hands back (its returned object or the one it was given). */
    public static function rowToPhp(string $collection, JsObject $row): array;
    /** Query options and filters: the operator grammar is unwrapped, json() operands stay handles. */
    public static function query(string $collection, mixed $opts): array;
    public static function filter(string $collection, mixed $where): array;
    /** Callback contexts: one graph per invocation; `data` by $dataShape, `user` by the fixed user shape. */
    public static function ctx(array $ctx, ?array $dataShape = null): JsObject;
    /** A default/onUpdate `fn` result, by its column. */
    public static function generated(array $col, mixed $v): mixed;
    /** Sync request envelopes and batch items, by collection. */
    public static function sync(string $collection, mixed $in): array;
    /** Outgoing to a foreign JSON encoder (WordPress, Action Scheduler): handles → stdClass / list. */
    public static function toWire(mixed $v): mixed;
}
```

Shapes are schema data the runtime already has: a collection's `columns`, an
action's or job's `input`, a global's `fields`, a relation's target
collection, a field list for a `group`/`blocks` item, the fixed user shape
`{ id, name, role }`, the sync envelope, and a short list of system columns
(`sizes`, `focal`, `translations`). Every `Seam` method takes one explicitly;
callers that today pass a bare `$data` (`Access::evaluate`,
`FieldAccess::allows`, `Schema::checkRules`) gain a shape parameter, threaded
from the collection or enclosing field list they already know.

Three rules apply to every row of the table:

1. **`toPhp` is shape-driven and grammar-aware, never a blind deep walk.**
   For a column shape it converts `group`/`repeater`/`blocks` by their field
   lists and leaves a `json()` value a handle (today's
   `Schema::plainOutsideJson`, moved). For a query shape it is today's
   `Db::plainOptions`/`plainFilter`/`plainWith`, moved: it follows relations,
   unwraps `OR`/`AND`/operator wrappers and leaves a `json()` operand such as
   `{ meta: { eq: {} } }`'s `{}` a handle.
2. **`toJs` never guesses `[]`.** `group` and a `blocks` item are objects;
   `repeater`, `blocks`, `mediaList`, `select` are lists; a `json()` value is
   already a handle; a relation value is a row or a list of rows by the
   relation's kind; a populated `media` column is a media row. A `[]`
   reaching `toJs` with no shape throws `LogicException`; there is no
   default.
3. **Ownership changes hands by copy.** A `json()` handle that crosses into
   runtime ownership is detached: `toPhp` on a write input, a `fn`
   default's or `onUpdate`'s result, and an accepted `before*` hook result
   each copy the `json()` leaves they keep with `Js::detach`, a graph copy
   that shares `Js::clone`'s identity map (aliases inside one leaf survive;
   aliases to compiled-code locals do not) but, unlike `structuredClone`,
   carries closures and `RegExp` through by reference instead of throwing:
   an unannotated `json()` column accepts `{ x: 1, f: () => 2 }` today and
   stores `{"x":1}`, and detachment must not refuse what serialization
   accepts. `structuredClone`'s `DataCloneError` stays the user-facing
   contract; `detach` is runtime-internal. Otherwise a validator
   that captured the same object the action passed as `meta` could write
   through its capture after validation and before storage, and the stored
   value would not be the validated one. In the other direction every
   callback gets its own graph: `rowToJs`, `toJs` and `ctx` build fresh
   handles on each call and clone the `json()` leaves inside them, so a hook,
   rule or validator can't change what the pipeline validated or stored by
   mutating a shared leaf. The exception is a
   `before*` hook's `data`/`patch`, which is read back on purpose. Within one
   invocation, arguments that are one object in JS are one handle in PHP:
   `.validate(value, ctx)` receives `value` as the very handle at
   `ctx.data[field]`; a `before*` hook's `data` and `ctx.data` are the same
   handle; `previous` and `ctx` are built from the same `rowToJs` call where
   they overlap. Each callback builds its graph once and takes every argument
   from it.
4. **Two callback contracts, decided at registration.** The runtime calls
   two kinds of callback and never confuses them. **Compiled** callbacks are
   the `\ZeroApp\…` functions `schema.php` names by string (`hooks.*`,
   `access.*.fn`, column `rules.validate`, `default`/`onUpdate` `fn`, action
   `handler`, job `handler`); they receive handles built by `Seam::rowToJs`
   and `Seam::ctx`. **Native** callbacks are PHP callables registered in
   code, and they keep their array contracts untouched: every `Extensions`
   seam (`beforeRead(array &$opts)`, `onRead(array $rows)`,
   `onWrite`/`normalizeWrite(array &$data, ?array $existing)`,
   `onWritten(array $row, ?array $previous)`, `aroundOperation`,
   `afterCommit`, `route`, `beforeAction`, `cli`, `schemaDescribe`,
   `onLookup`), the built-in job handlers (`Webhooks`), and `Access::evaluate`'s
   declarative rule forms (`allow`, `role`, `self`, which are user-authored
   configuration but not callbacks). The discriminator is the slot's value
   type: a **string** in a `schema.php` callback slot is always a compiled
   `\ZeroApp\` name, and a native handler in such a slot (today only
   `Webhooks::spec()`'s job handler) is always a non-string callable, a
   `Closure` or first-class callable, never a `'Class::method'` string. The
   dispatch sites (`Db::hook`, `Access::evaluate`, `Schema::checkRules`,
   `Schema::generate`, `App::action`, `Jobs\Runner`) convert exactly when
   the slot holds a string; `Extensions` seams are dispatched separately and
   always with arrays. `zero.config.ts` exposes no way to register a PHP
   callback: `Extensions` is registered only by the runtime's own modules
   (`FieldAccess`, `Sync`, `Jobs`/`Webhooks`, `Media\Files`, `Locale`,
   `Auth`, `Abilities`, and the WordPress store and REST registrants) and
   `runtime-contract.md` documents it as the runtime's internal seam. So the
   dispatch rule has no user-visible side and is pinned by one `db_test` case
   per dispatch site (a native `onWrite` sees an array while the compiled
   `beforeCreate` of the same write sees a handle).

| Crossing | Direction | Owner, and what happens |
|---|---|---|
| Request body, query `where`/`with`/`orderBy` JSON | wire → runtime | `App::parseBody`/`queryJson` call `Js::decodeJson`, which returns handles. `App::object()` then calls `Seam::toPhp($v, $inputShape)` for action inputs and write bodies, and `Db` applies `Seam::query`/`filter` to query options at its own entry (next row). Replaces today's marker checks in `App.php` (`withOption`, `object`, the row flattening at line 646). |
| `Db::findMany/findFirst/insert/update/delete/globalUpdate` | any caller → runtime | Each public `Db` method starts with one `Seam` call on its container arguments (`Seam::query`, `Seam::filter`, `Seam::toPhp($values, $columns)`) and returns plain rows. REST, CLI, EditorSave, Sync and compiled code all enter here, so a filter an access rule returns, a `with` from a query string and a `where` from compiled code are normalized by the same code. `Db` has no other conversion. |
| Compiled `db.*` calls | JS → runtime → JS | The compiler emits `\Zero\Seam::findMany(...)` and friends: thin static facades that call `Db` and convert the result with `rowToJs($collection, $row, $with)` (relations recursively, media rows as objects) or `toJs($value, $globalFields)`. `insert`/`update` with `returning` convert the returned row the same way. On the way in, `Seam::toPhp($values, $columns)` detaches `json()` leaves by `Js::detach` (rule 3). |
| Stored `json()` text → row value | storage → runtime | `Schema::decode` for `'json'` calls `Js::decodeJson` and returns a handle. This is the one runtime-land value that is a handle, by rule, for **user** `json()` columns. The runtime treats it as opaque: `Sql` filters call `Js::jsonStringify($arg)`, `Scf::scfValue` calls `Js::jsonStringify`, `Response` encodes it. |
| System JSON structures: media `sizes`/`focal`, locale `translations` | storage ↔ runtime ↔ JS | These are `'json'`-typed but the runtime indexes into them. `Locale\{Module,Read}` call `Seam::toPhp` right after decode where they read them and build plain arrays where they write them (`Locale\Read` replaces `translations` with a plain array today; that array is a runtime value). When a media row or a localized row reaches compiled code, `rowToJs` boxes `sizes`, `focal` and `translations` as objects by a system-column shape list in `Seam`. `WpMedia` keeps `json_decode(..., true)` for its own meta. |
| Column defaults and `onUpdate` | compile time → runtime | `schema_php::generator` emits `'json' => <text>` for every literal default of a container-typed column (`json`, `group`, `repeater`, `blocks`, and any subfield tree containing a `json()` leaf), not only when the literal contains `{}`. `Schema::generate($spec, $col)` takes the full column spec, decodes the text to handles and converts with `Seam::toPhp($v, $col)`, which leaves `json()` leaves as handles and makes structured parts arrays, so a `{}` or `{"1":1}` nested in a `group` default survives. A `fn` default's return value goes through `Seam::generated($col, $r)` at the same place. Every `default`/`onUpdate` caller passes the column. `extract.rs`'s refusal of list-shaped object defaults (`has_list_shaped_object`) is deleted: its premise was the array representation. |
| SCF / postmeta codecs | runtime ↔ storage | `Scf::scfValue` and `Scf::fromScf` convert runtime arrays to SCF's shapes for `group`/`repeater`/`blocks`/`mediaList`; those stay arrays. The `'json'` field type calls `Js::jsonStringify(handle)` and `Js::decodeJson(text)`, unchanged. `WpPostStore`/`WpUserStore` `select`/`mediaList` lists stay `json_decode(..., true)`: runtime arrays. No handle ever reaches `update_post_meta`, `wp_insert_post`, `get_field` or any other WordPress function; `Seam::toWire` sits in front of the two places that hand a Zero value to a foreign encoder (Abilities, below). |
| Hook `ctx`, `data`/`row`/`previous`; access rule `ctx`; `.validate(value, ctx)`; default `fn` | runtime → JS → runtime | `Db::hook`, the `before*` branches of `Db::create`/`update`, `Access::allows`, `Schema::checkRules` and `Schema::generate` build their arguments with `Seam::rowToJs` and `Seam::ctx($ctx, $dataShape)` right before calling the `\ZeroApp\…` function; `Access::evaluate(rule, viewer, op, data, dataShape)` and `FieldAccess::allows` gain the shape parameter and pass the collection's columns or the enclosing field list. `ctx.user` is the fixed `{ id, name, role }` shape; `ctx.data` is the **whole row** (or action input, or global) shaped by its root spec (the collection's columns, the action's input spec, the global's fields) and built once per callback invocation (rule 3), so one validator can't influence the next. A subfield validator's `value` is located inside that graph by its full path from the root (`Schema::checkFields` already walks with a pointer; it carries the matching path and reads `value` out of the `data` handle at that path), so `value` and `ctx.data.group.field` are one handle. `Access::evaluate` gets `ctx.data` shaped by the collection's columns. Absent keys stay absent. `beforeCreate(data)`/`beforeUpdate(patch, existing)` are documented as "mutate `data` or return a replacement"; today only the return works because PHP passed a copy. With a handle both work: `Db` takes the returned handle if there is one, otherwise the `data` handle it passed, through `Seam::rowToPhp`. `after*` hooks, rules and validators get fresh graphs (rule 3), so their mutations are discarded, `json()` leaves included. Filter-valued access callbacks require their collection at every evaluation, including WordPress editor authorization and Sync prechecks; `Access::evaluate` refuses a filter without that context. An access rule's `true/false/filter` goes through `Seam::filter`; a validator's `true/string/null` and a default's value are scalars or `Seam::toPhp($v, $column)`. |
| Action handler `(input, ctx)` and its return | runtime → JS → wire | `App::action` validates the body (`Schema::validateInput`, which normalizes and applies defaults in runtime land) and passes `Seam::toJs($normalized, $inputSpec)` and `Seam::ctx`. The return value is a handle graph; `Response::json` calls `Js::jsonStringify`, which encodes handles directly. No conversion back. |
| REST responses, generated TS client | runtime → wire | `Js::jsonStringify` is the only encoder for `{data}` bodies through `Response` and `Wp\Rest`. Plain arrays still encode as today (list → `[]`, assoc → `{}`, empty → `[]`); handles encode by class. The wire format and the generated client are unchanged, with one fix: a `json()` value of `{}` round-trips as `{}` in every path, and a numeric-string-keyed object stays an object. |
| `JSON.stringify` / `JSON.parse` in compiled code | JS ↔ text | `Js::jsonStringify(handle)` walks `ownKeys` for objects, `->a` for arrays, with the cycle check of §2.7. `Js::jsonParse` → `Js::decodeJson` → handles, with `jsNumbers` applied as today. `decodeJson` builds handles directly from `json_decode(..., false)`'s `stdClass`/arrays (the `"\0"` key workaround stays, since `json_decode` still goes through `stdClass`). Runtime callers that want arrays (`Jobs\Module`, `Scf::json` for non-json fields, `Sync\Wire`, `Abilities\Register`) call `Seam::toPhp(Js::decodeJson(...), $shape)`. |
| Job enqueue | JS → runtime → text, and back | `jobs.x.enqueue(input, opts)` compiles to `\Zero\Seam::enqueue($name, $input, $opts)`, which converts **first**: `opts` → `toPhp($opts)`, `input` → `toPhp($input, $jobInputSpec)`, so `Schema::validateInput` only ever sees runtime arrays with `json()` fields as detached handles (rule 3), the same shape it sees from a REST body. It then calls `Jobs::enqueue($name, $runtimeInput, $opts)`, which is unchanged and validates once (it already calls `Schema::validateInput`) and keeps its runtime-array contract for native callers (webhooks, sync): `Js::jsonStringify` writes the row, and `json()` handles inside the validated array encode as the objects they are (`{}` stays `{}`, integer-like keys keep order). The `{ id }` result comes back as a `JsObject`. `validateInput` therefore has one input contract everywhere: runtime arrays, `json()` leaves handles. |
| Job run | text → runtime → JS | `Jobs\Runner` decodes with `Js::decodeJson` and runs `Seam::toPhp($decoded, $jobInputSpec)` (handles → runtime arrays, `json()` leaves handles), retains the enqueue-validated snapshot without rerunning defaults or validators under the runner's anonymous user, then: a **native** handler (`Webhooks`, any PHP callable in the spec) gets the normalized runtime array and `$ctx` array, as today; a **compiled** handler gets `Seam::toJs($normalized, $jobInputSpec)` and `Seam::ctx`. Action Scheduler only ever carries `['id' => $id]`; the payload lives in Zero's table. |
| `once()` / `Idempotency-Key` receipts | JS → bytes → JS | `Receipts` stores `serialize($result)` and replays with `unserialize`. `allowed_classes` becomes `[stdClass::class, JsObject::class, JsArray::class, RegExp::class, JsError::class]`: `stdClass` stays because runtime producers (media `sizes`, `jobs_test`'s fixture) still put it in results. Decision: a replayed `once` result is a **snapshot** taken when the result is stored (PHP `serialize` does this; the shim stores `structuredClone(result)`), structurally equal to the first result and not identical to it; the first call returns the original in both. The `once` snapshot first uses `Js::clone`, so functions fail with `DataCloneError` as they do in the shim. An HTTP idempotency receipt stores the JSON value tree of its response, dropping function properties before PHP serialization; it replays the same wire value. The shim returns `structuredClone(stored)` on each replay so a later mutation of a replayed value can't leak into the next replay. |
| Captured module-level data | compile time → JS | The compiler walks the evaluator's `Value` graph (`Rc<RefCell<…>>` containers, so identity is available) and emits one memoized static per distinct container into a per-module `__captured_N()` helper: `const p = { n: 0 }; const pairs = [p, p]` compiles to one `JsObject` referenced twice, and two roots that share a descendant share it in PHP. `to_json` is no longer on this path; `validate_captured_data` already refuses cycles. Lifetime: the PHP process, which is one HTTP request on the web and the worker's life under `zero jobs work`, the same shape as a Node process that serves many requests. `config-api.md` says so. |
| `schema.php` | compile time → runtime | Unchanged apart from the defaults row above: plain arrays via `php_json`. It is runtime-land data. |
| Abilities / MCP, in | wire → runtime | Each operation descriptor carries a `shape` next to its JSON Schema `input`, describing the **whole operation input** with column shapes attached at the right paths: `create` → the collection's columns; `update` → `{ id: scalar, patch: columns }`; `delete`/`revisions`/`get` → `{ id }` plus the list-query envelope (`where` → `Seam::filter`'s grammar, `with`, `orderBy`, `limit`, `offset` as scalars); `list` → the query envelope; `run` → the action's input spec; a global `update` → the global's fields; sync operations → `Seam::sync`'s envelope. The conversion lives in `Invoke::call`, the one entry every caller shares: it receives the input from REST (`Register::rawInput` decodes the POST body with `Js::decodeJson` and takes the `input` key out of the run envelope), from `wp zero run --input` (`Abilities\Module::run`, already `Js::decodeJson`), and from core's own `execute()` callers (plain arrays), and runs `Seam::toPhp($input, $op['shape'])` first, before `object()`, permission and `data` extraction. `toPhp` accepts handles and arrays alike, so nested `json()` values keep `{}` versus `[]` and `patch`'s `json()` columns reach `Db` as handles whichever way the input arrived. `tests/wp` gains CLI cases with an ordinary input and a nested empty `json()` object. The `data` closure on `update` (today `Db::plainOutsideJson($columns, patch)`) becomes a read of the already-converted `patch`. Forwarded request bodies use `Seam::inputToJs` with the descriptor’s `bodyShape` (the patch columns for a collection update, otherwise the operation input shape), restoring nested structured objects before serialization. Invalid list containers and unknown values retain their input shape so validation can reject them. Access contexts use this input conversion while data is still unvalidated; unknown container-valued fields reach the normal validation error. `Invoke::object` loses its marker check. |
| Abilities / MCP, out | runtime → wire | `Invoke::call` returns `App::invoke`'s data straight to WordPress's JSON encoder, bypassing `Response`. It now returns `Seam::toWire($data)`, defined as the value tree `Js::jsonStringify` would encode, handed to a foreign encoder instead: `Js::encode` is split into a tree pass (`Js::jsonTree`) and a text pass, and `toWire` is the tree pass. So function-valued object properties are dropped, function-valued array elements and non-finite numbers become `null`, `-0` becomes `0`, `RegExp` becomes `{}`, a cycle throws `TypeError`; `JsArray` → list; `JsObject` → `stdClass` when every key is a legal PHP property name, otherwise an associative array (a `stdClass` can't take a property starting with `"\0"`, and `(object)` casting such an array makes `json_encode` emit `{}` silently; verified). A key starting with `"\0"` is never an integer, so the array can't be list-shaped and encodes as an object. An empty object is always `stdClass`. A non-empty associative operation envelope remains an array when its JSON object encoding is unambiguous: the MCP adapter inspects that envelope before invoking the encoder. This preserves the same JSON tree without adding a `result` wrapper. A WP test covers an action ability returning `{ f: helper, a: [helper, NaN] }` (expects `{"a":[null,null]}`), a row with an empty `json()` value, a numeric-keyed one, and a `{"\u0000":1}` one. |
| Sync, in | wire → runtime | `Sync\Routes::input` decodes the body **once** with `Js::decodeJson` and keeps that handle graph; `Seam::sync($collection, $decoded)` derives the runtime envelope from it (`records`, `uid`, `base`, `fields`, `translations`, cursor fields by a fixed envelope shape; each record's `fields` by the collection's columns, so `json()` values stay handles for the pipeline; batch items the same way). `Routes::applyAt`'s second `json_decode($body, false)`, which exists today to digest the record "as sent" with `{}` kept, is deleted: the sent-record digest is `Canon::digest` over the retained handle graph (`Sync, out` row), which also carries a `{"\u0000":1}` value that `json_decode` into `stdClass` cannot (it returns `null` and the digest is lost; verified). Every array consumer in `Routes`, `Wire` and `Apply` keeps receiving arrays; the marker checks in `Sync\Wire` go. A `sync_test` case pulls a record whose `json()` value has a NUL-prefixed key and pushes it back unchanged, expecting `unchanged`. |
| `FieldAccess` change detection | runtime, reads `json()` handles | `FieldAccess::canon` and `FieldAccess::same` decide whether an echoed value is unchanged (so a hidden or read-only field a client sent back untouched is not a refused write). Both walk arrays only today. They gain the two handle branches with their existing policies kept: `canon` drops nulls and sorts object keys; `same` tags objects and lists separately so key sorting never turns an object into a list. A `JsObject` is an object, a `JsArray` a list, in both. A `schema_test` case echoes a stored `{"a":1,"b":2}` as `{"b":2,"a":1}` through a field-rule-protected write and expects acceptance. |
| Sync, out | runtime → wire | `Wire::encode` keeps `json()` column values (handles) inside records and digests them with `Canon::digest`. `Canon::json` gains the two handle branches: `JsObject` → object with keys sorted (its existing canonical rule) over `->p`, `JsArray` → list over `->a`. `Canon` is runtime-land code reading the one handle type the runtime holds, like `Sql`. |

What this removes: `Js::plain`, `Schema::plainOutsideJson` (moves into
`Seam::toPhp`), `Db::plainOutsideJson`/`plainFilter`/`plainOptions`/`plainWith`
(move into `Seam::query`/`filter`), and every `$x instanceof JsObject ? [] : $x`
in `App`, `Db`, `Schema`, `Jobs\Runner`, `Abilities\Invoke`, `Sync\Wire`,
WordPress adapters. One conversion owner.

---

## 4. Runtime and compiler changes

### 4.1 `Js::*`

**Inventory of every helper that takes or returns a container**, with its new
signature. Anything not listed keeps its signature (numbers, string scalars,
dates, regexp, logging).

| Helper | Before | After |
|---|---|---|
| `str`, `truthy`, `typeOf`, `toNumber`, `strictEq`, `sameValueZero` | array branches | `instanceof` branches per §2.5; `str` with cycle guard |
| `split(string, …)` | `array` | `JsArray` |
| `strMatch(string, RegExp)` | `?array` | `?JsArray` (groups as elements, `index`/`input`/`groups` keys on `->p`-less array are not supported; today's shape is kept as elements only) |
| `find`, `findLast` | `(array, callable)` | `(JsArray, callable)`; each returns the element it read before calling the predicate, never a re-read |
| `findIndex`, `findLastIndex`, `some`, `every`, `includes`, `indexOf`, `lastIndexOf`, `join` | `array` first | `JsArray` first |
| `filter`, `map`, `flat`, `arrSlice`, `sorted`, `range` | `array → array` | `JsArray → JsArray` |
| `flatMap` | `flat(map(...))` | one loop that flattens each callback result into the output before the next callback runs (a later callback may mutate an array an earlier one returned) |
| `splice(&array, …)`, `reverse(&array)`, `sort(&array, ?cmp)`, `fill(&array, …)` | by-reference PHP array | `(JsArray, …)`: the handle is the reference; `splice` returns a `JsArray` |
| `reduce(array, callable, ...$init)` | | `(JsArray, callable, ...$init)` |
| `arrAt(array, i)` | | `(JsArray, int\|float)` |
| `keys`, `values`, `entries` | `array\|JsObject → array` | `JsObject → JsArray`; `entries` boxes each pair as a `JsArray` |
| `fromEntries(iterable)` | | `(JsArray)` of `JsArray` pairs |
| `omit(array\|JsObject, array)` | | `(JsObject, list<string>) → JsObject` |
| `hasOwn(array\|JsObject, string)` | | `(JsObject\|JsArray, mixed $k)`: `$k` → `Js::key`; on an array `"length"` is true, a canonical index string is `< count`, anything else false |
| `jsonStringify(mixed, …)` | | encodes handles by class, plain arrays as today (runtime callers), cycle → `TypeError` |
| `decodeJson(string)`, `jsonParse(string)` | arrays + marker | handles |
| `sameJson(a, b)` | arrays + marker | structural over handles and arrays: same class, same `ownKeys`/length, recursive |
| new `obj(array ...$parts): JsObject` | | literal with spread or computed keys |
| new `key(mixed): string` | | computed property key |
| new `index(int\|float): ?int`, `get(JsArray, int\|float): mixed`, `setAt(JsArray, int\|float, mixed): mixed` | | §2.4 |
| new `push(JsArray, mixed ...): int`, `unshift(JsArray, mixed ...): int`, `pop`, `shift` | `array_push($place, …)` etc. | over `->a` |
| new `concat(JsArray $a, mixed ...$items): JsArray` | `array_merge` | called after every argument is evaluated; a `JsArray` item is spread, anything else appended |
| new `forEach(JsArray, callable): void` | `array_map` with keys | §4.1 iteration rule |
| new `from(JsArray\|string, ?callable): JsArray` | lowered to `map` | `Array.from(arr, f)`: iterator semantics, live length; a string source iterates code points (`mb_str_split($s, 1, 'UTF-8')`, as `for…of` over a string does). Accepted sources are exactly: any array-typed value (`Array`, `Tuple`, `ArrayLiteral`; today only `Ty::Array` is accepted, so tuples and short literals are newly accepted), a string (newly accepted; code points, like `for…of`), and the literal `{ length: n }` form, which stays on the fixed-count `range` path and still requires the mapper (`Array.from({ length: 3 })` without one stays refused, since it would need holes). Any other argument type (a `JsObject`, a `Record`, `Map`/`Set`, a generic iterable) is a compile error, `Array.from needs an array, a string, or { length: n } with a mapper`. `tests/compiler.rs` keeps one refusal case; the differential suite gets one row per accepted form. |
| new `toReversed`, `toSorted`, `with` | `array_reverse` | over `->a`, return new `JsArray` |
| new `clone(mixed): mixed` | | `structuredClone`, §2.7 |
| new `detach(mixed): mixed` | | runtime-internal ownership copy: same identity map as `clone`, closures and `RegExp` by reference (§3 rule 3) |
| new `arr(iterable): JsArray` | | for runtime code building a list to hand to compiled code |
| deleted | `at`, `write`, `obj` (marker), `objectBinding`, `copyObject`, `plain`, `fromJson`'s marker branch | |

**Iteration rule for callbacks.** The eleven fixed-length methods, `map`,
`filter`, `forEach`, `some`, `every`, `reduce`, `flatMap`, `find`,
`findIndex`, `findLast`, `findLastIndex`, follow ECMA-262: `len = count($a->a)`
is read once; for `i` in `0..len` (`findLast*` from `len - 1` downward), if
`i >= count($a->a)` the walk has reached an index its callback removed and
the helper throws `RangeError` (§2.4). So no helper ever hands a callback a
missing element and the `value` parameter keeps its element type. Otherwise
the callback gets the element read live. The current PHP helpers mostly use
snapshot `foreach` loops; the rewrite replaces them with captured-length
index loops that read `->a[$i]` live. Each helper
keeps the element it read in a local and collects or returns that local,
never re-reading `->a` after the callback. Callback shapes are the JS ones
and the compiler types them so: `(value, index, array)` for `map`, `filter`,
`forEach`, `some`, `every`, `find*`, `flatMap`; `(acc, value, index, array)`
for `reduce`; `(value, index)` for `Array.from`'s mapper; `(a, b)` for
`sort`'s comparator. `effects.rs`'s callback edges gain the `array`
parameter as a copy of the receiver. `sort`/`toSorted` are not fixed-length
walks and are exempt from the guard: `sort` sorts a snapshot of `->a` with
`usort` and writes it back over the original prefix, keeping any elements
the comparator pushed past the original length (Node gives `[1, 2, 9]` for a
comparator that pushes 9 once; replacing the whole array with the snapshot
would drop it). Corpus rows 29 and 34 do observe which comparator argument
is read or mutated. PHP's two-element sort calls the operands in the reverse
order from V8; the helper calls the authored comparator with reversed
operands and negates its comparison sign. This preserves ordering and matches
those corpus observations. Beyond these cases, comparator invocation order
remains engine-defined; comparators must not depend on a particular sequence.
Pushes inside the callback are not visited (they are past `len`); writes to
not-yet-visited indices are seen. `Array.from(arr, f)` and `for…of` use the
iterator protocol instead: they continue while `i < count($a->a)` live, so
pushes inside the body are visited. `sort`'s contract is in the paragraph
above: prefix writeback, pushed tail kept, comparator invocation order left
to the engine.

Every runtime `mb_*` call passes its encoding explicitly (`'UTF-8'` for
Zero strings, with explicit source and destination encodings for conversions).
WordPress plugins may change `mb_internal_encoding()`; Zero never depends on
that global setting. The compiler's emitted `mb_*` calls follow the same rule.

### 4.2 Compiler

Each path, before → after. `R`, `K`, `V` name compiler temporaries.

- **Object literal.** `['k' => v]` or `(new JsObject())` or `Js::obj([...copyObject])`
  → `new \Zero\JsObject(['k' => v, …])` when every key is static and there is
  no spread; otherwise `\Zero\Js::obj(['k' => v], $s->p, [\Zero\Js::key($kx) => v2], …)`
  with parts in source order. Passing `$s->p` (the array, not the handle)
  is the snapshot: PHP copies it when the argument is evaluated, so
  `{ ...a, y: changeA() }` keeps `a`'s fields as they were before `changeA`,
  as JS does (verified against Node). A nullable spread is `($s?->p ?? [])`.
  Later parts overwrite earlier keys inside `Js::obj`, which is JS's
  later-wins.
- **Array literal.** `[a, b, ...$s]` → `new \Zero\JsArray([a, b, ...$s->a])`.
  List spread of a PHP list is safe (it renumbers, which is what a list is)
  and `$s->a` snapshots at its source position for the same reason.
- **Member read.** Object property reads use `\Zero\Js::prop(<o>, <k>)`,
  including static keys, so a missing receiver throws a catchable JS `TypeError`.
  Arguments preserve receiver-before-key order (`o[key()]` where `key`
  reassigns `o` reads the old object). Optional chains keep the
  temp-and-null pattern. `length` → `count($a->a)`. Array and tuple index
  reads use `\Zero\Js::get($a, $i)` with the same checked receiver semantics.
  The original direct member-read benchmark below is historical and does not
  measure the guarded helper path.
- **Member write.** `Js::write($root, [$k1, $k2], $v)` → the receiver and
  key are read before the right-hand side runs, because JS evaluates the
  reference first and the value second and a right-hand side can replace the
  receiver (`o.child.x = rhs()` where `rhs` reassigns `o.child` writes the
  *old* child in JS; verified against Node). The receiver is exempt from
  capture only when it is a `const` local or a parameter the function never
  reassigns; a `let` can be reassigned by the right-hand side, so it is
  captured like any expression.
  - Statement position: `R = <o>; K = \Zero\Js::key(<k>); \Zero\Js::set(R, K, <v>);`
    as separate statements. The helper checks a missing receiver after the
    right-hand side has run and throws a catchable JS `TypeError`.
    A direct PHP property write would instead throw a native error outside
    the authored JS catch block. The original direct-write benchmark below
    does not measure this guarded helper path.
  - Expression position, plain `=`: `\Zero\Js::set(<o>, \Zero\Js::key(<k>), <v>)`,
    whose arguments evaluate left to right and which returns the value.
  - Compound and logical writes capture `R`, `K`, then the old value through
    checked `Js::prop` / `Js::get`, before evaluating the right side. A missing
    receiver throws `TypeError` at this read, even for a short-circuited `&&=`.
    Arithmetic compounds also snapshot property presence with `Js::has`.
    Missing numeric values become `NaN`; present null values become zero.
    `+=` uses `Js::plus` with the presence snapshot for JavaScript primitive
    coercion (`undefined + "x"` is `"undefinedx"`, while `null + "x"` is
    `"nullx"`). This local presence bit does not change the general undefined
    representation in §2.6. Updates use the same presence and numeric rules.
    Logical assignments short-circuit on the captured value.
    Statement position emits separate statements. Expression position uses
    the compiler's in-place sequencing array, so conditional branches stay
    conditional and assignments on the right side update the enclosing scope.
    No thunk or hoisting is used. All writes go through `Js::set` / `Js::setAt`.
  - `a[i] = v` → `\Zero\Js::setAt(<a>, <i>, <v>)` in both positions (a
    helper already).
- **Destructuring.** The source is **always** captured in a temporary before
  any binding or default runs: `const { a = reset(), b } = src` reads `b`
  from the original object even if `reset()` reassigns `src`. Today the
  compiler reuses an addressable source; that reuse is deleted. Then
  `$src['k']` → `$T->p['k']`; object rest → `\Zero\Js::omit($T, [...])`;
  array patterns → `\Zero\Js::get($T, i)`; array rest →
  `new \Zero\JsArray(array_slice($T->a, n))`. Nested patterns capture their
  own sub-source the same way. Array destructuring keeps an iterator-exhausted
  flag: once an element read reaches the end, later defaults cannot revive the
  iterator by growing the source, and rest stays empty.
  `check_destructured_mutation` is deleted.
- **Parameters and captures.** `&$x` on parameters, `objectBinding`, capture
  anchors, the by-ref branch of `initialize_parameter` and the "captured
  mutating parameter needs an object with required fields" error are
  deleted. A parameter is a PHP variable holding a handle. A closure
  `use ($x)` captures the handle by value, which is JS's capture of the
  binding's current object; `use (&$x)` stays exactly for `let` bindings
  the closure can see reassigned (`l.mutable`), because that is about the
  variable, not the object. `effects.shared(binding)` drops out of that
  decision.
- **`for…of`.** `foreach ($src as $x)` → the receiver is captured once,
  `R = <iter>`, then an index loop with live length,
  `for ($i = 0; $i < count(R->a); $i++) { $x = R->a[$i]; … }`, so a push
  inside the body is visited, as in JS (PHP `foreach` iterates a snapshot;
  verified). `for (let …)` closures per iteration keep today's
  `fresh_binding` emission, which uses `effects.captured`. Strings keep
  `mb_str_split`.
- **Array methods.** The `place()` requirement ("call it on a variable") for
  `push`/`pop`/`shift`/`unshift`/`splice`/`sort`/`reverse`/`fill` is deleted;
  the receiver is any expression. `array_push($place, …)` →
  `\Zero\Js::push($a, …)`; `array_merge(...)` for `concat` →
  `\Zero\Js::concat($a, ...args)` (a helper call, so the receiver's elements
  are read after the arguments are evaluated, as JS does); `array_values`
  for `Array.from(arr)` and the `map` lowering of `Array.from(arr, f)` →
  `\Zero\Js::from($a, $f)`, with the source typed as array or string, the
  `{ length: n }` literal kept on `Js::range`, and everything else refused
  at compile time (§4.1); `Array.isArray` → `instanceof \Zero\JsArray`;
  `forEach` → `\Zero\Js::forEach`; `toReversed` → `\Zero\Js::toReversed`.
  Callback closures get the third `$array` parameter typed as the receiver.
- **`===`.** `check_identity_eq` is deleted; `strict_eq` emits `===` for two
  container operands when the right operand is pure, else `Js::strictEq`
  (§2.2).
- **`structuredClone(v)`** becomes supported: `\Zero\Js::clone($v)`, typed as
  its argument. It is the replacement for the implicit copy users could
  previously rely on by accident.
- **Function values.** A named helper used as a value → the memoized
  `\ZeroApp\__fn_name()` closure (§2.5).
- **Captured data.** Emitted from evaluator container identities into
  memoized per-module helpers (§3).
- **Type hints.** `php_hint`: `Ty::Obj | Ty::Map` → `\Zero\JsObject`,
  `Ty::Array | Tuple | ArrayLiteral` → `\Zero\JsArray`, nullable variants
  with `?`.
- **`JSON.parse` / `JSON.stringify`, `typeof`, truthiness, templates.** Same
  emission; the helpers changed.
- **`effects.rs`.** Stays. It owns captured-binding detection (fresh loop
  bindings), numeric and tuple widening of parameters (`parameter_type`,
  including the `incoming_writes` tuple-shape restoration that
  `tests/compiler.rs` pins), loop view types (`read_view_type`) and
  refinement invalidation on writes (`invalidate`, `write_type`,
  `changes_refinement`). Invalidation becomes **alias-aware with path
  translation**: the analysis already records copy edges between *places*
  (a binding plus a path of `Field`/`Index` steps) for assignment,
  destructuring, argument passing, store into a container, return and
  capture. Each copy edge `src → dst` is kept as an alias pair of places.
  A member write to place `W` invalidates, for every alias pair where `W`
  extends one side by a suffix `S`, the place `other side + S`, transitively.
  So after `alias = root.child`, a write to `alias.x` invalidates
  `root.child.x` (not `root.x`), and after `const { child } = root` the same.
  Paths through `Index` steps match any index. A refinement on a place whose
  alias set reaches a value that has escaped the function (passed to a call,
  stored into a container that itself escapes, captured by a closure,
  returned) is dropped at the next call expression that can execute user code
  or retain its arguments. Known built-ins that only read scalar/container values
  (e.g. `indexOf`) are not escape boundaries. Without this,
  `const alias = o; if (typeof o.x === "number") { alias.x = "hi"; return o.x + 1; }`
  would keep the numeric refinement on `o.x` and emit numeric addition where
  Node gives `"hi1"`. Aliases the runtime creates outside compiled code are
  **seeded** by the root's slot, from the same contract §3 states: a
  validator's `value` ≡ `ctx.data.<full path>`, a `before*` hook's
  `data`/`patch` ≡ `ctx.data`, an action's `input` has no alias. Captured
  module-level containers get one place per evaluator container identity
  (`Graph::ident` returns it for captured data, as it does for captured
  closures today), shared by every root, so the alias pairs §3's captured
  data row preserves at run time exist in the analysis too. Anything else
  that enters a function from outside (a parameter the slot says nothing
  about, a value returned by a `db.*` call) is an **external root**, and a
  member write through any external root or escaped place drops every
  descendant refinement rooted in an external root; it cannot replace the
  receiver binding itself, so the receiver's non-null refinement survives.
  Tuple and numeric widening from earlier mutations survives refinement
  invalidation. Refinements on locals the function built itself are untouched. The rule is conservative on purpose: a
  refinement survives only on a place nothing else can reach, and a dropped
  refinement is a compile error at the use site, never a wrong program.
  Deleted from the module:
  `by_ref`, `shared`, `shared_parameter`, `argument_by_ref`,
  `replaces_argument`, `reference_arguments`. Deleted
  from `compile.rs`: `check_aliasing`, `check_identity_eq`,
  `check_destructured_mutation`, `writes_into_object`, `object_binding`,
  `capture_anchor`, the by-ref plumbing in `closure_body`/`declare_parameter`/
  `ForOf`, the `shared_parameter` reassignment error in `place_inner`. The
  `reject-aliasing` fixture becomes a differential case that must pass.
- **Unchanged.** Types (`src/types.rs`), narrowing, numbers, strings, and
  the db query/filter compilation (it produces runtime-land arrays that
  `Seam::query` consumes).

### 4.3 Docs

`docs/runtime-contract.md`, "class Js": the value model line becomes
"arrays are `Zero\JsArray`, plain objects are `Zero\JsObject`, both handles
with identity; functions are `Closure`". The `JsObject` marker paragraph is
replaced by a `Seam` paragraph listing the crossings in §3 and the dense-array
rule of §2.4.

`docs/config-api.md`, "The subset": the aliasing refusals in the Rejected
list (mutating an object after storing it, reassigning a mutating parameter,
mutating through a destructured parameter, replacing an argument
mid-expression) and the tuple-widening paragraph about mutation are deleted.
`structuredClone` joins Supported. New lines: arrays are dense (writing past
`length` throws `RangeError`, and so does a `map`/`filter`/`find*`/… walk
that reaches an index its own callback removed); module-level captured objects live for the PHP
process; the four `undefined`-erasure deviations of §2.6. The hooks table's
"mutate `data` or return a replacement" becomes true as written.

---

## 5. Equality and serialization semantics

| Operation | Compiled PHP | Matches JS because |
|---|---|---|
| `a === b`, containers | `$a === $b` (pure right operand) or `Js::strictEq` | PHP object identity; the helper keeps JS's left-then-right evaluation. |
| `a === b`, mixed/unknown | `Js::strictEq` | Numbers by value (`1 === 1.0`), everything else `===`. |
| `a == b` | compile error (unchanged) | Loose equality isn't supported in Zero code. |
| `switch` | strict comparisons (unchanged) | |
| `includes` | `sameValueZero` | NaN equals NaN, handles by identity. |
| `indexOf`/`lastIndexOf` | `strictEq` | NaN never found, handles by identity. |
| `JSON.stringify(o)` | `ownKeys` order, `{}` / `[]` for empty, functions dropped from objects and `null` in arrays, non-finite numbers `null`, `-0` as `0`, cycle → `TypeError` | ECMA-262 `SerializeJSONObject` over `OrdinaryOwnPropertyKeys`. |
| `Object.keys/values/entries` | `ownKeys` | Same order rule. |
| `for (k of Object.keys(o))` | same | `for…in` stays a compile error with the `Object.keys` hint. |
| `for (x of arr)` | index loop, live length | Iterator protocol. |
| `Object.hasOwn(o, k)` | `Js::hasOwn`: objects by `array_key_exists(Js::key($k), $o->p)`; arrays: `"length"` true, canonical index string `< count`, else false | |
| `a.length` | `count($a->a)` | Dense arrays. |
| `String(o)`, templates | `[object Object]`, `a,b,c`, cycle → `""` | |
| `!!o` | `true` | Every object is truthy. |
| `typeof f` | `"function"` | Every function value is a `Closure`. |
| Known deviations (unchanged) | `typeof undefined` → `"object"`; `JSON.stringify({x: undefined})` → `{"x":null}`; `String(undefined)` → `"null"`; a destructuring default fires on `null` | `undefined` is PHP `null`. Documented in `config-api.md`. |

`Js::sameJson` (structural equality used by `EditorSave` for change
detection) compares handles structurally: same class, same `ownKeys` or
length, recursive on values; two separately decoded `{"a":1}` values are
equal and `{"a":1}` versus `{"a":2}` are not. `editor` tests keep a case
that changes a nested `json()` value and expects the column reported as
changed.

---

## 6. Performance

What was measured: `docs/spikes/js-references-bench.php`, a representation
microbenchmark, on this box under PHP 8.3.6 and 8.5.10 with
`-d memory_limit=-1` (the 100k-row builds exceed 128 MB in every
representation). Each row is the mean of 2–2000 warm iterations. It does
**not** measure the pipeline: `Seam` traversals, per-callback cloning of
`json()` values, `ownKeys` sorting, the identity maps of §2.7, or a real
WordPress request. Compare ratios, not absolutes.

| Case (per iteration) | plain array | handle | stdClass | ArrayObject | handle / plain |
|---|---|---|---|---|---|
| Build 100k rows `{ id, name, tags: [3], meta: { a, b } }` (3 containers per row) | 13.2 ms | 37.4 ms (constructor) / 56.0 ms (`Js::obj` variadic) | 18.8 ms | 33.3 ms | 2.8x / 4.2x |
| 1M member read + write `o.x = o.y + i` | 8.3 ms | 12.5 ms | 6.9 ms | 19.2 ms | 1.5x |
| 1M nested write `o.meta.a = i`, direct / receiver captured as a statement / `Js::set` helper in expression position / `[R = …, write][1]` array form | 10.5 ms | 14.2 ms / 13.7 ms / 23.2 ms / 31.7 ms | | | 1.4x / 1.3x / 2.2x / 3.0x |
| `map` then `filter` over 100k ints, live-length loop | 4.0 ms | 6.3 ms | | | 1.6x |
| `map` 100k rows → `name` | 6.0 ms | 6.9 ms | | | 1.1x |
| JSON encode 100k rows, runtime-style encoder | 86.9 ms | 90.4 ms | | | 1.04x |
| JSON encode 100k rows, native `json_encode` (reference only) | 16.6 ms | n/a | | | |
| JSON decode 100k rows: today's `json_decode` + `fromJson` walk, versus `json_decode` + handle walk | 127.6 ms | 197.1 ms | | | 1.5x |
| JSON decode a 10 KB body (10,171 bytes), same two walks | 0.105 ms | 0.128 ms | | | 1.2x |
| `for…of` 100k ints: `foreach` vs index loop with live length | 0.40 ms | 1.05 ms | | | 2.7x |
| Memory, 100k rows resident | 77.5 MB | 93.5 MB | 85.2 MB | | +168 B/row = 56 B per handle |

PHP 8.5 is within 10% of 8.3 on every row except `map rows → name`
(3.3 ms versus 8.1 ms, 2.5x; 8.5's plain `foreach` over rows got faster)
and 100k-row decode (129 versus 196 ms, 1.5x, the same ratio). CI runs 8.3
and 8.2; both are in the supported range. The design does not depend on
the PHP version.

Reading the numbers:

- Aggregate deltas: building a row with three containers costs about
  240 ns more than the plain version (24 ms over 100k rows), and a read
  plus write pair through a handle about 4 ns more than through a PHP array
  (4 ms over 1M pairs). Each handle is 56 bytes. The spike does not isolate
  allocation from access; these are the per-row and per-pair numbers.
- `Js::obj` (variadic literal) is 1.5x slower than the plain constructor, so
  the compiler uses the constructor whenever a literal has only static keys
  and no spread, which is nearly every literal.
- Capturing the receiver of a member write (§4.2) costs nothing in statement
  position (13.7 versus 14.2 ms direct). In expression position the `Js::set`
  helper is 1.6x a direct write and the array form 2.2x. These are historical
  emission choices: §4.2 now uses checked reads and writes for catchable JS
  errors and missing-property coercion. Computed keys and compound writes
  were not measured separately by this microbenchmark.
- Decode was already a PHP walk (`fromJson`), so the handle version is 1.2x
  to 1.5x of today, not the 2.3x an earlier draft claimed against raw
  `json_decode(…, true)`.
- The live-length index loop for `for…of` costs about 7 µs per 1000
  elements over `foreach`. Chosen for exactness; open question 2.
- Memory: a 1000-row response with three containers per row holds about
  170 KB more. WordPress requests run with 256 MB by default.

What the implementation PR must measure before merge, and record in its
body: `tests/wp/run.sh` wall time before and after; a compiled action handler
that reads 200 rows with one relation and a `json()` column, builds a response,
and returns it, timed in-process on both representations (this exercises
`rowToJs`, cloning and `jsonStringify` together); and the
`tests/php/run.sh` time (WordPress on SQLite, without HTTP). The design's claim is that these deltas are small
against MySQL and WordPress bootstrap; the PR proves or disproves it with
numbers. A response-building action is used instead of a collection hook, whose
return contract is a row or void; it exercises the query, callback, conversion,
and response pipeline without adding an artificial collection lifecycle.
The completed warm WordPress/SQLite experiment is in
`docs/spikes/js-references-pipeline.md`: 1.864 → 3.194 ms/request, 505 validated
requests per side, zero errors. It includes the final checked helpers. The
shared-host CLI run has opcache disabled and no isolated MySQL/PHP-FPM profile,
so it does not establish that overhead is small relative to bootstrap or MySQL.

---

## 7. Testing strategy

The bar is unchanged and now literal: what compiles must do what Node does.

1. **Acceptance suite = the corpus + `tests/differential`.** `CORPUS.md` on
   `archive/s2-ownership-rule` holds 65 action bodies, each a false negative
   of one of the two analyses or a reviewer finding, with the Node result and
   today's PHP result (58 differ, 3 agree, 4 are refused by the surviving
   name-based check). Every row moves into `tests/differential/cases.ts` as
   a `laneRefs` action group, one action per row, returning the body's value.
   The cases on the branch's `cases.ts` that the analyses had rewritten into
   loops (`map`/`reduce`/`fill`/closure/default-parameter forms) are restored
   to their original forms. Every case runs under `run-node.mjs` and
   `run-php.php` through the existing
   `compiled_php_matches_node_on_every_differential_case`. Done means every
   row returns what Node returns, including rows 22 and 34, where Node itself
   returns `false`.
2. **Identity and order are asserted inside cases**, not inferred from
   serialized output: a case returns `a === b`, `Object.keys(o)`, or the
   result of a mutation through the alias, because JSON output alone can't
   show whether two values were one object.
3. **Evaluation-order cases**, one each: receiver replaced by the right-hand
   side (`o.child.x = rhs()`), spread snapshot (`{ ...a, y: changeA() }`),
   destructuring default reassigning the source, `concat` with an argument
   that mutates the receiver, compound assignment whose right-hand side
   changes the old value, `o === f()` where `f` reassigns `o`, a `let`
   receiver reassigned by the right-hand side, `flatMap` whose later callback
   mutates an earlier result, `findLast` whose predicate overwrites the
   element, `for…of` with a push in the body, `map` with a push, with a write
   to a later index, `bump === bump` and
   `[bump].includes(bump)` for a named function, `o[key()]` where `key`
   reassigns `o`, `(o.x ??= (n = 1))` observing the write to `n`,
   `o.s += "b"` on a string field, `take ? (o.x += 1) : 0` with `take`
   false and `[o.x, o.x += 1]`, a validator that writes through
   `ctx.data.<field>` and reads `value`, a validator that writes through a
   captured object the action passed as the column value and a check that
   the stored value is the validated one, an insert of `{ x: 1, f: () => 2 }`
   into an unannotated `json()` column storing `{"x":1}`,
   and the alias-refinement program from §4.2 plus its `alias = root.child`
   variant.
4. **Key-order case** (§2.3): literal, spread, `reduce`, `fromEntries`,
   `JSON.parse`, through `Object.keys` and `JSON.stringify`.
5. **Dense-array cases**: `a[a.length] = v` appends; `a[a.length + 1] = v`
   throws `RangeError` in PHP and the Node shim (the shim's `Array` is a
   Proxy in the differential runner, or the case is PHP-only in
   `js_parity.php` with the documented deviation); `a[0.5]`, `a[-1]`,
   `a[NaN]` read `undefined`.
6. **Shrink-under-iteration cases** (`js_parity.php`, PHP-only, since Node
   produces a hole or skips where Zero throws): one row per helper that
   reads `length` once (`map`, `filter`, `forEach`, `some`, `every`,
   `reduce`, `flatMap`, `find`, `findIndex`, `findLast`, `findLastIndex`),
   each on a three-element array with a callback that `pop`s twice on the
   first visit and otherwise continues the walk (`false` for `some`/`find*`,
   `true` for `every`), expecting `RangeError` in both walk directions; one
   row per helper with a callback that `push`es, expecting the JS result (new
   elements not visited); non-throwing shrink rows pinning the narrow
   contract (`pop` on the last visit, `pop` then early return, `findLast`
   popping one past its position), expecting the JS result; one `for…of` and
   one `Array.from(arr, f)` row with a `pop` in the body, expecting the JS
   result (live length, no throw); a `sort` comparator that pushes, expecting
   the pushed element kept.
7. **Graph cases**: `structuredClone` of a shared descendant stays shared;
   `JSON.stringify` of a cycle throws a catchable `TypeError`; `String()` of
   a self-containing array.
8. **`tests/php/js_parity.php`** gains a row for each helper in the §4.1
   table whose signature changed, using the existing "JS expression versus
   PHP call" format.
9. **Harness.** `run-php.php` builds its arguments the way production does:
   for a validator it installs the fixture value at the column's full path
   inside the fixture `ctx.data`, builds one invocation graph with
   `Seam::ctx`, and reads `value` out of that graph at the same path, so
   `value` and `ctx.data.<field>` are one handle as in production;
   `run-node.mjs` does the same in JS. The harness can't pass a shape or an
   alias structure the runtime never would. State
   isolation is stated in `cases.ts`: Node runs every action in one module
   instance and PHP runs each in its own process, so no case may depend on
   another action having run; a case may mutate captured module data only
   within its own body.
10. **`tests/compiler.rs`:** the `reject-aliasing` fixture and the tests that
   expect the by-ref/identity/destructured-mutation errors are deleted along
   with the errors.
11. **Boundary tests** (`tests/php/db_test.php`, `schema_test.php`,
    `jobs_test.php`, `sync_test.php`): a `json()` column round-trips `{}`,
    `[]`, `{"1":1,"0":2}` and `{"\u0000":1}` through insert → read → REST
    body; a `group` written as `{}` from an action reads back filled; a
    `json()` default of `{"1":1,"0":2}` is applied as an object; a hook
    receives a handle and `Object.keys(row)` matches the column list plus
    attached relations; an `afterCreate` hook that mutates `row.meta.x`
    changes neither the stored row nor the response; a `beforeCreate` hook
    that mutates `data` without returning changes the stored row; an action
    input with a nested `json()` field arrives as a handle; a job enqueued from an action with a nested `json()` value
    (`{ meta: { "1": 1, "0": 2, empty: {} } }`) is validated at enqueue,
    boxed with the full job input schema before serialization, stored, and decoded on the run path to the same value byte for byte
    (`Js::jsonStringify` of the handler's `input.meta` equals the action's);
    the same job runs a compiled handler with a handle and a native handler
    with an array; a native `onWrite` sees an array while the compiled
    `beforeCreate` of the same write sees a handle; a `once` replay returns an equal, non-identical
    result; Sync digests a record with a `json()` value identically before
    and after the change; `sameJson` sees a nested `json()` change.
12. **Real WordPress:** `tests/wp/run.sh` gains one case per WordPress
    crossing in §3: SCF `json` field round trip of `{}` and a numeric-keyed
    object; a job whose input has a `json()` field; an ability invoked with
    `{}` and one returning a row with an empty `json()` value (the `toWire`
    path); a localized row's `translations` in a hook.
13. **Redundancy:** cases on the archived branch that only existed to prove
    a *refusal* are not ported; their programs are now expected to pass, and
    a passing program already covers the behavior.

---

## 8. Rollout

Three PRs, in order, each green on every suite in `LANE-BRIEF.md`.

1. **Seam extraction, no representation change.** Add `runtime/Zero/Seam.php`
   over today's arrays and marker: move `Schema::plainOutsideJson`,
   `Db::plainOptions/plainFilter/plainWith` and `App::object` into
   `Seam::toPhp/query/filter`; route every `Db` public method and every
   `instanceof JsObject ? [] : …` site through them. Add `Seam::ctx` and
   `rowToJs` as identity functions over arrays, called from every callback
   site, so the call sites exist before they do anything. Emit `'json'` text
   for every `json()` default. Behavior is identical; `db_test`, `schema_test`
   and the WP suite prove it. This PR exists so PR 2 touches one file for
   conversions.
2. **The switch.** Everything else in §2–§4 at once: the handle classes
   replace the marker, every `Js::*` helper changes signature, `Seam` converts
   for real, the compiler emits handles, `effects.rs` loses its sharing half,
   the corpus and all §7 cases land, `runtime-contract.md` and
   `config-api.md` are updated, and the §6 pipeline measurements are in the
   PR body. This cannot be split: a runtime that returns handles from `map`
   or `decodeJson` breaks every program compiled by the old compiler, and
   a compiler that emits `->p` needs the runtime to return handles. It is one
   large PR by necessity; review it by section of this document.
   The browser compiler suite discovers refusal fixtures by directory, so obsolete
   aliasing, array-identity, and list-shaped JSON default refusal configs are
   removed here alongside accepted behavioral coverage. Each layer stays green.
3. **Deletions.** `Js::plain`, `fromJson`'s marker branch, the marker class's
   `ArrayAccess` shims, dead tests for the old error messages. `Seam::toPhp`
   and `Db`'s entry points keep accepting plain arrays permanently: REST,
   CLI, EditorSave, Sync and compiled query/filter construction pass arrays by
   design, so array acceptance at the runtime boundary is not a compatibility
   path. The `"\0"` restore path in `decodeJson` stays because `json_decode`
   still goes through `stdClass`.

---

## 9. Open questions

1. **`after*` hooks' view of the row.** `before*` hooks' mutations take
   effect (§3). `afterCreate(row)` gets its own copy and its mutations are
   discarded. Should `Db` return the hook's view of the row to the caller
   (REST response, `insert` return value)? The design says no: the response
   is the row as stored.
2. **`for…of` as an index loop.** Exact but 2.7x slower than `foreach` on
   the loop overhead alone (7 µs per 1000 elements). The alternative is
   `foreach ($a->a as $x)`, which misses pushes inside the body. Keep
   exactness unless a measured hook shows it matters?
3. **Compile-time warning for sparse writes.** §2.4 decides the hole
   question: writes past `length`, and a fixed-length walk that reaches an
   index its own callback removed, are refused at run time with
   `RangeError`, and no hole sentinel exists. Should the compiler additionally warn on `a[i] = v`
   where `i` isn't provably `< length`? It usually can't prove it, so the
   design does not; noted in case a lint is wanted later.
4. **`Unknown` member reads.** `JSON.parse(s).x` is refused today ("can't
   read `x` of a value with unknown shape"). With handles, `Js::prop($v, 'x')`
   could return `null` for scalars and the property for objects. Out of scope
   here; noted because the handle makes it cheap.
5. **`strMatch` shape.** `s.match(re)` returns a `JsArray` of groups today
   without `index`/`input`/`groups`. A `JsArray` can't carry extra named
   properties. Keep the subset, or give `JsArray` a `->p` for named
   properties (which would also admit `a.foo = 1`)? The design keeps the
   subset.
6. **Naming.** `Seam` is the proposal for the conversion owner. `Bridge` and
   `Edge` were considered; the name matters less than there being exactly one.
