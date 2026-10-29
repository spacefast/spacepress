<?php

declare(strict_types=1);

namespace Zero\Jobs;

use function Zero\db;

/**
 * Moves committed outbox rows into the queue. Enqueue writes the outbox row inside the caller's
 * transaction, so a rollback leaves nothing behind; this runs after the outermost commit and again
 * from every worker pass, which drains rows a crash left between commit and dispatch.
 */
final class Outbox
{
    private static ?Queue $queue = null;

    public static function useQueue(Queue $queue): void
    {
        self::$queue = $queue;
    }

    public static function queue(): Queue
    {
        return self::$queue ??= new SqliteQueue();
    }

    /** @return int rows moved */
    public static function dispatch(): int
    {
        try {
            return db()->transaction(static function (): int {
                $rows = Storage::run('SELECT "id", "job", "input", "key", "runAt", "createdAt" FROM {outbox} ORDER BY "createdAt", "id"' . Storage::forUpdate());
                foreach ($rows as $row) {
                    Storage::run(Storage::insertIgnore() . ' INTO {jobs} ("id", "job", "input", "key", "dedupe", "state", "attempts", "runAt", "createdAt") VALUES (?, ?, ?, ?, ?, \'pending\', 0, ?, ?)', [
                        $row['id'], $row['job'], $row['input'], $row['key'], $row['key'], $row['runAt'], $row['createdAt'],
                    ]);
                    // A concurrent enqueue with the same key won the dedupe race: that job stands.
                    if (Storage::run('SELECT "id" FROM {jobs} WHERE "id" = ?', [$row['id']]) !== []) {
                        self::queue()->schedule((string) $row['id'], (string) $row['runAt']);
                    }
                    Storage::run('DELETE FROM {outbox} WHERE "id" = ?', [$row['id']]);
                }

                return count($rows);
            });
        } catch (\Throwable $e) {
            // The write already committed; its outbox rows wait for the next dispatch.
            error_log('[zero] outbox dispatch failed: ' . $e->getMessage());

            return 0;
        }
    }
}
