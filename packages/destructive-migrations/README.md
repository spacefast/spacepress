# `@typedpress/destructive-migrations`

> **WARNING: DESTRUCTIVE OPERATIONS — IRREVERSIBLE DATA LOSS**
>
> Core TypedPress migrations are **strictly forward-only**: removing a field or table from
> `typedpress.config.ts` retires it (preserving existing data) and never executes `DROP COLUMN`,
> `DROP TABLE`, `TRUNCATE`, or lossy narrowing.
>
> Install and opt into `@typedpress/destructive-migrations` **only** when you intentionally need
> to physically drop already-retired columns/tables, permanently purge soft-deleted rows, or run
> audited escape-hatch SQL via CLI.

## Opting In

```ts
import { defineConfig } from "typedpress";
import { destructiveMigrations } from "@typedpress/destructive-migrations";

export default defineConfig({
  use: [
    destructiveMigrations({
      requireArchive: true, // require --archive-to=<path> on every drop/purge
      allowRawSql: false,   // keep raw SQL disabled unless explicitly needed
    }),
  ],
});
```

## Safety Guarantees

1. **CLI-only:** Never runs on HTTP requests, REST calls, or WordPress plugin activation.
2. **Two-phase retirement prerequisite:** Active columns and tables cannot be dropped. You must first remove them from `typedpress.config.ts` and deploy a forward-only retirement migration.
3. **Live row/value confirmation:** Every destructive command counts live rows (or non-null values) and refuses execution unless `--confirm-rows=<exact-count>` is supplied.
4. **Optional (or mandatory) archival:** `--archive-to=/path/to/backup.jsonl` exports every affected row/value to JSONL before executing DDL or purge.
5. **Immutable audit trail:** Every executed command appends an audit row to `{prefix}tp__migrations` with `kind = 'destructive'`, `sql` (SHA-256), `actor`, `reason`, and `rows_affected`.

## CLI Commands

```bash
# Inspect retired columns and tables (local or on a live site)
typedpress danger plan
wp typedpress danger status

# Drop a retired column (two-phase: must already be retired in ops.json)
wp typedpress danger drop-column <table> <column> \
  --confirm-rows=<N> \
  --reason="GDPR cleanup after 90-day soak" \
  --archive-to=/tmp/backup.jsonl

# Drop a retired table
wp typedpress danger drop-table <table> \
  --confirm-rows=<N> \
  --reason="Retired legacy table" \
  --archive-to=/tmp/table-backup.jsonl

# Permanently purge soft-deleted rows
wp typedpress danger purge-deleted <kind> \
  --older-than=90d \
  --confirm-rows=<N> \
  --reason="Quarterly purge" \
  --archive-to=/tmp/purged.jsonl
```
