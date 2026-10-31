<?php

declare(strict_types=1);

namespace Zero\Auth;

use Zero\HttpError;
use Zero\Js;
use Zero\Store\SqliteStore;

/**
 * Standalone sessions (§6.2): `za_` access tokens (TTL from schema.php `auth.accessTtl`) and `zr_`
 * refresh tokens (`auth.refreshTtl`), both stored as sha256. A session row is one access/refresh
 * pair; rotating the refresh token writes a new row in the same `family` and marks the old one
 * used. Presenting a used refresh token revokes the whole family (theft detection).
 */
final class Sessions
{
    public const TABLE = '__zero_sessions';

    public function __construct(
        private readonly SqliteStore $store,
        private readonly int $accessTtl,
        private readonly int $refreshTtl,
    ) {
    }

    /** @return list<string> */
    public static function ddl(): array
    {
        return [
            'CREATE TABLE IF NOT EXISTS "__zero_sessions" ("id" text PRIMARY KEY NOT NULL, "userId" integer NOT NULL, "family" text NOT NULL, "accessHash" text NOT NULL UNIQUE, "refreshHash" text NOT NULL UNIQUE, "accessExpiresAt" text NOT NULL, "refreshExpiresAt" text NOT NULL, "usedAt" text, "replacedBy" text, "revokedAt" text, "createdAt" text NOT NULL)',
            'CREATE INDEX IF NOT EXISTS "__zero_sessions_family" ON "__zero_sessions" ("family")',
            'CREATE INDEX IF NOT EXISTS "__zero_sessions_user" ON "__zero_sessions" ("userId")',
        ];
    }

    /** @return array{accessToken: string, refreshToken: string, expiresIn: int} */
    public function issue(int $userId, ?string $family = null): array
    {
        $access = 'za_' . self::random();
        $refresh = 'zr_' . self::random();
        $now = Js::now();
        $this->store->run(
            'INSERT INTO "__zero_sessions" ("id", "userId", "family", "accessHash", "refreshHash", "accessExpiresAt", "refreshExpiresAt", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [bin2hex(random_bytes(16)), $userId, $family ?? bin2hex(random_bytes(16)), hash('sha256', $access), hash('sha256', $refresh),
                Js::iso($now + $this->accessTtl * 1000), Js::iso($now + $this->refreshTtl * 1000), Js::iso($now)],
        );

        return ['accessToken' => $access, 'refreshToken' => $refresh, 'expiresIn' => $this->accessTtl];
    }

    /**
     * The session an access token belongs to: [sessionId, userId, live]. `live` is false for a
     * revoked or expired token (the caller still checks the user, so suspension reads as such).
     * Null when the token was never issued.
     */
    public function resolve(string $access): ?array
    {
        if (!preg_match('/^za_[A-Za-z0-9_-]{43}$/D', $access)) {
            return null;
        }
        $row = $this->store->run(
            'SELECT "id", "userId", "revokedAt", "accessExpiresAt" FROM "__zero_sessions" WHERE "accessHash" = ?',
            [hash('sha256', $access)],
        )->fetch();

        return $row === false ? null : [(string) $row['id'], (int) $row['userId'], $row['revokedAt'] === null && $row['accessExpiresAt'] > Js::iso(Js::now())];
    }

    /**
     * Rotate a refresh token: a fresh pair in the same family; the old row is marked used and
     * revoked. Returns [userId, tokens]. Every failure is the same 400 invalid_grant.
     *
     * @param callable(int): void $live throws when the user may no longer sign in (suspended, gone)
     * @return array{int, array{accessToken: string, refreshToken: string, expiresIn: int}}
     */
    public function rotate(string $refresh, callable $live): array
    {
        // §3.5's semantics, as zero-identity answers them: 400 invalid_grant.
        $invalid = static fn () => new HttpError(400, 'invalid_grant', 'The refresh token is invalid, expired or revoked');
        if (!preg_match('/^zr_[A-Za-z0-9_-]{43}$/D', $refresh)) {
            throw $invalid();
        }
        $row = $this->store->run('SELECT * FROM "__zero_sessions" WHERE "refreshHash" = ?', [hash('sha256', $refresh)])->fetch();
        if ($row === false) {
            throw $invalid();
        }
        if ($row['usedAt'] !== null) {
            // Reuse: someone else holds a rotated token. End the family; the error must not undo it.
            $this->revokeFamily((string) $row['family']);
            throw new Reused($invalid());
        }
        if ($row['revokedAt'] !== null || $row['refreshExpiresAt'] <= Js::iso(Js::now())) {
            throw $invalid();
        }
        $live((int) $row['userId']);
        $tokens = $this->issue((int) $row['userId'], (string) $row['family']);
        $at = Js::iso(Js::now());
        $this->store->run(
            'UPDATE "__zero_sessions" SET "usedAt" = ?, "revokedAt" = ?, "replacedBy" = ? WHERE "id" = ?',
            [$at, $at, hash('sha256', $tokens['refreshToken']), $row['id']],
        );

        return [(int) $row['userId'], $tokens];
    }

    /** Revoke the family a session belongs to (sign-out). */
    public function end(string $sessionId): void
    {
        $family = $this->store->run('SELECT "family" FROM "__zero_sessions" WHERE "id" = ?', [$sessionId])->fetchColumn();
        if ($family !== false) {
            $this->revokeFamily((string) $family);
        }
    }

    public function revokeUser(int $userId): void
    {
        $this->store->run('UPDATE "__zero_sessions" SET "revokedAt" = ? WHERE "userId" = ? AND "revokedAt" IS NULL', [Js::iso(Js::now()), $userId]);
    }

    private function revokeFamily(string $family): void
    {
        $this->store->run('UPDATE "__zero_sessions" SET "revokedAt" = ? WHERE "family" = ? AND "revokedAt" IS NULL', [Js::iso(Js::now()), $family]);
    }

    private static function random(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }
}
