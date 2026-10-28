<?php

declare(strict_types=1);

namespace Zero;

/**
 * Read-only view of the generated schema.php plus the value codecs shared by
 * the write pipeline, filters, and action input validation.
 */
final class Schema
{
    /** @param array{collections?: array<string, array>, actions?: array<string, array>} $raw */
    public function __construct(private readonly array $raw)
    {
    }

    public static function load(string $file): self
    {
        $raw = require $file;
        if (!is_array($raw)) {
            throw new \RuntimeException("$file must return an array");
        }

        return new self($raw);
    }

    /** @return array<string, array> */
    public function collections(): array
    {
        return $this->raw['collections'] ?? [];
    }

    /** @return array<string, array> */
    public function actions(): array
    {
        return $this->raw['actions'] ?? [];
    }

    public function hasCollection(string $name): bool
    {
        return isset($this->raw['collections'][$name]);
    }

    public function collection(string $name): array
    {
        return $this->raw['collections'][$name]
            ?? throw HttpError::notFound("Unknown collection '$name'");
    }

    public function action(string $name): array
    {
        return $this->raw['actions'][$name]
            ?? throw HttpError::notFound("Unknown action '$name'");
    }

    /** Public description: no function names. */
    public function describe(): array
    {
        $collections = [];
        foreach ($this->collections() as $name => $c) {
            $collections[$name] = [
                'primaryKey' => $c['primaryKey'],
                'columns' => array_map(self::publicColumn(...), $c['columns']),
                'relations' => $c['relations'] ?? [],
                'api' => $c['api'] ?? [],
            ];
        }
        $actions = [];
        foreach ($this->actions() as $name => $a) {
            $actions[$name] = ['input' => array_map(self::publicColumn(...), $a['input'] ?? [])];
        }

        return ['collections' => $collections, 'actions' => $actions];
    }

    private static function publicColumn(array $col): array
    {
        foreach (['default', 'onUpdate'] as $k) {
            if (isset($col[$k]['fn'])) {
                $col[$k] = ['fn' => true];
            }
        }

        return $col;
    }

    // ---------------------------------------------------------------- codecs

    /** True when a create must receive this column (no default, not generated). */
    public static function isRequired(array $col): bool
    {
        return ($col['notNull'] ?? false) && !isset($col['default']) && !($col['autoIncrement'] ?? false);
    }

    /** Resolve a `default` / `onUpdate` spec. */
    public static function generate(array $spec, string $type): mixed
    {
        if (array_key_exists('value', $spec)) {
            return $spec['value'];
        }
        if ($spec['now'] ?? false) {
            return $type === 'date' ? gmdate('Y-m-d') : Js::iso(Js::now());
        }
        if (isset($spec['fn'])) {
            $fn = '\\ZeroApp\\' . $spec['fn'];

            return $fn();
        }

        throw new \LogicException('Invalid generator spec');
    }

    /**
     * Validate an input value and convert it to its SQLite storage form.
     *
     * @throws HttpError invalid_input
     */
    public static function encode(array $col, mixed $v, string $name, string $pointer): int|float|string|null
    {
        if ($v === null) {
            if ($col['notNull'] ?? false) {
                throw HttpError::invalidInput("$name is required", $pointer);
            }

            return null;
        }
        $type = $col['type'];
        $stored = match ($type) {
            'integer' => match (true) {
                is_int($v) => $v,
                is_float($v) && Js::isInteger($v) && abs($v) <= 9007199254740991 => (int) $v,
                default => null,
            },
            'real' => (is_int($v) || is_float($v)) && Js::isFinite($v) ? (float) $v : null,
            'text' => is_string($v) ? $v : null,
            'boolean' => is_bool($v) ? (int) $v : null,
            'timestamp' => self::timestamp($v),
            'date' => is_string($v) && self::isDate($v) ? $v : null,
            'json' => Js::jsonStringify($v),
            default => throw new \LogicException("Unknown column type '$type'"),
        };
        if ($stored === null) {
            throw HttpError::invalidInput("$name must be " . self::expected($type), $pointer);
        }
        if (isset($col['enum']) && !in_array($v, $col['enum'], true)) {
            throw HttpError::invalidInput("$name must be one of: " . implode(', ', $col['enum']), $pointer);
        }

        return $stored;
    }

    private static function expected(string $type): string
    {
        return match ($type) {
            'integer' => 'an integer',
            'real' => 'a finite number',
            'text' => 'a string',
            'boolean' => 'a boolean',
            'timestamp' => 'an ISO-8601 timestamp or epoch milliseconds',
            'date' => 'a date (YYYY-MM-DD)',
            default => 'a JSON value',
        };
    }

    private static function timestamp(mixed $v): ?string
    {
        if (is_int($v) || (is_float($v) && Js::isInteger($v))) {
            $ms = $v;
        } elseif (is_string($v) && $v !== '') {
            $ms = Js::date($v);
            if (is_float($ms)) { // not in JS date-time format; fall back to the PHP parser
                try {
                    $d = new \DateTimeImmutable($v, new \DateTimeZone('UTC'));
                } catch (\Exception) {
                    return null;
                }
                $ms = (int) $d->format('U') * 1000 + (int) $d->format('v');
            }
        } else {
            return null;
        }
        try {
            return Js::iso($ms);
        } catch (JsError) {
            return null;
        }
    }

    private static function isDate(string $v): bool
    {
        return (bool) preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $v, $m)
            && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }

    /** Stored SQLite value → JS-facing value. */
    public static function decode(array $col, mixed $v): mixed
    {
        if ($v === null) {
            return null;
        }

        return match ($col['type']) {
            'integer' => (int) $v,
            'real' => (float) $v,
            'boolean' => (bool) (int) $v,
            'json' => json_decode((string) $v, true),
            default => (string) $v,
        };
    }

    /** Decode a full row: every column key present, in schema order. */
    public static function decodeRow(array $columns, array $raw): array
    {
        $row = [];
        foreach ($columns as $name => $col) {
            $row[$name] = self::decode($col, $raw[$name] ?? null);
        }

        return $row;
    }

    /**
     * Validate an action/input object against a column map: unknown keys rejected,
     * defaults applied, values coerced and decoded back to their JS form.
     */
    public static function validateInput(array $columns, mixed $input, string $base = ''): array
    {
        if ($input === null) {
            $input = [];
        }
        if (!is_array($input) || ($input !== [] && array_is_list($input))) {
            throw HttpError::invalidInput('Input must be a JSON object', $base === '' ? '' : $base);
        }
        foreach ($input as $k => $_) {
            if (!isset($columns[$k])) {
                throw HttpError::invalidInput("Unknown field '$k'", $base . HttpError::seg($k));
            }
        }
        $out = [];
        foreach ($columns as $name => $col) {
            if (!array_key_exists($name, $input)) {
                if (isset($col['default'])) {
                    $input[$name] = self::generate($col['default'], $col['type']);
                } elseif ($col['notNull'] ?? false) {
                    throw HttpError::invalidInput("$name is required", $base . HttpError::seg($name));
                } else {
                    $out[$name] = null;
                    continue;
                }
            }
            $out[$name] = self::decode($col, self::encode($col, $input[$name], $name, $base . HttpError::seg($name)));
        }

        return $out;
    }
}
