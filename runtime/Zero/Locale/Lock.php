<?php

declare(strict_types=1);

namespace Zero\Locale;

use Zero\HttpError;
use Zero\Js;
use Zero\Wp\CompositeStore;

use function Zero\db;

/**
 * Concurrency for translation groups on MySQL (§7.3). InnoDB's REPEATABLE READ gives a request a
 * snapshot, so a value copied from a group, or the set of rows a change is propagated to, could be
 * stale by the time this request commits. Locking reads see the latest committed state and hold it:
 * when that differs from the request's snapshot, another request changed the group first and this
 * one fails with 409 `conflict` (retry) instead of committing a divergent group. SQLite serializes
 * writers (BEGIN IMMEDIATE), so it needs none of this.
 */
final class Lock
{
    /** The row's stored values must still be the latest committed ones. */
    public static function unchanged(string $collection, int|string $pk): void
    {
        $store = db()->store();
        if (!$store instanceof CompositeStore) {
            return;
        }
        [$sql, $params] = $store->isPostBacked($collection)
            ? ['SELECT meta_key, meta_value FROM `' . $store->db->wpdb()->postmeta . "` WHERE post_id = ? AND meta_key LIKE 'zero\\_%' ORDER BY meta_id", [(int) $pk]]
            : ['SELECT * FROM `' . $store->tables->table($collection) . '` WHERE `' . db()->schema()->collection($collection)['primaryKey'] . '` = ?', [$pk]];
        if (Js::jsonStringify($store->db->run($sql, $params)) !== Js::jsonStringify($store->db->run($sql . ' FOR UPDATE', $params))) {
            throw self::conflict();
        }
    }

    /**
     * Every member of $row's group as currently committed (locked), as locale => pk. Throws when a
     * member exists that this request's snapshot can't see.
     *
     * @param array<string, int|string> $seen locale => pk as this request sees the group
     * @return array<string, int|string>
     */
    public static function members(string $collection, array $row, array $seen): array
    {
        $store = db()->store();
        if (!$store instanceof CompositeStore) {
            return $seen;
        }
        $pk = db()->schema()->collection($collection)['primaryKey'];
        if ($store->isPostBacked($collection)) {
            $current = \Zero\Wp\Polylang::locked($store->db, array_map('intval', array_values($seen)));
        } else {
            $current = [];
            if (($row['translationGroup'] ?? null) !== null) {
                foreach ($store->db->run('SELECT `' . $pk . '` AS pk, `locale` FROM `' . $store->tables->table($collection) . '` WHERE `translationGroup` = ? FOR UPDATE', [$row['translationGroup']]) as $r) {
                    $current[(string) $r['locale']] = is_numeric($r['pk']) ? (int) $r['pk'] : $r['pk'];
                }
            }
            $current += $seen;
        }
        if (array_diff(array_map('strval', $current), array_map('strval', $seen)) !== []) {
            throw self::conflict();
        }

        return $current;
    }

    private static function conflict(): HttpError
    {
        return new HttpError(409, 'conflict', 'The translation group changed while this request ran; retry it');
    }
}
