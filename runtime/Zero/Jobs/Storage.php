<?php

declare(strict_types=1);

namespace Zero\Jobs;

use Zero\Store\SqliteStore;

use function Zero\db;

/**
 * Raw SQL on the jobs system tables, on the active store's connection (so it shares the request
 * transaction). Statements are written once with "double-quoted" identifiers and `{outbox}`,
 * `{jobs}`, `{receipts}` placeholders; MySQL gets backticks and the WordPress table prefix.
 */
final class Storage
{
    public const TABLES = ['outbox', 'jobs', 'receipts'];

    /** @param list<int|float|string|null> $params @return list<array<string, mixed>> */
    public static function run(string $sql, array $params = []): array
    {
        $store = db()->store();
        if ($store instanceof SqliteStore) {
            $stmt = $store->pdo()->prepare(self::sql($sql, false, ''));
            $stmt->execute($params);

            return $stmt->columnCount() > 0 ? $stmt->fetchAll(\PDO::FETCH_ASSOC) : [];
        }
        if ($store instanceof \Zero\Wp\CompositeStore) {
            return $store->db->run(self::sql($sql, true, $store->db->prefix()), $params);
        }

        throw new \LogicException('Zero jobs need the SQLite or WordPress store');
    }

    public static function mysql(): bool
    {
        return db()->store()->dialect()->name === 'mysql';
    }

    /** A dedupe key, receipt scope or key as a parameter: a `VARBINARY` column's value, compared byte for byte. */
    public static function bytes(string $value): string|\Zero\Wp\Bytes
    {
        return db()->store() instanceof \Zero\Wp\CompositeStore ? new \Zero\Wp\Bytes($value) : $value;
    }

    /** ` FOR UPDATE` on MySQL; SQLite transactions already hold the write lock (BEGIN IMMEDIATE). */
    public static function forUpdate(): string
    {
        return self::mysql() ? ' FOR UPDATE' : '';
    }

    /** A shared locking read on MySQL: sees the latest commit without asking for an exclusive lock. */
    public static function forShare(): string
    {
        return self::mysql() ? ' LOCK IN SHARE MODE' : '';
    }

    /** Rows changed by the previous statement on this connection (0 for an ignored insert). */
    public static function changes(): int
    {
        $store = db()->store();
        if ($store instanceof \Zero\Wp\CompositeStore) {
            return $store->db->changes();
        }

        return (int) self::run('SELECT changes() AS n')[0]['n'];
    }

    /** `UPDATE OR IGNORE` / `UPDATE IGNORE`: a unique conflict leaves the row unchanged instead of failing. */
    public static function updateIgnore(): string
    {
        return self::mysql() ? 'UPDATE IGNORE' : 'UPDATE OR IGNORE';
    }

    /** `INSERT OR IGNORE` / `INSERT IGNORE`. */
    public static function insertIgnore(): string
    {
        return self::mysql() ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
    }

    public static function sql(string $sql, bool $mysql, string $prefix): string
    {
        foreach (self::TABLES as $t) {
            $sql = str_replace('{' . $t . '}', $mysql ? "\"{$prefix}zero__$t\"" : "\"__zero_$t\"", $sql);
        }

        return $mysql ? str_replace('"', '`', $sql) : $sql;
    }

    /** Idempotent DDL for SystemTables (both dialects). */
    public static function register(): void
    {
        $text = 'COLLATE utf8mb4_bin';
        // Keys compare byte for byte, like SQLite: a PAD SPACE collation would make "k" and "k " collide.
        $bytes = 'VARBINARY(764)';
        $tail = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';
        \Zero\SystemTables::register('__zero_outbox', [
            'CREATE TABLE IF NOT EXISTS "__zero_outbox" ("id" text PRIMARY KEY NOT NULL, "job" text NOT NULL, "input" text NOT NULL, "key" text, "runAt" text NOT NULL, "createdAt" text NOT NULL)',
        ], [
            "CREATE TABLE IF NOT EXISTS `{prefix}zero__outbox` (`id` CHAR(36) NOT NULL, `job` VARCHAR(191) $text NOT NULL, `input` LONGTEXT NOT NULL, `key` VARCHAR(191) $text NULL, `runAt` CHAR(24) NOT NULL, `createdAt` CHAR(24) NOT NULL, PRIMARY KEY (`id`)) $tail",
        ]);
        // `dedupe` is the key while the job is pending or running (§6.1) and NULL otherwise;
        // UNIQUE(job, dedupe) is the one dedupe mechanism on both dialects (NULLs never collide).
        \Zero\SystemTables::register('__zero_jobs', [
            'CREATE TABLE IF NOT EXISTS "__zero_jobs" ("id" text PRIMARY KEY NOT NULL, "job" text NOT NULL, "input" text NOT NULL, "key" text, "dedupe" text, "state" text NOT NULL, "attempts" integer NOT NULL DEFAULT 0, "runAt" text NOT NULL, "lockedAt" text, "lastError" text, "createdAt" text NOT NULL, "doneAt" text)',
            'CREATE UNIQUE INDEX IF NOT EXISTS "__zero_jobs_dedupe" ON "__zero_jobs" ("job", "dedupe")',
            'CREATE INDEX IF NOT EXISTS "__zero_jobs_due" ON "__zero_jobs" ("state", "runAt")',
        ], [
            "CREATE TABLE IF NOT EXISTS `{prefix}zero__jobs` (`id` CHAR(36) NOT NULL, `job` VARCHAR(191) $text NOT NULL, `input` LONGTEXT NOT NULL, `key` $bytes NULL, `dedupe` $bytes NULL, `state` VARCHAR(16) NOT NULL, `attempts` INT NOT NULL DEFAULT 0, `runAt` CHAR(24) NOT NULL, `lockedAt` CHAR(24) NULL, `lastError` TEXT NULL, `createdAt` CHAR(24) NOT NULL, `doneAt` CHAR(24) NULL, PRIMARY KEY (`id`), UNIQUE KEY `dedupe` (`job`, `dedupe`), KEY `due` (`state`, `runAt`)) $tail",
        ]);
        \Zero\SystemTables::register('__zero_receipts', [
            'CREATE TABLE IF NOT EXISTS "__zero_receipts" ("scope" text NOT NULL, "key" text NOT NULL, "userId" integer NOT NULL, "inputHash" text NOT NULL, "state" text NOT NULL, "result" text, "createdAt" text NOT NULL, PRIMARY KEY ("scope", "key", "userId"))',
        ], [
            "CREATE TABLE IF NOT EXISTS `{prefix}zero__receipts` (`scope` VARBINARY(764) NOT NULL, `key` VARBINARY(256) NOT NULL, `userId` BIGINT NOT NULL, `inputHash` CHAR(64) NOT NULL, `state` VARCHAR(16) NOT NULL, `result` LONGTEXT NULL, `createdAt` CHAR(24) NOT NULL, PRIMARY KEY (`scope`, `key`, `userId`), KEY `created` (`createdAt`)) $tail",
        ]);
    }
}
