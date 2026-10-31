<?php
declare(strict_types=1);

namespace Zero\Identity;

/** Live session policy shared by WordPress and hosts without WordPress bootstrap. */
final class SessionLookup
{
    public static function digest(string $secret): string
    {
        return hash("sha256", "zero-identity-session-v1\0" . $secret);
    }

    /** The trusted adapter binds digest and current Unix time, in that order. */
    public static function statement(string $prefix): string
    {
        if (preg_match("/\A[A-Za-z0-9_]{1,56}\z/", $prefix) !== 1) {
            throw new \InvalidArgumentException(
                "Invalid identity table prefix",
            );
        }
        return "SELECT s.* FROM {$prefix}sessions s JOIN {$prefix}accounts a ON a.wp_user_id=s.wp_user_id WHERE s.secret_hash=%s AND s.revoked_at IS NULL AND s.expires_at>%d AND a.status='active'";
    }

    public static function find(
        callable $row,
        string $prefix,
        string $secret,
        int $now,
    ): ?array {
        if ($secret === "" || strlen($secret) > 512) {
            return null;
        }
        return $row(self::statement($prefix), self::digest($secret), $now);
    }
}
