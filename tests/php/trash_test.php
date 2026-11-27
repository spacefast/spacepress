<?php

declare(strict_types=1);

/*
 * WordPress's trash for a SpacePress kind (docs/decisions/2026-11-14-trash-is-unpublish.md), in-process on
 * WordPress (tests/php/wp.php): moving a published item to the trash is the item leaving the
 * published set, as an unpublish is, never a delete. One `update` notice with its id, its pages
 * purged, gone from reads, no delete hooks, and rows that reference it with `onDelete: cascade` kept.
 * An untrash reports the status it lands in: back to published is a publish, back to draft is nothing
 * to visitors. A permanent delete from the trash runs the delete pair once.
 */

use SpacePress\Realtime\Module as Realtime;
use SpacePress\Realtime\Publisher;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema                                = require dirname( __DIR__ ) . '/fixtures/blog/schema.php';
$schema['collections']['posts']['url'] = '/blog/:slug';
// This suite exercises WordPress's native wp_scheduled_delete cron; opt posts out of SpacePress's
// default retention: "forever" soft-delete guard so core's trash cron runs here.
$schema['collections']['posts']['softDelete'] = false;
// A table that refuses its post's delete while a row points at it.
$pins                          = $schema['collections']['comments'];
$pins['key']                   = 'pins';
$pins['label']                 = 'Pins';
$pins['table']                 = 'sp_pins';
$pins['hooks']                 = array();
$pins['access']                = array(
	'read'   => array( 'role' => 'anyone' ),
	'create' => array( 'role' => 'anyone' ),
	'update' => array( 'role' => 'editor' ),
	'delete' => array( 'role' => 'editor' ),
);
$pins['columns']               = array(
	'id'     => $pins['columns']['id'],
	'postId' => array(
		'type'       => 'integer',
		'notNull'    => true,
		'references' => array(
			'collection' => 'posts',
			'column'     => 'id',
			'onDelete'   => 'restrict',
		),
	),
);
$pins['relations']             = array();
$schema['collections']['pins'] = $pins;
foreach ( array( 'afterPublish', 'beforeDelete', 'afterDelete', 'afterUpdate', 'afterCreate' ) as $name ) {
	$schema['collections']['posts']['hooks'][ $name ] ??= $name;
}
$wp = wpSite(
	'trash',
	array(
		'schema'    => $schema,
		'functions' => file_get_contents( dirname( __DIR__ ) . '/fixtures/blog/functions.php' ) . <<<'PHP'

function afterPublish($row, $ctx) { $GLOBALS['test_hooks'][] = 'afterPublish'; }
function beforeDelete($row, $ctx) { $GLOBALS['test_hooks'][] = 'beforeDelete'; $GLOBALS['test_actor'] = \SpacePress\Js::prop($ctx, 'user') === null ? 'anonymous' : 'signed in'; }
function afterDelete($row, $ctx) { $GLOBALS['test_hooks'][] = 'afterDelete'; }
function afterUpdate($row, $previous, $ctx) { $GLOBALS['test_hooks'][] = 'afterUpdate'; }
function afterCreate($row, $ctx) { $GLOBALS['test_hooks'][] = 'afterCreate'; }
PHP,
		'muPlugins' => array( 'host' => "<?php add_action('sp_purge_urls', static function (array \$p): void { \$GLOBALS['test_purges'][] = \$p; });" ),
	)
);
$db = $wp->app()->db;
wp_set_current_user( 1 );

$sent = array();
Realtime::publish(
	new class($sent) implements Publisher {
		public function __construct( private array &$sent ) {
		}

		public function publish( array $notice ): void {
			$this->sent[] = $notice;
		}
	}
);
/** What one wp-admin action announced: realtime changes, purge calls and the hooks it ran. */
$seen    = static function ( callable $event ) use ( &$sent ): array {
	\SpacePress\Wp\Purges::flush();
	Realtime::flush();
	$sent                   = array();
	$GLOBALS['test_purges'] = array();
	$GLOBALS['test_hooks']  = array();
	$event();
	\SpacePress\Wp\Purges::flush(); // the end of the wp-admin request
	Realtime::flush();
	return array(
		'notices' => array_map( static fn ( array $n ) => array_map( static fn ( $c ) => array( $c['collection'], $c['ops'], $c['ids'] ), $n['changes'] ), $sent ),
		'purges'  => count( $GLOBALS['test_purges'] ),
		'hooks'   => $GLOBALS['test_hooks'],
	);
};
$visible = static fn ( int $id ): bool => $db->findFirst( 'posts', array( 'where' => array( 'id' => $id ) ) ) !== null;
$listed  = static fn ( int $id ): bool => in_array( $id, array_column( $db->findMany( 'posts', array() ), 'id' ), true );

$post    = (int) $db->insert(
	'posts',
	array(
		'title'  => 'Published',
		'status' => 'published',
	),
	true
)[0]['id'];
$comment = (int) $db->insert(
	'comments',
	array(
		'postId' => $post,
		'name'   => 'x',
		'body'   => 'attached',
	),
	true
)[0]['id'];
$draft   = (int) $db->insert(
	'posts',
	array(
		'title'  => 'Draft',
		'status' => 'draft',
	),
	true
)[0]['id'];

// Trash a published item: an unpublish.
$trashed = $seen( static fn () => wp_trash_post( $post ) );
eq( 'trash of a published item: one update notice with its id', $trashed['notices'], array( array( array( 'posts', array( 'update' ), array( $post ) ) ) ) );
eq( 'trash of a published item: one purge announcement', $trashed['purges'], 1 );
eq( 'trash of a published item: no delete or publish hooks, one afterUpdate', $trashed['hooks'], array( 'afterUpdate' ) );
check( 'trashed: no longer read', ! $visible( $post ) );
check( 'trashed: gone from lists', ! $listed( $post ) );
check( 'trashed: the comment that references it with onDelete cascade is still there', $db->findFirst( 'comments', array( 'where' => array( 'id' => $comment ) ) ) !== null );

// Untrash to draft (core's default): nothing to visitors.
$toDraft = $seen( static fn () => wp_untrash_post( $post ) );
eq(
	'untrash to draft: no notice, no purge, no hooks',
	$toDraft,
	array(
		'notices' => array(),
		'purges'  => 0,
		'hooks'   => array(),
	)
);
eq( 'untrash to draft: the item is a draft', $db->findFirst( 'posts', array( 'where' => array( 'id' => $post ) ) )['status'] ?? null, 'draft' );

// Back to the trash as a draft: nothing to visitors.
$draftTrash = $seen( static fn () => wp_trash_post( $post ) );
eq(
	'trash of a draft: nothing',
	$draftTrash,
	array(
		'notices' => array(),
		'purges'  => 0,
		'hooks'   => array(),
	)
);

// Untrash to published (the previous status, as WordPress's own filter offers): a publish.
wp_update_post(
	array(
		'ID'          => $post,
		'post_status' => 'trash',
	)
);
update_post_meta( $post, '_wp_trash_meta_status', 'publish' );
\SpacePress\Wp\Purges::flush();
Realtime::flush();
$previous    = static fn ( $status, $id, $before ) => $before;
add_filter( 'wp_untrash_post_status', $previous, 10, 3 );
$republished = $seen( static fn () => wp_untrash_post( $post ) );
remove_filter( 'wp_untrash_post_status', $previous, 10 );
eq( 'untrash to published: one update notice with its id', $republished['notices'], array( array( array( 'posts', array( 'update' ), array( $post ) ) ) ) );
eq( 'untrash to published: one purge announcement', $republished['purges'], 1 );
eq( 'untrash to published: afterPublish once, never afterCreate', $republished['hooks'], array( 'afterUpdate', 'afterPublish' ) );
check( 'untrashed to published: read again and listed', $visible( $post ) && $listed( $post ) );
eq( 'untrashed: the comment is still attached', $db->findFirst( 'comments', array( 'where' => array( 'id' => $comment ) ) )['postId'] ?? null, $post );

// A draft trashed from the start: nothing.
eq(
	'trash of a draft item: nothing',
	$seen( static fn () => wp_trash_post( $draft ) ),
	array(
		'notices' => array(),
		'purges'  => 0,
		'hooks'   => array(),
	)
);

// Trash, then delete permanently: the delete pair once, at the permanent delete.
$seen( static fn () => wp_trash_post( $post ) );
$deleted = $seen( static fn () => wp_delete_post( $post, true ) );
eq(
	'delete from the trash: beforeDelete and afterDelete once each',
	array_count_values( $deleted['hooks'] ),
	array(
		'beforeDelete' => 1,
		'afterDelete'  => 1,
	)
);
eq( 'delete from the trash: one delete notice', $deleted['notices'], array( array( array( 'comments', array( 'delete' ), array( $comment ) ), array( 'posts', array( 'delete' ), array( $post ) ) ) ) );
check( 'delete from the trash: the cascade ran then', $db->findFirst( 'comments', array( 'where' => array( 'id' => $comment ) ) ) === null );

// Search reads leave the trash out: gone from results and from the count, back after an untrash to
// published, with no rebuild in between.
$found      = static fn ( string $q ): array => array( array_column( $db->findMany( 'posts', array( 'search' => $q ) ), 'id' ), $db->count( 'posts', null, null, array( 'search' => $q ) ) );
$searchable = (int) $db->insert(
	'posts',
	array(
		'title'  => 'Zanzibar notes',
		'status' => 'published',
	),
	true
)[0]['id'];
eq( 'search: published item found and counted', $found( 'zanzibar' ), array( array( $searchable ), 1 ) );
wp_trash_post( $searchable );
eq( 'search: trashed item absent from results and count', $found( 'zanzibar' ), array( array(), 0 ) );
add_filter( 'wp_untrash_post_status', $previous, 10, 3 );
wp_untrash_post( $searchable );
remove_filter( 'wp_untrash_post_status', $previous, 10 );
eq( 'search: back after untrash to published, no rebuild', $found( 'zanzibar' ), array( array( $searchable ), 1 ) );

// onDelete: restrict refuses a delete from the trash as it refuses one of a live row.
$pinned = (int) $db->insert(
	'posts',
	array(
		'title'  => 'Pinned',
		'status' => 'published',
	),
	true
)[0]['id'];
$db->insert( 'pins', array( 'postId' => $pinned ) );
$refusal = static function ( callable $delete ): ?string {
	try {
		$db = \SpacePress\db();
		$db->transaction( $delete );
	} catch ( \SpacePress\HttpError $e ) {
		return "{$e->status} {$e->getMessage()}";
	}
	return null;
};
$live    = $refusal( static fn () => $db->delete( 'posts', array( 'id' => $pinned ) ) );
wp_trash_post( $pinned );
add_filter(
	'wp_die_handler',
	static fn () => static function ( $message ): never {
	throw new \RuntimeException( 'wp_die: ' . ( is_string( $message ) ? $message : '' ) );
	}
);
$fromTrash = null;
try {
	wp_delete_post( $pinned, true );
} catch ( \RuntimeException $e ) {
	$fromTrash = $e->getMessage();
}
eq( 'restrict: a live delete is refused', $live, '409 Rows in pins still reference this row' );
eq( 'restrict: a delete from the trash is refused with the same message', $fromTrash, 'wp_die: Rows in pins still reference this row' );
check( 'restrict: the refused post is still in the trash', get_post_status( $pinned ) === 'trash' );

// WordPress empties the trash itself (wp_scheduled_delete, cron, nobody signed in): the delete pair
// once, the cascade, the delete notice.
$old        = (int) $db->insert(
	'posts',
	array(
		'title'  => 'Old',
		'status' => 'published',
	),
	true
)[0]['id'];
$oldComment = (int) $db->insert(
	'comments',
	array(
		'postId' => $old,
		'name'   => 'x',
		'body'   => 'old',
	),
	true
)[0]['id'];
wp_trash_post( $old );
update_post_meta( $old, '_wp_trash_meta_time', time() - ( EMPTY_TRASH_DAYS + 1 ) * DAY_IN_SECONDS );
$cronError = null;
add_filter( 'wp_doing_cron', '__return_true' );
$cron = $seen(
	static function () use ( &$cronError ): void {
		wp_set_current_user( 0 );
		try {
			do_action( 'wp_scheduled_delete' ); // as WP-Cron runs it
		} catch ( \Throwable $e ) {
			$cronError = get_class( $e ) . ': ' . $e->getMessage();
		}
	}
);
remove_filter( 'wp_doing_cron', '__return_true' );
eq( 'cron: nothing threw', $cronError, null );
eq( 'cron: beforeDelete saw no signed-in user', $GLOBALS['test_actor'] ?? null, 'anonymous' );
eq(
	'cron: the delete pair once for the old item',
	array_count_values( $cron['hooks'] ),
	array(
		'beforeDelete' => 1,
		'afterDelete'  => 1,
	)
);
check( 'cron: the old item is gone', get_post( $old ) === null );
check( 'cron: its cascade child is gone', $db->findFirst( 'comments', array( 'where' => array( 'id' => $oldComment ) ) ) === null );
eq( 'cron: the delete notice', $cron['notices'], array( array( array( 'comments', array( 'delete' ), array( $oldComment ) ), array( 'posts', array( 'delete' ), array( $old ) ) ) ) );

// WordPress empties the trash on a schedule: a refused item (restrict) must not stop the run. The
// refused one stays in the trash, logged; a deletable one due in the same run is deleted with its
// cascade and one delete notice, and beforeDelete ran once per item.
add_filter( 'wp_doing_cron', '__return_true' );
$due  = time() - ( EMPTY_TRASH_DAYS + 1 ) * DAY_IN_SECONDS;
$keep = (int) $db->insert(
	'posts',
	array(
		'title'  => 'Kept by a pin',
		'status' => 'published',
	),
	true
)[0]['id'];
$db->insert( 'pins', array( 'postId' => $keep ) );
$goes        = (int) $db->insert(
	'posts',
	array(
		'title'  => 'Goes',
		'status' => 'published',
	),
	true
)[0]['id'];
$goesComment = (int) $db->insert(
	'comments',
	array(
		'postId' => $goes,
		'name'   => 'x',
		'body'   => 'goes',
	),
	true
)[0]['id'];
foreach ( array( $keep, $goes, $pinned ) as $id ) {
	get_post_status( $id ) === 'trash' || wp_trash_post( $id );
	update_post_meta( $id, '_wp_trash_meta_time', $due );
}
$log     = ini_get( 'error_log' );
$logFile = tempnam( sys_get_temp_dir(), 'spacepress-trash-log' );
ini_set( 'error_log', $logFile );
$cronError = null;
$mixed     = $seen(
	static function () use ( &$cronError ): void {
		wp_set_current_user( 0 );
		try {
			wp_scheduled_delete();
		} catch ( \Throwable $e ) {
			$cronError = get_class( $e ) . ': ' . $e->getMessage();
		}
	}
);
ini_set( 'error_log', (string) $log );
$logged = array_values( array_filter( explode( "\n", (string) file_get_contents( $logFile ) ), static fn ( $l ) => str_contains( $l, '[spacepress]' ) ) );
eq( 'cron with a refused item: the run did not die', $cronError, null );
check( 'cron with a refused item: the refused items stay in the trash', get_post_status( $keep ) === 'trash' && get_post_status( $pinned ) === 'trash' );
check( 'cron with a refused item: the deletable one is gone with its cascade child', get_post( $goes ) === null && $db->findFirst( 'comments', array( 'where' => array( 'id' => $goesComment ) ) ) === null );
eq( 'cron with a refused item: one delete notice, for the deletable one', $mixed['notices'], array( array( array( 'comments', array( 'delete' ), array( $goesComment ) ), array( 'posts', array( 'delete' ), array( $goes ) ) ) ) );
eq(
	'cron with a refused item: beforeDelete once per item, afterDelete once',
	array_count_values( $mixed['hooks'] ),
	array(
		'beforeDelete' => 3,
		'afterDelete'  => 1,
	)
);
eq( 'cron with a refused item: each refusal logged with kind, id, code and detail', count( array_filter( $logged, static fn ( $l ) => str_contains( $l, 'posts' ) && str_contains( $l, 'reference_violation' ) && str_contains( $l, 'Rows in pins still reference this row' ) ) ), 2 );
check( 'cron with a refused item: no transaction left open', ! \SpacePress\Wp\Plugin::instance()->connection()->inTransaction() );

// A pre_delete_post filter after SpacePress's declines the delete: the prepared delete is rolled back,
// never left open, and the next item still goes.
$declined        = (int) $db->insert(
	'posts',
	array(
		'title'  => 'Declined',
		'status' => 'published',
	),
	true
)[0]['id'];
$declinedComment = (int) $db->insert(
	'comments',
	array(
		'postId' => $declined,
		'name'   => 'x',
		'body'   => 'declined',
	),
	true
)[0]['id'];
$after           = (int) $db->insert(
	'posts',
	array(
		'title'  => 'After',
		'status' => 'published',
	),
	true
)[0]['id'];
foreach ( array( $after, $declined ) as $id ) { // the declined one last: nothing after it rolls it back
	wp_trash_post( $id );
	update_post_meta( $id, '_wp_trash_meta_time', $due );
}
$decline     = static fn ( $check, $post ) => $post instanceof \WP_Post && $post->ID === $declined ? false : $check;
add_filter( 'pre_delete_post', $decline, PHP_INT_MAX, 2 );
$declinedRun = $seen(
	static function (): void {
		wp_set_current_user( 0 );
		do_action( 'wp_scheduled_delete' ); // as WP-Cron runs it
	}
);
remove_filter( 'pre_delete_post', $decline, PHP_INT_MAX );
check( 'declined later: the item and its cascade child are still there', get_post_status( $declined ) === 'trash' && $db->findFirst( 'comments', array( 'where' => array( 'id' => $declinedComment ) ) ) !== null );
check( 'declined later: the next item went', get_post( $after ) === null );
check( 'declined later: no transaction left open', ! \SpacePress\Wp\Plugin::instance()->connection()->inTransaction() );
eq( 'declined later: only the deleted item was announced', array_map( static fn ( $n ) => array_column( $n, 0 ), $declinedRun['notices'] ), array( array( 'posts' ) ) );
remove_filter( 'wp_doing_cron', '__return_true' );

// Empty Trash in wp-admin (edit.php's delete_all): one wp_delete_post per trashed item, in id order;
// a refusal wp_dies there, after the items before it were deleted and before the ones after it.
$a        = (int) $db->insert(
	'posts',
	array(
		'title'  => 'Empty A',
		'status' => 'published',
	),
	true
)[0]['id'];
$aComment = (int) $db->insert(
	'comments',
	array(
		'postId' => $a,
		'name'   => 'x',
		'body'   => 'a',
	),
	true
)[0]['id'];
$b        = (int) $db->insert(
	'posts',
	array(
		'title'  => 'Empty B',
		'status' => 'published',
	),
	true
)[0]['id'];
$db->insert( 'pins', array( 'postId' => $b ) );
$c        = (int) $db->insert(
	'posts',
	array(
		'title'  => 'Empty C',
		'status' => 'published',
	),
	true
)[0]['id'];
$cComment = (int) $db->insert(
	'comments',
	array(
		'postId' => $c,
		'name'   => 'x',
		'body'   => 'c',
	),
	true
)[0]['id'];
foreach ( array( $a, $b, $c ) as $id ) {
	wp_trash_post( $id );
}
wp_set_current_user( 1 );
$emptyError = null;
try {
	foreach ( array( $a, $b, $c ) as $id ) { // edit.php: foreach ($post_ids as $post_id) { … wp_delete_post($post_id) … }
		wp_delete_post( $id );
	}
} catch ( \RuntimeException $e ) {
	$emptyError = $e->getMessage();
}
$GLOBALS['test_out']['empty'] = array(
	'error' => $emptyError,
	'a'     => array( get_post_status( $a ), $db->findFirst( 'comments', array( 'where' => array( 'id' => $aComment ) ) ) !== null ),
	'b'     => get_post_status( $b ),
	'c'     => array( get_post_status( $c ), $db->findFirst( 'comments', array( 'where' => array( 'id' => $cComment ) ) ) !== null ),
);
eq( 'Empty Trash: items before a refused one are deleted whole, with their cascade', $GLOBALS['test_out']['empty']['a'], array( false, false ) );
eq( 'Empty Trash: the refused item stays in the trash', $GLOBALS['test_out']['empty']['b'], 'trash' );
eq( 'Empty Trash: items after it are untouched, child attached', $GLOBALS['test_out']['empty']['c'], array( 'trash', true ) );

Realtime::reset();
finish( 'trash' );
