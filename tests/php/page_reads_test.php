<?php

declare(strict_types=1);

/*
 * The page cache's read log (SpacePress\Render\Cache::record) on WordPress on SQLite: what a cacheable
 * render read is stored per URL in few statements, a render that read the same rows as last time
 * writes nothing, and the purge lookups still find every URL that read a row or listed its kind.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname( __DIR__ ) . '/fixtures/blog/schema.php';
// A SQL table with a unique column: no drafts, so one value is one row.
$schema['collections']['tags'] = array(
	'key'        => 'tags',
	'primaryKey' => 'id',
	'columns'    => array(
		'id'    => array(
			'type'          => 'integer',
			'primaryKey'    => true,
			'autoIncrement' => true,
			'notNull'       => true,
		),
		'label' => array(
			'type'    => 'text',
			'notNull' => true,
			'unique'  => true,
		),
	),
);
$wp                            = wpSite(
	'page-reads',
	array(
		'schema'    => $schema,
		'functions' => file_get_contents( dirname( __DIR__ ) . '/fixtures/blog/functions.php' ),
	)
);
$wp->app();
// A host page cache listens, so renders record what they read.
add_action( 'sp_purge_urls', static function (): void {} );

$statements                          = array();
\SpacePress\Wp\Connection::$observer = static function ( string $sql ) use ( &$statements ): void {
	$statements[] = $sql;
};
$record                              = static function ( string $uri, array $reads, array $also = array() ) use ( &$statements ): array {
	$statements = array();
	\SpacePress\Render\Cache::record( $uri, $reads, $also );
	$writes = array_values( array_filter( $statements, static fn ( string $s ): bool => preg_match( '/^\s*(INSERT|DELETE|UPDATE)/i', $s ) === 1 ) );

	return array(
		'statements' => count( $statements ),
		'writes'     => count( $writes ),
	);
};
$log                                 = static fn ( string $url ): array => array_map(
	static fn ( array $r ): string => "{$r['kind']} {$r['item']}",
	$wp->sql( 'SELECT `kind`, `item` FROM {prefix}sp__app_reads WHERE `url` = ? ORDER BY `kind`, `item`', array( $url ) )
);

$ids  = range( 1, 250 );
$cost = $record(
	'/notes/',
	array(
		'posts'    => array(
			'ids'    => $ids,
			'listed' => true,
		),
		'comments' => array(
			'ids'    => array( 7, 8 ),
			'listed' => false,
		),
	)
);
eq( '253 rows recorded (posts listed, 250 posts, 2 comments)', count( $log( '/notes/' ) ), 253 );
check( 'in a handful of statements, not one per row', $cost['statements'] <= 8, $cost );
$cost = $record(
	'/notes/',
	array(
		'posts'    => array(
			'ids'    => $ids,
			'listed' => true,
		),
		'comments' => array(
			'ids'    => array( 8, 7 ),
			'listed' => false,
		),
	)
);
eq( 'the same reads again write nothing', array( $cost['writes'], count( $log( '/notes/' ) ) ), array( 0, 253 ) );
check( 'and read the log once', 1 === $cost['statements'], $cost );
$cost = $record(
	'/notes/',
	array(
		'posts' => array(
			'ids'    => array( 3 ),
			'listed' => false,
		),
	)
);
eq( 'other reads replace the URL\'s log', $log( '/notes/' ), array( 'posts 3' ) );
$record( '/about/', array() );
eq( 'a render that read nothing keeps no rows', $log( '/about/' ), array() );
$cost = $record(
	'/many/',
	array(
		'posts' => array(
			'ids'    => range( 1, \SpacePress\Render\Cache::MAX_IDS + 1 ),
			'listed' => false,
		),
	)
);
eq( 'past MAX_IDS the kind is recorded as listed', $log( '/many/' ), array( 'posts *' ) );

\SpacePress\Wp\Connection::$observer = null;

// What was recorded is what a write purges: the page that read the row and the page that listed the
// kind are announced, other pages are not; a page whose new render read nothing loses its rows.
$purged = array();
add_action(
	'sp_purge_urls',
	static function ( array $urls ) use ( &$purged ): void {
		$purged = array( ...$purged, ...$urls );
	}
);
$db    = $wp->app()->db;
$post  = $db->insert( 'posts', array( 'title' => 'Read by a page' ), true )[0];
$other = $db->insert( 'posts', array( 'title' => 'Read by nobody' ), true )[0];
\SpacePress\Wp\Purges::flush();
$record(
	'/a/',
	array(
		'posts' => array(
			'ids'    => array( $post['id'] ),
			'listed' => false,
		),
	)
);
$record(
	'/b/',
	array(
		'posts' => array(
			'ids'    => array(),
			'listed' => true,
		),
	)
);
$record(
	'/c/',
	array(
		'posts' => array(
			'ids'    => array( $other['id'] ),
			'listed' => false,
		),
	)
);
$record(
	'/d/',
	array(
		'comments' => array(
			'ids'    => array( 1 ),
			'listed' => true,
		),
	)
);
// At the page's one address only: the bare spelling redirects there, so no cache holds it.
eq( 'a row\'s own pages', array_map( static fn ( string $u ): string => (string) parse_url( $u, PHP_URL_PATH ), \SpacePress\Render\Cache::itemUrls( 'posts', $post['id'] ) ), array( '/a/' ) );
$paths  = static function () use ( &$purged ): array {
	$out = array_values( array_unique( array_map( static fn ( string $u ): string => (string) parse_url( $u, PHP_URL_PATH ), $purged ) ) );
	sort( $out );
	$purged = array();

	return $out;
};
$purged = array();
$db->update( 'posts', array( 'title' => 'Read by a page, edited' ), array( 'id' => $post['id'] ) );
\SpacePress\Wp\Purges::flush();
$announced = $paths();
check( 'a write announces the page that read the row and the page that listed the kind', array_intersect( array( '/a/', '/b/' ), $announced ) === array( '/a/', '/b/' ), $announced );
check( 'and not a page that read another row, or another kind', ! in_array( '/c/', $announced, true ) && ! in_array( '/d/', $announced, true ), $announced );
// /a/ renders again and reads nothing: its rows go, and the next write no longer announces it.
$record( '/a/', array() );
eq( 'a recorded set replaced by an empty one leaves no rows', $log( '/a/' ), array() );
$db->update( 'posts', array( 'title' => 'Edited again' ), array( 'id' => $post['id'] ) );
\SpacePress\Wp\Purges::flush();
$announced = $paths();
check( 'so the next write announces the listing page only', in_array( '/b/', $announced, true ) && ! in_array( '/a/', $announced, true ), $announced );
// ---- what a read is recorded as (Render\Reads): its rows alone only when its query names them ----
$author = $db->insert(
	'authors',
	array(
		'name'  => 'Ann',
		'email' => 'ann@example.test',
	),
	true
)[0];
$mine   = $db->insert(
	'posts',
	array(
		'title'    => 'Mine',
		'slug'     => 'mine',
		'authorId' => $author['id'],
		'status'   => 'published',
	),
	true
)[0];
$db->insert(
	'comments',
	array(
		'postId' => $mine['id'],
		'name'   => 'Bo',
		'body'   => 'First',
	),
	true
);
$db->insert( 'tags', array( 'label' => 'red' ), true );
$reading = static function ( callable $fn ) use ( $db ): array {
	\SpacePress\Render\Reads::during( static fn () => $fn( $db ), $reads, $also );

	return array( array_map( static fn ( array $r ): array => array( count( $r['ids'] ), $r['listed'] ), $reads ), $also );
};
$pk      = $mine['id'];
foreach ( array(
	'by primary key'                                    => array( static fn ( $db ) => $db->findMany( 'posts', array( 'where' => array( 'id' => $pk ) ) ), array( 'posts' => array( 1, false ) ) ),
	'by primary key, written as `eq`'                   => array( static fn ( $db ) => $db->findFirst( 'posts', array( 'where' => array( 'id' => array( 'eq' => $pk ) ) ) ), array( 'posts' => array( 1, false ) ) ),
	// Drafts may share a slug until one is published, so a unique column names one row only for a
	// read that sees published rows alone: a visitor's, or one whose `where` says so.
	'by a unique column, as a visitor'                  => array( static fn ( $db ) => $db->findFirst( 'posts', array( 'where' => array( 'slug' => 'mine' ) ), new \SpacePress\Viewer( null ) ), array( 'posts' => array( 1, false ) ) ),
	'by a unique column, published rows only'           => array(
		static fn ( $db ) => $db->findFirst(
			'posts',
			array(
				'where' => array(
					'slug'   => 'mine',
					'status' => 'published',
				),
			)
		),
		array( 'posts' => array( 1, false ) ),
	),
	'by a unique column, drafts in sight'               => array( static fn ( $db ) => $db->findFirst( 'posts', array( 'where' => array( 'slug' => 'mine' ) ) ), array( 'posts' => array( 1, true ) ) ),
	'by a unique column, as an editor who reads drafts' => array(
		static fn ( $db ) => $db->findFirst(
			'posts',
			array( 'where' => array( 'slug' => 'mine' ) ),
			new \SpacePress\Viewer(
				array(
					'id'   => 1,
					'name' => 'admin',
					'role' => 'admin',
				)
			)
		),
		array( 'posts' => array( 1, true ) ),
	),
	'by a unique column of a kind without drafts'       => array( static fn ( $db ) => $db->findFirst( 'tags', array( 'where' => array( 'label' => 'red' ) ) ), array( 'tags' => array( 1, false ) ) ),
	'the row a URL names'                               => array( static fn ( $db ) => \SpacePress\Render\Reads::named( 'posts', static fn () => $db->findFirst( 'posts', array( 'where' => array( 'slug' => 'mine' ) ) ) ), array( 'posts' => array( 1, false ) ) ),
	'by a list of keys, all found'                      => array( static fn ( $db ) => $db->findMany( 'posts', array( 'where' => array( 'id' => array( 'in' => array( $pk, $post['id'] ) ) ) ) ), array( 'posts' => array( 2, false ) ) ),
	// One of the named rows is missing: a write to any row could bring it in.
	'by a list of keys, one missing'                    => array( static fn ( $db ) => $db->findMany( 'posts', array( 'where' => array( 'id' => array( 'in' => array( $pk, 999999 ) ) ) ) ), array( 'posts' => array( 1, true ) ) ),
	'by a key that finds nothing'                       => array( static fn ( $db ) => $db->findFirst( 'posts', array( 'where' => array( 'id' => 999999 ) ) ), array( 'posts' => array( 0, true ) ) ),
	// A filter, a rank and an unfiltered read are listings, also when one row comes back.
	'a filter that matched one row'                     => array( static fn ( $db ) => $db->findMany( 'posts', array( 'where' => array( 'authorId' => $author['id'] ) ) ), array( 'posts' => array( 1, true ) ) ),
	'the first row by rank'                             => array( static fn ( $db ) => $db->findFirst( 'posts', array( 'orderBy' => array( 'id' => 'desc' ) ) ), array( 'posts' => array( 1, true ) ) ),
	'a key under OR'                                    => array( static fn ( $db ) => $db->findMany( 'posts', array( 'where' => array( 'OR' => array( array( 'id' => $pk ) ) ) ) ), array( 'posts' => array( 1, true ) ) ),
	// Relations: the row a foreign key names is that row; a parent's children are a listing.
	'a row with the one it refers to'                   => array(
		static fn ( $db ) => $db->findMany(
			'posts',
			array(
				'where' => array( 'id' => $pk ),
				'with'  => array( 'authorId' => true ),
			)
		),
		array(
			'posts'   => array( 1, false ),
			'authors' => array( 1, false ),
		),
	),
	'a row with its children'                           => array(
		static fn ( $db ) => $db->findMany(
			'posts',
			array(
				'where' => array( 'id' => $pk ),
				'with'  => array( 'comments' => true ),
			)
		),
		array(
			'posts'    => array( 1, false ),
			'comments' => array( 1, true ),
		),
	),
	'a count'                                           => array( static fn ( $db ) => $db->count( 'posts', array( 'id' => $pk ) ), array( 'posts' => array( 0, true ) ) ),
) as $what => [$read, $want] ) {
	eq( "recorded: $what", $reading( $read )[0], $want );
}
eq( 'a render that reads a global records it', $reading( static fn ( $db ) => $db->globalGet( 'settings' ) ), array( array(), array( 'global:settings' ) ) );
eq(
	'once, however often it is read',
	$reading(
		static function ( $db ): void {
			$db->globalGet( 'settings' );
			$db->globalGet( 'settings' );
		}
	)[1],
	array( 'global:settings' )
);
\SpacePress\Render\Reads::during(
	static function () use ( $db, $pk ): void {
		\SpacePress\Render\Reads::during( static fn () => $db->globalGet( 'settings' ) );
		$db->findFirst( 'posts', array( 'where' => array( 'id' => $pk ) ) );
	},
	$outer,
	$outer_also
);
eq( 'a nested recording keeps its own reads', array( array_keys( $outer ), $outer_also ), array( array( 'posts' ), array() ) );
eq( 'nothing is recorded outside a render', \SpacePress\Render\Reads::recording(), false );

// The URL a write to a global purges: the pages that read it, with their twins, after the commit.
$record(
	'/priced/',
	array(
		'posts' => array(
			'ids'    => array(),
			'listed' => true,
		),
	),
	array( 'global:settings' )
);
$record(
	'/plain/',
	array(
		'posts' => array(
			'ids'    => array(),
			'listed' => true,
		),
	)
);
eq( 'a global read is one row of the log', $log( '/priced/' ), array( 'global:settings *', 'posts *' ) );
$purged = array();
$db->globalUpdate( 'settings', array( 'siteTitle' => 'New title' ) );
\SpacePress\Wp\Purges::flush();
eq( 'a write to a global announces the pages that read it, and no other', $paths(), array( '/priced.md', '/priced/' ) );
// A repeater's values are options below the field's own (`…_social_0_label`): a change to one
// of them alone, with the row count as it was, is a write to the global too.
$db->globalUpdate(
	'settings',
	array(
		'social' => array(
			array(
				'label' => 'Mastodon',
				'href'  => 'https://example.test/@a',
			),
		),
	)
);
\SpacePress\Wp\Purges::flush();
$purged = array();
$db->globalUpdate(
	'settings',
	array(
		'social' => array(
			array(
				'label' => 'Fediverse',
				'href'  => 'https://example.test/@a',
			),
		),
	)
);
\SpacePress\Wp\Purges::flush();
eq( 'a change inside a global\'s repeater announces the pages that read it', $paths(), array( '/priced.md', '/priced/' ) );
$purged = array();
$db->globalUpdate( 'settings', array( 'siteTitle' => 'New title' ) );
\SpacePress\Wp\Purges::flush();
eq( 'a write that changes nothing announces nothing', $paths(), array() );
$purged = array();
try {
	$db->transaction(
		static function () use ( $db ): void {
			$db->globalUpdate( 'settings', array( 'siteTitle' => 'Never' ) );
			throw new \RuntimeException( 'rollback' );
		}
	);
} catch ( \RuntimeException ) {
}
\SpacePress\Wp\Purges::flush();
eq( 'a rolled-back write to a global announces nothing', $paths(), array() );
eq( 'and leaves the global as it was', $db->globalGet( 'settings' )['siteTitle'], 'New title' );

// ---- query strings: only a page's declared parameters make a URL of its own ----
foreach ( array(
	array( '/notes/', array(), true ),
	array( '/notes/?page=2', array( 'page' ), true ),
	array( '/notes/?page=2&q=a', array( 'page', 'q' ), true ),
	array( '/notes/?page=2&utm_source=x', array( 'page' ), false ),
	array( '/notes/?junk=1', array(), false ),
	array( '/notes/?', array(), false ),
	array( '/notes/?page=2&page=3', array( 'page' ), true ),
	array( '/notes/?%70age=2', array( 'page' ), true ),
	array( '/notes/?q=' . str_repeat( 'a', 600 ), array( 'q' ), false ),
	array( '/notes/?q=' . str_repeat( 'a', 200 ), array( 'q' ), false ),
	array( '/' . str_repeat( 'a', 200 ) . '/', array(), false ),
	// The router serves `//products/mug/` as the page `/products/mug/` (AppRouter::requestPath), but
	// a cache keeps it as a URL of its own that no purge names: never shared.
	array( '//products/mug/', array(), false ),
	array( '//notes/?page=2', array( 'page' ), false ),
	array( 'notes/', array(), false ),
) as [$uri, $declared, $want] ) {
	eq( "shareable: $uri", \SpacePress\Render\Cache::shareable( $uri, $declared ), $want );
}
eq(
	'a `//` URI records nothing, under neither page',
	array(
		\SpacePress\Render\Cache::record(
			'//products/mug/',
			array(
				'posts' => array(
					'ids'    => array( 1 ),
					'listed' => false,
				),
			)
		),
		$log( '/mug/' ),
		$log( '/products/mug/' ),
	),
	array( false, array(), array() )
);
eq(
	'an undeclared parameter records nothing',
	array(
		\SpacePress\Render\Cache::record(
			'/x/?junk=1',
			array(
				'posts' => array(
					'ids'    => array( 1 ),
					'listed' => false,
				),
			)
		),
		$log( '/x/?junk=1' ),
	),
	array( false, array() )
);
// A search page can render without reading any data. Its query variants still count.
$limit    = \SpacePress\Render\Cache::MAX_VARIANTS;
$admitted = 0;
for ( $i = 0; $i <= $limit; $i++ ) {
	$admitted += (int) \SpacePress\Render\Cache::record( "/empty/?q=$i", array(), array(), array( 'q' ) );
}
eq( 'even empty reads admit at most MAX_VARIANTS query URLs', $admitted, $limit );
// The variants' named lock fails outright (here: its SQLite lock file can't be opened, as GET_LOCK
// answering NULL would on MySQL): the page has rendered, so it is answered privately, not as a 500.
$store     = \SpacePress\db()->store();
$bucket    = crc32( '/locked/' ) % 16;
$lock      = 'sp:page-variants:' . substr( hash( 'sha256', DB_NAME . ':' . $store->db->prefix() . ':' . $bucket ), 0, 40 );
$lock_file = DB_PATH . '.' . substr( hash( 'sha256', $lock ), 0, 16 ) . '.lock';
@unlink( $lock_file );
mkdir( $lock_file ); // a directory where the lock file goes: fopen() fails
set_error_handler( static fn (): bool => true );
try {
	$recorded = \SpacePress\Render\Cache::record(
		'/locked/?q=1',
		array(
			'posts' => array(
				'ids'    => array( 1 ),
				'listed' => false,
			),
		),
		array(),
		array( 'q' )
	);
} catch ( \Throwable $e ) {
	$recorded = get_class( $e ) . ': ' . $e->getMessage();
} finally {
	restore_error_handler();
	rmdir( $lock_file );
}
eq( 'a failed variants lock records nothing and throws nothing', array( $recorded, $log( '/locked/?q=1' ) ), array( false, array() ) );
finish( 'page_reads' );
