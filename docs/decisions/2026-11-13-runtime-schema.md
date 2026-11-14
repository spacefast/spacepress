# Runtime schema changes, stored as numbered versions

Date: 2026-11-13. This reverses one line of `docs/spec/index.md` ("Not taken" from EmDash: "DB as
schema source, runtime DDL") for the content side only. The owner asked for runtime schema changes
with a versioning system and left the design open. This record says what was measured, what is
built, and what is refused because it cannot be made safe yet.

## The ruling

A project that sets `runtimeSchema: true` in `defineConfig` lets an editor or an agent change the
site's content schema while it runs. Each accepted change is an append-only numbered version in the
site's database. No build runs, no SQL DDL runs, and nothing compiles at request time. `first pull`
writes the site's versions into the project as a committed lock that `first build` reads, so git and
the site hold the same schema again. With the flag off, nothing below exists and behaviour is today's.

The compiled build stays the source of truth for everything that is code. The database is the source
of truth only for the additions made since the last build that contains them.

## What was checked on main

- `first/app/schema.php` is one PHP array, loaded by `First\Schema::load()` from `Wp/Runtime.php`;
  a build-store mount loads it once more, earlier, in `first-loader.php`, to decide whether to load
  identity. `Plugin` registers post types, post meta and the Secure Custom Fields groups from that
  array on `init` and `acf/init`, so a schema that differs from the compiled one by added array
  entries registers the same way. Two other readers take the file as bytes, not as a schema:
  `Plugin` hashes it to tell whether storage is current, and the app's uninstall script reads its
  name and post types.
- A `collection()` field is post meta with a local SCF field. Adding one needs no DDL. A `table()`
  field is a SQL column changed only by a generated migration, checked against live rows by
  `Wp/SchemaCheck.php`.
- Every schema rule is in the compiler, mostly in `src/eval.rs` (builders and modifiers) and
  `src/extract.rs` (kinds and fields), with a few in `src/pipeline/exports.rs` (one name for two
  things, `F1221`) and `src/kind_url.rs`. PHP has none. The codes are coarse: `F3001` for almost
  every schema rule, `F2001` for any error while the config evaluates (a modifier that does not fit
  its builder among them), `F3101` for `.ui()`.
- Builds in the store are immutable and one site can serve several of them, each on its own URL
  (`2026-11-07-build-store.md`). A runtime change is therefore site-wide state that every mounted
  build must be able to load, not state of one build.
- The compiler records what a plugin package's code uses (`plugins::Use`): reads per kind, writes
  per field. For the app's own code it records nothing per field or per kind.
- `taxonomy()` is on main as a build-only kind (docs/decisions/2026-11-11-authoring-surface.md,
  rulings 24-33): a runtime schema change to a taxonomy is deferred.

## Scope

Runtime changes cover what is data in WordPress: fields on `collection()` kinds, new collections,
globals, labels and editor presentation. Taxonomies stay build-only until their own slice. `table()` kinds, hooks,
actions, jobs, pages, routes, file buckets, and any field option that is a function (`.validate()`,
function access rules, function defaults) stay build-only. A change that needs one of them is
refused, and the refusal names the source edit to make.

## Storage and loading

**Measured** (`docs/spikes/runtime-schema-load.php`, `runtime-schema-request.php`; results in
`docs/benchmarks/runtime-schema.json`, where each figure is already a median: of 7 rounds of 500
loads for the load spike, of every timed request of a loader for the request spike). PHP 8.5.10,
WordPress 7.1.4 on SQLite, on a shared 24-core host.

Loader alone, microseconds per load, compiled `schema.php` of 38,610 bytes, opcache on. Each range
is the lowest and highest median over three runs (two for 450 fields):

| Added fields (stored bytes) | `require schema.php` | generated merged file | whole merged schema, unserialized | compiled + added fields, unserialized |
|---|---|---|---|---|
| 1 (193) | 0.07 | 0.06–0.07 | 33.8–44.7 | 0.68–0.79 |
| 20 (2,900) | 0.06–0.07 | 0.07 | 34.2–52.2 | 6.5–7.0 |
| 200 (28,778) | 0.07 | 0.07 | 94.0–117.1 | 62.7–69.1 |
| 450 (64,828) | 0.04–0.07 | 0.04–0.07 | 154.5–197.5 | 110.4–131.3 |

Inside a real request (`GET /__first/api/v1/posts?limit=10`, 150 requests per loader, loaders
alternated round by round), two runs at load averages 9 to 17: the compiled file costs 0.6–0.8 µs;
an autoloaded pointer option plus a generated file 6.2–10.9 µs at any size; an autoloaded option
holding the added fields 13.2–17.8 µs for 1 field, 19.7–26.5 µs for 20 and 61.0–69.6 µs for 200.
A third run at load 33 to 47, with 450 fields added, gave 2.1 µs for the compiled file, 25.7–30.3 µs
for the generated file and 55.1, 82.0, 216.9 and 362.0 µs for the option at 1, 20, 200 and 450
fields. The median whole request was 149.2–185.9 ms in the first two runs and 372.4–432.7 ms in
the third, and within one run configurations differ by up to 26.1 ms and 60.3 ms, in no order that
follows the loader. So the request totals show only that no loader is visible at that scale: the
largest loader cost in each run is 69.6 µs against a 26.1 ms spread (375 times smaller) and 362.0
µs against 60.3 ms (167 times smaller). The harness has no persistent object cache, so that was
not measured; it holds the same serialized value an option does.

**Chosen: one autoloaded option.** `first_<app>_runtime_schema` holds the active version number and
its resolved additions. WordPress loads autoloaded options in the query it already runs, so the
request adds no query: it unserializes the value and adds the entries to the compiled array, one
array union per touched kind. At normal load that is 13.2–69.6 µs for 1 to 200 fields, which is
69.6 µs ÷ 149.2 ms = 0.047% of the cheapest measured request. It is not zero, and spec principle 3 is
kept in its stated sense: a lookup, no compile, no validation, no diffing.

The generated file is 7–59 µs faster at normal load (option minus file, per run and size: 6.9,
18.9, 59.3 and 6.8, 12.6, 54.8 µs) and was not chosen. It needs a directory that PHP both writes
and executes: the build store is immutable and owned by the host, plugin directories are deploy
output (First turns off the file editors and plugin installs, and a deploy replaces the directory),
and requiring PHP from the uploads directory turns any file-write bug into code execution. On more
than one web node the file would have to reach every node before the pointer moves; the option is
replicated by the database with the version rows.

The option is bounded: a change that would take the serialized value past 65,536 bytes is refused.
The 450-field row above is that size. WordPress stops autoloading an option of more than 150,000
bytes when the caller doesn't say whether to autoload it; First always says so. The option never
shrinks: an addition stays in it while any build may lack it, and the site can't know which builds a
host still serves. Past the bound, a further change is made in source and deployed; what the option
holds keeps working.

**Compiled entries win.** The union never replaces something a build declares. A build made after
`first pull` declares the pulled fields itself, and the option's copies of them do nothing. A build
without them still gets them from the option. An older build selected again by the host behaves the
same way. Only label and presentation overrides replace compiled values, and those are limited to
keys that are never part of storage, validation or authorization (`label`, `ui`). A removal hides a
name from a build that declares it only where that build's own references index allows it
(below), so each live build decides for itself.

**Several live builds.** One site can serve several builds at once, and a change is validated on
the build of the request that makes it. So the site also keeps, in a second option, the stored type
of every field any build that initialized on the site declared. A change that would give one of
those names another stored type is refused, whichever build the request runs. A build that does not
set `runtimeSchema`, or a runtime that reads another format, serves its compiled schema: the
additions are invisible there and their stored values stay.

**Versions** live in one system table, `first__schema_versions`, created only for apps with the
flag: app, version, parent, the hash of the build the change was validated on, actor (user id and
login, and for an application password its UUID and name, never the secret), time, the change set,
and a hash that chains each version to its parent. Rows are never updated or deleted. The primary
key is (app, version).

**Concurrency.** Apply names the version it was validated against. Under the named lock a deploy
holds while it migrates (`first_<app>_schema`), it checks that the build its request loaded is still
the one on disk (otherwise 409 `schema_build_changed`), that its parent is still the newest version,
and, in one transaction, inserts
version + 1 and writes the option. A second apply on the same parent gets 409 `schema_conflict` and
must propose again. The primary key refuses a duplicate even if the lock is lost. The table is the
record: when the option is missing, behind, or in another format, apply rebuilds it from the rows
first. Under a persistent object cache WordPress keeps autoloaded options in one cached array that
any `update_option` call rewrites, so a concurrent write of another plugin's option can put an
older copy of this one back, as it can for any autoloaded option; requests then serve the older
version until the next apply rewrites it.

**Trust.** The table's hash chain is checked whenever the versions are read; a broken chain stops
further changes and leaves the site serving the last state that checked out. Apply seals the option
it writes, and the loader serves a sealed option only, and only as the operations a change can make:
added kinds are rebuilt from their stored definitions and fields are re-checked, so whoever can
write options can't give a kind access rules or code. A table() is build-only, label included.

**Rollback** is a new version whose change set reverses an earlier one. **Removing** a field or kind
hides it: it leaves the active schema, and its posts, post meta and options stay where they are. A
hidden name can be added again only with the same stored type, so old values always decode, and a
build that declares a hidden name with another type is refused at deploy.

## Stored format

A version's change set and the lock are JSON with `"format": 1`. Field definitions use the compiled
vocabulary, the column array `schema.php` holds on main today (`type`, `notNull`, `rules`, `enum`,
`default`, `ui`, …), not the authoring builders, because the authoring surface is being rewritten
and the compiled array is what the runtime executes. That vocabulary names compiled functions
(`default.fn`, `rules.validate`, an access `fn`); a stored definition may hold none of them, and the
validator refuses each by key. A state in a format this runtime does not know is not read: the
request serves the compiled schema and reports why. A later slice that changes the shape raises
the number.

## Validation

PHP gets a validator for exactly the runtime subset. It is held to the compiler by a shared corpus
of valid and invalid changes (`tests/runtime-schema/`), run on both sides in CI:

- PHP side: the validator's verdict and code for each case.
- Compiler side: the case's base project plus the change written as a lock, through `first check`.
  The compiler turns each lock field into the builder call an author would write and evaluates it,
  so lock fields go through the same `eval.rs` and `extract.rs` rules as authored ones. There is no
  second rule set in Rust.

For every case the verdicts must match, a refusal must carry the same diagnostic code, and an
accepted field must compile to exactly the stored definition. That last check is what makes "build
after pull leaves nothing in the overlay" true. A later authoring change that alters a rule fails
this suite until the PHP validator follows.

The runtime subset is narrower than the compiler's on purpose:

- A field added to an existing collection is optional or has a default. Compiled code that creates
  rows cannot know the field, and existing rows have no value for it. (A new collection's own
  fields may be required: no row of it exists yet.)
- A field may not be named `title`, `content` or `slug`, and may not be a `slug`, `file` or
  reference field. The compiler gives those names and types a role (the post's title, body or slug
  column, a relation), so the same field would be stored elsewhere once a build declared it.
- Names every kind has or will have under spec §2.4 (`author`, `createdAt`, `updatedAt`, `url`,
  `terms`, `uid`, `locale`, `translations`) are not available.
- Fields of a translated or synced collection are build-only for now: their copy and translate
  rules are in the build's `wpml-config.xml`, and synced fields come from files in the project.

Refusals that are not compiler rules have their own problem codes, among them `schema_build_only`
(names the source edit), `schema_in_use` (compiled code or a build declares it),
`schema_required`, `schema_reserved`, `schema_retype` and `schema_conflict` (409).

## Compiled code

Compiled code cannot name a field it never saw, but it can still meet one in a row:

- A `beforeCreate` or `beforeUpdate` hook that returns a replacement object would drop a runtime
  field the caller sent. The write path carries the runtime fields around those hooks: a hook sees
  only the build's fields and its result gets the runtime ones back.
- Every other row compiled code receives carries the runtime fields too. Code that copies a whole
  row into another kind's `create` is refused with "Unknown field" for a runtime field the other
  kind lacks; list the fields instead.

Changing or removing something a build declares can break compiled code.

**What cannot be made safe today:** retyping, renaming or removing a field or kind that a build
declares in source. The compiler has no per-field record of what compiled hooks, actions, jobs and
pages read, and compiled PHP uses native operators where the build-time type allowed it. The
compiler itself refuses a rename on a collection (`.was()` is for tables). These are refused at
runtime, always, with the source edit to make.

**What is built instead:** the build writes `first/app/references.php`, read only when a change is
proposed or the site has removed something. It lists every field and kind name that occurs as a
word in a source file the build loaded: the project's own and every plugin package it imports. A
field the build declares may be hidden at runtime only when it is optional and its name occurs
nowhere; a kind, only when its name occurs nowhere. Code that reads a row by a key computed at run
time reads "no value" from a hidden field, which an optional field's type already allows. The index
errs toward refusing: a name used anywhere counts as a use of every field with that name.

To remove a field that moved into source: delete it from source and from the lock, build and
deploy, then remove it at runtime (or roll back the version that added it).

## Git

`first pull` reads `GET /__first/api/v1/schema-versions/lock` (administrators only) and writes
`first/_generated/runtime-schema.json`: the format number, the site's version number and chain hash,
and the resolved state of the newest version (fields added to declared kinds, kinds added, labels and
presentation), not the change sets. `first build` reads it, declares those fields and kinds as if they
were authored, and records the version and hash in `schema.php`. A project deployed to two sites
pulls one of them; the other's changes stay active there and its deploy check lists them.

A JSON lock, not generated TypeScript, because:

- Fields added to a kind the author declared would need that declaration to import and spread the
  generated module: a source edit per kind, or a new authoring form while that surface is changing.
- The lock uses the stored field format, so pull writes what the site already validated, and the
  compiler checks it again when the project builds.
- It holds data only; the compiler builds every field it lists through the same builders an author
  calls, so a key that names a compiled function has no builder and is refused.

To move a field into source, declare it there with the same definition; the lock entry is then
satisfied and the next pull drops it.

**Deploy.** The deploy-time check compares the build with the site's newest version. Runtime changes
the build does not contain are reported by name (`wp first migrate` lists them) and stay active;
nothing is dropped. The deploy is refused before any table changes when the build declares a name
with another stored type than the site's active version or a hidden name has, and the refusal names
both types and the fix.

## Surfaces

- Abilities `<app>/schema-read`, `<app>/schema-propose` (validates, returns the diff and effects,
  writes nothing) and `<app>/schema-apply`. Reading and proposing need `manage_options`. Apply needs
  its own capability, `first_apply_schema`. The administrator role is given it once (an option
  records that it was), so removing it with `wp cap remove` holds. The option
  `first_<app>_schema_apply_denied` denies a user one application password (and any password it
  creates), all of their application passwords, or every First Identity access token they are
  issued (`bearer`): an access token has no id of its own to name, so it is denied by kind. A user
  without the capability, or signed in a denied way, can read and propose but not apply.
- Site command `first schema list | diff | apply | rollback`: one row in `commands.json`.
- `GET /__first/api/v1` describes the active schema and its version; `first pull` regenerates the
  typed client's types from it.
- A wp-admin screen that lists versions with their diffs.

A field or kind added at runtime is registered by the same code from the same array as a compiled
one, so whatever protects First's generated field groups, post types and meta from edits in
wp-admin or over core REST protects these too.

## Delivered in slices

1. This record and the spec edits.
2. The flag, version store, loader, PHP validator, the compiler reading the lock, the corpus: adding
   fields to an existing collection.
3. New collections and globals, labels and presentation, removal and rollback. Runtime changes to
   taxonomies (`taxonomy()` is on main, build-only) are a later slice.
4. `first pull`, the references index, the deploy-time report and refusal.
5. Abilities, commands, the admin screen.

## Not done by this design

- Runtime changes to `table()` kinds, and reference fields (a `ref().many()` gets a join table).
  They need DDL and the live-row check, which run at deploy.
- Retype, rename or removal of anything declared in source (above).
- A per-field use index precise enough to allow those. It needs the compiler to track row fields
  through types; the name-based index is the safe subset of it.
