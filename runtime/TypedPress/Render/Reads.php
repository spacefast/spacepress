<?php

declare(strict_types=1);

namespace TypedPress\Render;

/**
 * What a page render read: each kind, with the ids of the rows it returned and whether it ran a
 * listing (docs/spec/rendering.md §6.2). Recorded through the read pipeline's own hook, which sees
 * every read the render makes, compiled or not; it returns rows unchanged.
 */
final class Reads
{
    /** @var ?array<string, array{ids: array<int|string, int|string>, listed: bool}> */
    private static ?array $current = null;
    private static bool $hooked = false;

    /**
     * A read that returned no rows but depended on all of a kind's (a count): recorded as a listing,
     * so any write to the kind counts as a change to what the render read.
     */
    public static function listed(string $collection): void
    {
        if (self::$current !== null) {
            self::$current[$collection] ??= ['ids' => [], 'listed' => false];
            self::$current[$collection]['listed'] = true;
        }
    }

    /**
     * Runs $fn and fills $reads with what it read.
     *
     * @param-out array<string, array{ids: list<int|string>, listed: bool}> $reads
     */
    public static function during(callable $fn, ?array &$reads = null): mixed
    {
        if (!self::$hooked) {
            self::$hooked = true;
            \TypedPress\Extensions::onRead(static function (array $rows, string $collection): array {
                if (self::$current !== null) {
                    self::$current[$collection] ??= ['ids' => [], 'listed' => false];
                    $entry = &self::$current[$collection];
                    $entry['listed'] = $entry['listed'] || count($rows) !== 1;
                    $pk = \TypedPress\Db::instance()->schema()->collection($collection)['primaryKey'] ?? 'id';
                    foreach ($rows as $row) {
                        if (isset($row[$pk])) {
                            $id = $row[$pk];
                            // PHP converts numeric string keys to integers. Preserve strict ID identity.
                            $entry['ids'][is_int($id) ? $id : ':' . $id] = $id;
                        }
                    }
                }
                return $rows;
            }, true, static fn (): array => []); // the primary key only, which every read selects
        }
        $previous = self::$current;
        self::$current = [];
        try {
            return $fn();
        } finally {
            $reads = self::$current;
            self::$current = $previous;
            foreach ($reads as &$entry) {
                $entry['ids'] = array_values($entry['ids']);
            }
            unset($entry);
        }
    }
}
