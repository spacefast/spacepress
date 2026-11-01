<?php

declare(strict_types=1);

namespace Zero;

/** The boundary between compiled values and schema-shaped runtime data. */
final class Seam
{
    /** Unwrap just this container; nested json() values retain their representation. */
    public static function container(mixed $v): mixed
    {
        return $v instanceof JsObject ? [] : $v;
    }

    /** A column spec or field map controls which subtrees remain opaque json() values. */
    public static function toPhp(mixed $v, ?array $shape = null): mixed
    {
        if ($shape === null) {
            return Js::plain($v);
        }
        if (!isset($shape['type']) || !is_string($shape['type'])) {
            $v = self::container($v);
            if (!is_array($v)) {
                return $v;
            }
            foreach ($v as $name => $value) {
                $v[$name] = isset($shape[$name]) ? self::toPhp($value, $shape[$name]) : Js::plain($value);
            }
            return $v;
        }
        $col = $shape;
        $type = $col['type'];
        if ($type === 'json') {
            return $v;
        }
        $v = self::container($v);
        if (!is_array($v)) {
            return $v;
        }
        $item = static function (array $fields, mixed $o): mixed {
            $o = self::container($o);
            if (!is_array($o)) {
                return $o;
            }
            foreach ($o as $k => $x) {
                $o[$k] = isset($fields[$k]) ? self::toPhp($x, $fields[$k]) : Js::plain($x);
            }

            return $o;
        };

        return match ($type) {
            'group' => $item($col['fields'] ?? [], $v),
            'repeater' => array_map(static fn ($o) => $item($col['fields'] ?? [], $o), $v),
            'blocks' => array_map(
                static fn ($o) => is_array($o) && is_string($o['layout'] ?? null) && isset($col['layouts'][$o['layout']])
                    ? $item($col['layouts'][$o['layout']], $o) : Js::plain($o),
                $v,
            ),
            default => Js::plain($v),
        };
    }

    /** Query options as plain arrays, except a json() column's filter operands (`{ meta: { eq: {} } }`). */
    public static function query(string $collection, mixed $opts, ?Schema $schema = null): mixed
    {
        $schema ??= Db::instance()->schema();
        $opts = self::container($opts);
        if (!is_array($opts)) {
            return Js::plain($opts);
        }
        $relations = $schema->hasCollection($collection) ? ($schema->collection($collection)['relations'] ?? []) : [];
        foreach ($opts as $k => $v) {
            $opts[$k] = match ((string) $k) {
                'where' => self::filter($collection, $v, $schema),
                // Nested relation options are queries on the related collection.
                'with' => is_array($v) || $v instanceof JsObject ? self::with($relations, $v, $schema) : Js::plain($v),
                default => Js::plain($v),
            };
        }

        return $opts;
    }

    private static function with(array $relations, array|JsObject $with, Schema $schema): array
    {
        $with = self::container($with);
        foreach ($with as $name => $o) {
            $with[$name] = isset($relations[$name]) && (is_array($o) || $o instanceof JsObject)
                ? self::query($relations[$name]['collection'], $o, $schema)
                : Js::plain($o);
        }

        return $with;
    }

    /**
     * A filter as plain arrays, walking OR/AND/NOT and relations, but leaving a json() column's
     * operands as given: `{}` and `[]` are different values to compare against.
     */
    public static function filter(string $collection, mixed $where, ?Schema $schema = null): mixed
    {
        $schema ??= Db::instance()->schema();
        $where = self::container($where);
        if (!is_array($where) || !$schema->hasCollection($collection)) {
            return Js::plain($where);
        }
        $spec = $schema->collection($collection);
        foreach ($where as $k => $v) {
            $k = (string) $k;
            $where[$k] = match (true) {
                $k === 'OR' || $k === 'AND' => is_array($v) ? array_map(fn ($f) => self::filter($collection, $f, $schema), $v) : Js::plain($v),
                $k === 'NOT' => self::filter($collection, $v, $schema),
                isset($spec['columns'][$k]) => self::plainOperand($spec['columns'][$k], $v),
                isset($spec['relations'][$k]) => self::filter($spec['relations'][$k]['collection'], $v, $schema),
                default => Js::plain($v),
            };
        }

        return $where;
    }

    /**
     * A field filter: an operator object (`{ eq: v, OR: [...] }`) maps its operands by the column's
     * schema; a bare value is itself the operand. Each operand keeps `{}` only inside json() values.
     */
    private static function plainOperand(array $col, mixed $v): mixed
    {
        $ops = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'notLike', 'ilike', 'notIlike', 'isNull', 'isNotNull', 'has', 'NOT', 'OR', 'AND'];
        $isOps = is_array($v) && $v !== [] && !array_is_list($v) && array_diff(array_map('strval', array_keys($v)), $ops) === [];
        if (!$isOps) {
            return self::toPhp($v, $col);
        }
        foreach ($v as $op => $arg) {
            $v[$op] = match ((string) $op) {
                'in', 'notIn' => is_array($arg) ? array_map(static fn ($x) => self::toPhp($x, $col), $arg) : Js::plain($arg),
                'OR', 'AND' => is_array($arg) ? array_map(static fn ($x) => self::plainOperand($col, $x), $arg) : Js::plain($arg),
                'NOT' => self::plainOperand($col, $arg),
                'isNull', 'isNotNull', 'like', 'notLike', 'ilike', 'notIlike', 'has' => Js::plain($arg),
                default => self::toPhp($arg, $col),
            };
        }

        return $v;
    }

    /** Runtime callbacks still use arrays until the representation switches atomically. */
    public static function toJs(mixed $v, ?array $shape = null): mixed
    {
        return $v;
    }

    public static function rowToJs(string $collection, array $row, array $with = []): array
    {
        return $row;
    }

    public static function rowToPhp(string $collection, array|JsObject $row): array
    {
        return self::toPhp($row, Db::instance()->schema()->collection($collection)['columns']);
    }

    public static function ctx(array $ctx, ?array $dataShape = null): array
    {
        return $ctx;
    }

    public static function generated(array $col, mixed $v): mixed
    {
        return self::toPhp($v, $col);
    }
}
