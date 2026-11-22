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

Commit each generated folder under `tp/_generated/migrations/`. The compiler folds the folders’ `ops.json` files in order and writes a new folder when the SQL schema changes. Removing a field or table from the schema retires it while preserving its data.
