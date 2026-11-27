<?php

declare(strict_types=1);

namespace SpacePress;

/**
 * Shared rules for the crypto built-ins (Node\Crypto, Node\Hash) and Web Crypto's `randomUUID`
 * and `subtle.digest`. Hash and HMAC data is capped at 1 MiB in total. A MAC key read from
 * `process.env.NAME` is trimmed, and a missing or blank one is refused; any other key is used as
 * given.
 */
final class Crypto
{
    public const MAX_DATA = 1048576;

    /** `createHmac(algorithm, process.env.NAME)`'s key: the variable trimmed, which must be set. */
    public static function envKey(string $name): string
    {
        $value = Env::get($name);
        $secret = $value === null ? '' : self::trim($value);
        if ($secret === '') {
            throw new HttpError(500, 'crypto_key_unavailable', "Set the secret variable $name for this site, then retry.");
        }

        return $secret;
    }

    /**
     * `crypto.subtle.digest(algorithm, data)`: a promise of an ArrayBuffer holding the digest.
     * The algorithm is a name or `{ name }` (SHA-1, SHA-256, SHA-384, SHA-512, case-insensitive);
     * data is an ArrayBuffer, a typed array or a DataView. As in Web Crypto, a bad algorithm or
     * data rejects the promise rather than throwing.
     */
    public static function subtleDigest(mixed $algorithm, mixed $data): JsPromise
    {
        try {
            $name = $algorithm instanceof JsObject ? ($algorithm->p['name'] ?? null) : $algorithm;
            $php = is_string($name) ? match (strtoupper($name)) {
                'SHA-1' => 'sha1', 'SHA-256' => 'sha256', 'SHA-384' => 'sha384', 'SHA-512' => 'sha512', default => null,
            } : null;
            if ($php === null) {
                throw new JsError('Unrecognized algorithm name', 'NotSupportedError');
            }
            $bytes = match (true) {
                $data instanceof JsArrayBuffer => $data->bytes,
                $data instanceof JsTypedArray, $data instanceof JsDataView => $data->bytes(),
                default => throw new JsError('Failed to execute \'digest\' on \'SubtleCrypto\': 2nd argument is not instance of ArrayBuffer, Buffer, TypedArray, or DataView.', 'TypeError'),
            };
            return JsPromise::from(new JsArrayBuffer(hash($php, $bytes, true)));
        } catch (JsError $error) {
            return JsPromise::rejected($error);
        }
    }

    /** A random RFC 4122 version 4 UUID, as `crypto.randomUUID()` returns. */
    public static function randomUUID(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        $h = bin2hex($b);

        return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' . substr($h, 16, 4) . '-' . substr($h, 20);
    }

    /** Rust's `str::trim`: Unicode White_Space at both ends, which the original keyring applied. */
    private static function trim(string $value): string
    {
        $space = '[\x{9}-\x{D}\x{20}\x{85}\x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}]';
        $trimmed = preg_replace("/\\A$space+|$space+\\z/u", '', $value);

        return is_string($trimmed) ? $trimmed : trim($value, " \t\n\r\x0B\f");
    }
}
