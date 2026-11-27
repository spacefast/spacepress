<?php
declare(strict_types=1);
namespace SpacePress\Node;

use SpacePress\Js;
use SpacePress\JsArray;
use SpacePress\JsArrayBuffer;
use SpacePress\JsBigInt;
use SpacePress\JsBinary;
use SpacePress\JsDataView;
use SpacePress\JsError;
use SpacePress\JsObject;
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

    /** Node's `buffer.constants.MAX_LENGTH`, as Node reports it. */
    public const MAX_LENGTH = 9007199254740991;

    /** read/write method suffix => [bytes, signed, big-endian]. */
    private const INTS = [
        'UInt8' => [1, false, false], 'Int8' => [1, true, false],
        'UInt16LE' => [2, false, false], 'UInt16BE' => [2, false, true], 'Int16LE' => [2, true, false], 'Int16BE' => [2, true, true],
        'UInt32LE' => [4, false, false], 'UInt32BE' => [4, false, true], 'Int32LE' => [4, true, false], 'Int32BE' => [4, true, true],
    ];

    /** Uint8Array methods whose result is a new view: on a Buffer they return a Buffer, as in Node. */
    private const VIEWS = ['subarray', 'slice', 'map', 'filter'];

    private const OWN = ['toString', 'equals', 'compare', 'write', 'copy', 'fill', 'indexOf', 'lastIndexOf', 'includes', 'toJSON', 'toLocaleString', 'readBigUInt64BE', 'readBigUInt64LE', 'readBigUint64BE', 'readBigUint64LE'];

    private static ?Ctor $class = null;

    /** @return array<string, mixed> */
    public static function exports(): array
    {
        return [
            'Buffer' => self::class(),
            'constants' => new JsObject(['MAX_LENGTH' => self::MAX_LENGTH, 'MAX_STRING_LENGTH' => 536870888]),
            'kMaxLength' => self::MAX_LENGTH,
            'atob' => static fn (mixed $value = JsUndefined::Value): string => JsBinary::atob($value),
            'btoa' => static fn (mixed $value = JsUndefined::Value): string => JsBinary::btoa($value),
        ];
    }

    public static function class(): Ctor
    {
        return self::$class ??= new Ctor('Buffer', [
            'from' => self::from(...),
            'of' => static fn (mixed ...$values): JsTypedArray => self::flag(JsTypedArray::of('Uint8Array', $values)),
            'alloc' => static function (mixed $size = JsUndefined::Value, mixed $fill = JsUndefined::Value, mixed $encoding = JsUndefined::Value): JsTypedArray {
                $buffer = self::allocate($size);
                $zero = $fill === JsUndefined::Value || $fill === 0;
                return $zero || $buffer->length === 0 ? $buffer : self::fill($buffer, $fill, 0, $buffer->length, $encoding);
            },
            // Zero-filled: the bytes Node leaves uninitialized would differ from run to run.
            'allocUnsafe' => static fn (mixed $size = JsUndefined::Value): JsTypedArray => self::allocate($size),
            'allocUnsafeSlow' => static fn (mixed $size = JsUndefined::Value): JsTypedArray => self::allocate($size),
            'concat' => self::concat(...),
            'isBuffer' => static fn (mixed $value = JsUndefined::Value): bool => self::isBuffer($value),
            'isEncoding' => static fn (mixed $encoding = JsUndefined::Value): bool => is_string($encoding) && self::encoding($encoding) !== null,
            'byteLength' => self::byteLength(...),
            'compare' => static fn (mixed $a = JsUndefined::Value, mixed $b = JsUndefined::Value): int
                => self::order(self::uint8($a, 'buf1')->bytes(), self::uint8($b, 'buf2')->bytes()),
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
            'hex' => self::fromHex(self::latin1($text)),
            'base64', 'base64url' => self::fromBase64(self::latin1($text)),
            'latin1', 'ascii' => self::latin1($text),
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
        if (is_string($value)) {
            $known = is_string($encoding) && $encoding !== '' ? self::knownEncoding($encoding) : 'utf8';
            return self::wrap(self::decode($value, $known));
        }
        if ($value instanceof JsArrayBuffer) {
            $offset = $encoding === JsUndefined::Value ? 0 : Js::toNumber($encoding);
            $offset = is_nan((float) $offset) ? 0 : $offset;
            $room = $value->byteLength() - $offset;
            if ($room < 0) { throw JsError::node('"offset" is outside of buffer bounds', 'RangeError', 'ERR_BUFFER_OUT_OF_BOUNDS'); }
            if ($length === JsUndefined::Value) { $length = $room; }
            else {
                $length = Js::toNumber($length);
                if ($length > $room) { throw JsError::node('"length" is outside of buffer bounds', 'RangeError', 'ERR_BUFFER_OUT_OF_BOUNDS'); }
                $length = $length > 0 ? $length : 0;
            }
            return self::flag(new JsTypedArray('Uint8Array', $value, (int) $offset, (int) $length));
        }
        if ($value instanceof JsTypedArray) {
            return self::wrap($value->size === 1 && $value->kind !== 'Int8Array' ? $value->bytes() : self::octets($value->values()));
        }
        if ($value instanceof JsArray) { return self::wrap(self::octets(array_map(Js::toNumber(...), $value->a))); }
        if ($value instanceof JsDataView) { return self::wrap(''); }
        if ($value instanceof JsObject) {
            $data = $value->p['data'] ?? null;
            if (($value->p['type'] ?? null) === 'Buffer' && $data instanceof JsArray) { return self::from($data); }
            if (array_key_exists('length', $value->p)) {
                $count = $value->p['length'];
                if (!is_int($count) && !is_float($count)) { return self::wrap(''); }
                $count = (int) min(JsArrayBuffer::MAX, max(0, Js::toInteger($count)));
                $items = [];
                for ($i = 0; $i < $count; $i++) { $items[] = Js::toNumber(Js::dynamicGet($value, (string) $i)); }
                return self::wrap(self::octets($items));
            }
        }
        throw JsError::node('The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received ' . self::received($value), 'TypeError', 'ERR_INVALID_ARG_TYPE');
    }

    /** Numbers as bytes, each converted as a Uint8Array element is. */
    private static function octets(array $numbers): string
    {
        return implode('', array_map(static fn (int|float $n): string => JsTypedArray::encode('Uint8Array', $n), $numbers));
    }

    private static function allocate(mixed $size): JsTypedArray
    {
        if (!is_int($size) && !is_float($size)) { throw self::type('size', 'number', $size); }
        if (is_nan((float) $size) || $size < 0 || $size > self::MAX_LENGTH) {
            throw self::range('size', '>= 0 && <= ' . self::MAX_LENGTH, $size);
        }
        return self::flag(JsTypedArray::allocate('Uint8Array', (int) $size));
    }

    private static function concat(mixed $list = JsUndefined::Value, mixed $total = JsUndefined::Value): JsTypedArray
    {
        if (!$list instanceof JsArray) { throw self::type('list', 'Array', $list); }
        $bytes = '';
        foreach ($list->a as $i => $item) {
            if (!$item instanceof JsTypedArray || $item->kind !== 'Uint8Array') {
                throw JsError::node('The "list[' . $i . ']" argument must be an instance of Buffer or Uint8Array. Received ' . self::received($item), 'TypeError', 'ERR_INVALID_ARG_TYPE');
            }
            $bytes .= $item->bytes();
        }
        $total = $total === JsUndefined::Value ? strlen($bytes) : self::offset($total, 'length');
        return self::wrap(str_pad(substr($bytes, 0, $total), $total, "\0"));
    }

    private static function byteLength(mixed $value = JsUndefined::Value, mixed $encoding = JsUndefined::Value): int
    {
        if (!is_string($value)) {
            if (!$value instanceof JsArrayBuffer && !self::isView($value)) {
                throw JsError::node('The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received ' . self::received($value), 'TypeError', 'ERR_INVALID_ARG_TYPE');
            }
            return strlen(self::bytes($value, 'string'));
        }
        return match (self::encoding($encoding) ?? 'utf8') {
            'utf8' => strlen($value),
            'latin1', 'ascii' => Js::length($value),
            'utf16le' => 2 * Js::length($value),
            'hex' => Js::length($value) >> 1,
            // Node estimates from the length, ignoring characters outside the alphabet.
            'base64', 'base64url' => (static function (string $text): int {
                $n = Js::length($text);
                if ($n > 0 && Js::strAt($text, $n - 1) === '=') { $n--; }
                if ($n > 1 && Js::strAt($text, $n - 1) === '=') { $n--; }
                return ($n * 3) >> 2;
            })($value),
        };
    }

    /** Methods a Buffer has beyond Uint8Array's (and the ones it overrides). */
    public static function has(string $name): bool
    {
        return in_array($name, self::OWN, true) || in_array($name, self::VIEWS, true) || self::int($name) !== null;
    }

    public static function call(JsTypedArray $buffer, string $name, array $a): mixed
    {
        $arg = static fn (int $i): mixed => array_key_exists($i, $a) ? $a[$i] : JsUndefined::Value;
        if (in_array($name, self::VIEWS, true)) {
            // `buf.slice` is a view in Node, like subarray.
            return self::flag($buffer->call($name === 'slice' ? 'subarray' : $name, $a));
        }
        if (($int = self::int($name)) !== null) {
            [$size, $signed, $big, $write] = $int;
            return $write ? self::writeInt($buffer, $size, $signed, $big, $arg(0), $arg(1)) : self::readInt($buffer, $size, $signed, $big, $arg(0));
        }
        return match ($name) {
            'toString', 'toLocaleString' => self::toText($buffer, $arg(0), $arg(1), $arg(2)),
            'equals' => $buffer->bytes() === self::uint8($arg(0), 'otherBuffer')->bytes(),
            'compare' => self::compare($buffer, $a),
            'write' => self::write($buffer, $arg(0), $arg(1), $arg(2), $arg(3)),
            'copy' => self::copy($buffer, $arg(0), $arg(1), $arg(2), $arg(3)),
            'fill' => self::fill($buffer, $arg(0), $arg(1), $arg(2), $arg(3)),
            'indexOf' => self::search($buffer, $arg(0), $arg(1), $arg(2), true),
            'lastIndexOf' => self::search($buffer, $arg(0), $arg(1), $arg(2), false),
            'includes' => self::search($buffer, $arg(0), $arg(1), $arg(2), true) !== -1,
            'toJSON' => new JsObject(['type' => 'Buffer', 'data' => new JsArray($buffer->values())]),
            'readBigUInt64BE', 'readBigUint64BE' => self::readBig($buffer, $arg(0), true),
            'readBigUInt64LE', 'readBigUint64LE' => self::readBig($buffer, $arg(0), false),
        };
    }

    /** `JSON.stringify(buf)`: Node's `toJSON` shape. */
    public static function json(JsTypedArray $buffer): \stdClass
    {
        $out = new \stdClass();
        $out->type = 'Buffer';
        $out->data = $buffer->values();
        return $out;
    }

    /** `[bytes, signed, big-endian, write]` for readUInt16LE, writeInt32BE, readUint8, ...; else null. */
    private static function int(string $name): ?array
    {
        if (!preg_match('/^(read|write)(U[Ii]nt|Int)(8|16|32)(LE|BE)?$/D', $name, $m)) { return null; }
        $key = ($m[2] === 'Int' ? 'Int' : 'UInt') . $m[3] . ($m[4] ?? '');
        return isset(self::INTS[$key]) ? [...self::INTS[$key], $m[1] === 'write'] : null;
    }

    /** `buf.toString(encoding, start, end)`, with Node's coercion of start and end. */
    private static function toText(JsTypedArray $buffer, mixed $encoding, mixed $start, mixed $end): string
    {
        $length = $buffer->length;
        $from = Js::toNumber($start);
        if ($from <= 0) { $from = 0; }
        elseif ($from >= $length) { return ''; }
        else { $from = is_nan((float) $from) ? 0 : (int) $from; }
        $to = $end === JsUndefined::Value ? $length : Js::toNumber($end);
        $to = $to > $length ? $length : (is_nan((float) $to) ? 0 : (int) $to);
        if ($to <= $from) { return ''; }
        return self::encode(substr($buffer->bytes(), (int) $from, $to - (int) $from), self::knownEncoding($encoding));
    }

    /** `buf.write(string, offset?, length?, encoding?)`: whole characters that fit, as Node writes them. */
    private static function write(JsTypedArray $buffer, mixed $text, mixed $offset, mixed $length, mixed $encoding): int
    {
        if (!is_string($text)) { throw self::type('argument', 'string', $text); }
        $size = $buffer->length;
        if ($offset === JsUndefined::Value) { [$offset, $length] = [0, $size]; }
        elseif ($length === JsUndefined::Value && is_string($offset)) { [$encoding, $offset, $length] = [$offset, 0, $size]; }
        else {
            $offset = self::offset($offset, 'offset', 0, $size);
            $room = $size - $offset;
            if ($length === JsUndefined::Value) { $length = $room; }
            elseif (is_string($length)) { [$encoding, $length] = [$length, $room]; }
            else { $length = min(self::offset($length, 'length', 0, $size), $room); }
        }
        $known = $encoding === JsUndefined::Value || $encoding === null || $encoding === '' ? 'utf8' : self::knownEncoding($encoding);
        $bytes = self::decode($text, $known);
        $n = min($length, strlen($bytes));
        if ($known === 'utf8') { while ($n > 0 && $n < strlen($bytes) && (ord($bytes[$n]) & 0xC0) === 0x80) { $n--; } }
        if ($known === 'utf16le') { $n -= $n % 2; }
        self::put($buffer, $offset, substr($bytes, 0, $n));
        return $n;
    }

    private static function copy(JsTypedArray $source, mixed $target, mixed $targetStart, mixed $sourceStart, mixed $sourceEnd): int
    {
        if (!$target instanceof JsTypedArray) {
            throw JsError::node('The "target" argument must be an instance of Buffer or Uint8Array. Received ' . self::received($target), 'TypeError', 'ERR_INVALID_ARG_TYPE');
        }
        $length = $source->byteLength();
        $at = $targetStart === JsUndefined::Value ? 0 : self::integer($targetStart);
        if ($at < 0) { throw self::range('targetStart', '>= 0', $targetStart); }
        $from = $sourceStart === JsUndefined::Value ? 0 : self::integer($sourceStart);
        if ($from < 0 || $from > $length) { throw self::range('sourceStart', ">= 0 && <= $length", $sourceStart); }
        $to = $sourceEnd === JsUndefined::Value ? $length : self::integer($sourceEnd);
        if ($to < 0) { throw self::range('sourceEnd', '>= 0', $sourceEnd); }
        if ($at >= $target->byteLength() || $from >= $to) { return 0; }
        $count = (int) min($to - $from, $target->byteLength() - $at, $length - $from);
        if ($count <= 0) { return 0; }
        $bytes = substr($source->bytes(), (int) $from, $count);
        $target->buffer->bytes = substr_replace($target->buffer->bytes, $bytes, $target->offset + (int) $at, $count);
        return $count;
    }

    /** Node's `toInteger(n, 0)` for copy offsets: floor, or 0 when not a safe number. */
    private static function integer(mixed $value): int|float
    {
        $n = Js::toNumber($value);
        return is_nan((float) $n) || abs($n) > 9007199254740991 ? 0 : floor($n);
    }

    private static function compare(JsTypedArray $source, array $a): int
    {
        $target = self::uint8($a[0] ?? JsUndefined::Value, 'target');
        if (count($a) === 1) { return self::order($source->bytes(), $target->bytes()); }
        $arg = static fn (int $i): mixed => array_key_exists($i, $a) ? $a[$i] : JsUndefined::Value;
        $targetStart = $arg(1) === JsUndefined::Value ? 0 : self::offset($arg(1), 'targetStart');
        $targetEnd = $arg(2) === JsUndefined::Value ? $target->length : self::offset($arg(2), 'targetEnd', 0, $target->length);
        $sourceStart = $arg(3) === JsUndefined::Value ? 0 : self::offset($arg(3), 'sourceStart');
        $sourceEnd = $arg(4) === JsUndefined::Value ? $source->length : self::offset($arg(4), 'sourceEnd', 0, $source->length);
        if ($sourceStart >= $sourceEnd) { return $targetStart >= $targetEnd ? 0 : -1; }
        if ($targetStart >= $targetEnd) { return 1; }
        if ($sourceStart > $source->length) { throw self::range('sourceStart', '<= ' . $source->length, $sourceStart); }
        if ($targetStart > $target->length) { throw self::range('targetStart', '<= ' . $target->length, $targetStart); }
        return self::order(
            substr($source->bytes(), $sourceStart, $sourceEnd - $sourceStart),
            substr($target->bytes(), $targetStart, $targetEnd - $targetStart),
        );
    }

    /** -1, 0 or 1 by bytes, then length. */
    private static function order(string $a, string $b): int
    {
        return $a === $b ? 0 : (strcmp($a, $b) < 0 ? -1 : 1);
    }

    /** `buf.fill(value, offset?, end?, encoding?)`: the value's bytes repeated over the range. */
    private static function fill(JsTypedArray $buffer, mixed $value, mixed $offset, mixed $end, mixed $encoding): JsTypedArray
    {
        if (is_string($value)) {
            if (is_string($offset)) { [$encoding, $offset, $end] = [$offset, JsUndefined::Value, JsUndefined::Value]; }
            elseif (is_string($end)) { [$encoding, $end] = [$end, JsUndefined::Value]; }
            $known = $encoding === JsUndefined::Value || $encoding === null ? 'utf8' : self::knownEncoding($encoding);
            $pattern = $value === '' ? "\0" : self::decode($value, $known);
            if ($pattern === '') { throw JsError::node("The argument 'value' is invalid. Received '$value'", 'TypeError', 'ERR_INVALID_ARG_VALUE'); }
        } elseif (self::isView($value)) {
            $pattern = $value->bytes();
            if ($pattern === '') { throw JsError::node("The argument 'value' is invalid.", 'TypeError', 'ERR_INVALID_ARG_VALUE'); }
        } else {
            $pattern = JsTypedArray::encode('Uint8Array', Js::toNumber($value));
        }
        if ($offset === JsUndefined::Value) { [$from, $to] = [0, $buffer->length]; }
        else {
            $from = self::offset($offset, 'offset');
            $to = $end === JsUndefined::Value ? $buffer->length : self::offset($end, 'end', 0, $buffer->length);
            if ($from >= $to) { return $buffer; }
        }
        $count = $to - $from;
        self::put($buffer, $from, substr(str_repeat($pattern, intdiv($count, strlen($pattern)) + 1), 0, $count));
        return $buffer;
    }

    /** indexOf / lastIndexOf, following Node's offset rules (src/node_buffer.cc IndexOfOffset). */
    private static function search(JsTypedArray $buffer, mixed $value, mixed $byteOffset, mixed $encoding, bool $forward): int
    {
        if (is_string($byteOffset)) { [$encoding, $byteOffset] = [$byteOffset, JsUndefined::Value]; }
        $n = Js::toNumber($byteOffset);
        $haystack = $buffer->bytes();
        $length = strlen($haystack);
        $n = is_nan((float) $n) ? ($forward ? 0 : $length) : (int) max(-2147483648, min(2147483647, $n));
        if (is_int($value) || is_float($value)) {
            $start = self::start($length, $n, 1, $forward);
            return $start <= -1 || $length === 0 ? -1 : self::find($haystack, JsTypedArray::encode('Uint8Array', $value), $start, $forward, 1);
        }
        if (is_string($value)) {
            $known = $encoding === JsUndefined::Value ? 'utf8' : self::knownEncoding($encoding);
            $needle = self::decode($value, $known);
        } elseif ($value instanceof JsTypedArray && $value->kind === 'Uint8Array') {
            $known = self::encoding($encoding) ?? 'utf8';
            $needle = $value->bytes();
        } else {
            throw JsError::node('The "value" argument must be one of type number or string or an instance of Buffer or Uint8Array. Received ' . self::received($value), 'TypeError', 'ERR_INVALID_ARG_TYPE');
        }
        $unit = $known === 'utf16le' ? 2 : 1;
        if ($unit === 2) { $needle = substr($needle, 0, strlen($needle) - strlen($needle) % 2); }
        $start = self::start($length, $n, strlen($needle), $forward);
        if ($needle === '') { return $start; }
        if ($length === 0 || $start <= -1 || $forward && strlen($needle) + $start > $length || strlen($needle) > $length) { return -1; }
        if ($unit === 2 && $length < 2) { return -1; }
        return self::find($haystack, $needle, $start, $forward, $unit);
    }

    private static function start(int $length, int $offset, int $needle, bool $forward): int
    {
        if ($offset < 0) {
            if ($offset + $length >= 0) { return $length + $offset; }
            return $forward || $needle === 0 ? 0 : -1;
        }
        if ($offset + $needle <= $length) { return $offset; }
        if ($needle === 0) { return $length; }
        return $forward ? -1 : $length - 1;
    }

    /** The first match at or after `$start`, or the last one at or before it; UTF-16 matches are unit-aligned. */
    private static function find(string $haystack, string $needle, int $start, bool $forward, int $unit): int
    {
        if ($unit === 1) {
            $at = $forward ? strpos($haystack, $needle, $start) : strrpos(substr($haystack, 0, $start + strlen($needle)), $needle);
            return $at === false ? -1 : $at;
        }
        $last = strlen($haystack) - strlen($needle);
        $i = intdiv($start, 2) * 2;
        if (!$forward) { $i = min($i, $last - $last % 2); }
        for (; $i >= 0 && $i <= $last; $i += $forward ? 2 : -2) {
            if (substr_compare($haystack, $needle, $i, strlen($needle)) === 0) { return $i; }
        }
        return -1;
    }

    private static function readInt(JsTypedArray $buffer, int $size, bool $signed, bool $big, mixed $offset): int
    {
        $bytes = self::slot($buffer, $offset, $size);
        $n = 0;
        foreach (str_split($big ? $bytes : strrev($bytes)) as $byte) { $n = $n * 256 + ord($byte); }
        return $signed && $n >= 2 ** (8 * $size - 1) ? $n - 2 ** (8 * $size) : $n;
    }

    private static function writeInt(JsTypedArray $buffer, int $size, bool $signed, bool $big, mixed $value, mixed $offset): int
    {
        $value = Js::toNumber($value);
        [$min, $max] = $signed ? [-(2 ** (8 * $size - 1)), 2 ** (8 * $size - 1) - 1] : [0, 2 ** (8 * $size) - 1];
        if ($value > $max || $value < $min) { throw self::range('value', ">= $min and <= $max", $value); }
        $at = self::at($buffer, $offset, $size);
        $bytes = JsTypedArray::encode([1 => 'Uint8Array', 2 => 'Uint16Array', 4 => 'Uint32Array'][$size], $value);
        self::put($buffer, $at, $big ? strrev($bytes) : $bytes);
        return $at + $size;
    }

    private static function readBig(JsTypedArray $buffer, mixed $offset, bool $big): JsBigInt
    {
        $bytes = self::slot($buffer, $offset, 8);
        [$high, $low] = array_values(unpack('N2', $big ? $bytes : strrev($bytes)));
        return JsBigInt::fromInt($high)->mul(JsBigInt::fromInt(4294967296))->add(JsBigInt::fromInt($low));
    }

    private static function slot(JsTypedArray $buffer, mixed $offset, int $size): string
    {
        return substr($buffer->buffer->bytes, $buffer->offset + self::at($buffer, $offset, $size), $size);
    }

    /** A read or write offset, checked as Node checks it (`boundsError`). */
    private static function at(JsTypedArray $buffer, mixed $offset, int $size): int
    {
        if ($offset === JsUndefined::Value) { $offset = 0; }
        if (!is_int($offset) && !is_float($offset)) { throw self::type('offset', 'number', $offset); }
        $whole = is_int($offset) || is_finite($offset) && floor($offset) === $offset;
        if ($whole && $offset >= 0 && $offset + $size <= $buffer->length) { return (int) $offset; }
        if (!$whole) { throw self::range('offset', 'an integer', $offset); }
        if ($buffer->length - $size < 0) { throw JsError::node('Attempt to access memory outside buffer bounds', 'RangeError', 'ERR_BUFFER_OUT_OF_BOUNDS'); }
        throw self::range('offset', '>= 0 and <= ' . ($buffer->length - $size), $offset);
    }

    private static function put(JsTypedArray $buffer, int $at, string $bytes): void
    {
        if ($bytes !== '') { $buffer->buffer->bytes = substr_replace($buffer->buffer->bytes, $bytes, $buffer->offset + $at, strlen($bytes)); }
    }

    /** Node's `validateOffset`: an integer number from `$min` to `$max`. */
    private static function offset(mixed $value, string $name, int|float $min = 0, int|float $max = self::MAX_LENGTH): int
    {
        if (!is_int($value) && !is_float($value)) { throw self::type($name, 'number', $value); }
        if (is_float($value) && (!is_finite($value) || floor($value) !== $value)) { throw self::range($name, 'an integer', $value); }
        if ($value < $min || $value > $max) { throw self::range($name, ">= $min && <= $max", $value); }
        return (int) $value;
    }

    private static function uint8(mixed $value, string $name): JsTypedArray
    {
        if ($value instanceof JsTypedArray && $value->kind === 'Uint8Array') { return $value; }
        throw JsError::node('The "' . $name . '" argument must be an instance of Buffer or Uint8Array. Received ' . self::received($value), 'TypeError', 'ERR_INVALID_ARG_TYPE');
    }

    private static function type(string $name, string $type, mixed $value): JsError
    {
        return JsError::node('The "' . $name . '" argument must be of type ' . $type . '. Received ' . self::received($value), 'TypeError', 'ERR_INVALID_ARG_TYPE');
    }

    private static function range(string $name, string $range, mixed $value): JsError
    {
        return JsError::node('The value of "' . $name . '" is out of range. It must be ' . $range . '. Received ' . Js::str($value), 'RangeError', 'ERR_OUT_OF_RANGE');
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

    /** The low byte of each UTF-16 code unit of `$text`: Node's latin1 write. */
    private static function latin1(string $text): string
    {
        if (!preg_match('/[\x80-\xFF]/', $text)) { return $text; }
        $units = unpack('v*', (string) mb_convert_encoding($text, 'UTF-16LE', 'UTF-8')) ?: [];
        return implode('', array_map(static fn (int $unit): string => chr($unit & 0xFF), $units));
    }

    /** UTF-16LE bytes as text; a lone surrogate has no UTF-8 form, so it throws (Js::splitsPair). */
    private static function fromUtf16(string $bytes): string
    {
        if (!mb_check_encoding($bytes, 'UTF-16LE')) { Js::splitsPair(); }
        return (string) mb_convert_encoding($bytes, 'UTF-8', 'UTF-16LE');
    }
}
