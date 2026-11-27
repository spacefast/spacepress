<?php

declare(strict_types=1);

/*
 * Change notices on WordPress, in-process (tests/php/wp.php): one batch per committed transaction,
 * ids only, nothing on rollback, the sp_realtime_changes action, a failing publisher that never
 * fails the write, and the shared-room projection that drops ids a visitor could not list.
 */

use SpacePress\Realtime\Module as Realtime;
use SpacePress\Realtime\Publisher;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname( __DIR__ ) . '/fixtures/blog/schema.php';
// Comments readable by anyone, so the shared projection has one public collection to keep ids for.
$schema['collections']['comments']['access']['read'] = array( 'role' => 'anyone' );
$wp = wpSite(
	'realtime',
	array(
		'schema'    => $schema,
		'functions' => file_get_contents( dirname( __DIR__ ) . '/fixtures/blog/functions.php' ),
	)
);
$db = $wp->app()->db;

$post = $db->insert( 'posts', array( 'title' => 'Before any publisher' ), true )[0];

$sent     = array();
$recorder = new class($sent) implements Publisher {
	public function __construct( private array &$sent ) {
	}

	public function publish( array $notice ): void {
		$this->sent[] = $notice;
	}
};
check( 'no publisher: nothing is collected or delivered', ! Realtime::enabled() );
Realtime::publish( $recorder );
check( 'a registered publisher enables notices', Realtime::enabled() );

$db->transaction(
	static function () use ( $db, $post, &$sent ): void {
		$db->insert(
			'comments',
			array(
				'postId' => $post['id'],
				'name'   => 'a',
				'body'   => 'one',
			)
		);
		$db->insert(
			'comments',
			array(
				'postId' => $post['id'],
				'name'   => 'b',
				'body'   => 'two',
			)
		);
		$db->update( 'posts', array( 'title' => 'Renamed' ), array( 'id' => $post['id'] ) );
		eq( 'nothing is published before the commit', count( $sent ), 0 );
	}
);
eq( 'one notice for the whole transaction', count( $sent ), 1 );
$notice   = $sent[0];
$comments = array_map( 'intval', array_column( $db->findMany( 'comments', array( 'where' => array( 'postId' => $post['id'] ) ) ), 'id' ) );
sort( $comments );
check( 'notice names id, time and the changes', is_string( $notice['id'] ) && strlen( $notice['id'] ) === 24 && preg_match( '/^\d{4}-\d\d-\d\dT/', $notice['at'] ) === 1, $notice );
$changes = array_map(
	static function ( array $c ): array {
		if ( null !== $c['ids'] ) {
			$c['ids'] = array_map( 'intval', $c['ids'] );
			sort( $c['ids'] );
		}
		return $c;
	},
	$notice['changes']
);
eq(
	'changes per collection, sorted, with ops and ids',
	$changes,
	array(
		array(
			'collection' => 'comments',
			'ops'        => array( 'create' ),
			'ids'        => $comments,
		),
		array(
			'collection' => 'posts',
			'ops'        => array( 'update' ),
			'ids'        => array( (int) $post['id'] ),
		),
	)
);
check( 'no row values travel', ! str_contains( json_encode( $notice ), 'Renamed' ) && ! str_contains( json_encode( $notice ), '"one"' ), $notice );

$sent = array();
try {
	$db->transaction(
		static function () use ( $db, $post ): void {
			$db->insert(
				'comments',
				array(
					'postId' => $post['id'],
					'name'   => 'c',
					'body'   => 'doomed',
				)
			);
			throw new \RuntimeException( 'rollback' );
		}
	);
} catch ( \RuntimeException ) {
}
eq( 'a rolled-back transaction publishes nothing', $sent, array() );
$db->delete( 'comments', array( 'id' => $comments[0] ) );
eq(
	'the next commit carries only its own change',
	array_map( static fn ( $c ) => array( $c['collection'], $c['ops'], array_map( 'intval', $c['ids'] ) ), $sent[0]['changes'] ?? array() ),
	array( array( 'comments', array( 'delete' ), array( $comments[0] ) ) )
);

$sent = array();
$db->transaction(
	static function () use ( $db, $post ): void {
		for ( $i = 0; $i <= Realtime::MAX_IDS; $i++ ) {
			$db->insert(
				'comments',
				array(
					'postId' => $post['id'],
					'name'   => "bulk$i",
					'body'   => 'x',
				)
			);
		}
	}
);
eq(
	'past MAX_IDS a collection is listed without ids',
	$sent[0]['changes'] ?? null,
	array(
		array(
			'collection' => 'comments',
			'ops'        => array( 'create' ),
			'ids'        => null,
		),
	)
);

// Notices stay inside what a receiver can be told to accept: an id longer than MAX_ID_LENGTH
// lists its collection without ids, and a transaction over MAX_COLLECTIONS is several notices.
$sent = array();
$db->transaction(
	static function () use ( $db ): void {
		\SpacePress\Realtime\Module::written( 'create', 'comments', array( 'id' => str_repeat( 'k', Realtime::MAX_ID_LENGTH + 1 ) ), null );
	}
);
eq(
	'an over-long id lists its collection without ids',
	$sent[0]['changes'] ?? null,
	array(
		array(
			'collection' => 'comments',
			'ops'        => array( 'create' ),
			'ids'        => null,
		),
	)
);
$wide = $schema;
foreach ( range( 1, Realtime::MAX_COLLECTIONS + 1 ) as $n ) {
	$wide['collections'][ "c$n" ] = array(
		'key'        => "c$n",
		'primaryKey' => 'id',
	) + $schema['collections']['comments'];
}
$wide_db = new \SpacePress\Db( $db->store(), new \SpacePress\Schema( $wide ), $db->media() );
$sent    = array();
$wide_db->transaction(
	static function () use ( $wide_db ): void {
		$wide_db->current(
			static function (): void {
				foreach ( range( 1, Realtime::MAX_COLLECTIONS + 1 ) as $n ) {
					\SpacePress\Realtime\Module::written( 'create', "c$n", array( 'id' => $n ), null );
				}
			}
		);
	}
);
eq( 'a transaction over MAX_COLLECTIONS is announced in two notices', array_map( static fn ( $n ) => count( $n['changes'] ), $sent ), array( Realtime::MAX_COLLECTIONS, 1 ) );
eq( 'every collection is announced exactly once', count( array_unique( array_merge( ...array_map( static fn ( $n ) => array_column( $n['changes'], 'collection' ), $sent ) ) ) ), Realtime::MAX_COLLECTIONS + 1 );

// The WordPress action fires once per commit with the same notice.
$actions = array();
add_action(
	Realtime::ACTION,
	static function ( array $notice ) use ( &$actions ): void {
		$actions[] = $notice;
	}
);
$sent = array();
$db->insert(
	'comments',
	array(
		'postId' => $post['id'],
		'name'   => 'hooked',
		'body'   => 'y',
	)
);
check(
	'sp_realtime_changes fires with the published notice',
	count( $actions ) === 1 && $actions[0] === $sent[0],
	array(
		'actions' => $actions,
		'sent'    => $sent,
	)
);

// A throwing sp_realtime_changes listener is logged, never thrown into the committed request.
$sent     = array();
$throwing = static function (): void {
	throw new \RuntimeException( 'listener down' );
};
add_action( Realtime::ACTION, $throwing );
$kept = $db->insert(
	'comments',
	array(
		'postId' => $post['id'],
		'name'   => 'listener',
		'body'   => 'still saved',
	),
	true
)[0];
remove_action( Realtime::ACTION, $throwing );
check( 'a throwing listener does not fail the write', $db->findFirst( 'comments', array( 'where' => array( 'id' => $kept['id'] ) ) ) !== null );
eq( 'publishers still run after a throwing listener', count( $sent ), 1 );

// Scheduled promotion runs no write hooks, yet announces the promoted rows. Posts here are
// WordPress posts (WP cron promotes them, covered in tests/wp/rest.test.ts); a table-backed
// drafts collection is promoted by Db::promoteDue.
$status = array(
	'type'    => 'select',
	'options' => array( 'draft', 'published', 'scheduled' ),
	'notNull' => true,
	'default' => 'draft',
	'system'  => true,
);
$notes  = new \SpacePress\Schema(
	array(
		'version'     => 5,
		'runtime'     => \SpacePress\Schema::SERIES,
		'collections' => array(
			'notes' => array(
				'key'        => 'notes',
				'primaryKey' => 'id',
				'drafts'     => true,
				'editor'     => false,
				'table'      => 'sp_rt_notes',
				'columns'    => array(
					'id'          => array(
						'type'          => 'integer',
						'primaryKey'    => true,
						'autoIncrement' => true,
					),
					'status'      => $status,
					'publishedAt' => array(
						'type'   => 'timestamp',
						'system' => true,
					),
				),
			),
		),
	)
);
$wp->exec( 'CREATE TABLE {prefix}sp_rt_notes (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `status` VARCHAR(191) NOT NULL, `publishedAt` CHAR(24), PRIMARY KEY (`id`)) ENGINE=InnoDB' );
$wp->exec( "INSERT INTO {prefix}sp_rt_notes (`status`, `publishedAt`) VALUES ('scheduled', '2026-01-02T00:00:00.000Z')" );
$notes_db = new \SpacePress\Db( \SpacePress\Wp\CompositeStore::create( $notes, $db->store()->db ), $notes, $db->media() );
$sent     = array();
putenv( 'SP_NOW=2026-01-03T00:00:00.000Z' );
$promoted_ids = $notes_db->transaction( static fn () => $notes_db->promoteDue() );
putenv( 'SP_NOW' );
eq( 'the scheduled note was promoted', array_map( static fn ( $ids ) => array_map( 'intval', $ids ), $promoted_ids ), array( 'notes' => array( 1 ) ) );
eq( 'promotion announces each promoted row as an update', array_map( static fn ( $c ) => array( $c['collection'], $c['ops'], array_map( 'intval', $c['ids'] ?? array() ) ), $sent[0]['changes'] ?? array() ), array( array( 'notes', array( 'update' ), array( 1 ) ) ) );

// A failing publisher never fails the write and never blocks the next one.
Realtime::reset();
$after = array();
Realtime::publish(
	new class() implements Publisher {
		public function publish( array $notice ): void {
			throw new \RuntimeException( 'transport down' );
		}
	}
);
Realtime::publish(
	new class($after) implements Publisher {
		public function __construct( private array &$after ) {
		}

		public function publish( array $notice ): void {
			$this->after[] = $notice;
		}
	}
);
$row = $db->insert(
	'comments',
	array(
		'postId' => $post['id'],
		'name'   => 'still',
		'body'   => 'saved',
	),
	true
)[0];
check( 'the write committed although a publisher threw', $db->findFirst( 'comments', array( 'where' => array( 'id' => $row['id'] ) ) ) !== null );
eq( 'later publishers still receive the notice', count( $after ), 1 );

// A write to a collection the schema doesn't name (a system table) is not announced and never fails.
$after = array();
\SpacePress\Realtime\Module::written( 'create', '__sp_media', array( 'id' => 1 ), null );
\SpacePress\Realtime\Module::flush();
eq( 'system collections are skipped without an error', $after, array() );

// Shared rooms: ids only where any visitor may list the collection.
$shared = Realtime::shared(
	array(
		'id'      => 'x',
		'at'      => 'now',
		'changes' => array(
			array(
				'collection' => 'comments',
				'ops'        => array( 'create' ),
				'ids'        => array( 1 ),
			),
			array(
				'collection' => 'posts',
				'ops'        => array( 'update' ),
				'ids'        => array( 2 ),
			),
			array(
				'collection' => 'authors',
				'ops'        => array( 'update' ),
				'ids'        => array( 3 ),
			),
		),
	)
);
eq(
	'public, draft-free collections keep ids; rule-gated and draft collections lose them',
	array_column( $shared['changes'], 'ids', 'collection' ),
	array(
		'comments' => array( 1 ),
		'posts'    => null,
		'authors'  => null,
	)
);

Realtime::reset();
finish( 'realtime' );
