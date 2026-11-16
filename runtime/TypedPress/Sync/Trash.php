<?php

declare(strict_types=1);

namespace TypedPress\Sync;

use TypedPress\Wp\CompositeStore;
use TypedPress\Wp\Plugin;

use function TypedPress\db;

/**
 * WordPress trash for post-backed collections (§5.3): sync moves posts to the trash instead of deleting
 * them, lists trashed posts as `trashed: true`, and restores one when a record with its uid is pushed
 * again. Every other store has no trash: deletes go through the pipeline and revisions keep the row.
 *
 * A trash is what wp-admin's "Move to Trash" is (docs/decisions/2026-11-14-trash-is-unpublish.md): the
 * item leaving the published set, and nothing else. Rows that point at it, its links and its revisions
 * stay, so a restore brings back exactly what was there. The delete lifecycle (beforeDelete, onDelete
 * actions, afterDelete) runs only when someone deletes the post from the trash for good.
 */
final class Trash
{
    private const UID_META = '_tp_uid';

    public static function postBacked(array $spec): bool
    {
        return ($spec['editor'] ?? true) && ($spec['wp'] ?? null) !== null;
    }

    /** @return array<int, string> post id → uid of trashed posts with id > $after, ascending, at most $limit */
    public static function listed(string $collection, array $spec, int $after, int $limit): array
    {
        if (!self::postBacked($spec)) {
            return [];
        }
        $wpdb = Plugin::instance()->connection()->wpdb();
        $rows = Plugin::instance()->connection()->run(
            "SELECT p.ID, m.meta_value AS uid FROM `{$wpdb->posts}` p JOIN `{$wpdb->postmeta}` m ON m.post_id = p.ID AND m.meta_key = ?"
            . " WHERE p.post_type = ? AND p.post_status = 'trash' AND p.ID > ? ORDER BY p.ID LIMIT $limit",
            [self::UID_META, $spec['wp']['postType'], $after],
        );

        return array_column($rows, 'uid', 'ID');
    }

    /**
     * Move a post to the trash, in the request transaction; false when the collection has no trash.
     * A published item is unpublished: afterUpdate with the published row before and the trashed one
     * after, and the update notice. A draft leaving is nothing to visitors. $row is the full stored row
     * and the caller has authorized the trash.
     */
    public static function trash(string $collection, array $spec, array $row): bool
    {
        if (!self::postBacked($spec)) {
            return false;
        }
        $pk = (int) $row[$spec['primaryKey']];
        $connection = Plugin::instance()->connection();
        $connection->touchPost($pk);
        if (!$connection->core(static fn () => wp_trash_post($pk))) {
            throw new \RuntimeException("Could not move post $pk to the trash");
        }
        if (($row['status'] ?? null) === 'published') {
            self::changed($collection, $pk, $row);
        }

        return true;
    }

    /** The trashed post holding this uid, locked until commit; null when none or no trash. */
    public static function trashed(array $spec, string $uid): ?int
    {
        if (!self::postBacked($spec)) {
            return null;
        }
        $connection = Plugin::instance()->connection();
        $wpdb = $connection->wpdb();
        $id = $connection->run(
            "SELECT p.ID FROM `{$wpdb->posts}` p JOIN `{$wpdb->postmeta}` m ON m.post_id = p.ID AND m.meta_key = ? AND m.meta_value = ?"
            . " WHERE p.post_type = ? AND p.post_status = 'trash' LIMIT 1 FOR UPDATE",
            [self::UID_META, $uid, $spec['wp']['postType']],
        )[0]['ID'] ?? null;

        return $id === null ? null : (int) $id;
    }

    /**
     * Bring a trashed post back to the status it had, so the push updates it in place. Back to
     * published is a publish (afterUpdate, afterPublish, the notice), as wp-admin's untrash is.
     */
    public static function restore(string $collection, int $id): void
    {
        $connection = Plugin::instance()->connection();
        $trashed = db()->editorRowIncludingTrash($collection, $id);
        $previous = static fn ($status, $postId, $before) => $before;
        add_filter('wp_untrash_post_status', $previous, 10, 3);
        try {
            $connection->touchPost($id);
            if (!$connection->core(static fn () => wp_untrash_post($id))) {
                throw new \RuntimeException("Could not restore post $id from the trash");
            }
        } finally {
            remove_filter('wp_untrash_post_status', $previous, 10);
        }
        if ($trashed !== null && get_post_status($id) === 'publish') {
            self::changed($collection, $id, $trashed);
        }
    }

    /** The update lifecycle of a move into or out of the trash, with trashed posts readable. */
    private static function changed(string $collection, int $id, array $before): void
    {
        $store = db()->store();
        $run = static fn () => db()->afterEditorSave($collection, $id, $before, db()->actor());
        $store instanceof CompositeStore ? $store->posts->withTrash($run) : $run();
    }
}
