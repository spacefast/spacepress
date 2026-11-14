<?php

declare(strict_types=1);

/*
 * WordPress's trash for a First kind (docs/decisions/2026-11-14-trash-is-unpublish.md), in-process on
 * WordPress (tests/php/wp.php): moving a published item to the trash is the item leaving the
 * published set, as an unpublish is, never a delete. One `update` notice with its id, its pages
 * purged, gone from reads, no delete hooks, and rows that reference it with `onDelete: cascade` kept.
 * An untrash reports the status it lands in: back to published is a publish, back to draft is nothing
 * to visitors. A permanent delete from the trash runs the delete pair once.
 */

use First\Realtime\Module as Realtime;
use First\Realtime\Publisher;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
$schema['collections']['posts']['url'] = '/blog/:slug';
// A table that refuses its post's delete while a row points at it.
$pins = $schema['collections']['comments'];
$pins['key'] = 'pins';
$pins['label'] = 'Pins';
$pins['table'] = 'first_pins';
$pins['hooks'] = [];
$pins['access'] = ['read' => ['role' => 'anyone'], 'create' => ['role' => 'anyone'], 'update' => ['role' => 'editor'], 'delete' => ['role' => 'editor']];
$pins['columns'] = ['id' => $pins['columns']['id'], 'postId' => ['type' => 'integer', 'notNull' => true, 'references' => ['collection' => 'posts', 'column' => 'id', 'onDelete' => 'restrict']]];
$pins['relations'] = [];
$schema['collections']['pins'] = $pins;
foreach (['afterPublish', 'beforeDelete', 'afterDelete', 'afterUpdate', 'afterCreate'] as $name) {
    $schema['collections']['posts']['hooks'][$name] ??= $name;
}
$wp = wpSite('trash', [
    'schema' => $schema,
    'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php') . <<<'PHP'

        function afterPublish($row, $ctx) { $GLOBALS['test_hooks'][] = 'afterPublish'; }
        function beforeDelete($row, $ctx) { $GLOBALS['test_hooks'][] = 'beforeDelete'; $GLOBALS['test_actor'] = \First\Js::prop($ctx, 'user') === null ? 'anonymous' : 'signed in'; }
        function afterDelete($row, $ctx) { $GLOBALS['test_hooks'][] = 'afterDelete'; }
        function afterUpdate($row, $previous, $ctx) { $GLOBALS['test_hooks'][] = 'afterUpdate'; }
        function afterCreate($row, $ctx) { $GLOBALS['test_hooks'][] = 'afterCreate'; }
        PHP,
    'muPlugins' => ['host' => "<?php add_action('first_purge_urls', static function (array \$p): void { \$GLOBALS['test_purges'][] = \$p; });"],
]);
$db = $wp->app()->db;
wp_set_current_user(1);

$sent = [];
Realtime::publish(new class ($sent) implements Publisher {
    public function __construct(private array &$sent)
    {
    }

    public function publish(array $notice): void
    {
        $this->sent[] = $notice;
    }
});
/** What one wp-admin action announced: realtime changes, purge calls and the hooks it ran. */
$seen = static function (callable $event) use (&$sent): array {
    \First\Wp\Purges::flush();
    Realtime::flush();
    $sent = [];
    $GLOBALS['test_purges'] = [];
    $GLOBALS['test_hooks'] = [];
    $event();
    \First\Wp\Purges::flush(); // the end of the wp-admin request
    Realtime::flush();
    return [
        'notices' => array_map(static fn (array $n) => array_map(static fn ($c) => [$c['collection'], $c['ops'], $c['ids']], $n['changes']), $sent),
        'purges' => count($GLOBALS['test_purges']),
        'hooks' => $GLOBALS['test_hooks'],
    ];
};
$visible = static fn (int $id): bool => $db->findFirst('posts', ['where' => ['id' => $id]]) !== null;
$listed = static fn (int $id): bool => in_array($id, array_column($db->findMany('posts', []), 'id'), true);

$post = (int) $db->insert('posts', ['title' => 'Published', 'status' => 'published'], true)[0]['id'];
$comment = (int) $db->insert('comments', ['postId' => $post, 'name' => 'x', 'body' => 'attached'], true)[0]['id'];
$draft = (int) $db->insert('posts', ['title' => 'Draft', 'status' => 'draft'], true)[0]['id'];

// Trash a published item: an unpublish.
$trashed = $seen(static fn () => wp_trash_post($post));
eq('trash of a published item: one update notice with its id', $trashed['notices'], [[['posts', ['update'], [$post]]]]);
eq('trash of a published item: one purge announcement', $trashed['purges'], 1);
eq('trash of a published item: no delete or publish hooks, one afterUpdate', $trashed['hooks'], ['afterUpdate']);
check('trashed: no longer read', !$visible($post));
check('trashed: gone from lists', !$listed($post));
check('trashed: the comment that references it with onDelete cascade is still there', $db->findFirst('comments', ['where' => ['id' => $comment]]) !== null);

// Untrash to draft (core's default): nothing to visitors.
$toDraft = $seen(static fn () => wp_untrash_post($post));
eq('untrash to draft: no notice, no purge, no hooks', $toDraft, ['notices' => [], 'purges' => 0, 'hooks' => []]);
eq('untrash to draft: the item is a draft', $db->findFirst('posts', ['where' => ['id' => $post]])['status'] ?? null, 'draft');

// Back to the trash as a draft: nothing to visitors.
$draftTrash = $seen(static fn () => wp_trash_post($post));
eq('trash of a draft: nothing', $draftTrash, ['notices' => [], 'purges' => 0, 'hooks' => []]);

// Untrash to published (the previous status, as WordPress's own filter offers): a publish.
wp_update_post(['ID' => $post, 'post_status' => 'trash']);
update_post_meta($post, '_wp_trash_meta_status', 'publish');
\First\Wp\Purges::flush();
Realtime::flush();
$previous = static fn ($status, $id, $before) => $before;
add_filter('wp_untrash_post_status', $previous, 10, 3);
$republished = $seen(static fn () => wp_untrash_post($post));
remove_filter('wp_untrash_post_status', $previous, 10);
eq('untrash to published: one update notice with its id', $republished['notices'], [[['posts', ['update'], [$post]]]]);
eq('untrash to published: one purge announcement', $republished['purges'], 1);
eq('untrash to published: afterPublish once, never afterCreate', $republished['hooks'], ['afterUpdate', 'afterPublish']);
check('untrashed to published: read again and listed', $visible($post) && $listed($post));
eq('untrashed: the comment is still attached', $db->findFirst('comments', ['where' => ['id' => $comment]])['postId'] ?? null, $post);

// A draft trashed from the start: nothing.
eq('trash of a draft item: nothing', $seen(static fn () => wp_trash_post($draft)), ['notices' => [], 'purges' => 0, 'hooks' => []]);

// Trash, then delete permanently: the delete pair once, at the permanent delete.
$seen(static fn () => wp_trash_post($post));
$deleted = $seen(static fn () => wp_delete_post($post, true));
eq('delete from the trash: beforeDelete and afterDelete once each', array_count_values($deleted['hooks']), ['beforeDelete' => 1, 'afterDelete' => 1]);
eq('delete from the trash: one delete notice', $deleted['notices'], [[['comments', ['delete'], [$comment]], ['posts', ['delete'], [$post]]]]);
check('delete from the trash: the cascade ran then', $db->findFirst('comments', ['where' => ['id' => $comment]]) === null);

// Search reads leave the trash out: gone from results and from the count, back after an untrash to
// published, with no rebuild in between.
$found = static fn (string $q): array => [array_column($db->findMany('posts', ['search' => $q]), 'id'), $db->count('posts', null, null, ['search' => $q])];
$searchable = (int) $db->insert('posts', ['title' => 'Zanzibar notes', 'status' => 'published'], true)[0]['id'];
eq('search: published item found and counted', $found('zanzibar'), [[$searchable], 1]);
wp_trash_post($searchable);
eq('search: trashed item absent from results and count', $found('zanzibar'), [[], 0]);
add_filter('wp_untrash_post_status', $previous, 10, 3);
wp_untrash_post($searchable);
remove_filter('wp_untrash_post_status', $previous, 10);
eq('search: back after untrash to published, no rebuild', $found('zanzibar'), [[$searchable], 1]);

// onDelete: restrict refuses a delete from the trash as it refuses one of a live row.
$pinned = (int) $db->insert('posts', ['title' => 'Pinned', 'status' => 'published'], true)[0]['id'];
$db->insert('pins', ['postId' => $pinned]);
$refusal = static function (callable $delete): ?string {
    try {
        $db = \First\db();
        $db->transaction($delete);
    } catch (\First\HttpError $e) {
        return "{$e->status} {$e->getMessage()}";
    }
    return null;
};
$live = $refusal(static fn () => $db->delete('posts', ['id' => $pinned]));
wp_trash_post($pinned);
add_filter('wp_die_handler', static fn () => static function ($message): never { throw new \RuntimeException('wp_die: ' . (is_string($message) ? $message : '')); });
$fromTrash = null;
try {
    wp_delete_post($pinned, true);
} catch (\RuntimeException $e) {
    $fromTrash = $e->getMessage();
}
eq('restrict: a live delete is refused', $live, '409 Rows in pins still reference this row');
eq('restrict: a delete from the trash is refused with the same message', $fromTrash, 'wp_die: Rows in pins still reference this row');
check('restrict: the refused post is still in the trash', get_post_status($pinned) === 'trash');

// WordPress empties the trash itself (wp_scheduled_delete, cron, nobody signed in): the delete pair
// once, the cascade, the delete notice.
$old = (int) $db->insert('posts', ['title' => 'Old', 'status' => 'published'], true)[0]['id'];
$oldComment = (int) $db->insert('comments', ['postId' => $old, 'name' => 'x', 'body' => 'old'], true)[0]['id'];
wp_trash_post($old);
update_post_meta($old, '_wp_trash_meta_time', time() - (EMPTY_TRASH_DAYS + 1) * DAY_IN_SECONDS);
$cronError = null;
$cron = $seen(static function () use (&$cronError): void {
    wp_set_current_user(0);
    try {
        wp_scheduled_delete();
    } catch (\Throwable $e) {
        $cronError = get_class($e) . ': ' . $e->getMessage();
    }
});
eq('cron: nothing threw', $cronError, null);
eq('cron: beforeDelete saw no signed-in user', $GLOBALS['test_actor'] ?? null, 'anonymous');
eq('cron: the delete pair once for the old item', array_count_values($cron['hooks']), ['beforeDelete' => 1, 'afterDelete' => 1]);
check('cron: the old item is gone', get_post($old) === null);
check('cron: its cascade child is gone', $db->findFirst('comments', ['where' => ['id' => $oldComment]]) === null);
eq('cron: the delete notice', $cron['notices'], [[['comments', ['delete'], [$oldComment]], ['posts', ['delete'], [$old]]]]);

// Empty Trash in wp-admin (edit.php's delete_all): one wp_delete_post per trashed item, in id order;
// a refusal wp_dies there, after the items before it were deleted and before the ones after it.
$a = (int) $db->insert('posts', ['title' => 'Empty A', 'status' => 'published'], true)[0]['id'];
$aComment = (int) $db->insert('comments', ['postId' => $a, 'name' => 'x', 'body' => 'a'], true)[0]['id'];
$b = (int) $db->insert('posts', ['title' => 'Empty B', 'status' => 'published'], true)[0]['id'];
$db->insert('pins', ['postId' => $b]);
$c = (int) $db->insert('posts', ['title' => 'Empty C', 'status' => 'published'], true)[0]['id'];
$cComment = (int) $db->insert('comments', ['postId' => $c, 'name' => 'x', 'body' => 'c'], true)[0]['id'];
foreach ([$a, $b, $c] as $id) {
    wp_trash_post($id);
}
wp_set_current_user(1);
$emptyError = null;
try {
    foreach ([$a, $b, $c] as $id) { // edit.php: foreach ($post_ids as $post_id) { … wp_delete_post($post_id) … }
        wp_delete_post($id);
    }
} catch (\RuntimeException $e) {
    $emptyError = $e->getMessage();
}
$GLOBALS['test_out']['empty'] = [
    'error' => $emptyError,
    'a' => [get_post_status($a), $db->findFirst('comments', ['where' => ['id' => $aComment]]) !== null],
    'b' => get_post_status($b),
    'c' => [get_post_status($c), $db->findFirst('comments', ['where' => ['id' => $cComment]]) !== null],
];
eq('Empty Trash: items before a refused one are deleted whole, with their cascade', $GLOBALS['test_out']['empty']['a'], [false, false]);
eq('Empty Trash: the refused item stays in the trash', $GLOBALS['test_out']['empty']['b'], 'trash');
eq('Empty Trash: items after it are untouched, child attached', $GLOBALS['test_out']['empty']['c'], ['trash', true]);

Realtime::reset();
finish('trash');
