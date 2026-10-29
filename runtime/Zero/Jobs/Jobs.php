<?php

declare(strict_types=1);

namespace Zero\Jobs;

use Zero\Extensions;
use Zero\HttpError;
use Zero\Js;
use Zero\Schema;

use function Zero\db;

/** `jobs.<name>.enqueue(input, opts)` (§6.1): validated, written to the outbox, queued after commit. */
final class Jobs
{
    public const MAX_KEY = 191;

    /**
     * @param array{delay?: int|float, key?: string}|null $opts
     * @return array{id: string}
     */
    public static function enqueue(string $name, mixed $input, ?array $opts = null): array
    {
        $db = db();
        $spec = self::spec($name);
        $ctx = $db->hookCtx();
        $input = Schema::validateInput($spec['input'] ?? [], $input, '', $ctx['user'], $ctx['target']);
        $opts ??= [];
        $delay = $opts['delay'] ?? 0;
        if (!is_int($delay) && !is_float($delay) || !is_finite((float) $delay) || $delay < 0) {
            throw HttpError::invalidInput('delay must be a non-negative number of seconds', '/delay');
        }
        $key = $opts['key'] ?? null;
        if ($key !== null && (!is_string($key) || $key === '' || mb_strlen($key) > self::MAX_KEY)) {
            throw HttpError::invalidInput('key must be a string of 1 to ' . self::MAX_KEY . ' characters', '/key');
        }

        return $db->transaction(static function () use ($name, $input, $delay, $key): array {
            $id = self::uuid();
            $now = Js::now();
            $values = [$id, $name, Js::jsonStringify((object) $input), $key, Js::iso($now + (int) round($delay * 1000)), Js::iso($now)];
            if ($key === null) {
                Storage::run('INSERT INTO {outbox} ("id", "job", "input", "key", "runAt", "createdAt") VALUES (?, ?, ?, ?, ?, ?)', $values);
            } elseif (($winner = self::holder($name, $key)) !== null) {
                return ['id' => $winner];
            } else {
                // UNIQUE(job, key) on the outbox makes a concurrent same-key enqueue wait for this
                // transaction, then lose; the loser reads the winner through locking reads below.
                Storage::run(Storage::insertIgnore() . ' INTO {outbox} ("id", "job", "input", "key", "runAt", "createdAt") VALUES (?, ?, ?, ?, ?, ?)', $values);
                $inserted = Storage::run('SELECT "id" FROM {outbox} WHERE "id" = ?', [$id]) !== [];
                // The winner may have been dispatched into the queue while this insert waited.
                $queued = Storage::run('SELECT "id" FROM {jobs} WHERE "job" = ? AND "dedupe" = ?' . Storage::forUpdate(), [$name, $key])[0]['id'] ?? null;
                if ($queued !== null || !$inserted) {
                    if ($inserted) {
                        Storage::run('DELETE FROM {outbox} WHERE "id" = ?', [$id]);
                    }

                    return ['id' => (string) ($queued ?? self::holder($name, $key) ?? throw new \RuntimeException("job key '$key' is held by a job that vanished"))];
                }
            }
            Extensions::afterCommit(static fn () => Outbox::dispatch());

            return ['id' => $id];
        });
    }

    /** The job currently holding (job, key): queued (pending/running) or still in the outbox. Locking reads see the latest commit. */
    private static function holder(string $name, string $key): ?string
    {
        $row = Storage::run('SELECT "id" FROM {outbox} WHERE "job" = ? AND "key" = ?' . Storage::forUpdate(), [$name, $key])[0]
            ?? Storage::run('SELECT "id" FROM {jobs} WHERE "job" = ? AND "dedupe" = ?' . Storage::forUpdate(), [$name, $key])[0]
            ?? null;

        return $row === null ? null : (string) $row['id'];
    }

    /** The job's schema.php entry. */
    public static function spec(string $name): array
    {
        return db()->schema()->jobs()[$name] ?? throw new \LogicException("Unknown job '$name'");
    }

    public static function uuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr(ord($b[6]) & 0x0f | 0x40);
        $b[8] = chr(ord($b[8]) & 0x3f | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }
}
