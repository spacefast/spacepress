# Zero PHP runtime contract

The Rust compiler (`zero build`) emits a PHP app. Everything that runs at
request time is PHP: a hand-written runtime library (`runtime/Zero/*.php`,
copied verbatim into every build) plus generated files. This document is the
seam between them. The compiler only emits calls listed here.

Requirements: PHP 8.2+, extensions `pdo_sqlite`, `mbstring`, `json` and `gd`
(`sodium` for phase-two identity features). Composer runs only at maintainer
time; prefixed third-party libraries ship under `vendor-prefixed/` on both
targets. See `dependencies.md` for their locks and regeneration. Every Zero file starts with
`declare(strict_types=1);`. Namespace `Zero`.

## Build output layout

```
<out>/                      (default: <project>/.zero/app)
  public/index.php          generated front controller (also the php -S router)
  public/...                copied from <project>/public if present
  zero/runtime/*.php        this library, copied verbatim
  zero/runtime/vendor-prefixed/**  bundled, isolated PHP dependencies
  zero/app/schema.php       generated: `return [...]` schema metadata
  zero/app/functions.php    generated: compiled hooks, actions, helpers (namespace ZeroApp)
  zero/app/migrations/NNNN_<name>.sql
  zero/bin/zero.php         CLI entry (copied from runtime/bin/zero.php)
  data/                     runtime state (SQLite file), created on demand
  data/secret               persistent signing key, created on first standalone boot
  private/                  private-file storage, outside the public root
```

`public/index.php` is exactly:

```php
<?php
declare(strict_types=1);
if (PHP_SAPI === 'cli-server' && is_file(__DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH)) && !str_ends_with(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '.php')) {
    return false;
}
require __DIR__ . '/../zero/runtime/bootstrap.php';
\Zero\App::boot(dirname(__DIR__))->handleHttp();
```

`zero/runtime/bootstrap.php` eagerly loads `Db.php` (for the `Zero\db()`
function), sets `ini_set('precision', '-1')`,
`ini_set('serialize_precision', '-1')`, registers an autoloader for
`Zero\*` from its own directory, and registers the ordered feature modules
through `Features::register()` (once per process).

Standalone boot initializes `data/secret` to 32 random bytes encoded as 64 hex
characters with mode `0600`, under an exclusive file lock. `Secret::load($root)`
returns the same key on later boots; `ZERO_SECRET` overrides it without rewriting
the persisted key. Preserve this file across deployments with the SQLite data.

WordPress builds use `.zero/wp-content` instead. Its `plugins/` contains
`zero-runtime` (this library under `zero/`), the optional `zero-identity` bundle,
and `zero-app-<name>` (schema, functions, MySQL migrations and public assets).
Generated plugin ZIPs sit alongside those directories. `zero-manifest.json` at
the content root records versions, runtime series, platform requirements and
resolved dependency checksums. The app's schema is the authoritative runtime
series check; the runtime refuses a mismatched series or a second app.

`GET /_schema` on WordPress includes `runtime.wp` with WordPress/PHP/database
versions, `scf`, `actionScheduler`, `mcpAdapter`, `polylang`, `identity`,
`imageCdn`, and `incompatibleTables`. `runtime.pendingMigrations` and
`runtime.languages` report app migration and localization state. Identity is
true only for a compatible implementation; the A3 placeholder does not enable it.
`zero doctor --wp [--site URL --token T]` checks this data against the same
platform policy used by runtime activation.

## schema.php

```php
return [
  'collections' => [
    'items' => [
      'primaryKey' => 'id',
      'columns' => [
        // type: 'integer' | 'real' | 'text' | 'boolean' | 'timestamp' | 'date' | 'json'
        'id'        => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
        'name'      => ['type' => 'text', 'notNull' => true],
        'unit'      => ['type' => 'text', 'notNull' => true, 'enum' => ['pcs', 'g'], 'default' => ['value' => 'pcs']],
        'quantity'  => ['type' => 'integer', 'notNull' => true, 'default' => ['value' => 1]],
        'slug'      => ['type' => 'text', 'unique' => true, 'default' => ['fn' => 'items__default__slug']],
        'createdAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => ['now' => true]],
        'updatedAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => ['now' => true], 'onUpdate' => ['now' => true]],
        'touchedBy' => ['type' => 'text', 'onUpdate' => ['fn' => 'items__onUpdate__touchedBy']],
        'locationId'=> ['type' => 'integer', 'references' => ['collection' => 'locations', 'column' => 'id', 'onDelete' => 'set null']],
        'meta'      => ['type' => 'json'],
      ],
      'relations' => [
        // kind 'one': this row's `from` column points at target's `to` column.
        'location' => ['kind' => 'one', 'collection' => 'locations', 'from' => 'locationId', 'to' => 'id', 'optional' => true],
        // kind 'many': target rows whose `to` column equals this row's `from` column.
        // (for locations.items: from => 'id', to => 'locationId')
      ],
      // Names of functions in functions.php (namespace ZeroApp). Absent = no hook.
      'hooks' => ['beforeCreate' => 'items__beforeCreate', 'afterUpdate' => 'items__afterUpdate'],
      'api' => ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true],
    ],
  ],
  'actions' => [
    'consume' => [
      'input' => [ /* same column-definition shape as above, minus primaryKey/references/unique */ ],
      'handler' => 'action__consume',
    ],
  ],
];
```

Column keys are also the SQL column names (always double-quoted in SQL).

## functions.php

Generated. `namespace ZeroApp;`. Contains plain PHP functions. The runtime
calls them by the names in schema.php (prefix `\ZeroApp\`):

| Hook | Call | Return handling |
|---|---|---|
| beforeCreate | `$r = $fn($data)` | if `is_array($r)`, `$data = $r` |
| afterCreate | `$fn($row)` | ignored |
| beforeUpdate | `$r = $fn($patch, $existing)` | if `is_array($r)`, `$patch = $r` |
| afterUpdate | `$fn($row, $previous)` | ignored |
| beforeDelete | `$fn($row)` | ignored |
| afterDelete | `$fn($row)` | ignored |
| default fn / onUpdate fn | `$v = $fn()` | the value |
| action handler | `$out = $fn($input)` | returned as `data` |

The runtime always passes variables (never literals), because a compiled
function may declare a by-reference parameter (`array &$data`) when the
source mutates it.

Captured mutating object parameters have a separate local binding whose fields
share storage with the supplied object. Replacing the caller's variable does
not retarget the capture; field mutations remain visible. This requires a fixed
object shape with required fields. Capturing a mutating array, open record, or
object with optional fields is rejected with a located diagnostic; capture the
needed scalar values instead. Mutating `for…of` bindings use the same fixed
object representation; array/record/optional-field and destructured mutations
must use the source index instead. Object spread/rest copy field values, and
loop-local declarations receive a fresh binding on each execution.

## Write pipeline (`Db::insert/update/delete`, REST and CLI all go through it)

Create, per row:
1. Let registered input normalizers consume virtual inputs, then reject unknown keys
   (`invalid_input`, pointer `/<key>`). The original supplied input remains available to write hooks.
2. Apply defaults for absent keys: `value`, `now` (current UTC timestamp, or
   today's date for `date`), `fn`.
   2b. A required column (notNull, no default, not autoIncrement) that is
   absent and not listed in the collection's `beforeCreateFills` →
   `invalid_input` pointer `/<col>`. Hooks never see a missing required field.
3. `beforeCreate`.
4. Validate + coerce every column (below). Missing required (notNull, no
   default, not autoIncrement) → `invalid_input` pointer `/<col>`.
5. INSERT. UNIQUE violation → 409 `unique_violation` with pointer `/<col>`
   when the column can be determined. FK violation → 409 `reference_violation`.
6. Re-read the row by primary key → `afterCreate($row)`.

Update, per matching row (rows are selected first, then updated by PK):
1. Normalize virtual input, then reject unknown keys and changing the primary key.
2. For columns with `onUpdate` that are absent from the patch, set them.
3. `beforeUpdate($patch, $existing)`.
4. Validate + coerce patched columns.
5. UPDATE by PK; re-read → `afterUpdate($row, $previous)`.

Delete, per matching row: `beforeDelete($row)`, DELETE by PK, `afterDelete($row)`.

Writes made by hooks or actions through `Db` run the same pipeline
(including hooks). Nesting deeper than 8 levels → `HttpError(500, 'hook_recursion', ...)`.

Every HTTP request and every CLI command runs in one transaction
(`BEGIN IMMEDIATE`). Any exception rolls back everything.

## Validation and coercion (input → stored)

| type | accepts | stored as (SQLite) |
|---|---|---|
| integer | int, or float with no fractional part | INTEGER |
| real | int or float (not NaN/Inf) | REAL |
| text | string | TEXT |
| boolean | bool | INTEGER 0/1 |
| timestamp | int ms, or ISO 8601 `YYYY-MM-DD` (UTC midnight) / `YYYY-MM-DDTHH:mm[:ss[.fff]]` + `Z` or `±HH:MM`, every component a real calendar/clock value (no `now`, `10/30/2026`, zone-less date-times or `02-30`) | TEXT `Y-m-d\TH:i:s.v\Z` (UTC) |
| date | string `YYYY-MM-DD` that is a real calendar date | TEXT |
| json | any JSON value | TEXT (json_encode, unescaped slashes/unicode) |

`enum` → value must be one of the listed strings. `null` is accepted only
when not `notNull`. Wrong type → `invalid_input` with pointer `/<col>` and
a detail naming the expected type.

Reading rows back (decode): integer → int, real → float, boolean → bool,
json → decoded (assoc arrays), others → string, NULL → null. Every row
returned anywhere (REST, Db, hooks) has every column key present.

## class Db

```php
final class Db {
  public static function instance(): Db;            // set up by App::boot
  public function findMany(string $collection, array $opts = []): array;   // list<row>
  public function findFirst(string $collection, array $opts = []): ?array; // findMany with limit 1
  public function insert(string $collection, array $values, bool $returning = false): ?array;
  public function update(string $collection, array $set, array $where, bool $returning = false): ?array;
  public function delete(string $collection, array $where, bool $returning = false): ?array;
}
function db(): Db;   // namespace Zero, in Db.php, returns Db::instance()
```

`insert` `$values`: one row (assoc array) or a list of rows. With
`$returning`, insert/update/delete return a list of the affected rows
(post-write rows for insert/update, pre-delete rows for delete); otherwise
`null`.

`$opts` (Drizzle relational-query v1 shape):

- `where`: filter (below).
- `orderBy`: `['name' => 'asc', 'createdAt' => 'desc']`.
- `limit`, `offset`: ints.
- `columns`: `['id' => true, 'name' => true]` → only those keys.
- `with`: `['location' => true, 'items' => ['where' => ..., 'orderBy' => ..., 'limit' => ..., 'with' => ...]]`.
  `one` relations attach a row or null; `many` attach a list. Load with one
  extra query per relation per level (`WHERE fk IN (...)`), never N+1.

Filter grammar:

- `['col' => scalar]` → `col = ?`; `['col' => null]` → `col IS NULL`.
- `['col' => ['eq' => v, 'ne' => v, 'gt' => v, 'gte' => v, 'lt' => v, 'lte' => v,
  'in' => [..], 'notIn' => [..], 'like' => s, 'notLike' => s, 'ilike' => s,
  'notIlike' => s, 'isNull' => true, 'isNotNull' => true,
  'NOT' => fieldFilter, 'OR' => [fieldFilter..], 'AND' => [fieldFilter..]]]`
  (several operators in one object are ANDed).
- Top level `'OR' => [filter..]`, `'AND' => [filter..]`, `'NOT' => filter`.
- Relation key: `['location' => true]` → related row exists;
  `['location' => filter]` → EXISTS related row matching filter.
- Values are coerced with the column's encoder (booleans → 0/1, timestamps
  normalized). `like` is case-sensitive, `ilike` case-insensitive.
- Unknown column/relation/operator → `HttpError(400, 'invalid_query', ...)` with pointer
  like `/where/qty`.

All values are bound parameters. Identifiers come only from schema.php.

## Runtime extension points (schema v3)

`Features` owns the ordered module list; bootstrap registers it once. A module
registers callbacks through `Extensions`, plus idempotent dialect-specific DDL
through `SystemTables` when needed. Registration itself performs no app I/O.

- `beforeRead(collection, &opts, ?viewer, pointer)` runs before query validation
  and SQL; its normalized options also govern projection at every relation level.
  `onLookup(collection, pks)` runs in concrete stores before hydration
  and decode. Lookup receives nonempty collection pages, not system-media rows.
  Mutation results (including receipt replay) and revision snapshots also prime
  their page before read transforms; callbacks may run again after write hooks.
- `onRead(rows, collection, ?viewer)` transforms decoded rows before `with` and
  projection; also applies to revision reads and returning write responses.
  Revision restore authorizes first, then uses the full stored snapshot; display
  transforms never supply persistence input. Internal mutation selection keeps
  authorization filters and passes full decoded storage rows to normalization,
  validation and write hooks, including previous-row notifications.
  Keep primary keys intact. Relation attachment preserves original linkage
  privately; removing a media column prevents its population.
- `normalizeWrite(op, collection, &data, ?existing, ?viewer, provided)` consumes
  virtual inputs before column rejection on create/update. Keep it free of
  persisted effects; unconsumed unknown keys remain errors.
- `onWrite(op, collection, &data, ?existing, ?viewer, provided)` runs after
  defaults/onUpdate and before app before-hooks (create: also before required
  and access checks). `provided` is the original row/patch. Delete runs before
  `beforeDelete`. `onWritten(op, collection, row, ?previous)` runs after app
  after-hooks in the same transaction, including WP editor notifications.
  WP editor captures use `editorRow(collection, pk)` to keep full stored values
  for previous/deleted rows, even when trusted reads have display transforms.
- `afterCommit(fn)` delegates to the active Db's Store. The outermost commit
  drains its queue; rollback discards it. Outside a transaction it runs
  immediately. Nested transactions join without savepoints. A callback that
  throws propagates after commit, without rollback cleanup or callback replay.
- `route(prefix, handler)` receives `(method, fullDecodedSegments, query,
  rawBody, viewer, files, form)` and returns `[status, data]` or `Response`. One
  complete first segment is matched before built-ins and collections. Thus the
  auth feature can replace `/auth/token`; without a registered owner the phase-1
  login remains. A module that owns a prefix owns all its dispatch and method checks.
- `beforeAction(spec, name, rawBody, headers, ?viewer)` sees exact input bytes
  and lowercase header names after action authorization, before input validation.
  JSON syntax parsing retains its phase-1 precedence before action lookup.
  HTTP and CLI actions share this path; a null viewer means trusted CLI.
- `aroundOperation(scope, spec, rawBody, headers, ?viewer, next): Response` wraps
  `action:<name>` and HTTP `create:<collection>` in the current transaction.
  Action authorization, raw-body guards and input validation, or create input
  normalization/required/access checks, run before wrappers, including on replay.
  Calling `next()` executes the handler/write pipeline. A wrapper may instead
  return its stored result and add metadata with `Response::withHeaders`.
  Wrapper failures roll back both writes and receipt effects. Create wrappers
  see the full persisted row; read transforms apply after execution or replay.
  `Db::insert` exposes its optional per-row `around(callable(): array): array`
  continuation to the request adapter. Trusted nested writes do not inherit
  the request header or create another receipt.
- HTTP list and item reads forward feature query options to `beforeRead`. The
  feature consumes/normalizes its options; unknown remaining options fail normal
  query validation.
- `cli(command, handler)` receives `(argsWithoutCommand, flags)` inside the
  canonical CLI transaction and receipts, on both standalone and `wp zero`.
- `schemaDescribe(fn)` transforms the public schema description.

`SystemTables::register(name, sqliteStatements, mysqlStatements)` assigns one
owner per table. Each list contains idempotent SQL strings or guarded
`callable(Store): void` upgrades (SQLite has no `ADD COLUMN IF NOT EXISTS`).
`apply(Store)` rejects request transactions before running SQL or guards and
chooses the dialect; WP replaces `{prefix}` in SQL. Store construction (SQLite) and the existing
WP migrator apply registrations outside request transactions. `Store` exposes
`afterCommit(callable)` and `applySystemStatements(list<string>)` for these
seams. Existing phase-1 tables and generated migrations are unchanged.

`Wp\Scf::fieldFilter(fn)` transforms each fully-built field, including nested
fields, with `(field, definition, column, spec)`. Top-level `spec` is the
collection/global; nested `spec.fields` contains sibling definitions.

Schema loading requires v3 and runtime series `0.2` (phase-2 design §3.1); v2
and missing or incompatible series are refused. `Schema::version()` and
`Schema::runtime()` report the loaded contract. New feature metadata passes
through unchanged; feature modules own its behavior. Lazy scheduled promotion
remains at the start of requests/commands, so due records are visible in that
same request.

`App::dispatch(method, path, query, rawBody, Viewer, headers = [], files = [],
form = []): Response` is the shared operation entry point for HTTP and Abilities.
It opens or joins a transaction, promotes due rows, binds the explicit viewer
as hook actor, and restores the previous actor even on failure. It does not
resolve credentials or convert exceptions to HTTP problems. `App::invoke(method,
path, query, body, Viewer)` is its data-only convenience for JSON operations;
`body` is a decoded value or exact raw JSON string. Headers and raw file responses
use `dispatch`. HTTP resolves credentials once, then uses the same dispatcher.

`Response::json(data, status = 200, headers = [])` keeps the normal `{data}`
envelope. `Response::raw(string|Closure, status = 200, headers = [])` returns
bytes or a deferred emitter for downloads. Raw handlers set their content type
and download/security/cache headers explicitly. Both HTTP transports emit only
after the operation transaction commits. `App::handle` returns a string or
closure body; `handleHttp` and the WordPress REST adapter call `Response::emit`.
Stream emitters perform I/O only, with authorization/file readiness already
checked in the transaction. Streaming errors cannot roll back a committed
operation or replace an already-started response.

## class App (HTTP)

`App::boot(string $appRoot): App` loads `zero/app/schema.php`, requires
`zero/app/functions.php`, opens SQLite at env `ZERO_DB_PATH` or
`<appRoot>/data/zero.sqlite` (creating the directory), sets
`PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`,
`PRAGMA busy_timeout = 5000`, and applies pending migrations (unless env
`ZERO_AUTO_MIGRATE=0`).

Routes (everything else → 404 problem):

| Method + path | Behavior | Success |
|---|---|---|
| `GET /api/_schema` | collections, columns, relations, actions (no function names) | 200 `{data}` |
| `GET /api/{c}` | query params: `where` (JSON filter), `orderBy` (`name` or `-name`, comma-separated), `limit` (default 50, max 200), `offset`, `with` (comma-separated relation names) | 200 `{data: [rows]}` |
| `GET /api/{c}/{id}` | by primary key, `with` allowed | 200 `{data: row}` / 404 `not_found` |
| `POST /api/{c}` | JSON body = one row | 201 `{data: row}` |
| `PATCH /api/{c}/{id}` | JSON body = patch | 200 `{data: row}` / 404 |
| `DELETE /api/{c}/{id}` | | 200 `{data: deletedRow}` / 404 |
| `POST /api/actions/{name}` | JSON body validated against `input` (unknown keys rejected, defaults applied, coerced like columns) | 200 `{data: result}` |
| `OPTIONS *` | CORS preflight | 204 |

A collection's `api` flags gate list/get/create/update/delete (disabled →
405 `method_not_allowed`). All responses send
`Access-Control-Allow-Origin: *` and allow `GET, POST, PATCH, DELETE, OPTIONS`
and header `content-type`.

Success body: `{"data": ...}` with `Content-Type: application/json`.
Failure body (RFC 9457), `Content-Type: application/problem+json`:

```json
{"type":"about:blank","title":"Invalid input","status":422,"code":"invalid_input","detail":"quantity must be an integer","pointer":"/quantity"}
```

Status mapping: `invalid_input` 422, `invalid_query` 400, `invalid_json`
400, `not_found` 404, `method_not_allowed` 405, `unique_violation` 409,
`reference_violation` 409, `rejected` 422 (any `JsError` thrown by user
code: `detail` = its message), `HttpError` → its own status/code, anything
else → 500 `internal` (detail = message only when env `ZERO_DEBUG=1`,
always logged to `error_log`).

JSON responses are encoded with `Js::jsonStringify` (so integral floats
print without `.0`).

## CLI (`zero/bin/zero.php`)

```
php zero/bin/zero.php migrate
php zero/bin/zero.php action <name> [json]
php zero/bin/zero.php find <collection> [opts-json]
php zero/bin/zero.php insert <collection> <json>
php zero/bin/zero.php update <collection> <where-json> <set-json>
php zero/bin/zero.php delete <collection> <where-json>
```

Prints `{"data": ...}` on success (exit 0) or `{"error": {problem}}` (exit 1)
to stdout. Same transaction and pipeline rules as HTTP.

## Migrations

Files `zero/app/migrations/NNNN_<name>.sql`, applied in filename order.
Statements are separated by a line `--> statement-breakpoint`. Applied files
are recorded in `__zero_migrations(id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`.
Each file runs in its own transaction with `PRAGMA foreign_keys = OFF`
around it (table rebuilds must not fire cascades), followed by
`PRAGMA foreign_key_check`; any violation rolls the file back and names the
table.

## Errors

```php
class JsError extends \Exception {      // what `throw new Error(msg)` compiles to
  public function __construct(string $message, public readonly string $jsName = 'Error');
}
class HttpError extends \Exception {    // `throw new HttpError(404, "not_found", "...")` from `zero`
  public function __construct(public readonly int $status, public readonly string $errorCode, string $message, public readonly ?string $pointer = null);
}
```

## class Js — JavaScript semantics in PHP

Static methods on `final class Js`. Value model: JS `number` = PHP
`int|float`; `string` = PHP `string` (UTF-8, indexes count Unicode code
points); `boolean` = `bool`; `null` and `undefined` are both PHP `null`;
arrays are PHP lists; plain objects are PHP assoc arrays; functions are
`callable`; `Date` values are numbers (epoch ms); `RegExp` is `Zero\RegExp`.
The compiler emits native PHP whenever types make it safe; these helpers
cover the cases where JS and PHP genuinely differ. Each must match the
JavaScript result exactly on the inputs its types allow.

Conversions:
- `str(mixed $v): string` — `String(v)`. null → `"null"`, bools → `"true"/"false"`, numbers → `numStr`, list → elements `str`'d joined by `,` with null as `""`, assoc → `"[object Object]"`, `RegExp` → `/src/flags`.
- `numStr(int|float $n): string` — `Number.prototype.toString()`: `NaN`, `Infinity`, `-Infinity`, `-0` → `"0"`, integral values below 1e21 without exponent, shortest round-trip digits, exponent form `1e+21`, `1.5e-7` exactly where JS uses it (≥ 1e21 or < 1e-6).
- `toNumber(mixed $v): int|float` — `Number(v)`: null → 0, bool → 0/1, string trimmed of JS whitespace: `""` → 0, decimal, `0x`/`0o`/`0b` prefixes, `Infinity`/`-Infinity`, otherwise NAN. Safe integers (|n| ≤ 2^53) return int, larger values float.
- `n(int|float $r): int|float` — an integer arithmetic result as a JS number: an int beyond ±2^53 becomes the nearest double. Compiled `+ - *` and `++`/`--` (`preStep`/`postStep(&$x, ±1)`, which evaluate the place once) go through it, and `**`/`Math.pow` through `pow(a, b)`, so Zero ints never do exact arithmetic JS numbers can't. `decodeJson(string)` is the one JSON decoder (request bodies, query JSON, `JSON.parse`, stored JSON columns): integers past ±2^53 decode as the double a JS parser would produce.
- `parseInt(string $s, int|float|null $radix = null): int|float`, `parseFloat(string $s): int|float` — exact JS semantics, NAN when nothing parses.
- `truthy(mixed $v): bool` — null, false, 0, -0.0, NAN, `""` are falsy; every array (even empty) is truthy.
- `typeOf(mixed $v): string` — `"object"` for null/arrays, `"number"`, `"string"`, `"boolean"`, `"function"` for Closure.
- `strictEq(mixed $a, mixed $b): bool` — `===` for primitives: int/float compare numerically, NAN never equal.
- `isInteger(mixed $v): bool`, `isFinite(mixed $v): bool` (`Number.isInteger/isFinite`, no coercion).
- `toFixed(int|float $n, int $digits = 0): string` — JS `toFixed`.

Strings (all code-point based, negative/float/out-of-range arguments handled exactly like JS):
- `slice(string $s, int|float $start = 0, int|float|null $end = null): string`
- `substring(string $s, int|float $start, int|float|null $end = null): string`
- `charAt(string $s, int|float $i): string`, `strAt(string $s, int|float $i): ?string`
- `indexOf(string $s, string $needle, int|float $from = 0): int`, `lastIndexOf(string $s, string $needle): int`
- `includes(string $s, string $needle): bool` is native (`str_contains`), not here.
- `split(string $s, string|RegExp $sep, int|float|null $limit = null): array` (`""` separator → code points)
- `padStart(string $s, int|float $len, string $fill = ' '): string`, `padEnd(...)`
- `trim(string $s): string`, `trimStart`, `trimEnd` (JS whitespace incl. Unicode spaces and line terminators)
- `replace(string $s, string|RegExp $pattern, string|callable $replacement): string` — string pattern replaces the first occurrence; RegExp replaces all with `g`, else first. String replacements support `$$`, `$&`, `` $` ``, `$'`, `$1`..`$99`, `$<name>`. A callable receives `(match, ...groups, offset, input)` like JS (no named-groups object).
- `replaceAll(string $s, string|RegExp $pattern, string|callable $replacement): string` (RegExp without `g` → throw `JsError` TypeError like JS)
- `repeat(string $s, int|float $n): string`
- `localeCompare(string $a, string $b): int` — -1/0/1 via byte comparison (documented deviation)
- `strMatch(string $s, RegExp $re): ?array` — `String.prototype.match`: non-global → `[match, ...groups]` (unmatched groups null) or null; global → list of all matches or null.

RegExp:
- `re(string $source, string $flags): RegExp` — cached per (source, flags). Translates the JS source to PCRE (delimiter-safe, `u` added when the `u` flag is set), maps flags `i m s u g`. `y` and `d` throw `JsError`.
- `RegExp::test(string $s): bool`, readonly `source`, `flags`, `global`.

Arrays (lists):
- `find(array $a, callable $f): mixed` (null when none), `findIndex(array $a, callable $f): int`, `findLast`, `findLastIndex`
- `some(array $a, callable $f): bool`, `every(array $a, callable $f): bool`
- Callbacks are invoked as `$f($item, $index)`; compiled callbacks declare the parameters they use, and PHP closures ignore extra arguments.
- `filter(array $a, callable $f): array` (re-indexed list; callback result passed through `truthy`)
- `map(array $a, callable $f): array` (`$f($item, $index)`)
- `includes(array $a, mixed $v): bool` — SameValueZero (numbers numeric, NAN equals NAN)
- `indexOf(array $a, mixed $v): int`, `lastIndexOf(array $a, mixed $v): int` — strict equality
- `join(array $a, string $sep = ','): string` (null elements → `""`, others `str`)
- `arrSlice(array $a, int|float $start = 0, int|float|null $end = null): array`
- `arrAt(array $a, int|float $i): mixed`
- `splice(array &$a, int|float $start, int|float|null $deleteCount = null, mixed ...$items): array`
- `reverse(array &$a): array` (in place, returns the array)
- `sort(array &$a, ?callable $cmp = null): array` — in place; default compares `str()` values by UTF-16 code units; comparator results may be floats; stable.
- `sorted(array $a, ?callable $cmp = null): array` — `toSorted`
- `reduce(array $a, callable $f, mixed ...$init): mixed` — `$f($acc, $item, $index)`; empty array without init → `JsError` TypeError
- `flat(array $a, int|float $depth = 1): array`, `flatMap(array $a, callable $f): array`
- `fill(array &$a, mixed $v, int|float $start = 0, int|float|null $end = null): array`
- `max(int|float ...$n): int|float`, `min(...)` — JS `Math.max/min` (no args → -INF/INF, any NAN → NAN)
- `range(int $n, callable $f): array` — `Array.from({ length: n }, (_, i) => f(i))`

Objects (assoc arrays):
- `keys(array $o): array` (keys as strings), `values(array $o): array`, `entries(array $o): array` (`[[string key, value], ...]`), `fromEntries(iterable $e): array`
- `omit(array $o, array $keys): array` — object rest after destructuring.
- `hasOwn(array $o, string $k): bool`

JSON:
- `jsonStringify(mixed $v, int|float|string|null $indent = null): ?string` — `JSON.stringify(v, null, indent)`: lists → arrays, assoc → objects, empty array → `[]`, NAN/INF → `null`, integral floats without `.0`, unescaped `/` and Unicode, `Closure` values omitted from objects and `null` in arrays, top-level Closure → null. Indent number (clamped 10) or string, exactly as JS formats it.
- `jsonParse(string $s): mixed` — assoc arrays; invalid → `JsError` named `SyntaxError`.

Misc:
- `now(): int` — epoch ms. `date(mixed $v): int|float` — `new Date(v).getTime()`: number → itself, ISO/`YYYY-MM-DD` string → ms (date-only = UTC midnight, date-time without zone = UTC), unparseable → NAN. Like V8 it lets an in-range day overflow (`2021-02-30` → March 2) and takes hour 24 only as exact midnight; unlike V8 it has no legacy fallback (`10/30/2026` → NAN). Column writes don't rely on it for validation: the timestamp codec checks the calendar first. `iso(int|float $ms): string` — `toISOString()`, NAN → `JsError` RangeError.
- `uuid(): string` — RFC 4122 v4.
- `random(): float` — `[0, 1)`.
- `log(string $level, mixed ...$args): void` — `console.log`: args `str`'d (arrays/objects via jsonStringify) joined by a space, written to `error_log` with `[zero] ` prefix.
