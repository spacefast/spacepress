<?php

declare(strict_types=1);

namespace Zero\Auth;

use Zero\HttpError;
use Zero\Js;
use Zero\Store\SqliteStore;

/**
 * Standalone sign-in throttle (§6.2): failed password attempts per account and per client address,
 * counted in a fixed window in `__zero_attempts` (the app's own database; no other store). Past the
 * limit the grant answers 429 `rate_limited` until the window ends, whatever the password.
 */
final class Throttle
{
    public const TABLE = '__zero_attempts';
    public const WINDOW = 300;
    public const PER_ACCOUNT = 10;
    public const PER_ADDRESS = 50;

    public function __construct(private readonly SqliteStore $store)
    {
    }

    /** @return list<string> */
    public static function ddl(): array
    {
        return ['CREATE TABLE IF NOT EXISTS "__zero_attempts" ("bucket" text PRIMARY KEY NOT NULL, "hits" integer NOT NULL, "expiresAt" integer NOT NULL)'];
    }

    /** Refuse once either bucket is spent. */
    public function check(string $account, string $address): void
    {
        foreach ($this->buckets($account, $address) as [$bucket, $max]) {
            $hits = $this->store->run('SELECT "hits" FROM "__zero_attempts" WHERE "bucket" = ? AND "expiresAt" > ?', [$bucket, self::now()])->fetchColumn();
            if ($hits !== false && (int) $hits >= $max) {
                throw new HttpError(429, 'rate_limited', 'Too many sign-in attempts. Try again later.');
            }
        }
    }

    /** Count one failed attempt in both buckets (the caller commits it even though the grant fails). */
    public function fail(string $account, string $address): void
    {
        $now = self::now();
        $this->store->run('DELETE FROM "__zero_attempts" WHERE "expiresAt" <= ?', [$now]);
        foreach ($this->buckets($account, $address) as [$bucket]) {
            $this->store->run(
                'INSERT INTO "__zero_attempts" ("bucket", "hits", "expiresAt") VALUES (?, 1, ?) ON CONFLICT ("bucket") DO UPDATE SET "hits" = "hits" + 1',
                [$bucket, $now + self::WINDOW],
            );
        }
    }

    /** @return list<array{string, int}> */
    private function buckets(string $account, string $address): array
    {
        $window = intdiv(self::now(), self::WINDOW);

        return [
            [hash('sha256', 'account:' . strtolower($account) . ':' . $window), self::PER_ACCOUNT],
            [hash('sha256', 'address:' . $address . ':' . $window), self::PER_ADDRESS],
        ];
    }

    private static function now(): int
    {
        return intdiv(Js::now(), 1000);
    }
}
