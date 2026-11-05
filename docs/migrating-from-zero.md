# Migrating from Zero 0.8

This guide moves a WordPress site built with the original `@spacefast/zero`
0.8 (`capsule()` collections) onto the new Zero: the same posts, ids, fields,
media, revisions and authors, now served by the `zero-app-<name>` plugin at
`/wp-json/zero/v1`.

It takes two commands. `zero migrate config` turns the capsule into a
`zero.config.ts`, and `zero migrate site` moves the content in place. Both
refuse anything they can't carry and name the exact spot, so nothing is
silently dropped.

## Application source migration

For a capsule with application tables and handlers, use the app migrator:

```sh
zero migrate app --from zero-0.8 ./old-app --out ./migrated-app --space spc_example --dry-run --json
zero migrate app --from zero-0.8 ./old-app --out ./migrated-app --space spc_example
zero check ./migrated-app
```

The input may be a Spacefast 0.8 project root with `sf.jsonc`, `server/index.ts`
and `content/`. It must contain `server/index.ts`. Local TypeScript helper
imports are copied without running them. The destination must be new, including
for a dry run. Both forms print JSON, and both compile the generated app before
reporting success. `--json` is accepted for callers that set it explicitly.
Exit codes are 0 for a generated candidate or successful dry run, 1 for refusal,
and 2 for invalid arguments. A refusal writes no destination.

The report contains `entries` with `mapped` or `review` outcomes, an `errors`
list with RFC 6901 pointers, `adoption_sql`, and `connector_roles`. Pointers name
capsule declarations; `/pages/...`, `/layouts/...`, and `/islands/...` name project
files. All independently unsupported handlers and features are reported together.
Compiler failures point to the generated source and refuse the whole candidate.
A `written` candidate can still contain review entries. It is not a live deployment.

The command writes compiler-readable TypeScript, `zero/migrations/0001_adopt.sql`,
and `zero/migrations/snapshot.json`. It does not connect to a database. The SQL
checks that the existing table and columns exist and creates v2's revisions
system table. It does not copy rows, rename columns, or convert column types.
`zero build` accepts this snapshot without generating a second initial migration.
If a physical table or column is absent, activation fails at that check. The
WordPress migrator also checks any declared primary key, unique index and foreign
key against the names and definitions assumed by the snapshot. A different name
refuses adoption rather than allowing a later migration to drop an absent index.
Unmanaged legacy indexes remain in place.

`--space` is required when `schema` tables are present. It uses the original
runner's exact binding formula: sanitize the Space ID and logical table name,
form `sf_<space>_<table>`, truncate the base to 53 ASCII characters, then append
`_` and the first 10 hex digits of SHA-256 of `<space>\0<table>`. The physical ID
is **BIGINT UNSIGNED AUTO_INCREMENT**, while action results keep decimal string
IDs. Number fields remain DOUBLE. Other fields, including timestamps and
booleans, keep their existing TEXT storage. Boolean predicates match both legacy
`true`/`false` text and `1`/`0` written by v2. `id("table")` and `userId()` values
remain text and gain no foreign key or automatic identity rewrite.

The supported handler subset includes typed named parameters, local pure helpers,
`get`, `insert`, `update`, `delete`, and static `withIndex` chains ending in
`collect`, `count`, `first`, or `take`. Declared index field order, followed by
`createdAt` and `id`, controls ordering. Optional SQL NULL fields are omitted
from row results, defaults remain defaults, and updates distinguish an absent
patch property from an explicit `undefined` or `null`. Empty patches still touch
`updatedAt`. Queries and legacy actions cannot gain database writes. Mutations
run in v2's transaction. Parameters become named action inputs; URLs, envelopes
and error transport use v2's action API. Existing browser clients require the
v2 generated client and the hosting integration's reserved API URL.

Content declarations use the existing config importer. Native `posts` declarations,
or a `content/posts` directory, add a post-backed `posts` collection with title
and rich-text body. Spacefast's data migration copies the fenced native rows
into that collection with their IDs, authors, dates and revisions intact. Legacy
sync declarations are dropped with a review hint; hosted edits do not rebuild
static frontends. Custom native post fields need an explicit port. Other content
collections use `zero migrate site` and their content-model release on standalone
WordPress. Do not activate a candidate before its data migration succeeds.

An `auth` declaration adds a `members` user projection with a required unique
email and display name.
Use `--users` when the Space has Space Users enabled but its capsule has no
`auth` declaration. `auth.requireSignIn` becomes a zero-identity signed-in gate on actions.
The portable `ctx.user` supplies signed-in/guest flags and display names. Legacy
principal IDs, auth methods and upgrade callbacks are refused. Standalone sessions,
account mappings and ownership transfer require a separate identity migration.
Spacefast moves accounts and sessions in its scoped data migration.
The command does not invent `wp:<id>` owners or install an identity framework.

Connector declarations produce a separate `connector-roles.json` host overlay,
also included in the report. `owner` becomes `personal`; `team` and `visitor`
keep their roles. The file carries no credentials or grants and is not part of
the portable v2 config. Connector calls in handlers are refused. Spacefast's
hosting integration owns applying this overlay and account sessions.

Realtime declarations are dropped with a review hint: realtime is not supported.
Endpoints, pages, layouts, islands, unknown context services, dynamic database
builders, pagination, optional-field range comparisons, npm imports and executable
schema factories require an explicit port. Row IDs above JavaScript's safe integer
range also require a port; generated ID lookups refuse them. Compiled finalize
payloads, including the monorepo's `zero-all-features` fixture, are not capsule
source and are refused. No sources are inferred from those bundles.

For local WordPress installation, `zero build ./migrated-app` emits PHP plugins.
For hosted publication, submit compiler-readable app source and the separate
vendor source bundle through the hosting integration. The server compiler emits
PHP at finalize. Migration never requires uploading generated PHP. Published
versions share the current database schema, so forward migrations can break older
code; the command adds no schema versioning or down migrations. Preview approval,
activation, hosted client URLs and realtime remain the hosting integration's work.

The executable proof is `cargo test --test app_migrate` plus
`tests/wp/app-migrate/run.sh`. The former compiles the generated apps with Zero
and TypeScript; the latter adopts retained rows on WordPress/MariaDB, compares
rows and DDL across activation, and exercises the migrated actions, including
boolean predicates, safe BIGINT IDs, rollback and native password/PKCE sign-in.
It also refuses a mismatched
unique-index name, then adopts and removes the correctly named index.

## Before you start

- Back up the database. The site migration runs in one transaction and rolls
  back on any refusal, but a backup is still the undo button.
- Find the original release: the `content-model.php` the original runtime
  activated for your Space, under
  `<private root>/spaces/<space>/content-model/releases/<revision>/`.
  It names every collection and field the site stored. It is PHP the original
  compiler generated, and the command runs it on the site as `wp eval-file`
  would, dry run included. Use only that file, never one from somewhere else.
- Keep the original app's code. The content-only commands below do not migrate application handlers or pages; see [what stays manual](#what-stays-manual).

## 1. Convert the config

```sh
zero migrate config --from zero capsule.ts --out app/zero.config.ts
```

The report (JSON on stdout) lists every mapping and every review item. Each
collection keeps its authored key and becomes a WordPress post type with a
canonical storage name: `stockItems` becomes `zero_stock_items`. The site
migration resolves release IDs through those authored keys, including relation
targets; do not set a mixed-case `storageName` to match the old release. Each
field becomes a column:

| Original field | New column |
| --- | --- |
| `text` (`multiline`, `maxLength`) | `text()` with the same bound |
| `number` | `real()` |
| `boolean` | `boolean()` |
| `datetime` | `timestamp()` |
| `enum` / `enum` + `multiple` | `select()` |
| `media` / `media` + `multiple` | `media()` / `media({ multiple: true })` |
| `reference` to `projects` | `projectId: integer().references(...)` plus a `project` relation |

Original Zero kept a deleted target's id in a reference. The new Zero doesn't
keep dangling ids: an optional reference is cleared when its target goes
(`set null`), and a required one blocks the delete (`restrict`).

See [config migration](config-migration.md) for the full rules.

## 2. Review access

The importer denies every write until you say otherwise, and only carries
`publicRead` over to reads. Open the new config and set `access` on each
collection, for example:

```ts
{ access: { read: true, create: "editor", update: "editor", delete: "editor" } }
```

## 3. Build and activate

```sh
zero build app
```

Deactivate the original runtime, upload `app/.zero/wp-content/plugins/`, and
activate the dependencies, then `zero-runtime`, then `zero-app-<name>`. The new
post types exist now, but your content is still tagged with the original
`zero_collection` taxonomy, so they're empty.

## 3½. Copy the uploads

The original platform kept a Space's uploads in its private storage root
(`<private root>/spaces/<space>/content-media/`), not in `wp-content/uploads`,
and served them itself. Copy that folder's contents into `wp-content/uploads`,
keeping the `YYYY/MM/` paths, so WordPress can serve the same attachments.
The migration checks every media file it carries over and refuses with the
record and field if one is missing.

## 4. Dry run

```sh
zero migrate site content-model.php --dry-run --wp "wp --path=/srv/site"
```

`--wp` is any WP-CLI command that reaches the site: `wp --ssh=host:/path`,
`docker compose exec -T cli wp`, and so on. The release is sent on stdin, so the
file stays on your machine. Without `--wp`, the command targets the current
project's WordPress Studio site created by `zero dev`. This selects a target;
it does not import an existing site or its database into Studio. Use `--wp`
to migrate the original site in place.

The report lists each collection's record ids, how many revisions come along,
what's skipped (trashed posts stay in the trash, untouched), and review notes
(a `pending` or `private` post keeps its WordPress status, and reads as a draft).
No content is written: the dry run plans inside a transaction and rolls it back.

## 5. Migrate

```sh
zero migrate site content-model.php --wp "wp --path=/srv/site"
```

Each record keeps its post id, so references, media ids, comments and links
stay valid. Its post type becomes `zero_<name>`, and every
`_zero_<collection>_<field>` value is rewritten as the new `zero_<column>`
field. Status, publish dates, scheduled times and authors are the post row's
own and don't change. A column you added in step 2 starts at its default. Revisions keep their author and date, and gain the
record's field values, so restoring one changes the title the way it did before.

Run it again any time: migrated posts no longer carry the original tag, so a
second run finds nothing to do. The run is one database transaction, so a
failure partway leaves the site exactly as it was. It needs InnoDB tables for
posts, post meta and terms, and refuses to start otherwise.

Only the original collection tag is removed. Categories and tags a post
carried stay attached, and the original collection terms stay too (counted
again), so the original app's data model is still there to roll back to.

If the site hosted more than one original Space, pass `--space=<id>`. The
command refuses to guess.

## 6. App users (optional)

If the original Space had sign-in, its app users are already WordPress users:
the identity plugin's accounts, marked as members of the Space. To make them
members of the new app, register a `userProjection()` in `users` (see
`docs/config-api.md`), build and activate it, then run:

```sh
wp zero migrate-legacy-users --space=<id> --dry-run
wp zero migrate-legacy-users --space=<id>
```

Activate zero-identity first: the command carries each account's state into
it. Each app user keeps their WordPress id, password and role. Their verified
primary email becomes the member's email and their zero-identity email, and
their account status carries over, so a user suspended on the original platform
stays suspended (and one already suspended or erased in the new app stays so).
The member collection's own columns start at their defaults (a column without
one starts empty), validated like any write with the user's role in view. A
reference, media or file column can't take a default here, so set those after
the move. An app user without a verified email refuses the run with
`/users/<id>/email`. So does a unique value (`/users/<id>/<column>`, the email
included) that another user holds, or that an earlier user in the same run just
took, compared the way the database compares (`Invite` and `invite` are one
value). Nothing
changes on a refusal, and the dry run catches all of these. A second run skips
users already moved. Original Zero guests lived only in the browser, so there
are none to move.

## Refusals

A refusal is a JSON problem with an RFC 6901 pointer, and the whole run rolls
back:

| Pointer | Meaning |
| --- | --- |
| `""` | the site holds several original Spaces (pass `--space`), or a table isn't InnoDB |
| `/postTypes/3/id` | that collection has no counterpart in the new config, is a `table()`, localized, `uid`/`sync` or has a `slug()` column, or has a new column whose default the migration can't write (post content, references, media, files, structured fields) |
| `/postTypes/3/fields/2/name` | the field's column is missing, or is the new app's `content` or `slug` column |
| `/postTypes/3/fields/2/definition` | the field's type or options don't match the new column |
| `/postTypes/3/fields/2/definition/type` | rich text and blocks fields need a content port |
| `/records/42/project` | record 42's reference points at a post that isn't a live project |
| `/records/42/gallery/1` | the second media id isn't an attachment, isn't an image (for an image-only column), or its file isn't in `wp-content/uploads` yet |
| `/records/42/title` | a value breaks a rule of the new column (required, bound), or repeats a unique value among the records or the collection's live rows |

Fix the data in WordPress (or the new config), then run again.

## What stays manual

The content-only config and site commands below do not move:

- `blocks` (rich text) fields and multiple references. The importer refuses them.
- Native `posts`, `pages` and `media` collections.
- Application tables and handlers. Use the [app migrator](#application-source-migration)
  for its supported subset; endpoints, pages, islands, service calls and sync
  bindings still need an explicit port.
- Sign-in providers and sessions of the original platform (app users themselves move with step 6).
- The original Space's routes, redirects and private file storage.

The [compatibility inventory](zero-compatibility.md) tracks each of these.
