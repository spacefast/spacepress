<?php

declare(strict_types=1);

namespace Zero;

/** Feature-owned, idempotent DDL and guarded upgrade steps. MySQL statements use {prefix} for the WP table prefix. */
final class SystemTables
{
    /** @var array<string, array{sqlite: list<string|callable>, mysql: list<string|callable>}> */
    private static array $tables = [];

    /**
     * @param list<string|callable(Store): void> $sqlite SQL or a guarded upgrade (SQLite has no ADD COLUMN IF NOT EXISTS)
     * @param list<string|callable(Store): void> $mysql SQL uses {prefix}; guards receive the concrete store
     */
    public static function register(string $table, array $sqlite, array $mysql): void
    {
        if (isset(self::$tables[$table])) {
            throw new \LogicException("Duplicate system table '$table'");
        }
        self::$tables[$table] = ['sqlite' => $sqlite, 'mysql' => $mysql];
    }

    /**
     * Identifies the registered set (table names and their SQL; a guard step counts by position), so
     * a site that recorded an older set — a new table, a new column step — upgrades on the next check.
     */
    public static function fingerprint(): string
    {
        $parts = [];
        foreach (self::$tables as $table => $dialects) {
            $parts[$table] = array_map(static fn (array $steps) => array_map(static fn ($s) => is_string($s) ? $s : 'step', $steps), $dialects);
        }
        ksort($parts);

        return substr(hash('sha256', (string) json_encode($parts)), 0, 16);
    }

    /** Apply outside request transactions: MySQL DDL commits implicitly. */
    public static function apply(Store $store): void
    {
        if (self::$tables === []) {
            return;
        }
        $store->applySystemStatements([]); // Reject request transactions before running any upgrade guard.
        foreach (self::$tables as $statements) {
            foreach ($statements[$store->dialect()->name] as $step) {
                if (is_string($step)) {
                    $store->applySystemStatements([$step]);
                } else {
                    $step($store);
                }
            }
        }
    }
}
