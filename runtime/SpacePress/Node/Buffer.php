<?php
declare(strict_types=1);
namespace SpacePress\Node;

use SpacePress\Js;
use SpacePress\JsArrayBuffer;
use SpacePress\JsDataView;
use SpacePress\JsError;
use SpacePress\JsText;
use SpacePress\JsTypedArray;
use SpacePress\JsUndefined;

/**
 * `node:buffer`. A Buffer is the runtime's Uint8Array (JsTypedArray) with `nodeBuffer` set, so
 * `buf instanceof Uint8Array` holds as in Node; Buffer's own methods are dispatched here first and
 * every other Uint8Array method is inherited. Every Node built-in reads its byte inputs with
 * `bytes()` and returns bytes with `wrap()`.
 */
final class Buffer
{
    /** Node's names for each encoding, lower-cased, to the one this class implements. */
    private const ENCODINGS = [
        'utf8' => 'utf8', 'utf-8' => 'utf8', 'hex' => 'hex', 'base64' => 'base64', 'base64url' => 'base64url',
        'latin1' => 'latin1', 'binary' => 'latin1', 'ascii' => 'ascii',
        'utf16le' => 'utf16le', 'utf-16le' => 'utf16le', 'ucs2' => 'utf16le', 'ucs-2' => 'utf16le',
    ];

    private static ?Ctor $class = null;

    /** @return array<string, mixed> */
    public static function exports(): array
    {
        return ['Buffer' => self::class()];
    }

    public static function class(): Ctor
    {
        return self::$class ??= new Ctor('Buffer', [
            'from' => self::from(...),
            'isBuffer' => static fn (mixed $value = JsUndefined::Value): bool => self::isBuffer($value),
            'byteLength' => static fn (mixed $value = JsUndefined::Value, mixed $encoding = JsUndefined::Value): int
                => strlen(is_string($value) ? self::decode($value, self::encoding($encoding) ?? 'utf8') : self::bytes($value, 'string')),
        ], self::isBuffer(...));
    }

    /** A flagged Uint8Array over its own copy of `$bytes`. */
    public static function wrap(string $bytes): JsTypedArray
    {
        return self::flag(JsTypedArray::fromBytes($bytes));
    }

    public static function flag(JsTypedArray $view): JsTypedArray
    {
        $view->nodeBuffer = true;
        return $view;
    }

    public static function isBuffer(mixed $value): bool
    {
        return $value instanceof JsTypedArray && $value->nodeBuffer;
    }

    /** A typed array or DataView: what Node accepts as an `ArrayBufferView`. */
    public static function isView(mixed $value): bool
    {
        return $value instanceof JsTypedArray || $value instanceof JsDataView;
    }

    /**
     * The bytes of a Node byte input: a string (UTF-8), any typed array or DataView, or an
     * ArrayBuffer. Anything else is Node's ERR_INVALID_ARG_TYPE naming `$what`.
     */
    public static function bytes(mixed $value, string $what): string
    {
        return match (true) {
            is_string($value) => $value,
            $value instanceof JsTypedArray, $value instanceof JsDataView => $value->bytes(),
            $value instanceof JsArrayBuffer => $value->bytes,
            default => throw JsError::node('The "' . $what . '" argument must be of type string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer. Received ' . self::received($value), 'TypeError', 'ERR_INVALID_ARG_TYPE'),
        };
    }

    /** Node's name for a known encoding, case-insensitive; null for undefined or an unknown one. */
    public static function encoding(mixed $encoding): ?string
    {
        return is_string($encoding) ? self::ENCODINGS[strtolower($encoding)] ?? null : null;
    }

    /** Like encoding(), but an unknown name throws ERR_UNKNOWN_ENCODING; undefined is UTF-8. */
    public static function knownEncoding(mixed $encoding): string
    {
        if ($encoding === JsUndefined::Value) { return 'utf8'; }
        return self::encoding($encoding) ?? throw JsError::node('Unknown encoding: ' . Js::str($encoding), 'TypeError', 'ERR_UNKNOWN_ENCODING');
    }

    /** `Buffer.from(text, encoding)`: the bytes `$text` stands for in `$encoding`. */
    public static function decode(string $text, string $encoding): string
    {
        return match (self::encoding($encoding) ?? throw JsError::node('Unknown encoding: ' . $encoding, 'TypeError', 'ERR_UNKNOWN_ENCODING')) {
            'utf8' => $text,
            'hex' => self::fromHex($text),
            'base64', 'base64url' => self::fromBase64($text),
            'latin1', 'ascii' => self::units($text, static fn (int $unit): string => chr($unit & 0xFF)),
            'utf16le' => (string) mb_convert_encoding($text, 'UTF-16LE', 'UTF-8'),
        };
    }

    /** `buf.toString(encoding)`: `$bytes` as text in `$encoding`. */
    public static function encode(string $bytes, string $encoding): string
    {
        return match (self::encoding($encoding) ?? throw JsError::node('Unknown encoding: ' . $encoding, 'TypeError', 'ERR_UNKNOWN_ENCODING')) {
            'utf8' => JsText::decode($bytes, false, true),
            'hex' => bin2hex($bytes),
            'base64' => base64_encode($bytes),
            'base64url' => rtrim(strtr(base64_encode($bytes), '+/', '-_'), '='),
            'latin1' => (string) mb_convert_encoding($bytes, 'UTF-8', 'ISO-8859-1'),
            'ascii' => (string) mb_convert_encoding($bytes & str_repeat("\x7F", strlen($bytes)), 'UTF-8', 'ISO-8859-1'),
            'utf16le' => self::fromUtf16(strlen($bytes) % 2 === 0 ? $bytes : substr($bytes, 0, -1)),
        };
    }

    /** `Buffer.from(value, encodingOrOffset?, length?)`. */
    public static function from(mixed $value = JsUndefined::Value, mixed $encoding = JsUndefined::Value, mixed $length = JsUndefined::Value): JsTypedArray
    {
        if (is_string($value)) { return self::wrap(self::decode($value, self::encoding($encoding) ?? 'utf8')); }
        if ($value instanceof JsTypedArray) {
            return self::wrap($value->kind === 'Uint8Array' || $value->kind === 'Uint8ClampedArray' || $value->kind === 'Int8Array'
                ? $value->bytes()
                : pack('C*', ...array_map(static fn ($n) => is_float($n) ? (is_finite($n) ? (int) fmod($n, 256) : 0) : $n, $value->values())));
        }
        throw JsError::node('The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received ' . self::received($value), 'TypeError', 'ERR_INVALID_ARG_TYPE');
    }

    /** Methods a Buffer has beyond Uint8Array's (and the ones it overrides). */
    public static function has(string $name): bool
    {
        return in_array($name, ['toString', 'equals'], true);
    }

    public static function call(JsTypedArray $buffer, string $name, array $a): mixed
    {
        $arg = static fn (int $i): mixed => array_key_exists($i, $a) ? $a[$i] : JsUndefined::Value;
        return match ($name) {
            'toString' => self::encode($buffer->bytes(), self::knownEncoding($arg(0))),
            'equals' => $arg(0) instanceof JsTypedArray && $arg(0)->kind === 'Uint8Array'
                ? $buffer->bytes() === $arg(0)->bytes()
                : throw JsError::node('The "otherBuffer" argument must be an instance of Buffer or Uint8Array. Received ' . self::received($arg(0)), 'TypeError', 'ERR_INVALID_ARG_TYPE'),
        };
    }

    /** Node's description of a wrong argument (`type string ('x')`, `an instance of Map`). */
    public static function received(mixed $value): string
    {
        return match (true) {
            $value === JsUndefined::Value => 'undefined',
            $value === null => 'null',
            is_string($value) => "type string ('" . (strlen($value) > 25 ? substr($value, 0, 25) . '...' : $value) . "')",
            is_bool($value) => 'type boolean (' . ($value ? 'true' : 'false') . ')',
            is_int($value), is_float($value) => 'type number (' . Js::str($value) . ')',
            $value instanceof \Closure => 'function',
            default => 'an instance of ' . substr(Js::dynamicObjectTag($value), 8, -1),
        };
    }

    /** Hex pairs up to the first invalid one, as Node decodes them. */
    private static function fromHex(string $text): string
    {
        $out = '';
        for ($i = 0; $i + 1 < strlen($text); $i += 2) {
            $pair = substr($text, $i, 2);
            if (!ctype_xdigit($pair)) { break; }
            $out .= chr((int) hexdec($pair));
        }
        return $out;
    }

    /**
     * Node's lenient base64 and base64url: either alphabet, padding optional, everything outside
     * the alphabet skipped, and decoding stops at the first `=`.
     */
    private static function fromBase64(string $text): string
    {
        $end = strpos($text, '=');
        $clean = (string) preg_replace('/[^A-Za-z0-9+\/_-]/', '', $end === false ? $text : substr($text, 0, $end));
        $clean = strtr($clean, '-_', '+/');
        if (strlen($clean) % 4 === 1) { $clean = substr($clean, 0, -1); }
        return (string) base64_decode($clean . str_repeat('=', (4 - strlen($clean) % 4) % 4));
    }

    /** One byte per UTF-16 code unit of `$text`, from `$byte(unit)`. */
    private static function units(string $text, \Closure $byte): string
    {
        $units = unpack('v*', (string) mb_convert_encoding($text, 'UTF-16LE', 'UTF-8')) ?: [];
        return implode('', array_map($byte, $units));
    }

    /** UTF-16LE bytes as text; a lone surrogate has no UTF-8 form, so it throws (Js::splitsPair). */
    private static function fromUtf16(string $bytes): string
    {
        if (!mb_check_encoding($bytes, 'UTF-16LE')) { Js::splitsPair(); }
        return (string) mb_convert_encoding($bytes, 'UTF-8', 'UTF-16LE');
    }
}
