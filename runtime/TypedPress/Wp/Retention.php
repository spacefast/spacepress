<?php

declare(strict_types=1);

namespace TypedPress\Wp;

use TypedPress\Js;
use TypedPress\Schema;

/**
 * Config-driven retention policy (ADR 2026-11-21 §4).
 *
 * By default (`retention` omitted or `"forever"`), TypedPress NEVER automatically purges
 * soft-deleted rows, trashed posts, or revisions — WordPress's 30-day `wp_scheduled_delete`
 * is unhooked for TypedPress post types so retention is governed solely by `typedpress.config.ts`.
 *
 * When finite retention is configured (globally or per kind), `sweep()` purges expired soft-deleted
 * rows and prunes old revisions in bounded batches from Action Scheduler maintenance.
 */
final class Retention
{
    /** Effective retention in seconds for soft-deleted rows of $collection, or null for `"forever"`. */
    public static function deletedSeconds(Schema $schema, string $collection): ?int
    {
        $spec = $schema->hasCollection($collection) ? $schema->collection($collection) : null;
        if ($spec !== null && array_key_exists('retention', $spec) && is_array($spec['retention'])) {
            $sec = $spec['retention']['deletedSeconds'] ?? null;

            return is_int($sec) ? $sec : null;
        }
        $global = $schema->raw()['retention'] ?? null;
        if (is_array($global)) {
            $sec = $global['deletedSeconds'] ?? null;

            return is_int($sec) ? $sec : null;
        }

        return null;
    }

    /**
     * Effective revision retention for $collection: `['keepLast' => ?int, 'maxAgeSeconds' => ?int]`
     * or null for `"forever"`.
     *
     * @return ?array{keepLast: ?int, maxAgeSeconds: ?int}
     */
    public static function revisionsPolicy(Schema $schema, string $collection): ?array
    {
        $spec = $schema->hasCollection($collection) ? $schema->collection($collection) : null;
        if ($spec !== null && array_key_exists('retention', $spec) && is_array($spec['retention'])) {
            return is_array($spec['retention']['revisions'] ?? null) ? $spec['retention']['revisions'] : null;
        }
        $global = $schema->raw()['retention'] ?? null;
        if (is_array($global) && is_array($global['revisions'] ?? null)) {
            return $global['revisions'];
        }

        return null;
    }

    /**
     * True when WordPress's built-in 30-day `wp_scheduled_delete` must NOT auto-purge this post type.
     * Any TypedPress post type with `softDelete: true` is governed by TypedPress's retention policy
     * (default `"forever"`), never WordPress's hardcoded 30-day trash timer.
     */
    public static function blocksWpScheduledDelete(Schema $schema, string $postType): bool
    {
        foreach ($schema->collections() as $spec) {
            if (($spec['wp']['postType'] ?? null) === $postType && ($spec['softDelete'] ?? false)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Sweep expired soft-deleted rows and revisions in bounded batches (called from hourly maintenance).
     *
     * @return array{purged: int, revisionsPruned: int}
     */
    public static function sweep(Plugin $plugin, int $batchSize = 100): array
    {
        $schema = $plugin->schema;
        $db = $plugin->db();
        $nowMs = Js::now();
        $purged = 0;
        $revisionsPruned = 0;

        foreach ($schema->collections() as $name => $spec) {
            $name = (string) $name;
            if (!($spec['softDelete'] ?? false)) {
                continue;
            }
            $deletedSeconds = self::deletedSeconds($schema, $name);
            if ($deletedSeconds === null) {
                continue;
            }
            $cutoff = Js::iso($nowMs - ($deletedSeconds * 1000));
            $pk = $spec['primaryKey'];
            $expired = $db->findMany($name, [
                'deleted' => 'only',
                'where' => ['deletedAt' => ['lte' => $cutoff]],
                'columns' => [$pk => true],
                'limit' => $batchSize,
            ]);
            foreach ($expired as $row) {
                $db->purge($name, [$pk => $row[$pk]]);
                $purged++;
            }
        }

        $conn = $plugin->connection();
        $revTable = '`' . $conn->prefix() . 'tp__revisions`';
        $hasRevTable = $conn->run('SHOW TABLES LIKE ?', [$conn->prefix() . 'tp__revisions']) !== [];
        if ($hasRevTable) {
            foreach ($schema->collections() as $name => $spec) {
                $name = (string) $name;
                $policy = self::revisionsPolicy($schema, $name);
                if ($policy === null) {
                    continue;
                }
                if (is_int($policy['maxAgeSeconds'] ?? null)) {
                    $cutoff = Js::iso($nowMs - ($policy['maxAgeSeconds'] * 1000));
                    $old = $conn->run("SELECT `id` FROM $revTable WHERE `collection` = ? AND `at` <= ? LIMIT $batchSize", [$name, $cutoff]);
                    foreach ($old as $r) {
                        $conn->run("DELETE FROM $revTable WHERE `id` = ?", [(int) $r['id']]);
                        $revisionsPruned++;
                    }
                }
                if (is_int($policy['keepLast'] ?? null) && $policy['keepLast'] >= 1) {
                    $keep = (int) $policy['keepLast'];
                    $pks = $conn->run("SELECT `pk` FROM $revTable WHERE `collection` = ? GROUP BY `pk` HAVING COUNT(*) > ? LIMIT $batchSize", [$name, $keep]);
                    foreach ($pks as $p) {
                        $rows = $conn->run("SELECT `id` FROM $revTable WHERE `collection` = ? AND `pk` = ? ORDER BY `id` DESC LIMIT $batchSize OFFSET $keep", [$name, (string) $p['pk']]);
                        foreach ($rows as $r) {
                            $conn->run("DELETE FROM $revTable WHERE `id` = ?", [(int) $r['id']]);
                            $revisionsPruned++;
                        }
                    }
                }
            }
        }

        return ['purged' => $purged, 'revisionsPruned' => $revisionsPruned];
    }
}
