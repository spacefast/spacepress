# Zero PHP runtime contract

The Rust compiler (`zero build`) emits WordPress plugins. Everything that runs
at request time is PHP: a hand-written runtime library (`runtime/Zero/*.php`,
copied verbatim into every build) plus generated files. This document is the
seam between them. The compiler only emits calls listed here.

Requirements (`Platform::problems()` is the one statement of them; activation
and `zero doctor` both apply it): WordPress 7.1+ on PHP 8.2+ with the
`mbstring`, `json` and `gd` extensions (`sodium` for the identity bundle);
MySQL 8.0+ or MariaDB 10.11+ with every Zero table InnoDB, or SQLite through
SQLite Database Integration 3.1.2+; the pinned platform plugins Secure Custom
Fields, Action Scheduler and MCP Adapter at the versions in
`Platform::PLUGINS`, plus Polylang when the app is localized. Composer runs
only at maintainer time; prefixed third-party libraries ship under
`vendor-prefixed/`. See `dependencies.md` for their locks and regeneration.
Every Zero file starts with `declare(strict_types=1);`. Namespace `Zero`.

## Build output layout

```
<out>/                                 (default: <project>/.zero/wp-content)
  zero-manifest.json                   versions, runtime series, platform requirements, dependency checksums
  plugins/zero-runtime/
    zero-runtime.php                   plugin header; boots Wp\Plugin
    zero/*.php                         this library, copied verbatim
    zero/vendor-prefixed/**            bundled, isolated PHP dependencies
  plugins/zero-identity/               optional identity bundle (passkeys, sessions, tokens)
  plugins/zero-app-<name>/
    zero-app-<name>.php                plugin header
    zero/app/schema.php                generated: `return [...]` schema metadata
    zero/app/functions.php             generated: compiled hooks, actions, helpers (namespace ZeroApp)
    zero/app/migrations/NNNN_<name>.sql  MySQL DDL, `{prefix}` for the table prefix
    public/...                         copied from <project>/public if present
  *.zip                                the same plugins, packaged
```

`zero/bootstrap.php` eagerly loads `Db.php` (for the `Zero\db()` function),
sets `ini_set('precision', '-1')`, `ini_set('serialize_precision', '-1')`,
registers an autoloader for `Zero\*` from its own directory, and registers the
ordered feature modules through `Features::register()` (once per process).

The signing key for private-file URLs is the `zero_runtime_secret` option,
minted on activation.

The app's schema is the authoritative runtime series check; the runtime
refuses a mismatched series or a second app plugin.

`GET /_schema` on WordPress includes `runtime.wp` with WordPress/PHP/database
versions, `scf`, `actionScheduler`, `mcpAdapter`, `polylang`, `identity`,
`imageCdn`, and `incompatibleTables`. `runtime.pendingMigrations` and
`runtime.languages` report app migration and localization state. Identity is
true only for a compatible implementation; the A3 placeholder does not enable it.
`zero doctor [--site URL --token T]` checks this data against the same
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

| Compiled callback | Call | Return handling |
|---|---|---|
| beforeCreate | `$r = $fn($data, $ctx)` | a `JsObject` replaces data; otherwise retain mutations to `$data` |
| afterCreate | `$fn($row, $ctx)` | ignored |
| beforeUpdate | `$r = $fn($patch, $existing, $ctx)` | a `JsObject` replaces the patch; otherwise retain mutations to `$patch` |
| afterUpdate | `$fn($row, $previous, $ctx)` | ignored |
| beforeDelete / afterDelete | `$fn($row, $ctx)` | ignored |
| default fn / onUpdate fn | `$v = $fn()` | converted through `Seam::generated` for the column |
| action handler | `$out = $fn($input)` | converted to wire values and returned as `data` |

A string in a schema callback slot names compiled code. `Seam` converts its
schema-shaped input and context to `JsObject` / `JsArray` handles. Each callback
receives a fresh graph; before-hooks' `$data` / `$patch` shares identity with
`$ctx->p['data']`, so in-place mutations are retained without a replacement
return. After-hook and delete-hook return values are ignored. Native non-string
callables retain PHP array inputs and contexts; before-hooks replace data or
patches only when their return is a native array.

Compiled object and array parameters pass handles by value: member mutations
are shared, but rebinding a parameter does not replace the caller's binding.
Captured bindings retain that JavaScript behavior, including arrays, open
records and optional fields. Object spread/rest copies field values shallowly.
Loop-local declarations receive a fresh binding on each execution, and a
captured `for (let …)` header variable receives a fresh `Js::cell` per iteration.
The cell copies its value; copying a handle preserves the referenced container.

Arrays remain dense. Indexed writes may replace an existing element or append
at the current length; writes past the end throw a catchable `RangeError`.
Writing through a missing receiver throws `TypeError`. Assignments evaluate
the receiver and key before the value; read-modify-write operations read the
old value before evaluating the right-hand side. These are runtime semantics,
not a blanket refusal of writes into array elements.

## Compiled classes

Generated class methods are plain `ZeroApp` functions with an explicit first
receiver argument. They use `JsObject` handles for instances, so aliases,
closures, member mutations and strict identity use the existing object model.
`JsObject::$class` is readonly descriptor metadata; only `JsObject::$p` contains
enumerable own fields. PHP inheritance and PHP method binding are not used.

`JsClass` descriptors contain the parent, constructor and ordered field
initializer closures, instance/static method tables, and a static `JsObject`.
Generated descriptor factory functions cache one descriptor per class per process.
The compiler emits these runtime operations:

- `construct(...$args): JsObject` allocates a fresh handle and initializes it.
- `initialize(JsObject $instance, array $args): void` runs a constructor on the
  existing receiver. Base fields precede constructor defaults; generated derived
  constructors call the parent's initializer, then their own field initializer.
- `invoke($receiver, $name, $args, $static): mixed` selects the actual receiver's
  descriptor. `invokeOn(...)` starts at the lexical parent for `super` calls while
  retaining that receiver. Methods receive the hidden receiver explicitly.
- `get`, `has` and `set` implement static field inheritance. Reads search parents;
  writes create an own field on the actual class descriptor.
- `isInstance($value, $expected): bool` walks descriptor ancestry, never field
  shapes. Plain/cloned/deserialized objects do not acquire class identity.

`Js::prop`, `has` and `set` also accept descriptors for compiled static field
updates. Spread, object keys and JSON visit own properties only. `Js::clone`
and `Seam` detachment copy the own-field graph into plain handles; descriptors
and method tables are not traversed or serialized. Generated client types erase
instance identity recursively at the wire boundary.

## Native post password visibility

Viewer-bound reads exclude password-protected WordPress records before filters,
projections, pagination and relation matching. Locked item reads return 404;
list and Ability reads omit the row. This boundary covers native core REST as
well as Zero. An explicit viewer with native `edit_post` capability or a valid
WordPress post-password cookie can read the record. Trusted server reads with
no viewer retain their existing authority.

Native core REST GET/HEAD requests also accept their `password` parameter.
That proof is scoped to the collection and explicit viewer, accepts only rows
with the matching password, and is suspended/restored across nested requests.
It does not authorize a later Zero request or borrow the ambient user's rights.

## Write pipeline (`Db::insert/update/delete`, REST and CLI all go through it)

Viewer-bound writes must not answer existence questions about unreadable data.
Setting a non-null unique value (including an explicit primary key or a generated
slug) requires an unfiltered collection read rule and visibility of that field
across rows. Otherwise both taken and free values return 401/403 before any
uniqueness lookup. A filtered read, including `self` or automatic draft filtering,
does not authorize new or changed unique values. An unchanged value is accepted
only when the viewer can read the current row and the column cannot hide values.
That value is omitted from persistence, and native slug repair preserves it without
querying competitors. Publishing a WordPress draft is a new uniqueness operation;
echoing or omitting its slug cannot bypass the full visibility preflight.
Hidden columns and unreadable rows receive the same refusal
before equality can affect the response. Trusted CLI/hook writes retain normal
uniqueness checks; successful public creates retain their ordinary row response.
System uids remain unguessable sync identities.

Blind intake belongs in a narrow application action, not a public unique-create
endpoint. The site example acknowledges newsletter requests with a constant
response and queues private, deduplicated processing; it returns neither a
subscriber row nor a job identifier. Existing and new subscriptions have the
same acknowledgement. Exact announcement recipient counts are admin-only,
including filtering: comparing counts around a signup would otherwise disclose
membership. Member administrators explicitly have collection read
access before managing unique identities. Its editor-only removal action
authorizes detaching private subscription links and returns only the post id;
private subscriber data never leaves that action. These application policies
do not exempt viewer-bound CRUD from the checks above.

Every reference in a viewer-bound write, including generated values, must resolve within the target's read filters and use
a readable target column; an unreadable target and a missing target return the
same `reference_violation`, without the resolved value in its detail. Knowing a
sync UID grants no target visibility: primary and non-primary references both
require a viewer-scoped lookup, and the write pipeline checks visibility again
after hooks. Hidden and absent translation peers both remain unlinked until a
visible peer is available. This applies to core WordPress saves too.
Sync checks target visibility before resolved values reach input rules or validators.
Potential generated constraints are preflighted before defaults and on-update
generators run; hook-written references are checked before field validation.
A delete requires visibility across the referencing collection and
column before checking for children, so hidden children cannot be discovered by
trying to delete their parent. The preflight follows cascade branches and covers
generated values from referential updates even when a branch has no rows. Hidden
cascade branches are refused before traversal, so recursion limits cannot reveal
their depth.
These checks roll back the whole write on refusal.
Changing a referenced key uses the same relationship visibility preflight,
following native cascading updates before the database can expose hidden children.
Native WordPress draft publication preflights slug visibility before collision
resolution. Wrapped saves and editor forms preserve an omitted slug on an
already published, scheduled, or private row. Programmatic native writes without
known input provenance retain collision resolution and require slug visibility.

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
(`START TRANSACTION`, REPEATABLE READ). An exception before the commit rolls
back every write of the request. Nested runtime transactions join without
savepoints. Any failed joined operation marks the outer transaction rollback-only,
even if an application hook catches its exception. Attempting the outer commit
rolls back all writes, discards after-commit callbacks, and throws. Hooks must let
the outer operation fail and retry the complete unit of work. Two things are outside that guarantee: an
`afterCommit` callback runs after the commit, so its failure propagates without
undoing the request; and `wp zero migrate` records each DDL statement as it
succeeds (MySQL DDL commits implicitly), so a later statement's failure leaves
the earlier ones applied and recorded (see Migrations).
Transactions run concurrently, so a read whose result the transaction then
depends on takes an explicit lock (`FOR UPDATE`, `LOCK IN SHARE MODE`; see
`Sync\Lock`, `Locale\Lock`, `Jobs\Storage`).

## Validation and coercion (input → stored)

| type | accepts | stored as (custom table column) |
|---|---|---|
| integer | int, or a float with no fractional part whose magnitude is at most 9007199254740991 (JavaScript's safe-integer range) | BIGINT |
| real | int or float (not NaN/Inf) | DOUBLE |
| text | string | LONGTEXT (VARCHAR when unique or bounded) |
| boolean | bool | TINYINT(1) 0/1 |
| timestamp | int ms, or ISO 8601 `YYYY-MM-DD` (UTC midnight) / `YYYY-MM-DDTHH:mm[:ss[.fff]]` + `Z` or `±HH:MM`, every component a real calendar/clock value (no `now`, `10/30/2026`, zone-less date-times or `02-30`) | TEXT `Y-m-d\TH:i:s.v\Z` (UTC) |
| date | string `YYYY-MM-DD` that is a real calendar date | CHAR(10) |
| json | any JSON value | LONGTEXT (json_encode, unescaped slashes/unicode) |

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
  Constraint preflights treat extension narrowing as filtered visibility: unique
  namespaces, generated references, and incoming relationships must remain fully
  readable before storage can answer about competitors or children. Unchanged
  unique values must also survive a viewer-scoped read of the current row.
  Custom `beforeRead` and `onRead` callbacks conservatively disable viewer-bound
  namespace checks, since an arbitrary callback can hide values conditionally.
  A registration may set `constraintSafe: true` only when its visibility policy
  preserves row membership and constraint columns except for restrictions already
  represented by schema access rules; built-in transforms do so.
  Concrete references still require a row and matching column value in the final
  viewer-visible result, including read transforms. Trusted writes remain available.
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
  canonical `wp zero` transaction and receipts.
- `schemaDescribe(fn)` transforms the public schema description.

`SystemTables::register(name, statements)` assigns one owner per table. The
list contains idempotent SQL strings (`{prefix}` is the WordPress table prefix)
or guarded `callable(Store): void` upgrades (a column check against
`information_schema` before `ADD COLUMN`). `apply(Store)` rejects request
transactions before running SQL or guards; the runtime applies registrations
on activation and on the first request after an update, outside request
transactions. `Store` exposes `afterCommit(callable)` and
`applySystemStatements(list<string>)` for these seams.

`Wp\Scf::fieldFilter(fn)` transforms each fully-built field, including nested
fields, with `(field, definition, column, spec)`. Top-level `spec` is the
collection/global; nested `spec.fields` contains sibling definitions.

Schema loading requires v3 and runtime series `0.3`; v2 and missing or
incompatible series are refused with a rebuild instruction. Series `0.3`
requires handle-based compiled callbacks; schemas from the `0.2` compiler
cannot load under this runtime. `Schema::version()` and
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
closure body; the WordPress REST adapter calls `Response::emit`.
Stream emitters perform I/O only, with authorization/file readiness already
checked in the transaction. Streaming errors cannot roll back a committed
operation or replace an already-started response.

## class App (HTTP)

`App::boot(string $appRoot, Store $store, Auth $auth, Media $media): App` loads
`zero/app/schema.php` and requires `zero/app/functions.php`; the plugin passes
its store, authentication and media services, and migrates on activation and
on the first request after an update (`Wp\Plugin`).

Routes, under `/wp-json/zero/v1` (everything else → 404 problem):

| Method + path | Behavior | Success |
|---|---|---|
| `GET /_schema` | collections, columns, relations, actions (no function names) | 200 `{data}` |
| `GET /{c}` | query params: `where` (JSON filter), `orderBy` (`name` or `-name`, comma-separated), `limit` (default 50, max 200), `offset`, `with` (comma-separated relation names) | 200 `{data: [rows]}` |
| `GET /{c}/{id}` | by primary key, `with` allowed | 200 `{data: row}` / 404 `not_found` |
| `POST /{c}` | JSON body = one row | 201 `{data: row}` |
| `PATCH /{c}/{id}` | JSON body = patch | 200 `{data: row}` / 404 |
| `DELETE /{c}/{id}` | | 200 `{data: deletedRow}` / 404 |
| `POST /actions/{name}` | JSON body validated against `input` (unknown keys rejected, defaults applied, coerced like columns) | 200 `{data: result}` |

A collection's `api` flags gate list/get/create/update/delete (disabled →
405 `method_not_allowed`). `Wp\Rest` registers one catch-all route and serves
the body App produced verbatim; WordPress's REST server owns authentication
(cookie and nonce, or an application password), CORS headers and `OPTIONS`
preflights.

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

## CLI (`wp zero`)

```
wp zero migrate [--mark-applied <id>:<n>]
wp zero publish-due
wp zero action <name> [json]
wp zero find <collection> [opts-json]
wp zero insert <collection> <json>
wp zero update <collection> <where-json> <set-json>
wp zero delete <collection> <where-json>
```

Prints `{"data": ...}` on success (exit 0) or `{"error": {problem}}` (exit 1)
to stdout. Same transaction and pipeline rules as HTTP. Every command except
`migrate` first promotes due scheduled rows of custom-table collections
(`publish-due` does only that; its envelope is `{"data": {"promoted": {collection: [pks]}}}`);
post-backed collections are scheduled by WordPress itself.

## Migrations

`Wp\Migrator` applies the app plugin's `zero/app/migrations/NNNN_<name>.sql`
files (MySQL dialect, `{prefix}` replaced by `$wpdb->prefix`) in filename
order. Statements are separated by a line `--> statement-breakpoint`. The
compiler's `-- zero-adopt` statement metadata makes the migrator validate existing
primary/unique index names and foreign-key definitions before recording adoption.
Integer columns must match the declared BIGINT signedness, so later generated
foreign keys cannot silently assume a different physical key type.
Unmanaged indexes are retained. The
shared migration path checks existing tables before DDL or ledger writes, and
checks the resulting tables before marking the app current. Non-InnoDB or
non-utf8mb4 tables refuse activation, first-request upgrades and CLI migration;
failed upgrades keep Zero unavailable until the storage is corrected. The
ledger is `{prefix}zero__migrations(app, id, applied_at)`, keyed by app so two
plugins' `0001_init` files stay apart. MySQL DDL commits implicitly, so every
statement that succeeds is recorded as `<id>:<n>` before the next one runs;
once a file completes its own id is recorded and the step rows are removed. A
file that failed half way resumes at the failing statement. A statement that
committed without its marker fails on the retry ("already exists") until the
operator records it with `wp zero migrate --mark-applied <id>:<n>`. Writers
(first request, activation, `wp zero migrate`) serialize on `Connection::locked`.

## Errors

```php
class JsError extends \Exception {      // what `throw new Error(msg)` compiles to
  public function __construct(string $message, public readonly string $jsName = 'Error');
}
class HttpError extends \Exception {    // `throw new HttpError(404, "not_found", "...")` from `zero`
  public function __construct(public readonly int $status, public readonly string $errorCode, string $message, public readonly ?string $pointer = null);
}
```

Built-in overloads and phase arity are owned by `src/builtins.rs`. Its generated
`runtime/Zero/Builtins.php` guards checked JavaScript dispatch; regenerate with
`UPDATE_BUILTINS=1 cargo test --lib builtins::tests`. The normal Rust suite
checks freshness. Type/coercion guards remain at their language boundary.
JSON parsing/serialization and Error instances are runtime-only. The evaluator
refuses these calls rather than serialize with Rust's JSON rules or substitute
plain objects for Errors. Keep configuration data plain; serialize and construct
Errors inside handlers. Custom object and function coercion is also refused
at build time; the pure conversion helpers never silently skip ToPrimitive hooks.
Runtime conversions execute user code once, with array length captured before
bound or depth coercion. Coercions that would require sparse splice/fill results
are explicitly refused. Typed string `at` retains its nullable-read boundary;
checked JavaScript string `at` returns undefined outside the string.

`tests/differential/builtin-vectors.json` supplies the same expressions to
Node, captured configuration evaluation and generated PHP. Regex state is
runtime-only because the pure evaluator has no mutable RegExp execution model.
Captured arrays and objects retain one identity across typed and imported
JavaScript callers, including references nested in other captured data.
Build-time regex replacement accepts ASCII text/patterns without escapes,
nested character classes, multiline mode, set operations or line terminators;
other cases are refused
instead of inheriting Rust regex semantics. String replacements have no such
ASCII restriction. Replacement tokens implement GetSubstitution, including
capture-number boundaries and named captures.
Repeated groups containing captures are refused in every phase: Rust/PCRE
retain captures from earlier iterations where JavaScript clears them. Capturing
lookbehind is also refused because JavaScript matches its groups backward. Regex
literals receive located diagnostics; dynamically constructed patterns throw. Literal patterns are parsed by Oxc's JavaScript regex parser before lowering;
JavaScript-invalid syntax never reaches Rust or PCRE. Checked runtime constructors
refuse unsupported quantifier chains. Legacy class identity escapes consume only
the escaped character, leaving following class members intact.
Large parseInt results are supported for base 10 and power-of-two bases; other
radices require safe integer results to avoid engine-specific approximations.
Known unsupported literals are refused at source; dynamic values throw explicitly.
PHP and Rust power-of-two parsing round once from the significant bits.
Powers accept safe integer powers, integral powers of binary bases, squares,
square roots and IEEE special values. Other powers are refused:
Node and native math libraries can round them differently. Known literals have
source diagnostics; dynamic values throw RangeError. Missing reads and built-in
results preserve undefined separately from null in both language modes.
Unknown built-in properties and Object.freeze are refused during configuration evaluation.
Database namespace, query and builder receivers must be direct references or calls;
computed receiver expressions refuse at their source position before effects can be discarded.

Database builders, configuration/schema factories and column modifiers also use
the shared source arity contract, including runtime arguments to `$type`. Database
collection arguments must resolve to static references; effectful expressions
are refused instead of discarded. Updates require `set(...)` before `where(...)`
to preserve argument evaluation order. Extracted methods cannot be invoked during
configuration evaluation because the evaluator does not model lost receivers.
Callbacks are validated before empty-input shortcuts in configuration evaluation.
`Object.fromEntries` follows live array/Set/Map/arguments iterators and reads both
entry values before key coercion. String splitting and regex replacement retain
conversion effects even when a zero limit or non-global pattern makes them inert.
Array conversions honor own `toString`, `valueOf` and `join`; join snapshots
length before converting its separator. Function `apply` reads an array-like
object, with primitive argument lists refused. Prototype setter literals and
dynamic prototype access/mutation are refused; computed `__proto__` data keys
remain ordinary own properties.
Custom `toJSON` callbacks are refused at the source when known and explicitly
at runtime otherwise. Serialize their result explicitly. JSON schemas must
accept their serialized values; undefined array slots require null, and omitted
properties must be optional. Addition and compound addition use default primitive
conversion before string conversion. Sorting places undefined last without
passing it to comparators. Typed Dates require explicit `toISOString()` or
`toJSON()` before JSON.stringify; typed and imported dates share JsDate identity.
Imported JavaScript for-of consumes live iterators. Regex source and string
conversion escape delimiters and line terminators. Ignore-case matching requires
literal ASCII source and ASCII input, including in Unicode mode. Regex split on
astral text also requires u because returned lone surrogates are unsupported.
Typed invalid-Date `toJSON()` returns null. Generated undefined defaults become
null at the storage boundary; required fields still refuse null. Object
overwrites retain key insertion order during evaluation.
Unsupported callback `thisArg`, JSON replacer/reviver, numeric radix formatting
and typed string-search positions are never silently discarded.

Rust and PHP trim and numeric parsers use the explicit ECMAScript WhiteSpace
and LineTerminator set: BOM is whitespace; U+0085 is not. Unary negation performs ToNumber. JSON decoding preserves negative-zero tokens without rewriting quoted text.
Math.round and multiplication preserve negative zero; round avoids the `floor(x + .5)` loss at
large and adjacent-to-half boundaries.

## class Js — JavaScript semantics in PHP

Static methods on `final class Js`. Value model: JS `number` = PHP
`int|float`; `string` = PHP `string` (UTF-8; indexes count UTF-16 code units; splitting a surrogate pair throws `RangeError`); `boolean` = `bool`; `null` = PHP `null`; explicit `undefined` = `JsUndefined::Value`;
arrays are `Zero\JsArray`, plain objects are `Zero\JsObject`, both handles
with identity; class instances are `JsObject` handles with a non-enumerable
`JsClass` descriptor; functions are `Closure`; `Date` values are numbers (epoch ms); `RegExp` is `Zero\RegExp`.
The compiler emits native PHP whenever types make it safe; these helpers
cover the cases where JS and PHP genuinely differ. Each must match the
JavaScript result exactly on the inputs its types allow.

Runtime `void` results use undefined. Missing reads, uninitialized locals and class fields, optional arguments, bare
returns and function fallthrough preserve undefined identity: it is falsy, has typeof `undefined`,
stringifies as `"undefined"`, is omitted from JSON objects and becomes null in
JSON arrays. This distinction does not change schema nullability. Public client
result types describe serialization: undefined array slots become null, and
properties whose values may be undefined become optional with undefined removed
from the present value domain.
Array and object destructuring retain undefined for absent entries. Configuration
for-of and array destructuring use live iterators, including permanent exhaustion
after completion. Optional/default parameters before rest parameters remain
omittable.
Optional parameters accept undefined; null requires an explicit nullable type.
Parameter and destructuring defaults run only for undefined. Typed object
property reads distinguish missing properties from explicit null. Strict
null/undefined comparisons refine only the value being compared; `!= null`
excludes both. Class calls use the same omission rules as ordinary typed calls:
nullable parameters remain required unless their contract also accepts undefined. Undefined cannot be assigned to a null-only annotation. Optional method
results include undefined. Conditional var initializers retain the prior type,
including the hoisted undefined path.

Raw `.js`/`.mjs`/`.cjs` functions use a separate `Dynamic` compiler type. It
does not weaken authored TypeScript `unknown`. `JsDynamic` checks properties,
calls, constructors, iteration and primitive operations against the supported
value model; unknown methods and unsupported signatures throw `JsError`
TypeError. Calls resolve an own method before evaluating arguments. Extracted
supported builtin methods retain the receiver passed through `call`/`apply`.
Ordinary functions receive `JsArguments` (numeric properties, independent
non-enumerable length); arrows inherit the surrounding arguments. Parameters
are not sloppy-mode mapped aliases. Function-scoped `var`, comma expressions,
loose equality and own-key `for…in` share the evaluator's lowering.

Typed and dynamic dates use `JsDate`; Set and Map use ordered `JsSet`/`JsMap` handles.
These support the small constructor/method subset exercised by imported
helpers. RegExp exec tracks global `lastIndex` and exposes match index, input,
groups and undefined captures. Typed and dynamic non-global string match share that metadata; global match returns only matched strings. Dynamic string match/split/replace preserve
these semantics. Literal regexes allocate distinct objects; captured regexes
keep one instance for their shared state. Errors inherit `name`; a defined message
creates an own nonenumerable `message`, including an empty string. Cloning and
receipt snapshots preserve message ownership. Older Error snapshots retain their
stored message as an own property. RegExp snapshots persist source, flags and
lastIndex; restoration rebuilds translation caches, including for older snapshots.
Stack metadata is refused.
Configuration evaluation refuses restricted arguments access because it does
not model native Error descriptors. Undefined remains distinct inside JavaScript. Storage validation treats it as
null for schema fields, including nested fields. Required storage fields still
reject it. `Array.from` interleaves reads with its mapper,
and arrays use live length. The standard Math namespace has stable identity.
`Object.hasOwn` sees the namespace’s supported non-enumerable own properties;
`Object.keys`, `values` and `entries` retain its empty enumerable surface.
Handles expose PI, E and registered methods; other properties refuse explicitly
instead of returning undefined. Error message coercion precedes cause-option
validation, including options mutated during that coercion.

This is not a JavaScript host. Node/browser APIs, arbitrary prototypes,
accessors, custom iterators, sparse arrays and lone surrogates remain outside
the supported subset. JSON replacers/revivers, Error cause options, Date component constructors,
Date string coercion and nondecimal number formatting fail explicitly instead
of ignoring arguments. Typed Dates require explicit `toISOString()`/`toJSON()`
before string conversion. Dynamic function `call`/`apply` property values use
the function method family; unsupported metadata and `bind` access fail
explicitly. Array string conversion and `join` suppress recursive array visits
while expanding repeated nonrecursive references.
See the [npm probes](../examples/npm-compat/README.md)
for exact library exports and inputs qualified against Node.
Object string conversion uses supported `toString`/`valueOf` hooks in JavaScript order.
Function source-text conversion is refused at known call sites or explicitly at
runtime. Date construction applies object primitive conversion before parsing
or numeric clipping.

Configuration evaluation uses the same UTF-16 units for numeric string indexes,
`slice` and `split("")`; a result containing a lone surrogate is rejected with a
located build diagnostic. `split` applies its limit before converting units.
Configuration object reads preserve absent own values as undefined and refuse
inherited prototype properties; use `Object.hasOwn` before reading those names. Noncanonical array index strings
and ambiguous regex class delimiters are refused during evaluation. Optional
regex groups containing captures require a nonempty body; the engines disagree
about capture participation when that body can match empty text. Noncapturing
groups with any quantifier also require a provably nonempty body; JavaScript and
PCRE choose different alternatives when a group iteration can match empty text.

Legacy regex braces that do not form JavaScript quantifiers remain literal text;
Unicode mode refuses those malformed or unmatched braces.

Unicode regex properties (`\p{...}` and `\P{...}` with `u`) are refused because
JavaScript and PCRE use different Unicode databases. Ignore-case matching requires
literal ASCII source and ASCII input; encoded character escapes are refused in
that mode. Remove ignore-case matching or use explicit character classes.
Class escapes adjacent to unescaped hyphens are refused; escape a literal hyphen.
Unicode-mode constructors reject malformed hex, Unicode, named-reference and
identity escapes and unmatched closing brackets. Trailing backslashes are syntax
errors in both modes; legacy-mode identity escapes retain their JavaScript behavior.

`Math.log` and `Math.exp` accept only IEEE special values and exact identities
(log(1), exp(0)). Other inputs receive a located literal refusal or a checked
runtime RangeError, avoiding engine-dependent transcendental rounding.

String `lastIndexOf` accepts only literal number/null/undefined positions; a
runtime position coercion is outside this typed overload. Omit the position or use a literal instead.

Conversions:
- `str(mixed $v): string` — `String(v)`. null → `"null"`, bools → `"true"/"false"`, numbers → `numStr`, list → elements `str`'d joined by `,` with null as `""`, assoc → `"[object Object]"`, `RegExp` → `/src/flags`.
- `numStr(int|float $n): string` — `Number.prototype.toString()`: `NaN`, `Infinity`, `-Infinity`, `-0` → `"0"`, integral values below 1e21 without exponent, shortest round-trip digits (including adjacent decimal candidates at binary rounding boundaries), exponent form `1e+21`, `1.5e-7` exactly where JS uses it (≥ 1e21 or < 1e-6).
- `toNumber(mixed $v): int|float` — `Number(v)`: null → 0, bool → 0/1, string trimmed of JS whitespace: `""` → 0, decimal, `0x`/`0o`/`0b` prefixes, `Infinity`/`-Infinity`, otherwise NAN. Safe integers (|n| ≤ 2^53) return int, larger values float.
- `n(int|float $r): int|float` — an int as a JS number: beyond ±2^53 it becomes the nearest double. Compiled `a + b`, `a - b`, `a * b` and unary `-a` on numbers are `add`/`sub`/`mul`/`neg`, which take each operand through `n()` and then the result; `++`/`--` are `preStep`/`postStep(&$x, ±1)` (the place is evaluated once), and `**`/`Math.pow` are `pow(a, b)`. So Zero ints never do exact arithmetic JS numbers can't, whether an operand is a literal, a computed value, or an exact int read from storage or input. Compiled `JSON.parse` (`jsonParse`) uses `decodeJson(string)`: integers past ±2^53 decode as the double a JS parser would produce. Stored values, ids and request bodies stay exact (identity and storage keys must not round): compiled code that passes such a value on unchanged (a lookup, a write, a return) passes the exact int; only the arithmetic it does sees the JS number. Comparisons (`<`, `===`) and `String(n)` of an untouched exact int past 2^53 still see the exact value, unlike JS; ids that large only come from storage, where the exact value is the right one.
- `Seam` owns conversions between compiled handles and schema-shaped runtime arrays: Db inputs/results, callback contexts, validators, generators, action/job inputs, Sync envelopes and ability inputs/outputs. User `json()` leaves remain handles in runtime rows. Write inputs detach them from compiled locals; each callback receives a fresh graph. Validator `value` aliases its full path in `ctx.data`; a before-hook's `data`/`patch` aliases `ctx.data` and is read back when no replacement is returned. Native `Extensions` callbacks keep array contracts. A string in a schema callback slot names compiled code; native callbacks use non-string callables.
- Objects enumerate canonical array-index keys in ascending order, then other keys in insertion order (`ownKeys`). Empty objects encode as `{}` and empty arrays as `[]`, including nested JSON and numeric-keyed objects.
- Arrays are dense: compiled reads use `dynamicGet` and return undefined for invalid/missing indexes. Native `get` returns null; `setAt` permits overwrite or append at length and throws `RangeError` otherwise. Fixed-length walks throw if they reach an index removed by their callback; live-length `from` and `for…of` allow shrinking and growing.
- `get`/`prop` and `setAt`/`set` throw catchable JS `TypeError` for a missing receiver. Writes evaluate their value first; read-modify-write operations read first.
- `has` snapshots property presence for arithmetic compounds and updates. `plus` implements `+=` primitive coercion with that snapshot, distinguishing a missing old value from present null.
- `parseInt(string $s, int|float|null $radix = null): int|float`, `parseFloat(string $s): int|float` — exact JS semantics, NAN when nothing parses.
- `truthy(mixed $v): bool` — null, false, 0, -0.0, NAN, `""` are falsy; every handle (even empty) is truthy.
- `typeOf(mixed $v): string` — `"object"` for null/handles, `"number"`, `"string"`, `"boolean"`, `"function"` for Closure.
- `strictEq(mixed $a, mixed $b): bool` — `===` for primitives: int/float compare numerically, NAN never equal; handles compare by identity.
- `isInteger(mixed $v): bool`, `isFinite(mixed $v): bool` (`Number.isInteger/isFinite`, no coercion).
- `toFixed(int|float $n, int $digits = 0): string` — JS `toFixed`.

Strings (indexes and lengths count UTF-16 code units like JS, so 🙂 is two; negative/float/out-of-range arguments handled exactly like JS):
- `slice(string $s, int|float $start = 0, int|float|null $end = null): string`
- `substring(string $s, int|float $start, int|float|null $end = null): string`
- `charAt(string $s, int|float $i): string`, `strAt(string $s, mixed $i = 0): string|JsUndefined`
- `indexOf(string|JsArray $s, mixed $needle, mixed $from = 0): int`, `lastIndexOf(string|JsArray $s, mixed $needle, mixed ...$fromArg): int` (lists too: both honor `fromIndex`; a given `null` is 0, an omitted `lastIndexOf` position searches from the end)
- `includes(string $s, string $needle): bool` is native (`str_contains`), not here.
- `split(string $s, string|RegExp $sep, int|float|null $limit = null): JsArray` (`""` separator → UTF-16 code units; splitting a pair throws)
- `padStart(string $s, int|float $len, string $fill = ' '): string`, `padEnd(...)`
- `trim(string $s): string`, `trimStart`, `trimEnd` (JS whitespace incl. Unicode spaces and line terminators)
- `replace(string $s, string|RegExp $pattern, string|callable $replacement): string` — string pattern replaces the first occurrence; RegExp replaces all with `g`, else first. String replacements support `$$`, `$&`, `` $` ``, `$'`, `$1`..`$99`, `$<name>`. A callable receives `(match, ...groups, offset, input)` like JS (no named-groups object).
- `replaceAll(string $s, string|RegExp $pattern, string|callable $replacement): string` (RegExp without `g` → throw `JsError` TypeError like JS)
- `repeat(string $s, int|float $n): string`
- `stringCompare(string $a, string $b): int` — -1/0/1 by UTF-16 code units, shared by typed and dynamic relational operators. `localeCompare` is refused; no host-dependent collation or byte-order substitute is exposed.
- `strIndex(string $s, int|float $i): string|JsUndefined` — numeric bracket access; fractional, negative and non-finite indexes name no character.
- `strMatch(string $s, RegExp $re): ?JsArray` — `String.prototype.match`: non-global → `[match, ...groups]` (unmatched groups undefined) or null; global → list of all matches or null.

Every runtime and emitted `mb_*` call passes explicit encodings; Zero never
depends on `mb_internal_encoding()`.

Computed object keys evaluate before their values; computed fields and map spreads
contribute to inferred map value types. Optional chains permit guarded steps and
single optional method calls. Non-optional continuations after a short-circuiting
link refuse at source; parenthesized chain boundaries retain ordinary access semantics.

Missing indexed/optional arguments retain undefined in call constraints.
Tuple destructuring widens later element/rest types after potentially effectful defaults,
including nested defaults that can change the original array. Inherited Object valueOf
method handles share identity across functions, arrays and other reference families;
scalar and Date valueOf retain their own prototype methods. Inherited Object toString
handles also share identity across Set, Map, Math and ordinary objects, while Error
uses its own prototype method. Borrowed Object toString reports the receiver tag.
Unregistered native-property reads refuse instead of fabricating undefined for
unimplemented JavaScript methods. Missing ordinary-object and arguments-object fields
remain undefined, and explicitly assigned array properties retain their values. Known absent native
length fields remain undefined for array-like conversion; function metadata still refuses.
Missing numeric array properties, including fractional, negative and NaN keys, remain undefined.

Typed object/record reads accept own data fields. If an absent field resolves to an
unmodeled Object prototype property, the read refuses before type-based optimizations
can consume it. Member/index reads, destructuring, method fields and assignment reads
share this boundary. Checked JavaScript retains inherited method lookup.

Template interpolation converts and snapshots each substitution before evaluating the next one.

RegExp:
- `re(string $source, string $flags): RegExp` — creates a fresh instance and translates the supported JS regex subset to UTF-aware, delimiter-safe PCRE. Accepts `g i m s u y`; `d` and `v` throw `JsError`.
- `dateJSON(int|float $ms): ?string` returns null for invalid dates and otherwise ISO text.
- `RegExp::test(string $s): bool`, readonly `source`, `flags`, `global`, `sticky`. `test` and checked `exec` share `execMatch`: global/sticky calls read and update UTF-16 `lastIndex`, reset it on failure, and keep it unchanged after an empty match. Literal evaluation creates fresh regex identity; a captured regex keeps its own instance. Sticky replacement is explicitly refused.
- Astral characters and surrogate escapes in regex patterns require the `u` flag, even for ASCII or BMP subjects. Lone-surrogate escapes in character classes are refused. Unicode-mode classes retain valid surrogate pairs and braced scalar escapes.
- Global regex dots, complemented shorthands (`\D`, `\W`, `\S`), character classes and lookarounds on text outside the Basic Multilingual Plane require the `u` flag; otherwise they throw `RangeError` before searching. These atoms can consume surrogate halves or distinguish them from UTF-8 stand-ins; code-point matches cannot supply correct UTF-16 boundaries or callback offsets.

Arrays (`JsArray`):
- `find(JsArray $a, callable $f): mixed`, `findLast`; `findIndex`/`findLastIndex`: int (undefined/-1 when absent).
- `some(JsArray $a, callable $f): bool`, `every(...)`: bool.
- Callbacks receive `(value, index, array)`; fixed-length walks read each value live and keep the value read before the callback.
- `filter(JsArray $a, callable $f): JsArray`, `map(...)`: JsArray, `forEach(...)`: JsUndefined.
- `includes(JsArray $a, mixed $v): bool` uses SameValueZero; `indexOf`/`lastIndexOf` use strict equality.
- `join(JsArray $a, string $sep = ','): string` (null elements → `""`; cyclic arrays render a revisited handle as `""`).
- `arrSlice(JsArray $a, int|float $start = 0, int|float|null $end = null): JsArray`, `arrAt(JsArray $a, int|float $i): mixed`.
- `splice(JsArray $a, int|float $start, int|float|null $deleteCount = null, mixed ...$items): JsArray`.
- `push(JsArray $a, mixed ...$items): int`, `unshift(...)`: int; `pop(JsArray $a): mixed`, `shift(...)`: mixed.
- `reverse(JsArray $a): JsArray`, `sort(JsArray $a, ?callable $cmp = null): JsArray`, `fill(JsArray $a, mixed $v, int|float $start = 0, int|float|null $end = null): JsArray` mutate the handle. Sort is stable; default comparison uses UTF-16 code units and refuses multiple object values. Custom comparators must be compiler-recognized numeric differences between the two parameters or matching property paths. The runtime sorts finite primitive keys; arbitrary or effectful comparator callbacks are refused before invocation.
- `sorted(JsArray $a, ?callable $cmp = null): JsArray` (`toSorted`), `toReversed(JsArray $a): JsArray`, `with(JsArray $a, int|float $index, mixed $value): JsArray` return new handles.
- `reduce(JsArray $a, callable $f, mixed ...$init): mixed` calls `(acc, value, index, array)`; empty without init throws `TypeError`.
- `flat(JsArray $a, int|float $depth = 1): JsArray` (typed calls accept depths 0 and 1, with null selecting 0 and undefined selecting 1), `flatMap(JsArray $a, callable $f): JsArray`; flatMap flattens each result before the next callback.
- `concat(JsArray $a, mixed ...$items): JsArray` reads receiver elements after evaluating every argument. Element inference preserves null and undefined, including nullable array operands.
- `from(JsArray|string $source, ?callable $f = null): JsArray` uses live iterator length; strings iterate code points. `range(int $n, callable $f): JsArray` is the fixed-count `{ length: n }` path, passing `(null, index)`.
- `max(int|float ...$n): int|float`, `min(...)` are JS Math helpers.

Objects (`JsObject`):
- `keys(JsObject $o): JsArray`, `values(...)`: JsArray, `entries(...)`: JsArray of JsArray pairs; `fromEntries(JsArray $entries): JsObject`.
- `obj(array ...$parts): JsObject` writes per key in source order; `omit(JsObject $o, array $keys): JsObject` implements object rest.
- `hasOwn(JsObject|JsArray $o, mixed $key): bool`; `key(mixed $key): string` coerces computed keys as JS does.
- `clone(mixed $v): mixed` independently copies objects, arrays, Set, Map and Date handles, preserving aliases and cycles; closures and arguments objects throw `DataCloneError`. Math namespace clones are plain empty objects, preserving repeated-reference aliases. Internal `detach` also copies arguments objects, while preserving closures, RegExp and namespace identity by reference for runtime ownership.

JSON:
- `jsonStringify(mixed $v, int|float|string|null $indent = null): ?string` — `JSON.stringify(v, null, indent)`: lists → arrays, assoc → objects, empty array → `[]`, NAN/INF → `null`, integral floats without `.0`, unescaped `/` and Unicode, `Closure` values omitted from objects and `null` in arrays, top-level Closure → null. Cycles throw `TypeError`; `jsonTree` provides the same value tree for foreign encoders. Indent number (clamped 10) or string, exactly as JS formats it.
- `jsonParse(string $s): mixed` — handles; invalid → `JsError` named `SyntaxError`.

Misc:
- `now(): int` — epoch ms. `date(mixed $v): int|float` — `new Date(v).getTime()`: number → itself, ISO/`YYYY-MM-DD` string → ms (date-only = UTC midnight, date-time without zone = UTC). Time requires a complete date and T separator; offsets require a colon. Invalid calendar components produce NAN; unsupported syntax throws RangeError. Like V8 it lets an in-range day overflow (`2021-02-30` → March 2) and takes hour 24 only as exact midnight; legacy/non-ISO syntax is refused explicitly (`10/30/2026` throws RangeError). Column writes don't rely on it for validation: the timestamp codec checks the calendar first. `iso(int|float $ms): string` — `toISOString()`, NAN → `JsError` RangeError.
- `uuid(): string` — RFC 4122 v4.
- `random(): float` — `[0, 1)`.
- `log(string $level, mixed ...$args): void` — `console.log`: args `str`'d (arrays/objects via jsonStringify) joined by a space, written to `error_log` with `[zero] ` prefix.

## TypeScript type normalization

Zero uses OXC 0.152.0 to parse TypeScript and keeps its annotations and source
locations in the typed IR. The native and browser/WASM compilers run the same
normalizer before PHP emission. These are type operations, not a JavaScript
engine or a replacement for TypeScript's complete checker. Check authoring
code with strict TypeScript as well as `zero check`.

| Surface | Support | Boundary |
|---|---|---|
| Interfaces | Supported for finite objects | Multiple `extends` bases, imported named types, generic arguments and inherited optional fields. Reachable merged declarations are refused. Class references use the separate nominal class dispatch described below; finite object operations do not model class prototype keys. |
| Class/type interoperability | Supported within the existing class subset | Local/imported class references retain identity through concrete aliases and object wrappers. Class fields, constructor parameter properties and method signatures can use the finite type operations in this table. PHP compilation preserves `undefined` identity, including reentrant class compilation; runtime `void` results are undefined. This does not add generic classes or class-prototype type introspection. |
| Intersections | Partial | Named finite objects merge recursively; compatible scalar/literal intersections narrow. Optional properties include implicit `undefined` in overlapping value domains under strict TypeScript without `exactOptionalPropertyTypes`; required presence does not remove that value. Conflicting optional domains still allow absence. Impossible object intersections and function/array intersections are refused. |
| Generic aliases/interfaces | Supported for concrete instantiations | Required arguments, scalar/array/finite-object structural constraints, defaults that reference earlier parameters, and nested applications. Constraint checks do not use PHP runtime conversions such as Date-to-number. Missing/extra arguments fail. PHP-reachable generic functions are refused, rather than compiling a signature widened to `unknown`. |
| `keyof` | Supported for finite objects | Literal string keys; object unions retain only common keys. Open maps, arrays, primitive/prototype keys, numeric property names and symbols are refused. |
| Indexed access types | Partial | String-key unions on finite objects, arrays (`T[]`, `Array<T>`, `ReadonlyArray<T>`) with `[number]`, tuple numeric literals/unions and tuple `[number]`. A key missing from any union member fails. Optional reads retain `undefined` at runtime. |
| Dynamic property reads | Supported for finite string keys | `object[key]` works when every possible key belongs to the fixed object. Arbitrary string keys need `Record<string, T>`. This does not add dynamic writes to fixed objects. |
| `Record<K, V>` | Partial | Finite string unions produce required fixed properties; `string` produces the existing open map. Numeric/symbol keys are refused. |
| `Partial`, `Required`, `Readonly` | Partial | Finite objects and unions of finite objects. `Required` removes optional presence and its `undefined`, retaining explicit `null`. Readonly is type-only; PHP handles retain their existing identity/mutation semantics. Open-map and array utility transforms are refused. |
| `Pick`, `Omit` | Partial | Finite objects and finite string key unions; object unions use their common keys, with combined value types and presence. `Pick` validates every key. They do not distribute across object unions. |
| `NonNullable` | Partial | Concrete types; removes both `null` and `undefined` before PHP normalization. `unknown` and `void` are refused. |
| `Extract`, `Exclude`, conditional types | Partial | Concrete scalar, array/tuple and finite object comparisons, including structural object matching. Direct naked bound parameters distribute over unions (including boolean); tuple-wrapped checks do not. Check positions must be direct parameters, scalars or object/array/tuple wrappers; aliases and other type operations in check position need an explicit tuple wrapper, because they can change distributivity before instantiation. `null` and `undefined` remain distinct until the PHP boundary. `infer`, unresolved `unknown`, `void`, function/runtime predicates and boxed primitive/array property matching are refused. |
| Mapped types | Partial | Finite string key domains; optional modifiers and homomorphic identity mappings preserve presence. `-?` requires a homomorphic identity mapping. Homomorphic mappings need one finite object; key parameters constrained by a direct `keyof T` preserve presence too. Fresh key sets use literal unions (optionally including `never`), or direct parameters constrained by `string` or literal unions. Aliased or reduced key expressions and constraints, such as `Keys<T>`, `Identity<K>`, `keyof T \| never` and `K \| never`, are refused: their reductions can hide optional presence. Rewrite them as direct `keyof T` or a direct key parameter constrained by `keyof T`. Key remapping, template literal expansion, symbols and open maps are refused. |
| `ReturnType`, `Parameters` | Partial | Concrete function type annotations with required parameters. Generic, optional/rest parameter and overloaded function type transforms are refused. General `typeof` queries remain limited to the existing schema inference operations. |
| `Awaited` | Partial | Nested `Promise` wrappers ending in concrete scalar/array values. Thenable-object, union and `unknown` normalization are refused. |
| Modules | Existing subset | Direct named type imports from relative TS modules, with arguments resolved in the caller's module and bodies/defaults in the declaration's module. Package source resolution is documented separately in config-api.md; this type-algebra contract does not add namespace-import, type re-export/barrel or module-augmentation support. |

Normalization is bounded: 96 nested annotation levels, 16,384 resolution steps
per root annotation (including independent roots reached during class
compilation), and 512 keys per finite key operation. Intersection distribution
checks a maximum of 512 candidate alternatives before expansion; this conservative
limit applies before incompatible or duplicate alternatives are removed. Its
recursive calls, copied type nodes and object-property merges also consume the root resolution
budget. Recursive types produce a located diagnostic. Unsupported types are not replaced with
`unknown` or an unrestricted string key.

JSON `$type` annotations retain the authored domain through `InferSelectModel`
and `InferInsertModel`, including nested JSON columns. Authored model expansion
retains finite enums/locales, finite translation maps, structured write presence,
and distinct fresh-row/translation insert alternatives. Runtime insert
approximations remain separate; query rows retain their finite schema domains.
Their dependencies resolve
independently of registry order. Recursive model dependencies and chains exceeding
96 JSON annotations receive located refusals. Copying inferred model fields and
cached JSON types also consumes the root's 16,384-step work budget, before cloning.
PHP compilation and generated backend query types retain the authored
null/undefined domain after model expansion. Public client types apply JSON
serialization rules after that expansion.

The executable [strict fixture](../tests/fixtures/type-semantics/zero.config.ts)
imports its generic interfaces from a separate module. Its `typeReport` action
with input `{"entry":{"id":7,"title":"Hello","state":"draft","active":true}}`
emits this PHP/JSON result:

```json
{"finiteChecks":[[false,false],[false,false],[false,true],[false,true],[false,true],[false,true],[false,false]],"finiteIdentity":true,"finiteCaptured":true,"pureFinite":[[false,false],[false,false],[false,true],[false,true],[false,true],[false,true],[false,false]],"scalarTypes":["8","HELLO","true","false","other"],"scalarFalseBranches":["6","hello","absent"],"guardedLabels":["found"],"guardedFind":"found","guardedBranch":"found","predicateMap":[false,true],"booleanFilter":["0","value"],"tupleLabels":["Left:L","Right:R"],"arrayPresence":{"tags":["present"]},"classView":{"entry":{"id":7,"title":"Hello","state":"draft","active":true},"label":"draft"},"labels":{},"intersected":{},"optionalConflict":{},"optionalSnapshot":{},"snapshot":{"id":7,"note":null},"flags":{"ready":true,"visible":true},"state":"draft","tag":{"kind":"draft"},"together":"mixed","value":"Hello","pair":7,"element":"value","key":"common","payload":"present","awaited":"done","returned":null,"args":[1,"one"],"undefinedType":"undefined","nullType":"null","booleans":["yes","no"],"collapsed":"broad","weak":"no","requiredUndefined":{"label":"present"}}
```

The fixture also imports a derived class with public constructor parameter
properties typed through `Projection`, a `Required` snapshot result, and an
`undefined` field and `void` method. Its class reference is nested in a generic
object alias before construction; this exercises class compilation reached
from type normalization. The generated client exposes `classView.missing?: never`
and `classView.label: "draft"`, and omits class methods at the JSON boundary.

It also captures `{ note: undefined }` under
`{ note?: string } & { note: string | undefined }`. The authored property remains required with `note: string | undefined`,
including after `Required`. JSON omits an undefined value, so the public client
uses `note?: string`. In contrast, `Required<{ label?: string | undefined }>`
removes optional undefined and keeps `label: string`. Direct mapped labels
retain optional presence and return `{}`. Conflicting optional intersections
also accept `{}` and admit only undefined when present.

The generated output type retains `state: "draft"`, `key: "common"`,
`snapshot: { id: number; note: string | null }`, and `missing: string | null | undefined`.
The [client fixture](../tests/fixtures/type-semantics/client.ts) checks both
accepted uses and rejected non-null/literal assumptions with strict TypeScript.
JSON input annotations retain their existing compile-time role; this change
does not add shape validation at the HTTP boundary or change the client's
existing `unknown` JSON input type.

The `languageTypes` action in the existing
[Node↔PHP oracle](../tests/differential/cases.ts) owns runtime results. It runs
through the emitted plugin on real WordPress using its SQLite Database
Integration plugin. The site's existing compiler tests own native/WASM output
and diagnostic parity plus strict generated-client checking. The
[compatibility inventory](language-support.md) records executable refusals.

The matching maintained `oxc_semantic`, `oxc_ast_visit` and `oxc_transformer`
0.152.0 crates were evaluated against Rust 1.96; all are MIT. Semantic analysis
provides scopes/references, not TypeScript type assignability or normalization;
the visitor supplies AST traversal; the TypeScript transform strips annotations
for JavaScript output. This change adds no scope walker or parser and keeps the
annotations needed for PHP and client emission, so it does not add those
crates. Existing OXC parsing/lowering is reused. No upstream implementation was
copied, no new license notice is needed, and the OXC family remains pinned
together at 0.152.0.

This type-algebra work adds no JS built-in API. Arbitrary browser/Node APIs,
symbols, generators and dynamic runtime type introspection remain outside the
supported runtime. Package source resolution has its own [import contract](config-api.md). Runtime values preserve null and undefined separately; supported Unicode string
semantics remain bounded by the contract above. Class behavior has its own implementation contract.

## Identity password verification inventory

Normal requests provision a fixed current-algorithm dummy hash and enqueue a
one-minute WordPress cron event; they never enumerate user password hashes.
Each background invocation reads at most 1,000 users in ascending `ID` order. An
option row locked within the database transaction serializes workers. The
profile map and cursor commit together without publishing uncommitted values to
the shared option cache, so an interrupted page is retried from
the previous committed cursor. Password-write hooks merge profiles under the
same profile-map row lock. Stored profiles contain independent random-password
hashes, never copies of user credentials.

Before the inventory completes, password sign-in verifies the fixed current
hash plus the user's own hash (or the fixed hash again for an absent user).
This keeps login available and prevents an absent account from skipping costly
verification. Legacy algorithm costs can differ during this initial inventory.
Once complete, every attempt verifies the full stored algorithm/cost schedule,
substituting the user's hash in its matching slot. Retaining all profiles gives
matching verification costs across heterogeneous legacy accounts; checking only
the most expensive legacy profile would not give that property. Sites disabling
WP-Cron must run the scheduled event through their external cron or WP-CLI.

Identity password sign-in accepts encodings whose algorithm/cost can be
reproduced with independent verification material. Unsupported pluggable or
malformed encodings fail with the same generic refusal after the shared dummy
schedule; they cannot replace a costly dummy with a fast rejection. Such users
must reset their password to a supported WordPress encoding to use Identity
password sign-in. Core WordPress authentication remains owned by WordPress.
The [operational password ceilings](identity-security.md#password-verification-budgets)
also apply to imports, both login schedules, and previously stored profiles.
They cover plain bcrypt and WordPress's `$wp$2y$` SHA-384-prefixed format,
phpass, SHA-crypt, and PHP Argon2. Over-budget profiles are never generated or
verified; supported profiles remain even when their last user upgrades.

Legacy importers can detect the registration capability with
`is_callable([\Zero\Identity\Accounts::class, 'rememberPasswordHash'])` and call
`\Zero\Identity\Accounts::rememberPasswordHash(string $hash): void` after a raw
user import. The `zero_identity_password_profiles` option remains an associative
map from algorithm/cost profile keys to independent random-password hash strings.
Registration merges into that map using the importer's existing database
transaction. Importers must include the option in their rollback cache cleanup.
The initial inventory's background scheduling does not replace registration for
imports performed after inventory completion.
