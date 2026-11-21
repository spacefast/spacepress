import type { Plugin } from "typedpress";

export interface DestructiveMigrationsOptions {
  /**
   * When true, every destructive operation MUST pass `--archive-to=<path>` so rows/values
   * are archived to JSONL before any DROP or purge executes. Default: `false`.
   */
  requireArchive?: boolean;
  /**
   * When true, enables `wp typedpress danger raw-sql` for explicit raw escape-hatch SQL.
   * Default: `false`.
   */
  allowRawSql?: boolean;
}

/**
 * Opt-in plugin that unlocks CLI-only destructive database operations (`typedpress danger` /
 * `wp typedpress danger`). Register in `typedpress.config.ts`:
 *
 * ```ts
 * import { defineConfig } from "typedpress";
 * import { destructiveMigrations } from "@typedpress/destructive-migrations";
 *
 * export default defineConfig({
 *   use: [destructiveMigrations({ requireArchive: true })],
 * });
 * ```
 */
export declare function destructiveMigrations(options?: DestructiveMigrationsOptions): Plugin;
export default destructiveMigrations;
