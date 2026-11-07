<?php
declare(strict_types=1);
namespace Zero;

/**
 * A JavaScript Blob, or a File when $name is set. The bytes are immutable.
 *
 * text(), arrayBuffer() and bytes() return through settle(), the single place the promise model
 * wraps them once Promise values exist; until then `await` passes the value through.
 * stream() calls the factory registered with onStream(), which the streams runtime installs.
 */
final class JsBlob
{
    private static ?\Closure $stream = null;

    public function __construct(public readonly string $bytes, public readonly string $type = '', public readonly ?string $name = null, public readonly int|float $lastModified = 0) {}

    /** Register the ReadableStream factory: fn (JsBlob $blob): object. */
    public static function onStream(?\Closure $factory): void { self::$stream = $factory; }

    public static function settle(mixed $value): mixed { return $value; }

    public static function construct(string $constructor, array $a): self
    {
        $file = $constructor === 'File';
        if ($file && count($a) < 2) { throw new JsError("Failed to construct 'File': 2 arguments required", 'TypeError'); }
        $parts = $a[0] ?? JsUndefined::Value;
        $options = $a[$file ? 2 : 1] ?? JsUndefined::Value;
        $bytes = '';
        if ($parts !== JsUndefined::Value) {
            if (!is_object($parts) || $parts instanceof JsUndefined) { throw new JsError('The provided value cannot be converted to a sequence', 'TypeError'); }
            $partList = Js::dynamicIterable($parts)->a;
        }
        $type = ''; $endings = 'transparent'; $lastModified = null;
        if (!Js::isNullish($options)) {
            if (!is_object($options)) { throw new JsError('The provided options are not an object', 'TypeError'); }
            $value = Js::dynamicGet($options, 'type');
            if ($value !== JsUndefined::Value) { $type = self::normalType(Js::str($value)); }
            $value = Js::dynamicGet($options, 'endings');
            if ($value !== JsUndefined::Value) { $endings = Js::str($value); }
            if ($file) {
                $value = Js::dynamicGet($options, 'lastModified');
                if ($value !== JsUndefined::Value) { $lastModified = Js::toNumber($value); }
            }
        }
        if ($endings !== 'transparent' && $endings !== 'native') { throw new JsError("The provided value '" . $endings . "' is not a valid enum value of type EndingType", 'TypeError'); }
        foreach ($partList ?? [] as $part) {
            // Native endings rewrite string parts only, to this host's line separator, as Node does.
            $bytes .= $endings === 'native' && is_string($part) ? preg_replace('/\r\n|\r|\n/', PHP_EOL, $part) : self::part($part);
        }
        if (!$file) { return new self($bytes, $type); }
        $lastModified ??= Js::now();
        $lastModified = is_float($lastModified) && !is_finite($lastModified) ? 0 : Js::toInteger($lastModified);
        return new self($bytes, $type, Js::str($a[1]), $lastModified);
    }

    private static function part(mixed $part): string
    {
        return match (true) {
            $part instanceof self => $part->bytes,
            $part instanceof JsArrayBuffer => $part->bytes,
            $part instanceof JsTypedArray, $part instanceof JsDataView => $part->bytes(),
            default => Js::str($part),
        };
    }

    /** The type is lowercased; any character outside U+0020..U+007E makes it empty. */
    private static function normalType(string $type): string
    {
        return preg_match('/^[\x20-\x7E]*$/D', $type) ? strtolower($type) : '';
    }

    public function get(string $key): mixed
    {
        return match ($key) {
            'size' => strlen($this->bytes), 'type' => $this->type,
            'name' => $this->name ?? null, 'lastModified' => $this->name === null ? null : $this->lastModified,
            'webkitRelativePath' => $this->name === null ? null : '',
            default => null,
        };
    }

    public function call(string $name, array $a): mixed
    {
        $get = static fn (int $i): mixed => array_key_exists($i, $a) ? $a[$i] : JsUndefined::Value;
        switch ($name) {
            case 'slice':
                [$from, $to] = JsTypedArray::range($get(0), $get(1), strlen($this->bytes));
                $type = $get(2) === JsUndefined::Value ? '' : self::normalType(Js::str($get(2)));
                return new self($to > $from ? substr($this->bytes, $from, $to - $from) : '', $type);
            case 'text': return self::settle(JsText::decode($this->bytes));
            case 'arrayBuffer': return self::settle(new JsArrayBuffer($this->bytes));
            case 'bytes': return self::settle(new JsTypedArray('Uint8Array', new JsArrayBuffer($this->bytes), 0, strlen($this->bytes)));
            case 'stream':
                if (self::$stream === null) { throw new JsError('Blob.stream() needs ReadableStream, which compiled code does not support yet', 'TypeError'); }
                return (self::$stream)($this);
        }
        throw new JsError($name . ' is not a function', 'TypeError');
    }
}
