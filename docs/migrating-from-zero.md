# Migrating from Zero 0.8

This guide moves a WordPress site built with the original `@spacefast/zero`
0.8 (`capsule()` collections) onto the new Zero: the same posts, ids, fields,
media, revisions and authors, now served by the `zero-app-<name>` plugin at
`/wp-json/zero/v1`.

It takes two commands. `zero migrate config` turns the capsule into a
`zero.config.ts`, and `zero migrate site` moves the content in place. Both
refuse anything they can't carry and name the exact spot, so nothing is
silently dropped.

## Before you start

- Back up the database. The site migration runs in one transaction and rolls
  back on any refusal, but a backup is still the undo button.
- Find the original release: the `content-model.php` the original runtime
  activated for your Space, under
  `<private root>/spaces/<space>/content-model/releases/<revision>/`.
  It names every collection and field the site stored. It is PHP the original
  compiler generated, and the command runs it on the site as `wp eval-file`
  would, dry run included. Use only that file, never one from somewhere else.
- Keep the original app's code. Queries, mutations, actions, endpoints, pages
  and sign-in are not migrated here; see [what stays manual](#what-stays-manual).

## 1. Convert the config

```sh
zero migrate config --from zero capsule.ts --out app/zero.config.ts
```

The report (JSON on stdout) lists every mapping and every review item. Each
collection becomes a WordPress post type `zero_<name>`, and each field a
column:

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
zero build app --target wp
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
file stays on your machine. Without `--wp`, the command targets the local test
harness.

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

## Refusals

A refusal is a JSON problem with an RFC 6901 pointer, and the whole run rolls
back:

| Pointer | Meaning |
| --- | --- |
| `""` | the site holds several original Spaces (pass `--space`), or a table isn't InnoDB |
| `/postTypes/3/id` | that collection has no counterpart in the new config, is `editor: false`, localized, `uid`/`sync` or has a `slug()` column, or has a new column whose default the migration can't write (post content, references, media, files, structured fields) |
| `/postTypes/3/fields/2/name` | the field's column is missing, or is the new app's `content` or `slug` column |
| `/postTypes/3/fields/2/definition` | the field's type or options don't match the new column |
| `/postTypes/3/fields/2/definition/type` | rich text and blocks fields need a content port |
| `/records/42/project` | record 42's reference points at a post that isn't a live project |
| `/records/42/gallery/1` | the second media id isn't an attachment, isn't an image (for an image-only column), or its file isn't in `wp-content/uploads` yet |
| `/records/42/title` | a value breaks a rule of the new column (required, bound), or repeats a unique value among the records or the collection's live rows |

Fix the data in WordPress (or the new config), then run again.

## What stays manual

The config and content migration don't move:

- `blocks` (rich text) fields and multiple references. The importer refuses them.
- Native `posts`, `pages` and `media` collections.
- `schema` tables, queries, mutations, actions, endpoints, pages, islands,
  connectors and sync bindings: port them to `zero.config.ts` actions and hooks.
- App users and sign-in. See the `auth: true` collections in the new Zero.
- The original Space's routes, redirects and private file storage.

The [compatibility inventory](zero-compatibility.md) tracks each of these.
