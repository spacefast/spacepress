import type { Plugin } from "./index.d.ts";

export interface DestructiveMigrationsOptions {
  /**
   * When true, every destructive operation MUST pass `--archive-to=<path>` so rows/values
   * are archived to JSONL before any DROP or purge executes. Default: `false`.
   */
  requireArchive?: boolean;
  /**
   * When true, enables `wp spacepress danger raw-sql` for explicit raw escape-hatch SQL.
   * Keep `false` unless you specifically need one-off raw destructive SQL. Default: `false`.
   */
  allowRawSql?: boolean;
}

/**
 * Opt-in plugin that unlocks CLI-only destructive database operations (`spacepress danger` /
 * `wp spacepress danger`). Core SpacePress migrations remain strictly forward-only and never
 * emit or run `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or lossy narrowing on HTTP boot.
 *
 * Register explicitly in `spacepress.config.ts`:
 *
 * ```ts
 * import { defineConfig } from "spacepress";
 * import { destructiveMigrations } from "spacepress/danger";
 *
 * export default defineConfig({
 *   use: [destructiveMigrations({ requireArchive: true })],
 * });
 * ```
 *
 * WARNING: Operations executed via this plugin permanently remove data and cannot be rolled back.
 * Every destructive action requires:
 *   1. Two-phase retirement (columns/tables must already be retired in a prior forward-only migration).
 *   2. Exact live row/non-null count confirmation (`--confirm-rows=<N>`).
 *   3. A human `--reason="..."` recorded in `{prefix}sp__migrations` with `kind = 'destructive'`.
 *   4. CLI-only execution (refused on HTTP requests and plugin activation).
 */
export declare function destructiveMigrations(options?: DestructiveMigrationsOptions): Plugin;
export default destructiveMigrations;
