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
            if ($key !== null) {
                $existing = Storage::run('SELECT "id" FROM {jobs} WHERE "job" = ? AND "dedupe" = ?', [$name, $key])[0]
                    ?? Storage::run('SELECT "id" FROM {outbox} WHERE "job" = ? AND "key" = ?', [$name, $key])[0]
                    ?? null;
                if ($existing !== null) {
                    return ['id' => (string) $existing['id']];
                }
            }
            $id = self::uuid();
            $now = Js::now();
            Storage::run('INSERT INTO {outbox} ("id", "job", "input", "key", "runAt", "createdAt") VALUES (?, ?, ?, ?, ?, ?)', [
                $id, $name, Js::jsonStringify((object) $input), $key, Js::iso($now + (int) round($delay * 1000)), Js::iso($now),
            ]);
            Extensions::afterCommit(static fn () => Outbox::dispatch());

            return ['id' => $id];
        });
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
