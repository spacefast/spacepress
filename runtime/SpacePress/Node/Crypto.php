<?php
declare(strict_types=1);
namespace SpacePress\Node;

use SpacePress\Crypto as Limits;
use SpacePress\HttpError;
use SpacePress\Js;
use SpacePress\JsArrayBuffer;
use SpacePress\JsError;
use SpacePress\JsObject;
use SpacePress\JsUndefined;

/** `node:crypto`'s exports, over PHP's `hash`, `hash_equals` and `random_bytes`. */
final class Crypto
{
    public const HASHES = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'];

    /** @return array<string, mixed> */
    public static function exports(): array
    {
        return [
            'createHash' => static fn (mixed $algorithm = JsUndefined::Value, mixed $options = JsUndefined::Value): Hash
                => new Hash(self::hash($algorithm) ?? throw new JsError('Digest method not supported', 'Error')),
            'createHmac' => static fn (mixed $algorithm = JsUndefined::Value, mixed $key = JsUndefined::Value, mixed $options = JsUndefined::Value): Hash
                => new Hash(
                    self::hash($algorithm) ?? throw JsError::node('Invalid digest: ' . Js::str($algorithm), 'TypeError', 'ERR_CRYPTO_INVALID_DIGEST'),
                    self::key($key),
                ),
            'randomBytes' => self::randomBytes(...),
            'randomUUID' => static function (mixed $options = JsUndefined::Value): string {
                if ($options !== JsUndefined::Value && !$options instanceof JsObject) {
                    throw JsError::node('The "options" argument must be of type object', 'TypeError', 'ERR_INVALID_ARG_TYPE');
                }
                return Limits::randomUUID();
            },
            'timingSafeEqual' => self::timingSafeEqual(...),
        ];
    }

    /** A supported digest's PHP name, case-insensitive as in Node, or null. */
    private static function hash(mixed $algorithm): ?string
    {
        if (!is_string($algorithm)) {
            throw JsError::node('The "algorithm" argument must be of type string', 'TypeError', 'ERR_INVALID_ARG_TYPE');
        }
        $name = strtolower($algorithm);
        return in_array($name, self::HASHES, true) ? $name : null;
    }

    /** An HMAC key: text as UTF-8, or the bytes of a buffer or view. Capped like the data it signs. */
    private static function key(mixed $key): string
    {
        if (!is_string($key) && !$key instanceof JsArrayBuffer && !Buffer::isView($key)) {
            throw JsError::node('The "key" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView', 'TypeError', 'ERR_INVALID_ARG_TYPE');
        }
        $bytes = Buffer::bytes($key, 'key');
        if (strlen($bytes) > Limits::MAX_DATA) {
            throw new HttpError(413, 'crypto_input_too_large', 'The crypto input is too large.');
        }
        return $bytes;
    }

    /** `randomBytes(size)`, size from 0 to 1024 (a documented difference: Node allows 2^31 - 1). */
    private static function randomBytes(mixed $size = JsUndefined::Value, mixed $callback = JsUndefined::Value): \SpacePress\JsTypedArray
    {
        if (!is_int($size) && !is_float($size)) {
            throw JsError::node('The "size" argument must be of type number', 'TypeError', 'ERR_INVALID_ARG_TYPE');
        }
        if (is_nan((float) $size) || $size < 0 || $size > 2147483647) {
            throw JsError::node('The value of "size" is out of range. It must be >= 0 && <= 2147483647', 'RangeError', 'ERR_OUT_OF_RANGE');
        }
        if ($callback !== JsUndefined::Value) {
            throw new JsError('randomBytes with a callback is not supported in SpacePress code; call it without one', 'TypeError');
        }
        $size = (int) $size;
        if ($size > 1024) {
            throw new JsError('randomBytes takes 0 to 1024 bytes in SpacePress code', 'RangeError');
        }
        return Buffer::wrap($size === 0 ? '' : random_bytes($size));
    }

    /** Constant time over two equal-length buffers or views; different lengths throw, as in Node. */
    private static function timingSafeEqual(mixed $a = JsUndefined::Value, mixed $b = JsUndefined::Value): bool
    {
        foreach (['buf1' => $a, 'buf2' => $b] as $name => $value) {
            if (!$value instanceof JsArrayBuffer && !Buffer::isView($value)) {
                throw JsError::node('The "' . $name . '" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.', 'TypeError', 'ERR_INVALID_ARG_TYPE');
            }
        }
        $a = Buffer::bytes($a, 'buf1');
        $b = Buffer::bytes($b, 'buf2');
        if (strlen($a) > Limits::MAX_DATA || strlen($b) > Limits::MAX_DATA) {
            throw new HttpError(413, 'crypto_input_too_large', 'The crypto input is too large.');
        }
        if (strlen($a) !== strlen($b)) {
            throw JsError::node('Input buffers must have the same byte length', 'RangeError', 'ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH');
        }
        return hash_equals($a, $b);
    }
}
