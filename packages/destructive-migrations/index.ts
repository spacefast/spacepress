import { definePlugin } from "typedpress";

export interface DestructiveMigrationsOptions {
  /**
   * When true, every destructive operation MUST pass `--archive-to=<path>` so rows/values
   * are archived to JSONL before any DROP or purge executes. Default: `false`.
   */
  requireArchive?: boolean;
  /**
   * When true, enables `wp typedpress danger raw-sql` for explicit raw escape-hatch SQL.
   * Keep `false` unless you specifically need one-off raw destructive SQL. Default: `false`.
   */
  allowRawSql?: boolean;
}

/**
 * Opt-in plugin that unlocks CLI-only destructive database operations (`typedpress danger` /
 * `wp typedpress danger`). Core TypedPress migrations remain strictly forward-only and never
 * emit or run `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or lossy narrowing on HTTP boot.
 *
 * WARNING: Operations executed via this plugin permanently remove data and cannot be rolled back.
 * Every destructive action requires:
 *   1. Two-phase retirement (columns/tables must already be retired in a prior forward-only migration).
 *   2. Exact live row/non-null count confirmation (`--confirm-rows=<N>`).
 *   3. A human `--reason="..."` recorded in `{prefix}tp__migrations` with `kind = 'destructive'`.
 *   4. CLI-only execution (refused on HTTP requests and plugin activation).
 */
export function destructiveMigrations(options?: DestructiveMigrationsOptions) {
  return definePlugin({
    name: "destructive_migrations",
    migrationProvider: {
      id: "destructive-migrations",
      cliOnly: true,
      requireArchive: options?.requireArchive ?? false,
      allowRawSql: options?.allowRawSql ?? false,
    },
  });
}

export default destructiveMigrations;
