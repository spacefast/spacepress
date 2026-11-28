---
uid: zr_79c58e3d26cdbacc20be
title: Schema & Storage
description: "Collections, SQL tables, globals, WordPress built-in kinds, field builders, and migrations."
order: 1
status: published
publishedAt: 2026-11-21T09:04:00.000Z
---
## Choosing a storage kind

| Builder             | Storage                     | When to use                                                                                                    |
|---------------------|-----------------------------|----------------------------------------------------------------------------------------------------------------|
| `collection()`      | WordPress custom post type  | Editorial items needing Gutenberg, drafts, revisions, staged versions, comments, URL routing, or Markdown sync |
| `table()`           | Dedicated SQL table         | Relational app records, high-volume data, compound indexes (`.index()`), strict SQL migrations                 |
| `global()`          | WordPress options singleton | Site-wide settings, navigation links, feature flags                                                            |
| `wp.posts.extend()` | Built-in WordPress `post`   | Native blog posts extended with typed meta fields and URL pattern                                              |
| `userProjection()`  | `wp_users` + `wp_usermeta`  | Typed user profiles without duplicating WordPress accounts                                                     |
| `taxonomy()`        | WordPress term tables       | Flat or hierarchical vocabularies attached via `on: [...]` or `terms()`                                        |

## Field builders

All columns are `NOT NULL` by default unless `.optional()` is chained.

- **Scalars:** `text({ multiline? })`, `integer()`, `number()`, `boolean()`, `date()`, `timestamp()`, `json<T>()`
- **Semantic:** `email()`, `url()`, `slug({ source })`, `richText()`, `select([...])` (`.many()` for multi-select)
- **Relations & Media:** `ref(kind)` (`.many()`, `.onDelete("cascade" | "restrict" | "setNull")`, `.reverse("name")`), `terms(taxonomy)`, `media({ accept })`, `file(bucket)`
- **Structured:** `group(fields)`, `repeater(fields)`, `blocks(layouts)`

## Modifiers & safe renames

Chain `.min(n)`, `.max(n)`, `.pattern(/.../)`, `.unique()`, `.default(v)`, `.defaultNow()`, `.$default(fn)`, `.$onUpdate(fn)`, `.validate((v, ctx) => ...)`, `.ui({ label, help, placeholder, width })`, `.showIf({ ... })`, and `.searchable()` (which fields `search` matches; see [Queries & Access Control](/docs/core/queries-and-access#search)).

Rename a field in TypeScript while keeping its physical column with `.column("old_name")`. Keep an SQL table’s physical name with `storageName: "old_table"`. Add `.alias("oldName")` if callers still send the previous field name.

## Migrations

Commit each generated folder under `sp/_generated/migrations/`. Each one is named `<timestamp>_<hash>_<slug>` and holds `ops.json` and `migration.sql`. The compiler folds the folders' `ops.json` files in name order and writes a new folder when the SQL schema changes, so two branches that both change the schema merge without a conflict on a shared file.

Migrations only move forward and never lose data:

- Adding a required column needs a literal `.default(...)`, or the build fails and says how to fix it.
- Removing a field or table from the schema retires it: its column or table and data stay, and new code ignores them.
- A narrowing change, such as a shorter text type, is refused at build time.
- Renames go through `.column("old_name")` and `storageName`, not `RENAME`.

Dropping retired columns and tables and purging soft-deleted rows happen only through the CLI's `spacepress danger` commands, after you list `destructiveMigrations()` from `"spacepress/danger"` in `defineConfig({ use })`.

<Warning title="Don't regenerate committed migrations">
A deployed site records which migrations it applied. Renumbering or rewriting a committed folder makes the site's history disagree with the project.
</Warning>

## Soft deletes and revisions

`collection()` and `table()` keep deleted rows and revisions by default (`softDelete: false` or `revisions: false` turns them off per kind):

- `kind.delete(id)` soft-deletes the row and, through `onDelete: "cascade"` references, its children. `kind.restore(id)` brings them back. `kind.purge(id)` deletes permanently and by default only the system may call it.
- `kind.list({ deleted: "include" | "only" })` shows deleted rows to callers with `restore` or `delete` access.
- `kind.revisions.list(id)`, `.get(id, version)`, `.diff(id, from, to)` and `.restore(id, version)` read and restore revisions. Each records the operation, the user and the schema migration it was written under.
- Nothing is purged automatically. Set `retention: { deleted: "90d", revisions: { keepLast: 50 } }` in `defineConfig()` to purge in the background.
