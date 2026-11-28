<?php

declare(strict_types=1);

/*
 * `columns` pushed into SQL (Db::selected, Sql::select's `$only`) on WordPress on SQLite: a read
 * that asks for some columns selects only those plus what the pipeline needs (the primary key,
 * relation keys, `with` fields, child linkage), with no join for the rest, and returns exactly
 * what it returned when every column was read and then dropped. Post-backed (blog `posts`, meta
 * fields, select/media/group/repeater/blocks), table-backed (`comments`) and term-backed (a
 * taxonomy, in tests/php/taxonomy_test.php) stores; field read rules; `with` both ways.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname( __DIR__ ) . '/fixtures/blog/schema.php';
// A field only editors read (a shorthand rule: decided without the row).
$schema['collections']['posts']['columns']['excerpt']['access'] = array( 'read' => array( 'role' => 'editor' ) );
$wp = wpSite(
	'columns',
	array(
		'schema'    => $schema,
		'functions' => file_get_contents( dirname( __DIR__ ) . '/fixtures/blog/functions.php' ),
	)
);
$db = $wp->app()->db;

$author = $db->insert(
	'authors',
	array(
		'name'  => 'Ann',
		'email' => 'ann@example.com',
		'bio'   => 'Writes',
	),
	true
)[0];
foreach ( range( 1, 3 ) as $n ) {
	$post = $db->insert(
		'posts',
		array(
			'title'    => "Post $n",
			'excerpt'  => "Excerpt $n",
			'body'     => "<p>Body $n</p>",
			'tags'     => array( 'news' ),
			'authorId' => $author['id'],
			'seo'      => array( 'metaTitle' => "Meta $n" ),
			'sections' => array(
				array(
					'layout' => 'quote',
					'text'   => "q$n",
				),
			),
		),
		true
	)[0];
	foreach ( range( 1, 2 ) as $c ) {
		$db->insert(
			'comments',
			array(
				'postId'   => $post['id'],
				'name'     => "C$n.$c",
				'body'     => "Comment $n.$c",
				'approved' => true,
			)
		);
	}
}

$statements                          = array();
\SpacePress\Wp\Connection::$observer = static function ( string $sql ) use ( &$statements ): void {
	$statements[] = $sql;
};
/** The first statement a read ran against $table, and what it returned. @return array{string, list<array>} */
$read = static function ( string $collection, array $opts, ?\SpacePress\Viewer $viewer = null, string $table = 'wp_posts' ) use ( $db, &$statements ): array {
	$statements = array();
	$rows       = $db->findMany( $collection, $opts, $viewer );
	$sql        = '';
	foreach ( $statements as $s ) {
		if ( str_contains( $s, "FROM `$table` t0" ) ) {
			$sql = $s;
			break;
		}
	}

	return array( $sql, $rows );
};
/** The same read with every column, the result reduced to what `columns` keeps (what Db::project did). */
$expected = static function ( string $collection, array $opts, ?\SpacePress\Viewer $viewer = null ) use ( $db ): array {
	$columns = $opts['columns'];
	unset( $opts['columns'] );
	$known    = array_keys( $db->schema()->collection( $collection )['columns'] );
	$included = array_keys( array_filter( $columns, static fn ( $on ) => true === $on ) );
	$keep     = array() !== $included ? $included : array_diff( $known, array_keys( array_filter( $columns, static fn ( $on ) => false === $on ) ) );
	$keep     = array( ...$keep, ...array_keys( $opts['with'] ?? array() ) );

	return array_map( static fn ( array $row ): array => array_intersect_key( $row, array_flip( $keep ) ), $db->findMany( $collection, $opts, $viewer ) );
};
$anon     = new \SpacePress\Viewer( null );
$editor   = new \SpacePress\Viewer( $wp->user( 'editor' ) );

// ---- post-backed ---------------------------------------------------------------------------------
$opts         = array(
	'columns' => array( 'title' => true ),
	'orderBy' => array( 'id' => 'asc' ),
);
[$sql, $rows] = $read( 'posts', $opts );
eq( 'posts: the rows are what reading every column gave', $rows, $expected( 'posts', $opts ) );
check( 'posts: no meta join, no column it did not ask for', ! str_contains( $sql, 'wp_postmeta' ) && ! str_contains( $sql, 'AS `body`' ) && ! str_contains( $sql, 'AS `excerpt`' ) && str_contains( $sql, 'AS `title`' ) && str_contains( $sql, 'AS `id`' ), $sql );

$opts         = array(
	'columns' => array(
		'body'     => false,
		'seo'      => false,
		'gallery'  => false,
		'sections' => false,
		'tags'     => false,
	),
	'orderBy' => array( 'id' => 'desc' ),
);
[$sql, $rows] = $read( 'posts', $opts );
eq( 'posts, columns excluded: same rows', $rows, $expected( 'posts', $opts ) );
check( 'posts, columns excluded: those are not selected', ! str_contains( $sql, 'AS `body`' ) && ! str_contains( $sql, 'AS `tags`' ) && str_contains( $sql, 'AS `excerpt`' ), $sql );

$opts         = array(
	'columns' => array(
		'title' => true,
		'tags'  => true,
		'seo'   => true,
		'cover' => true,
	),
	'where'   => array( 'excerpt' => 'Excerpt 2' ),
);
[$sql, $rows] = $read( 'posts', $opts );
eq( 'posts: select, group and media columns read as before, a filter on an unselected field still applies', $rows, $expected( 'posts', $opts ) );
check( 'posts: the filter joins its own field, the select list holds only what was asked', str_contains( $sql, "meta_key = 'sp_excerpt'" ) && ! str_contains( $sql, 'AS `excerpt`' ), $sql );

$opts         = array(
	'columns' => array( 'title' => true ),
	'with'    => array(
		'authorId' => true,
		'comments' => array(
			'columns' => array( 'name' => true ),
			'orderBy' => array( 'id' => 'asc' ),
		),
	),
	'orderBy' => array( 'id' => 'asc' ),
);
[$sql, $rows] = $read( 'posts', $opts );
eq( 'posts with relations: the parent keeps its relation key, the children theirs', $rows, $expected( 'posts', $opts ) );
check( 'posts with relations: the relation key is read though not asked for', str_contains( $sql, 'AS `authorId`' ), $sql );
[$child_sql] = $read( 'posts', $opts, null, 'wp_sp_comments' );
check( 'comments under posts: only the asked column, its key and its link', str_contains( $child_sql, '`name` AS `name`' ) && str_contains( $child_sql, 'AS `postId`' ) && ! str_contains( $child_sql, 'AS `body`' ), $child_sql );

// Field rules: the result as each viewer saw it before.
$opts = array(
	'columns' => array(
		'title'   => true,
		'excerpt' => true,
	),
	'orderBy' => array( 'id' => 'asc' ),
);
eq( 'an editor reads the editor-only field it asked for', $read( 'posts', $opts, $editor )[1], $expected( 'posts', $opts, $editor ) );
problem( 'a visitor selecting it is refused, as before', static fn () => $db->findMany( 'posts', $opts, $anon ), 403, 'forbidden', '/columns/excerpt' );
$opts = array(
	'columns' => array( 'title' => true ),
	'orderBy' => array( 'id' => 'asc' ),
);
eq( 'a visitor\'s read of other columns', $read( 'posts', $opts, $anon )[1], $expected( 'posts', $opts, $anon ) );

$statements = array();
eq( 'count agrees with the filtered post list', $db->count( 'posts', array( 'excerpt' => 'Excerpt 2' ), $editor ), 1 );
$count_sql = current( array_filter( $statements, static fn ( string $sql ): bool => str_contains( $sql, 'first_count' ) ) );
check(
	'count joins the filter field only',
	is_string( $count_sql ) && substr_count( $count_sql, 'JOIN `wp_postmeta`' ) === 1
	&& str_contains( $count_sql, "meta_key = 'sp_excerpt'" ) && ! str_contains( $count_sql, 'AS `body`' ),
	$count_sql
);

// ---- table-backed --------------------------------------------------------------------------------
$opts         = array(
	'columns' => array( 'body' => true ),
	'orderBy' => array( 'id' => 'asc' ),
	'limit'   => 3,
);
[$sql, $rows] = $read( 'comments', $opts, null, 'wp_sp_comments' );
eq( 'comments: same rows', $rows, $expected( 'comments', $opts ) );
check( 'comments: only the asked column and the key', str_contains( $sql, '`body` AS `body`' ) && ! str_contains( $sql, 'AS `name`' ) && ! str_contains( $sql, 'AS `createdAt`' ), $sql );
$opts         = array(
	'columns' => array( 'name' => true ),
	'with'    => array( 'postId' => array( 'columns' => array( 'title' => true ) ) ),
	'orderBy' => array( 'id' => 'asc' ),
);
[$sql, $rows] = $read( 'comments', $opts, null, 'wp_sp_comments' );
eq( 'comments with their post: same rows', $rows, $expected( 'comments', $opts ) );
check( 'comments with their post: the relation key is read', str_contains( $sql, 'AS `postId`' ), $sql );

// ---- what turns pruning off -------------------------------------------------------------------------
// No `columns`, or columns that keep everything: every column, as before.
[$sql] = $read( 'posts', array( 'orderBy' => array( 'id' => 'asc' ) ) );
check( 'no columns option: every column is selected', str_contains( $sql, 'AS `body`' ) && str_contains( $sql, 'AS `excerpt`' ), $sql );
// An unknown column is refused as before (after the read, by project()).
problem( 'an unknown column is refused as before', static fn () => $db->findMany( 'posts', array( 'columns' => array( 'nope' => true ) ) ), 400, 'invalid_query', '/columns/nope' );
// A read extension that didn't say which columns it reads sees whole rows.
$seen = array();
\SpacePress\Extensions::onRead(
	static function ( array $rows, string $collection ) use ( &$seen ): array {
		if ( 'posts' === $collection ) {
			$seen = array_column( $rows, 'body' );
		}

		return $rows;
	},
	true
);
$opts         = array(
	'columns' => array( 'title' => true ),
	'orderBy' => array( 'id' => 'asc' ),
);
[$sql, $rows] = $read( 'posts', $opts );
check( 'with such an extension every column is read', str_contains( $sql, 'AS `body`' ) && $seen === array( '<p>Body 1</p>', '<p>Body 2</p>', '<p>Body 3</p>' ), array( $sql, $seen ) );
eq( 'and the result is the same', $rows, $expected( 'posts', $opts ) );

\SpacePress\Wp\Connection::$observer = null;
finish( 'columns' );
