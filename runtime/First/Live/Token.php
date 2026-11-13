<?php

declare(strict_types=1);

namespace First\Live;

/**
 * What a subscriber holds between polls: the counters its last answer was computed at, a hash of
 * that answer and when it was computed, sealed with a key only the site has (secretbox, a fresh
 * nonce each time). A subscriber can't read the counters, and every answer carries a new token
 * whether or not anything changed, so a token says nothing about writes the visitor can't read.
 */
final class Token
{
    /** Longer tokens are not ones this site issued. */
    public const MAX_LENGTH = 2048;

    /** @param array<string, mixed> $claims */
    public static function seal(array $claims): string
    {
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $box = sodium_crypto_secretbox((string) json_encode($claims, JSON_UNESCAPED_SLASHES), $nonce, self::key());

        return rtrim(strtr(base64_encode($nonce . $box), '+/', '-_'), '=');
    }

    /** The claims of a token this site sealed, or null for anything else. */
    public static function open(mixed $token): ?array
    {
        if (!is_string($token) || $token === '' || strlen($token) > self::MAX_LENGTH) {
            return null;
        }
        $raw = base64_decode(strtr($token, '-_', '+/'), true);
        if ($raw === false || strlen($raw) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES + SODIUM_CRYPTO_SECRETBOX_MACBYTES) {
            return null;
        }
        $plain = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), self::key());
        $claims = $plain === false ? null : json_decode($plain, true);

        return is_array($claims) ? $claims : null;
    }

    private static function key(): string
    {
        static $key = null;

        return $key ??= hash('sha256', "first-live\0" . wp_salt('auth'), true);
    }
}
