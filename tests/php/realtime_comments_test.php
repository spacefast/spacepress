<?php

declare(strict_types=1);

/*
 * Change notices for core comments (`wp:comments`, docs/decisions/2026-11-14-live-regions.md), in-process
 * on WordPress (tests/php/wp.php): a notice only when the approved thread changes, never with ids,
 * through the same pending batch as SpacePress's own writes (discarded on rollback, flushed after the
 * commit, at once with no transaction), and `changed()` refusing an app collection's key.
 */

use SpacePress\Realtime\Module as Realtime;
use SpacePress\Realtime\Publisher;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema                                     = require dirname( __DIR__ ) . '/fixtures/blog/schema.php';
$schema['collections']['posts']['comments'] = true;
$wp = wpSite(
	'realtime-comments',
	array(
		'schema'    => $schema,
		'functions' => file_get_contents( dirname( __DIR__ ) . '/fixtures/blog/functions.php' ),
		'users'     => array( 'mod' => 'editor' ),
	)
);
$db = $wp->app()->db;
wp_set_current_user( 1 );
$post = (int) $db->insert(
	'posts',
	array(
		'title'  => 'Commented',
		'status' => 'published',
	),
	true
)[0]['id'];

$sent     = array();
$recorder = new class($sent) implements Publisher {
	public function __construct( private array &$sent ) {
	}

	public function publish( array $notice ): void {
		$this->sent[] = $notice;
	}
};
Realtime::publish( $recorder );
/** What one comment event announced, as (collection, ids) per change, notices in order. */
$announced = static function ( callable $event ) use ( &$sent ): array {
	$sent = array();
	$event();
	Realtime::flush(); // the end of the request, for an event outside any transaction
	return array_map( static fn ( array $n ) => array_map( static fn ( $c ) => array( $c['collection'], $c['ids'] ), $n['changes'] ), $sent );
};
$comment   = static fn ( int|string $approved, string $text = 'Hi' ) => (int) wp_insert_comment(
	array(
		'comment_post_ID'  => $post,
		'comment_content'  => $text,
		'comment_author'   => 'x',
		'comment_approved' => $approved,
	)
);
$one       = array( array( array( 'wp:comments', null ) ) );

$held = 0;
eq(
	'a comment held for moderation announces nothing',
	$announced(
		static function () use ( $comment, &$held ): void {
			$held = $comment( 0, 'Held' );
		}
	),
	array()
);
eq( 'a spam comment announces nothing', $announced( static fn () => $comment( 'spam', 'Spam' ) ), array() );
eq( 'approving it announces once, with no ids', $announced( static fn () => wp_set_comment_status( $held, 'approve' ) ), $one );
eq(
	'editing an approved comment announces once',
	$announced(
		static fn () => wp_update_comment(
			array(
				'comment_ID'      => $held,
				'comment_content' => 'Held, edited',
			)
		)
	),
	$one
);
eq( 'unapproving it announces once', $announced( static fn () => wp_set_comment_status( $held, 'hold' ) ), $one );
eq( 'pending to spam announces nothing', $announced( static fn () => wp_set_comment_status( $held, 'spam' ) ), array() );
eq( 'spam to approved announces once', $announced( static fn () => wp_set_comment_status( $held, 'approve' ) ), $one );
eq( 'trashing an approved comment announces once', $announced( static fn () => wp_trash_comment( $held ) ), $one );
eq( 'a comment saved approved announces once', $announced( static fn () => $comment( 1, 'Straight in' ) ), $one );

// Outside any SpacePress transaction (core's REST route, wp-admin moderation): the notice goes out at once,
// before the request ends, and the next request carries no leftover.
$sent      = array();
$moderated = $comment( 0, 'For the moderator' );
wp_set_comment_status( $moderated, 'approve' );
eq( 'outside a transaction the notice is out before the request ends', count( $sent ), 1 );
$sent = array();
Realtime::flush();
eq( 'nothing is left for a later request', $sent, array() );
$request = new \WP_REST_Request( 'POST', '/wp/v2/comments' );
$request->set_param( 'post', $post );
$request->set_param( 'content', 'Through core REST' );
$request->set_param( 'status', 'approved' );
$sent    = array();
$created = rest_do_request( $request );
eq(
	'core REST: one notice, at once',
	array( $created->get_status(), count( $sent ), $sent[0]['changes'] ?? null ),
	array(
		201,
		1,
		array(
			array(
				'collection' => 'wp:comments',
				'ops'        => array( 'update' ),
				'ids'        => null,
			),
		),
	)
);

// Inside a SpacePress transaction that rolls back: nothing.
$sent  = array();
$later = $comment( 0, 'Approved then rolled back' );
Realtime::flush();
$sent = array();
try {
	$db->transaction(
		static function () use ( $later ): void {
			wp_set_comment_status( $later, 'approve' );
			throw new \RuntimeException( 'rollback' );
		}
	);
} catch ( \RuntimeException ) {
}
Realtime::flush();
eq( 'an approval in a rolled-back transaction announces nothing', $sent, array() );
// One notice batch with a SpacePress write: both changes, one notice.
$sent = array();
$db->transaction(
	static function () use ( $db, $post, $comment ): void {
		$comment( 1, 'With a post edit' );
		$db->update( 'posts', array( 'title' => 'Commented, edited' ), array( 'id' => $post ) );
	}
);
eq( 'one notice carries a comment change and a SpacePress write together', array_map( static fn ( $c ) => array( $c['collection'], $c['ids'] ), $sent[0]['changes'] ?? array() ), array( array( 'posts', array( $post ) ), array( 'wp:comments', null ) ) );

// The shared projection keeps ids null, and changed() refuses an app collection's key or table.
eq(
	'shared rooms keep a non-collection key and its null ids',
	Realtime::shared(
		array(
			'id'      => 'x',
			'at'      => 'now',
			'changes' => array(
				array(
					'collection' => 'wp:comments',
					'ops'        => array( 'update' ),
					'ids'        => null,
				),
			),
		)
	)['changes'],
	array(
		array(
			'collection' => 'wp:comments',
			'ops'        => array( 'update' ),
			'ids'        => null,
		),
	)
);
foreach ( array( 'comments', 'posts' ) as $taken ) {
	try {
		Realtime::changed( $taken, 'update' );
		check( "changed() refuses the app collection key '$taken'", false );
	} catch ( \LogicException ) {
		check( "changed() refuses the app collection key '$taken'", true );
	}
}

Realtime::reset();
finish( 'realtime-comments' );
