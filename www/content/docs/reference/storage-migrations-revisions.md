---
uid: zr_c0f65a9c5941e13d8ec8
title: Storage migrations and revisions
description: How SpacePress applies schema changes, retains deleted rows, and tracks revisions.
status: draft
---
## Migration files

- **Layout:** Each migration is an immutable folder under `sp/_generated/migrations/`:
  ```text
  sp/_generated/migrations/
    20261121180000_7k9m2x_init/
      ops.json        # canonical structured forward-only operations
      migration.sql   # compiled MySQL/SQLite-compatible DDL
  ```
- **ID format:** `<YYYYMMDDHHMMSS>_<6-char-crockford-base32>_<slug>` (UTC timestamp + 6-char deterministic hash suffix of the ops + descriptive slug). Lexicographic (`SORT_STRING`) order is chronological and collision-free across parallel branches.
- **No global `snapshot.json` or `_journal.json`:** Two branches never edit the same file. At build time, the compiler folds every `<id>/ops.json` in sorted ID order to compute the baseline schema state, then diffs the current schema against that folded state.
- **Parallel conflict detection:** While folding `ops.json` files across merged branches, incompatible parallel edits (e.g., two branches adding the same physical column with incompatible types, or conflicting physical names) fail the build with a diagnostic naming both migration IDs.
- **Unified ledger (`{prefix}sp__migrations`):**
  Columns: `app`, `id`, `kind` (`'schema' | 'data' | 'destructive'`), `applied_at`, `sql` (SHA-256 of `migration.sql`), `actor`, `reason`, `rows_affected`.
  `Migrator` applies any folder whose `id` is not yet in `sp__migrations` in `SORT_STRING` order (set-based, so out-of-order merged parallel branches apply cleanly without re-running applied IDs).

## Schema changes and aliases

- **Core emits and executes ONLY lossless, forward-only DDL:**
  - `CREATE TABLE`
  - `ADD COLUMN` (nullable or with a literal SQL default; adding a required column without a literal default is a compile error with instructions to make it nullable, add `.default(...)`, or expand/backfill)
  - Lossless widenings (e.g., `VARCHAR(50) -> VARCHAR(191) -> LONGTEXT`, `NOT NULL -> NULL`, widening numeric ranges)
  - Index and foreign-key additions/removals
  - **Retiring removed columns/tables:** Removing a column from TypeScript does **not** emit `ALTER TABLE ... DROP COLUMN`. Instead, it marks the column retired in `ops.json` and emits a forward-only relaxation (`MODIFY COLUMN ... NULL` + dropping unique/FK constraints on it) so new code ignores it while old data stays intact and rolling deploys never break. Removing a table marks it retired in `ops.json` and leaves its SQL table intact (dropping inbound FKs if needed).
  - **Lossy narrowing / tightening without default** is rejected at build time with actionable guidance.
- **Runtime forward-only guard:** `Wp\Migrator` refuses to execute `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or `RENAME` statements in core schema migrations.
- **Aliasing instead of in-place `RENAME`:**
  - Columns support `.column("physical_name")` (decoupling the TypeScript/API field name from the physical SQL column name with zero DDL) and `.alias("old_api_name")` (accepting an old API/filter name during transitions).
  - Tables support `{ storageName: "physical_table_slug" }` to decouple the TypeScript kind name from `{prefix}sp_<storageName>`.
- **Join tables:** `ref().many()` stores links in `{prefix}sp__join_<owner>_<field>`, a namespace reserved for these relationships.

## Destructive operations with `spacepress/danger`

- Destructive operations (`DROP COLUMN` / `DROP TABLE` on already-retired items, lossy type narrowing, physical purge of soft-deleted rows, raw escape-hatch SQL) live behind an explicit opt-in subpath `spacepress/danger` (never exported from the main `spacepress` barrel).
- Opted in explicitly in `spacepress.config.ts`:
  ```ts
  import { destructiveMigrations } from "spacepress/danger";
  export default defineConfig({ use: [destructiveMigrations()] });
  ```
- Plugs into `Wp\Migrator`'s `MigrationProvider` registry, **CLI-only** (never auto-runs on HTTP boot or plugin activation).
- Enforces:
  1. Two-phase retirement prerequisite (cannot drop an active column/table—must be retired in a prior migration first).
  2. Live row-count / non-null value inspection before execution, requiring explicit operator confirmation (`--confirm-rows=<count>` or interactive confirmation).
  3. Optional `--archive-to=<path>` JSONL export before destructive execution.
  4. Audit row in `sp__migrations` with `kind = 'destructive'`, `actor`, `reason`, and `rows_affected`.

## Soft deletes and retention

- **Default ON everywhere:** Both `table()` and `collection()` default to `softDelete: true` (opt out with `{ softDelete: false }`).
- **Storage:**
  - `table()`: automatic system columns `deletedAt` (`CHAR(24) NULL`), `deletedBy` (`BIGINT UNSIGNED NULL`), `deletedGroup` (`CHAR(36) NULL`), and internal `_live` (`TINYINT(1) NULL DEFAULT 1`, set to `1` while active and `NULL` when soft-deleted).
  - **Active-row uniqueness:** Unique constraints and `.index(..., { unique: true })` on soft-deletable SQL tables include `_live` (`UNIQUE(col, _live)`). Because SQL treats multiple `NULL`s as distinct, soft-deleted rows do not block reusing unique values (e.g., `email`, `slug`), while two active rows or a colliding `restore()` fail with `409 unique_violation`. Sync `uid` remains globally unique without `_live`.
  - `collection()`: `delete()` moves posts to WordPress Trash (`wp_trash_post`) and stores `_sp_deleted_by` / `_sp_deleted_group` postmeta; `restore()` calls `wp_untrash_post` and restores prior status; `purge()` calls `wp_delete_post(..., true)`.
- **API:**
  - `kind.delete(id)` performs a soft delete (when `softDelete: true`) and cascades `deletedGroup` to `onDelete: "cascade"` children.
  - `kind.restore(id)` restores the row and any children sharing its `deletedGroup`.
  - `kind.purge(id)` permanently deletes (default access `"system"`, fires `beforePurge` / `afterPurge`).
  - `kind.list({ deleted?: "exclude" | "include" | "only" })` defaults to `"exclude"`; `"include"` and `"only"` require `restore` or `delete` access.
- **Retention policy (default `"forever"`):**
  - If `retention` is omitted from `defineConfig()`, SpacePress **never automatically purges** soft-deleted rows, trashed posts, or revisions. WordPress's 30-day `wp_scheduled_delete` is unhooked for SpacePress post types unless retention is configured.
  - Opt-in globally or per kind:
    ```ts
    retention: {
      deleted: "90d", // or "forever"
      revisions: { keepLast: 50, maxAge: "365d" }, // or "forever"
    }
    ```
  - Swept in bounded batches via Action Scheduler.

## Revisions

- Both `collection()` and `table()` default to `revisions: true` (opt out with `{ revisions: false }`).
- Each row in `{prefix}sp__revisions` records these fields:
  - `version` (`INT UNSIGNED NOT NULL`, monotonic per `(collection, pk)`)
  - `op` (`VARCHAR(16) NOT NULL`: `'create' | 'update' | 'delete' | 'restore' | 'purge'`)
  - `at` (`CHAR(24) NOT NULL`)
  - `userId` (`BIGINT UNSIGNED NULL`)
  - `schemaMigration` (`VARCHAR(191) NULL`, latest applied schema migration ID)
  - `row` (`LONGTEXT NOT NULL`, JSON snapshot including `ref().many()` link arrays)
  - `changed` (`LONGTEXT NULL`, JSON list of changed field names)
- Unified API on `KindApi`, REST, generated client, and WordPress Abilities:
  - `kind.revisions.list(id)`
  - `kind.revisions.get(id, version)`
  - `kind.revisions.diff(id, fromVersion, toVersion)`
  - `kind.revisions.restore(id, version)`
- Schema-aware decoding resolves aliased/retired columns across forward-only migrations.
- Optimistic concurrency (`_rev`) is supported uniformly on `table()` as well as `collection()`.

## System fields, filters, and IDs

- **Automatic system fields:** Every kind with rows automatically exposes `id`, `author`, `createdAt`, `updatedAt` (plus `deletedAt`, `deletedBy` when `softDelete: true`).
- **Strict Drizzle 1.0 filter semantics:** Explicit `undefined` values inside `where` filters throw `422 invalid_input` (instead of silently dropping the predicate and returning all rows). In `update()`, `undefined` means untouched and `null` clears nullable fields.
- **Branded IDs:** Generated TypeScript types emit `type Id<Kind extends string> = number & { readonly __sp_kind: Kind }` for kind primary keys and `ref()` columns.
