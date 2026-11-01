# Zero: JS reference semantics in compiled PHP

Status: design, for review. No implementation yet. Zero is unreleased, so this
breaks the compiled-code contract without a migration.

Scope: how compiled `zero.config.ts` code represents JS objects and arrays at
run time, every place that representation meets the rest of the runtime, and
the order in which the change lands.

---

## 0. Decisions in one screen

| Area | Decision |
|---|---|
| Representation | Two final PHP classes, `Zero\JsObject` and `Zero\JsArray`, each a handle around one PHP array (`->p` for properties, `->a` for elements). Compiled code holds and passes handles. Primitives stay PHP scalars. |
| Identity | PHP object identity is JS identity. `===` between handles compiles to PHP `===`. The compile-time refusal of `===` on containers goes away. |
| Key order | Property order is computed by one function, `Js::ownKeys`, at every read of an object's keys: array-index keys ascending, then the rest in insertion order. Objects are never built by PHP array spread, `array_merge`, or `array_values`, so integer-like keys can't renumber. |
| Holes | Arrays have no holes. A write past the end fills with `null`. Elisions, `new Array(n)` and `delete` stay compile errors. |
| Boundary | Compiled code lives in "JS land" (handles). `Db`, `Schema`, `Sql`, stores, SCF codecs and WordPress calls live in "runtime land" (plain arrays). One file, `runtime/Zero/Seam.php`, owns every conversion in both directions, driven by the schema. A `json()` column's value is a handle at every layer; the runtime treats it as opaque. |
| Deleted | `src/compile/effects.rs` (sharing analysis), `check_aliasing`, `check_identity_eq`, `check_destructured_mutation`, by-reference parameters, capture anchors, `Js::write`/`at`/`obj`/`objectBinding`/`copyObject`/`plain`, the empty-object marker and its 30 `instanceof JsObject` sites. |
| Acceptance | The 65-row sharing corpus (`CORPUS.md` on branch `archive/s2-ownership-rule`: 58 compile and differ from Node, 3 agree, 4 are refused) plus `tests/differential` run under Node and compiled PHP; results must be identical. |
| Cost | Measured: object build 2.6x slower per literal, member read/write 1.5x, `map`/`filter` 1.1–1.7x, JSON encode 1.0x, JSON decode 2.4x, +56 bytes per handle. Absolute cost at hook-sized data is well under a millisecond. |

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
`slice` and `fill`. The second attempt (`src/compile/effects.rs`, 1316 lines,
plus a 1059-line `aliasing.rs` on the archived branch) also made the
compiler's output worse for correct programs: parameters became PHP
references, loop bindings grew "capture anchors", and users were told to
rewrite `reduce` as a `for` loop. The analyses were abandoned.

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
calls; every operation is either direct PHP (`$o->p['x']`, `$a->a[] = $v`,
`count($a->a)`) or a `Js::*` helper. Both are `final` so `instanceof` is
exact and the engine can inline property access.

Why not the alternatives:

- **`stdClass` for objects.** Fastest build (1.4x plain versus 2.6x for the
  handle), but it can't hold a property named `"\0…"` (the runtime already
  carries a workaround in `decodeJson`), it iterates in insertion order only,
  so JS integer-first order still needs a sort at every read, and it leaves
  arrays as PHP arrays, which is the bug we are fixing. Half the programs in
  the corpus mutate arrays.
- **`ArrayObject` / `ArrayAccess`.** Member read/write is 2.4x slower than
  the handle (19.4 versus 12.4 ms per million), and nested writes through
  `offsetGet` return copies (`$ao['meta']['a'] = 1` raises "Indirect
  modification of overloaded element"). The syntax sugar costs exactly the
  semantics we need.
- **A handle around a PHP array.** One pointer indirection over today's code,
  the array inside keeps PHP's hash ordering and copy-on-write for internal
  helpers, and the two classes make `[]` versus `{}` unambiguous for the
  first time. This is the decision.

### 2.2 Identity

A handle is a PHP object; `$a === $b` is identity. Compiled `===`/`!==`
between two values typed as containers emits PHP `===`. `Js::strictEq` keeps
its number handling and falls through to `===` for everything else, which is
now right for handles too. `includes`, `indexOf` and `lastIndexOf` use
`sameValueZero`, which calls `strictEq`, so `[o].includes(o)` is true and
`[{}].includes({})` is false, as in JS.

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
object spread, object rest, `structuredClone` and `Seam::toPhp` all walk
`ownKeys($o->p)`. Keys come back as strings (`(string) $k`).

Decision: an object is only ever built by three primitives, each of which
writes keys one at a time:

```php
new JsObject(['k' => $v, …])          // literal with static keys only
Js::obj(array|JsObject ...$parts)     // literal with spread: parts in source order
$o->p[Js::key($k)] = $v               // computed key, or any compiled write
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

### 2.4 Arrays, `length`, holes

`JsArray::$a` is always a PHP list (`array_is_list` holds). `length` compiles
to `count($a->a)`. Reads use `$a->a[(int) $i] ?? null`, which gives `null`
for negative, fractional, or out-of-range indices; `at` goes through
`Js::arrAt` as today.

Decision: writes by index go through `Js::setAt(JsArray $a, int|float $i, mixed $v): mixed`:
an in-range index overwrites; `$i === count` appends; a larger index fills the
gap with `null` and appends. Zero already maps `undefined` to `null`, so a
filled gap reads back exactly as a JS hole does (`a[5]` is `undefined`,
`a.length` is 6, `JSON.stringify` writes `null`). What a hole would do
differently (skip in `forEach`, `in`, `Object.keys`) is not reachable:
elisions in array literals, `new Array(n)`, `delete a[i]` and `a.length = n`
remain compile errors with the existing messages. `Array.from({ length })`
and `fill` produce dense arrays as before.

A non-integer index on an array (`a["x"] = 1`) is a type error in Zero
already (arrays are indexed by `number`); it stays one.

### 2.5 Prototype-less plain objects

Handles have no prototype chain. `o.constructor`, `o.toString`,
`o.hasOwnProperty` and `o.__proto__` are not fields of any Zero object type,
so reading them is a compile error on a typed object and reads `null` on a
`Record` or `unknown` value, where JS would return a function. This is an
accepted difference: no program in the corpus or the examples touches a
prototype member, and `Object.hasOwn` is the supported spelling.

`typeof` returns `"object"` for both handles, `"function"` for closures.
`Js::truthy` is true for every handle, including empty ones. `Js::str` gives
`[object Object]` for a `JsObject` and the comma-joined elements for a
`JsArray` (the existing list branch, over `->a`). `Js::toNumber` of a
`JsArray` follows the existing array rules over `->a`; of a `JsObject` it is
`NAN`.

### 2.6 Primitives stay unboxed

Only values whose static type is `Obj`, `Map`, `Array`, `Tuple`,
`ArrayLiteral` or `Unknown` can be handles. Numbers, strings, booleans,
`null`/`undefined`, `Date` (epoch ms), `RegExp` (`Zero\RegExp`) and closures
are what they are today. The compiler already tracks these types to pick
between native PHP and `Js::*`; nothing boxes a scalar, and `Unknown` values
are handles or scalars at run time, which `Js::*` helpers already dispatch on
with `instanceof` / `is_*`.

---

## 3. Boundaries: where a handle meets a PHP array

Rule: compiled code and `Js::*` speak handles. `Db`, `Schema`, `Sql`, the
stores, `Scf`, `WpPostStore`, `WpUserStore`, Sync, Abilities, `EditorSave`
and every WordPress function speak plain arrays. The two meet in one new
file, `runtime/Zero/Seam.php`, which holds every conversion. Compiled output
never contains a conversion call; `Db.php` never contains an `instanceof
JsObject`.

```php
final class Seam
{
    /** JS value → runtime value. $shape is a column spec, an input spec, or null. */
    public static function toPhp(mixed $v, ?array $shape = null): mixed;
    /** Runtime value → JS value. $shape decides `[]`: list or object. */
    public static function toJs(mixed $v, ?array $shape = null): mixed;
    /** A row by its collection's columns, both directions. */
    public static function rowToJs(array $columns, array $row): JsObject;
    public static function rowToPhp(array $columns, JsObject $row): array;
    /** Hook/rule/action contexts. */
    public static function ctx(array $ctx): JsObject;
}
```

`toPhp` walks the value: `JsObject` → assoc array, `JsArray` → list,
scalars as is, except where `$shape` says the value is a `json()` column, in
which case the handle passes through untouched. That is exactly what
`Schema::plainOutsideJson` does today, with the `JsObject`-marker branches
removed; the function moves and keeps its tests.

`toJs` is the direction that doesn't exist today. The one ambiguity is a plain
`[]`: list or empty object? Decision: the schema decides, never a guess.
`group` and a `blocks` item are objects; `repeater`, `blocks`, `mediaList`,
`select` are lists; a `json()` value is already a handle; scalars aren't
containers. Where no schema exists the value was never a PHP array in the
first place (it came from `decodeJson`, which returns handles). A `[]`
reaching `toJs` with no shape is a bug and throws `LogicException` in tests.

The table lists every crossing, its direction, and who owns it.

| Crossing | Direction | Owner, and what happens |
|---|---|---|
| Request body, query `where`/`with`/`orderBy` JSON | wire → JS | `App::parseBody`/`queryJson` call `Js::decodeJson`, which returns handles. `App::object()` and `Access`/`Schema::validateInput` then call `Seam::toPhp($v, $inputShape)`, so the pipeline sees arrays with `json()` values still handles. Replaces today's marker checks in `App.php` lines 386, 441, 646. |
| `db.query.X.findMany(opts)` / `findFirst` | JS → runtime → JS | Compiled code calls `\Zero\db()->findMany(...)` as today. `Db::findMany` takes `array\|JsObject $opts` and starts with `Seam::toPhp` (replacing `plainOptions`/`plainFilter`/`plainWith`), and returns `Seam::rowToJs` per row **only when called from compiled code**. Decision: the compiler emits `\Zero\Seam::findMany(...)`, a thin static facade that converts in, calls `Db`, converts out. `Db` itself keeps returning arrays for its runtime callers (REST, EditorSave, Sync). Same for `findFirst`, `insert`, `update`, `delete`, `globals.get/update`. |
| `db.insert(values)` / `update(set, where)` | JS → runtime | `Seam::insert` runs `Seam::toPhp($values, $columns)`; `json()` columns stay handles and reach `Schema::encode`, which calls `Js::jsonStringify`. `{}` written to a `json()` column stores `{}`; `{}` written to a `group` becomes `[]` and is filled from the field list. |
| Stored `json()` text → row value | storage → JS | `Schema::decode` for `'json'` calls `Js::decodeJson` and returns the handle. This is the one runtime-land value that is a handle, by rule. Everything that touches a row in the runtime treats a `json()` value as opaque (it already does: `Sql` `has`/`eq` filters call `Js::jsonStringify($arg)`, which accepts handles). |
| `SCF`/postmeta codecs | storage ↔ runtime | `Scf::scfValue` and `Scf::fromScf` convert runtime arrays to SCF's shapes for `group`/`repeater`/`blocks`/`mediaList`; those stay arrays. The `'json'` field type calls `Js::jsonStringify(handle)` and `Js::decodeJson(text)`, unchanged. `WpPostStore`/`WpUserStore` `select`/`mediaList` lists stay `json_decode(..., true)`: they're runtime arrays. No handle ever reaches `update_post_meta`, `wp_insert_post`, `get_field` or any other WordPress function. |
| Hook `ctx`, `data`/`row`, `previous`; access rule `ctx`; `.validate(value, ctx)`; default `fn` | runtime → JS → runtime | `Db::hook`, `Db::create`/`update` (the `before*` hooks), `Access::allows`, `Schema::checkRules` and `Schema::defaultValue` build their arguments with `Seam::rowToJs($columns, $row)` and `Seam::ctx($ctx)` right before calling the `\ZeroApp\…` function. `beforeCreate(data)`/`beforeUpdate(patch, existing)` are documented as "mutate `data` or return a replacement"; today only the return works because PHP passed a copy. With a handle both work: `Db` converts the returned handle if there is one, otherwise the same `data` handle it passed in, with `Seam::rowToPhp($columns, $handle)`. `after*` hooks' return values and mutations of `row` stay ignored (the write is done). An access rule's `true/false/filter` goes through `Seam::toPhp`; a validator's `true/string/null` and a default's value are scalars or `Seam::toPhp($v, $column)`. |
| Action handler `(input, ctx)` and its return | runtime → JS → wire | `App::action` passes `Seam::toJs($input, $inputSpec)` and `Seam::ctx`. The return value is a handle graph; `Response::json` calls `Js::jsonStringify`, which encodes handles directly. No conversion back. |
| REST responses, generated TS client | runtime → wire | `Js::jsonStringify` is the only encoder for `{data}` bodies (standalone `Response`, `Wp\Rest`). Plain arrays still encode as today (list → `[]`, assoc → `{}`, empty → `[]`); handles encode by class. The wire format and the generated client are unchanged, with one fix: a `json()` value of `{}` round-trips as `{}` in every path, and a numeric-string-keyed object stays an object. |
| `JSON.stringify` / `JSON.parse` in compiled code | JS ↔ text | `Js::jsonStringify(handle)` walks `ownKeys` for objects, `->a` for arrays. `Js::jsonParse` → `Js::decodeJson` → handles, with `jsNumbers` applied as today. `decodeJson` builds `JsObject`/`JsArray` directly from `json_decode(..., false)`'s `stdClass`/arrays (the `"\0"` key workaround stays, since `json_decode` still goes through `stdClass`). Runtime callers that want arrays (`Jobs\Module`, `Scf::json` for non-json fields, `Abilities\Register`, `Sync\Wire`) call `Seam::toPhp(Js::decodeJson(...))`. |
| Job payloads | JS → text → JS | `jobs.x.enqueue(input)` compiles to `Jobs::enqueue($name, $input)`, which calls `Js::jsonStringify` (already does). `Jobs\Runner` decodes with `Js::decodeJson` → handles, validates with `Schema::validateInput` (which calls `Seam::toPhp` for the check and keeps the handle for the handler), and passes `Seam::toJs($input, $jobInputSpec)` and `Seam::ctx`. Action Scheduler only ever carries `['id' => $id]`; the payload lives in Zero's table. |
| `once()` / `Idempotency-Key` receipts | JS → bytes → JS | `Receipts` stores `serialize($result)` and replays with `unserialize`. The result is a handle graph; `allowed_classes` becomes `[JsObject::class, JsArray::class, RegExp::class]` and `stdClass` is dropped. |
| Captured module-level data | compile time → JS | `php_js_value` emits `new \Zero\JsObject([...])` / `new \Zero\JsArray([...])`. Decision: each captured container compiles to one memoized helper (`static $v ??= …`) so a module-level `const RANK = […]` is one object per request, and `shared.visits++` through a helper is visible to the next read, as the `reject-aliasing` fixture expects once it becomes a positive case. |
| `schema.php` | compile time → runtime | Unchanged: plain arrays via `php_json`. It is runtime-land data. `json()` column *defaults* are stored as JSON text (`'json' => '{}'`) and decoded with `Js::decodeJson` on use (already the case, `Schema.php` line 255). |
| Abilities / MCP | wire → runtime → JS | `Abilities\Invoke::object` takes decoded input; replace its marker check with `Seam::toPhp`. Everything downstream is the REST path. |
| Sync | wire → runtime | `Sync\Wire` handles `fields: {}` with a marker check today; becomes `Seam::toPhp` with the collection's columns. Sync never calls compiled code. |

What this removes: `Js::plain`, `Schema::plainOutsideJson` (moves into
`Seam::toPhp`), `Db::plainOutsideJson`, `Db::plainFilter`'s marker branches,
`Db::plainWith`, and every `$x instanceof JsObject ? [] : $x` in `App`,
`Db`, `Schema`, `Jobs\Runner`, `Abilities\Invoke`, `Sync\Wire`,
`Store\SqliteMedia`. Thirty sites, one owner.

---

## 4. Runtime and compiler changes

### 4.1 `Js::*`

Changes, by group:

- **Deleted:** `at`, `write`, `obj` (the marker constructor), `objectBinding`,
  `copyObject`, `plain`, `fromJson`'s marker branch. The `JsObject` marker
  class is replaced by the handle class of the same name (it keeps the name
  because the name is right; nothing else about it survives).
- **New:** `obj(...$parts): JsObject` (literal with spread), `key(mixed): string`,
  `setAt(JsArray, int|float, mixed): mixed`, `push(JsArray, mixed ...): int`,
  `clone(mixed): mixed` (`structuredClone`: deep copy of handles, scalars as
  is, throws `JsError('DataCloneError')` on closures), `arr(iterable): JsArray`
  (list from any PHP iterable, for runtime helpers).
- **Signature change, same behavior:** every array helper takes and returns
  `JsArray` instead of `array`: `find*`, `some`, `every`, `filter`, `map`,
  `includes`, `join`, `arrSlice`, `arrAt`, `splice`, `reverse`, `sort`,
  `sorted`, `reduce`, `flat`, `flatMap`, `fill`, `range`, `indexOf`,
  `lastIndexOf` (the string overloads stay). The by-reference `&$a` on
  `splice`/`reverse`/`sort`/`fill` goes away: the handle is the reference.
  Callbacks receive `($value, $index, $array)` with `$array` the same handle.
- **Objects:** `keys`, `values`, `entries`, `fromEntries`, `omit`, `hasOwn`
  take `JsObject`; `ownKeys` walks `->p`.
- **JSON:** `jsonStringify` encodes `JsObject` by `ownKeys`, `JsArray` by
  `->a`, plain arrays as today (runtime callers). `decodeJson` returns
  handles. `jsonParse` unchanged on top of it.
- **Conversions:** `str`, `truthy`, `typeOf`, `toNumber`, `strictEq`,
  `sameValueZero` gain `instanceof` branches as §2.5 describes.
- **Unchanged:** every number, string, date, regexp, and logging helper.

### 4.2 Compiler

Each path, before → after:

- **Object literal.** `['k' => v]` or `(new JsObject())` or `Js::obj([...copyObject])`
  → `new \Zero\JsObject(['k' => v])` when every key is static and there is no
  spread; otherwise `\Zero\Js::obj(['k' => v], $spread, [\Zero\Js::key($kx) => v2])`
  with parts in source order, so evaluation order and later-wins are JS's.
- **Array literal.** `[a, b, ...$s]` → `new \Zero\JsArray([a, b, ...$s->a])`.
  List spread of a PHP list is safe (it renumbers, which is what a list is).
- **Member read.** `$o['k']` / `($o['k'] ?? null)` → `$o->p['k']` /
  `($o->p['k'] ?? null)`. Optional chains keep the temp-and-null pattern.
  `length` → `count($a->a)`. Tuple index `$t[0]` → `$t->a[0]`.
- **Member write.** `Js::write($root, [$k1, $k2], $v)` → `$root->p[$k1]->p[$k2] = $v`.
  PHP evaluates the target chain, then the keys, then the value, which is
  JS's order (verified: `f()->p[k()] = v()` prints `obj key val`), so the
  temporaries `assign()` creates for plain `=` go away. Compound and logical
  assignment (`+=`, `??=`) keep one temp per computed key so each key is
  evaluated once. Array index writes → `\Zero\Js::setAt($a, $i, $v)`.
- **Destructuring.** `$src['k']` → `$src->p['k']`; object rest →
  `\Zero\Js::omit($src, [...])` (returns a handle); array rest →
  `new \Zero\JsArray(array_slice($src->a, n))`. `check_destructured_mutation`
  is deleted: mutating through a destructured binding is just a write through
  a handle.
- **Parameters and captures.** `&$x`, `objectBinding`, capture anchors, the
  `initialize_parameter` by-ref branch and the "captured mutating parameter
  needs an object with required fields" error are deleted. A parameter is a
  PHP variable holding a handle. A closure `use ($x)` captures the handle.
  `for (const e of list)` binds the handle; `for (let …)` closures per
  iteration keep today's fresh-binding emission for scalars.
- **Array methods.** The `place()` requirement ("call it on a variable") for
  `push`/`pop`/`shift`/`unshift`/`splice`/`sort`/`reverse`/`fill` is deleted;
  the receiver is any expression. `array_push($place, …)` → `\Zero\Js::push($a, …)`;
  `array_pop($place)` → `array_pop($a->a)`; `array_merge(...)` for `concat`
  → `new \Zero\JsArray([...$a->a, ...$b->a])`; `array_values` for
  `Array.from(arr)` → `new \Zero\JsArray($a->a)`; `Array.isArray` →
  `instanceof \Zero\JsArray`. `forEach` (`array_map` with keys today) →
  `\Zero\Js::forEach`.
- **`for…of`.** `foreach ($src as $x)` → an index loop,
  `for ($i = 0; $i < count($a->a); $i++) { $x = $a->a[$i]; … }`, so a push
  inside the body is visited, as in JS (PHP `foreach` iterates a snapshot).
  Cost: 1.0 versus 0.37 ms per 100k elements (§6). Strings keep
  `mb_str_split`.
- **`===`.** `check_identity_eq` is deleted; `strict_eq` emits `===` for two
  container operands.
- **`structuredClone(v)`** becomes supported: `\Zero\Js::clone($v)`, typed as
  its argument. It is the replacement for the implicit copy users could
  previously rely on by accident.
- **`JSON.parse` / `JSON.stringify`.** Same emission; the helpers changed.
- **`typeof`, truthiness, template strings.** Same emission; the helpers
  changed.
- **Captured data.** `php_js_value` emits handle constructors inside a
  memoized helper (§3).
- **Deleted modules and checks.** `src/compile/effects.rs`, `check_aliasing`,
  `check_identity_eq`, `check_destructured_mutation`, `writes_into_object`,
  `object_binding`, the `by_ref` plumbing in `closure_body`, `declare_parameter`,
  `ForOf`, and the `shared_parameter` reassignment error in `place_inner`.
  The `reject-aliasing` fixture becomes a differential case that must pass.
- **Unchanged.** Types (`src/types.rs`), narrowing, numbers, strings, the db
  query/filter compilation (it produces runtime-land arrays for `Seam` to
  consume, which is where the filter's shape is checked anyway).

### 4.3 `docs/runtime-contract.md`

The "class Js" section's value model line becomes: arrays are `Zero\JsArray`,
plain objects are `Zero\JsObject`, both handles with identity. The `JsObject`
marker paragraph is replaced by a `Seam` paragraph listing the crossings in §3.

`docs/config-api.md`, "The subset": the five aliasing refusals in the
Rejected list (mutating an object after storing it, reassigning a mutating
parameter, mutating through a destructured parameter, replacing an argument
mid-expression, the tuple-widening paragraph) are deleted. `structuredClone`
joins Supported. The hooks table's "mutate `data` or return a replacement"
becomes true as written.

---

## 5. Equality and serialization semantics

| Operation | Compiled PHP | Matches JS because |
|---|---|---|
| `a === b`, containers | `$a === $b` | PHP object identity. |
| `a === b`, mixed/unknown | `Js::strictEq` | Numbers by value (`1 === 1.0`), everything else `===`. |
| `a == b` | compile error (unchanged) | Loose equality isn't supported in Zero code. |
| `switch` | strict comparisons (unchanged) | |
| `includes`/`indexOf` | `sameValueZero` | NaN equals NaN, handles by identity. |
| `JSON.stringify(o)` | `ownKeys` order, `{}` for empty object, `[]` for empty array, closures dropped from objects and `null` in arrays, non-finite numbers `null`, `-0` as `0` | ECMA-262 `SerializeJSONObject` over `OrdinaryOwnPropertyKeys`. |
| `Object.keys/values/entries` | `ownKeys` | Same order rule. |
| `for (k of Object.keys(o))` | same | `for…in` stays a compile error with the `Object.keys` hint. |
| `for (x of arr)` | index loop | Live length. |
| `Object.hasOwn(o, k)` | `array_key_exists(Js::key($k), $o->p)` | |
| `a.length` | `count($a->a)` | Dense arrays. |
| `String(o)` / template | `[object Object]`, `a,b,c` | |
| `!!o` | `true` | Every object is truthy. |

`Js::sameJson` (structural equality used by `EditorSave` on runtime arrays)
is a runtime-land helper and keeps working on arrays; it gains no handle
support because nothing in runtime land holds handles except `json()` values,
which it compares via `jsonStringify`.

---

## 6. Performance

Spike: a 250-line PHP script with the two handle classes above, run on this
box under PHP 8.3.6 and PHP 8.5.10 (`-d memory_limit=-1`; the 100k-row
builds exceed 128 MB in every representation). Each case is the median of
3–5 warm iterations. Compare ratios, not absolutes.

| Case (per iteration) | plain array | handle | stdClass | ArrayObject | handle / plain |
|---|---|---|---|---|---|
| Build 100k rows `{ id, name, tags: [3], meta: { a, b } }` (3 containers per row) | 12.6 ms | 33.1 ms (constructor) / 55.7 ms (`Js::obj` variadic) | 17.8 ms | 35.1 ms | 2.6x / 4.4x |
| 1M member read + write `o.x = o.y + i` | 8.2 ms | 12.4 ms | 7.0 ms | 19.4 ms | 1.5x |
| 1M nested write `o.meta.a = i` | 10.4 ms | 14.6 ms | | | 1.4x |
| `map` then `filter` over 100k ints | 4.1 ms | 4.6 ms | | | 1.1x |
| `map` 100k rows → `name` | 4.6 ms | 6.6 ms | | | 1.4x |
| JSON encode 100k rows, runtime encoder (`Js::encode` shape) | 89.4 ms | 96.1 ms | | | 1.07x |
| JSON encode 100k rows, native `json_encode` for reference | 18.1 ms | n/a | | | |
| JSON decode 100k rows (`json_decode` assoc vs `json_decode` + handle walk) | 71.3 ms | 166.9 ms | | | 2.3x |
| `for…of` 100k ints: `foreach` vs index loop over `->a` | 0.37 ms | 1.01 ms | | | 2.7x |
| Memory, 100k rows resident | 77.5 MB | 93.5 MB | 85.2 MB | | +168 B/row = 56 B per handle |

PHP 8.5 numbers are within 10% of 8.3 on every row (build 31.7 ms, rw 11.5 ms,
map rows 6.1 ms, decode 180.7 ms, memory identical), so the design doesn't
depend on the PHP version; CI runs 8.3 and 8.2 and both are in the supported
range.

Reading the numbers:

- The per-operation overhead is one object allocation per container (56
  bytes, ~200 ns) and one property indirection per access (~4 ns). A hook
  that builds a 50-row response with nested objects pays about 40 µs extra
  for the build and under 1 µs extra per access.
- `Js::obj` (the variadic literal with spread) is 1.7x slower than the plain
  constructor, so the compiler uses the constructor whenever a literal has
  no spread and static keys, which is nearly every literal.
- JSON decode is the widest gap because today's decode is a single C call and
  the handle version walks the tree once in PHP. Request bodies and `json()`
  columns are the only decode sites on the hot path; a 10 KB body decodes in
  about 60 µs either way.
- The runtime's own JSON encoder is already 5x slower than `json_encode`
  because it implements JS number formatting and key order; the handle adds
  7% on top. Not a regression worth designing around.
- The index loop for `for…of` costs 7 µs per 1000 elements. Chosen for
  exactness; open question 3 asks whether to keep it.
- Memory: a 1000-row response with three containers per row holds about
  170 KB more. WordPress requests run with 256 MB by default.

Not measured: real-WordPress request latency. A hook on this stack is
dominated by MySQL and WordPress bootstrap (tens of milliseconds); the deltas
above are two orders of magnitude below that. The WP harness run in the
implementation PR records before/after wall time for `tests/wp/run.sh` as a
sanity check, not as a gate.

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
   `compiled_php_matches_node_on_every_differential_case`, which already
   compares the two outputs. The six program shapes in §1 each get a case if
   the corpus lacks one. Done means every row returns what Node returns,
   including rows 22 and 34, where Node itself returns `false`.
2. **Key-order case** (§2.3): literal, spread, `reduce`, `fromEntries`,
   `JSON.parse`, through `Object.keys` and `JSON.stringify`.
3. **`tests/php/js_parity.php`** gains cases for each `Js::*` helper whose
   signature changed, using the existing "JS expression versus PHP call"
   table: `obj` with overlapping parts, `setAt` past the end, `clone`,
   `push` on a handle, `includes` identity, `jsonStringify` of nested
   handles with integer-like keys, `decodeJson` returning handles.
4. **`tests/compiler.rs`:** the `reject-aliasing` fixture and the tests that
   expect the by-ref/identity/destructured-mutation errors are deleted along
   with the errors. `structuredClone` gets a differential case, not a
   compiler test.
5. **Boundary tests** (`tests/php/db_test.php`, `schema_test.php`): a
   `json()` column round-trips `{}`, `[]`, `{"1":1,"0":2}` and `{"\u0000":1}`
   through insert → read → REST body; a `group` written as `{}` from an
   action reads back filled; a hook receives a handle and `Object.keys(row)`
   matches the column list; an action input with a nested `json()` field
   arrives as a handle and a `group` field as a handle built from an array.
6. **Real WordPress:** `tests/wp/run.sh` already covers REST, SCF, jobs and
   abilities end to end; one case per crossing in §3 that involves WordPress
   (SCF `json` field round trip of `{}` and a numeric-keyed object, a job
   whose input has a `json()` field, an ability invoked with `{}`).
7. **Redundancy:** cases on the archived branch that only existed to prove a
   *refusal* are not ported; their programs are now expected to pass, and a
   passing program already covers the behavior.

---

## 8. Rollout

Three PRs, in order, each green on every suite in `LANE-BRIEF.md`.

1. **Runtime handles.** Replace the `JsObject` marker with the handle classes;
   add `JsArray`; make every `Js::*` helper handle-aware (accepting plain
   arrays too, so the existing compiler output keeps passing); add `Seam`
   with `toPhp`/`toJs`/`rowToJs`/`ctx` and the facade methods; move
   `plainOutsideJson` into it. `js_parity` and `db_test` cover it. Nothing
   compiled changes yet; the marker's 30 call sites are left calling into
   `Seam::toPhp`, which handles both representations during this PR.
2. **Compiler emits handles.** All of §4.2, the deletions included; the
   corpus and the key-order case land in `cases.ts`; `tests/wp/run.sh`
   proves the WordPress crossings. The `reject-aliasing` fixture becomes a
   differential case. `docs/runtime-contract.md` and `docs/config-api.md`
   (the aliasing section) are updated in the same PR because the contract
   changes here.
3. **Runtime cleanup.** Delete the dual-representation acceptance from `Js::*`
   and `Seam::toPhp`, every remaining `instanceof JsObject ? [] : …`,
   `Js::plain`, `Receipts`' `stdClass`, and the `"\0"` restore path if the
   handle decoder makes it unnecessary (it doesn't yet: `json_decode` still
   produces `stdClass`, so it stays). Pure deletion plus the tests that
   guarded the old shapes.

PR 2 is the one that changes behavior for every user program; PRs 1 and 3 are
mechanical. If review wants fewer PRs, 1 and 2 can merge as one.

---

## 9. Open questions

1. **`after*` hooks mutating `row`.** `before*` hooks' mutations now take effect (§3). `afterCreate(row)` mutating `row` still changes nothing, since the write is done, and the mutated handle is dropped. Should `Db` return the hook's view of the row to the caller (REST response, `insert` return value)? The design says no: the response is the row as stored.
2. **Module-level state across requests.** With memoized captured data, a
   module-level object is one object per PHP request, as it is one per Node
   process. A Node process is long-lived and a PHP request is not, so a
   counter in module scope resets per request in PHP. The differential
   runner can't observe this. Document as a difference, or refuse module-level
   `let`/mutation of captured containers? Today module-level `let` reads are
   already refused ("hooks can't read `n`: it's a module-level `let`").
3. **`for…of` as an index loop.** Exact but 2.7x slower than `foreach` on
   the loop overhead alone (7 µs per 1000 elements). The alternative is
   `foreach ($a->a as $x)`, which misses pushes inside the body. Keep
   exactness unless a measured hook shows it matters?
4. **`Unknown` member reads.** `JSON.parse(s).x` is refused today ("can't read
   `x` of a value with unknown shape"). With handles, `Js::get($v, 'x')` could
   return `null` for scalars and the property for objects, as JS does for
   `undefined.x`'s non-throwing cousins. Out of scope here; noted because the
   handle makes it cheap.
5. **Naming.** `Seam` is the proposal for the conversion owner. `Bridge` and
   `Edge` were considered; the name matters less than there being exactly one.
