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

- `first/app/schema.php` is one PHP array, loaded once per request by `First\Schema::load()`
  (`Wp/Runtime.php`, or `first-loader.php` for a build-store mount). `Plugin` registers post types,
  post meta and the Secure Custom Fields groups from that array on `init` and `acf/init`. Nothing
  else reads the file, so a schema that differs from the compiled one by added array entries
  registers the same way.
- A `collection()` field is post meta with a local SCF field. Adding one needs no DDL. A `table()`
  field is a SQL column changed only by a generated migration, checked against live rows by
  `Wp/SchemaCheck.php`.
- Every schema rule is in the compiler: builder rules in `src/eval.rs`, schema rules in
  `src/extract.rs`. PHP has none. Their diagnostic codes are coarse: `F3001` for almost every schema
  rule, `F2001` for a modifier that does not fit its builder, `F3101` for `.ui()`.
- Builds in the store are immutable and one site can serve several of them, each on its own URL
  (`2026-11-07-build-store.md`). A runtime change is therefore site-wide state that every mounted
  build must be able to load, not state of one build.
- The compiler records which kinds a plugin's code reads and writes (`plugins::Use`), per kind. It
  records nothing per field, for any code.
- `taxonomy()` is not on main yet. Globals and collections are.

## Scope

Runtime changes cover what is data in WordPress: fields on `collection()` kinds, new collections,
globals, taxonomies once `taxonomy()` lands, labels and editor presentation. `table()` kinds, hooks,
actions, jobs, pages, routes, file buckets, and any field option that is a function (`.validate()`,
function access rules, function defaults) stay build-only. A change that needs one of them is
refused, and the refusal names the source edit to make.

## Storage and loading

**Measured** (`docs/spikes/runtime-schema-load.php`, `runtime-schema-request.php`; raw samples in
`docs/benchmarks/runtime-schema.json`). PHP 8.5.10, WordPress 7.1.4 on SQLite, a shared 24-core
host with load 9 to 17.

Loader alone, microseconds per load, compiled `schema.php` of 38,610 bytes, opcache on, two runs:

| Added fields | `require schema.php` | generated merged file | whole merged schema, unserialized | compiled + added fields, unserialized |
|---|---|---|---|---|
| 1 | 0.04–0.07 | 0.04–0.07 | 21–44 | 0.45–0.69 |
| 20 | 0.04–0.07 | 0.04–0.07 | 24–50 | 3.8–6.9 |
| 200 | 0.04–0.07 | 0.04–0.07 | 56–117 | 35–69 |

Inside a real request (`GET /__first/api/v1/posts?limit=10`, 150 requests per loader, two runs,
loaders alternated): the compiled file costs 0.6–0.8 µs; an autoloaded pointer option plus a
generated file costs 6–11 µs at any size; an autoloaded option holding the added fields costs
13–18 µs for 1 field, 20–26 µs for 20 and 61–70 µs for 200. The median whole request took 149–186 ms
across configurations, in no order that follows the loader: configurations in one run differ by up
to 26 ms on this host, several hundred times the largest loader cost, so the request totals show
only that no loader is visible at that scale. The harness has no persistent object cache, so that
option was not measured separately; it stores the same serialized value an option does.

**Chosen: one autoloaded option.** `first_<app>_runtime_schema` holds the active version number and
its resolved additions. WordPress loads autoloaded options in the query it already runs, so the
request adds no query: it unserializes the value and adds the entries to the compiled array, one
array union per touched kind. That is 13–70 µs, under 0.05% of the measured request. It is not zero,
and spec principle 3 is kept in its stated sense: a lookup, no compile, no validation, no diffing.

The generated file is 10–60 µs faster and was not chosen. It needs a directory that PHP both writes
and executes: the build store is immutable and owned by the host, plugin directories are deploy
output (First turns off the file editors and plugin installs, and a deploy replaces the directory),
and requiring PHP from the uploads directory turns any file-write bug into code execution. On more than one web node the file would have to reach every
node before the pointer moves; the option is replicated by the database with the version rows.

The option is bounded: a change that would take the resolved value past 64 KB is refused with the
fix (`first pull`, build, deploy), which is well under the 150,000 bytes at which WordPress flags an
autoloaded option.

**Compiled entries win.** The union never replaces something a build declares. A build made after
`first pull` declares the pulled fields itself, and the option's copies of them do nothing. A build
without them still gets them from the option. An older build selected again by the host behaves the
same way. So the option needs no knowledge of which builds are live. Only label and presentation
overrides replace compiled values, and those are limited to keys that are never part of storage,
validation or authorization (`label`, `ui`).

**Versions** live in one system table, `first__schema_versions`, created only for apps with the
flag: app, version, parent, the hash of the build the change was validated on, actor (user id and
login, and for an application password its UUID and name, never the secret), time, the change set,
and a hash that chains each version to its parent. Rows are never updated or deleted. The primary
key is (app, version).

**Concurrency.** Apply names the version it was validated against. Under the same named lock
migrations use, it checks that this is still the active version, inserts version + 1 and writes the
option. A second apply on the same parent gets 409 `schema_conflict` and must propose again. The
primary key refuses a duplicate even if the lock is lost.

**Rollback** is a new version whose change set reverses an earlier one. **Removing** a field or kind
hides it: it leaves the active schema, and its posts and post meta stay where they are. A hidden
name can be added again only with the same stored type, so old values always decode.

## Stored format

A version's change set and the lock are JSON with `"format": 1`. Field definitions use the compiled
vocabulary, the column array `schema.php` holds on main today (`type`, `notNull`, `rules`, `enum`,
`default`, `ui`, …), not the authoring builders, because the authoring surface is being rewritten
and the compiled array is what the runtime executes. A format the runtime does not know is refused
on read; a later slice that changes the shape raises the number.

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

The runtime subset is narrower than the compiler's in one place, on purpose: an added field must be
optional or have a default. Compiled code that creates rows cannot know the field, and existing
rows have no value for it.

Refusals that are not compiler rules have their own problem codes: `schema_build_only` (names the
source edit), `schema_in_use` (compiled code or a build declares it), `schema_conflict` (409).

## Compiled code

Adding can't break compiled code, because that code cannot name what it never saw. Changing or
removing something a build declares can.

**What cannot be made safe today:** retyping, renaming or removing a field or kind that a build
declares in source. The compiler has no per-field record of what compiled hooks, actions, jobs and
pages read, and compiled PHP uses native operators where the build-time type allowed it. The
compiler itself refuses a rename on a collection (`.was()` is for tables). These are refused at
runtime, always, with the source edit to make.

**What is built instead:** the build writes `first/app/references.php`, read only when a change is
proposed. It lists every property name compiled code mentions and whether any code reads a row by a
computed key. A field that entered a build through the lock may be hidden at runtime only when it
is optional and the index shows no possible use. The index errs toward refusing: a name used
anywhere counts as a use of every field with that name.

## Git

`first pull` writes `first/_generated/runtime-schema.json`: the format number, the site's version
number and chain hash, and the resolved additions. `first build` reads it, declares those fields
and kinds as if they were authored, and records the version and hash in `schema.php`.

A JSON lock, not generated TypeScript, because:

- Fields added to a kind the author declared would need that declaration to import and spread the
  generated module: a source edit per kind, or a new authoring form while that surface is changing.
- The lock is the stored change-set format, so pull is a copy and a hash check.
- JSON cannot hold a function, so the data-only boundary is the file format.

To move a field into source, declare it there with the same definition; the lock entry is then
satisfied and the next pull drops it.

**Deploy.** The deploy-time check compares the build's recorded version and hash with the site's.
Versions the build does not contain are reported by name and stay active; nothing is dropped. The
deploy is refused only when the build declares a name the site's active version also declares with
a different stored type, and the refusal names both and the fix.

## Surfaces

- Abilities `<app>/schema-read`, `<app>/schema-propose` (validates, returns the diff and effects,
  writes nothing) and `<app>/schema-apply`. Apply needs its own capability, `first_apply_schema`,
  which administrators hold; a user without it, or an application password an administrator has
  denied, can read and propose but not apply.
- Site commands `first schema list | diff | apply | rollback`, one row each in `commands.json`.
- `GET /__first/api/v1` describes the active schema and its version; `first pull` regenerates the
  typed client's types from it.
- A wp-admin screen that lists versions with their diffs.

The rule another lane is adding, that First's generated field groups, post types, taxonomies and
meta cannot be edited in wp-admin or over core REST, covers runtime-added ones too: they are
registered by the same code from the same array. This path is the one way to change them.

## Delivered in slices

1. This record and the spec edits.
2. The flag, version store, loader, PHP validator, the compiler reading the lock, the corpus: adding
   fields to an existing collection.
3. New collections and globals, labels and presentation; taxonomies when `taxonomy()` is on main.
4. `first pull`, the references index, the deploy-time report and refusal.
5. Abilities, commands, the admin screen.

## Not done by this design

- Runtime changes to `table()` kinds. They need DDL and the live-row check, which run at deploy.
- Retype, rename or removal of anything declared in source (above).
- A per-field use index precise enough to allow those. It needs the compiler to track row fields
  through types; the name-based index is the safe subset of it.
