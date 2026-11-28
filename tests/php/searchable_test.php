<?php

declare(strict_types=1);

/*
 * `.searchable()` (Search\Index::fields) on the blog fixture, in-process on WordPress on SQLite: the
 * marked fields are indexed and matched, an unmarked text field is not once any field is marked,
 * `.searchable(false)` leaves out even the title, and each reader still matches only the fields and
 * rows they may read, on a kind's list, the API, core's list route and core's /wp/v2/search.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname( __DIR__ ) . '/fixtures/blog/schema.php';
// `recipes`: name (the title) searched by default, `bio` marked, `email` marked but only editors
// read it, `notes` an unmarked text field, and a read rule that hides some rows from all but editors.
$recipes                                   = $schema['collections']['authors'];
$recipes['key']                            = 'recipes';
$recipes['label']                          = 'Recipes';
$recipes['relations']                      = array();
$recipes['url']                            = '/recipes/:id';
$recipes['wp']                             = array(
	'postType'       => 'sp_recipes',
	'groupKey'       => 'group_sp_recipes',
	'metaPrefix'     => 'sp_',
	'fieldKeyPrefix' => 'field_sp_recipes_',
);
$recipes['access']['read']                 = array( 'fn' => 'recipes__access__read' );
$recipes['columns']['bio']['searchable']   = true;
$recipes['columns']['email']['searchable'] = true;
$recipes['columns']['email']['unique']     = false;
$recipes['columns']['email']['access']     = array( 'read' => array( 'role' => 'editor' ) );
$recipes['columns']['notes']               = array( 'type' => 'text' );
$schema['collections']['recipes']          = $recipes;
// `codes`: a title marked `.searchable(false)`, so only the marked `bio` is searched.
$codes                                  = $schema['collections']['authors'];
$codes['key']                           = 'codes';
$codes['label']                         = 'Codes';
$codes['relations']                     = array();
$codes['url']                           = '/codes/:id';
$codes['wp']                            = array(
	'postType'       => 'sp_codes',
	'groupKey'       => 'group_sp_codes',
	'metaPrefix'     => 'sp_',
	'fieldKeyPrefix' => 'field_sp_codes_',
);
$codes['columns']['name']['searchable'] = false;
$codes['columns']['bio']['searchable']  = true;
$codes['columns']['email']['unique']    = false;
$schema['collections']['codes']         = $codes;
// `ledger`: every text field `.searchable(false)`: the kind isn't searched at all.
$ledger                                  = $schema['collections']['authors'];
$ledger['key']                           = 'ledger';
$ledger['label']                         = 'Ledger';
$ledger['relations']                     = array();
$ledger['url']                           = '/ledger/:id';
$ledger['wp']                            = array(
	'postType'       => 'sp_ledger',
	'groupKey'       => 'group_sp_ledger',
	'metaPrefix'     => 'sp_',
	'fieldKeyPrefix' => 'field_sp_ledger_',
);
$ledger['columns']['name']['searchable'] = false;
$ledger['columns']['bio']['searchable']  = false;
$ledger['columns']['email']['unique']    = false;
$schema['collections']['ledger']         = $ledger;

$wp     = wpSite(
	'searchable',
	array(
		'schema'    => $schema,
		'functions' => file_get_contents( dirname( __DIR__ ) . '/fixtures/blog/functions.php' ) . <<<'PHP'

function recipes__access__read(\SpacePress\JsObject $ctx)
{
    $user = \SpacePress\Js::prop($ctx, 'user');

    return $user !== null && in_array(\SpacePress\Js::prop($user, 'role'), ['editor', 'admin'], true) ? true : ['notes' => ['ne' => 'staff only']];
}
PHP,
		'users'     => array(
			'ed'  => 'editor',
			'sub' => 'subscriber',
		),
	)
);
$db     = \SpacePress\db();
$prefix = $wp->connection()->prefix();
$index  = static fn ( string $kind ): array => array_map(
	static fn ( array $r ): string => $r['field'] . ':' . $r['body'],
	$wp->sql( "SELECT `field`, `body` FROM `{$prefix}sp__search` WHERE `kind` = ? ORDER BY `item`, `field`", array( new \SpacePress\Wp\Bytes( $kind ) ) )
);
$fields = static fn ( string $kind ): array => \SpacePress\Search\Index::fields( $db->schema()->collection( $kind ) );

// ---------------------------------------------------------------- which fields

eq( 'marked fields and the title are searchable; an unmarked text field is not once one is marked', $fields( 'recipes' ), array( 'name', 'email', 'bio' ) );
eq( '`.searchable(false)` leaves out the title', $fields( 'codes' ), array( 'bio' ) );
eq( 'a kind whose every text field is `.searchable(false)` has none', $fields( 'ledger' ), array() );
eq( 'a kind with no marks keeps every text field', $fields( 'authors' ), array( 'name', 'bio' ) );
check( 'the site-wide search leaves out a kind with no searchable field', ! in_array( 'ledger', \SpacePress\Search\Index::kinds(), true ) && in_array( 'recipes', \SpacePress\Search\Index::kinds(), true ), \SpacePress\Search\Index::kinds() );

// ---------------------------------------------------------------- the index

wp_set_current_user( 1 );
$soup  = $db->insert(
	'recipes',
	array(
		'name'   => 'Tomato soup',
		'email'  => 'chef@saffron.test',
		'bio'    => 'Slow roasted',
		'notes'  => 'Basil garnish',
		'status' => 'published',
	),
	true
)[0];
$staff = $db->insert(
	'recipes',
	array(
		'name'   => 'Staff curry',
		'email'  => 'staff@example.test',
		'bio'    => 'Roasted cumin',
		'notes'  => 'staff only',
		'status' => 'published',
	),
	true
)[0];
$code  = $db->insert(
	'codes',
	array(
		'name'   => 'Walnut code',
		'email'  => 'c@example.test',
		'bio'    => 'Hazelnut description',
		'status' => 'published',
	),
	true
)[0];
$entry = $db->insert(
	'ledger',
	array(
		'name'   => 'Pecan entry',
		'email'  => 'l@example.test',
		'bio'    => 'Pecan body',
		'status' => 'published',
	),
	true
)[0];
wp_set_current_user( 0 );

$soup_entries = array_values( array_filter( $index( 'recipes' ), static fn ( string $e ): bool => in_array( $e, array( 'name:Tomato soup', 'email:chef@saffron.test', 'bio:Slow roasted', 'notes:Basil garnish' ), true ) ) );
eq( 'the marked fields and the title are indexed, the unmarked one is not', $soup_entries, array( 'bio:Slow roasted', 'email:chef@saffron.test', 'name:Tomato soup' ) );
eq( 'a `.searchable(false)` title is not indexed', $index( 'codes' ), array( 'bio:Hazelnut description' ) );
eq( 'a kind with no searchable field has no entries', $index( 'ledger' ), array() );

// ---------------------------------------------------------------- `search` on a kind, as the reader

$ids  = static fn ( array $rows ): array => array_map( static fn ( array $r ): int => (int) $r['id'], $rows );
$as   = static fn ( ?string $who ): \SpacePress\Viewer => new \SpacePress\Viewer( null === $who ? null : $wp->user( $who ) );
$list = static function ( string $kind, string $q, ?string $who ) use ( $ids, $as, $db ): array {
	$found = $ids(
		\SpacePress\Seam::asVisitor(
			$as( $who ),
			static fn (): array => $db->findMany(
				$kind,
				array(
					'where'   => array(),
					'columns' => array( 'id' => true ),
					'search'  => $q,
				),
				$as( $who )
			)
		)
	);
	sort( $found );

	return $found;
};

eq( 'a word of a marked field finds the row', $list( 'recipes', 'slow', null ), array( $soup['id'] ) );
eq( 'a word of the title finds it', $list( 'recipes', 'tomato', null ), array( $soup['id'] ) );
eq( 'a word only in the unmarked field finds nothing, for anyone', array( $list( 'recipes', 'basil', null ), $list( 'recipes', 'basil', 'ed' ) ), array( array(), array() ) );
eq( 'a word only in a marked field the reader may not read finds nothing', array( $list( 'recipes', 'saffron', null ), $list( 'recipes', 'saffron', 'sub' ) ), array( array(), array() ) );
eq( 'the editor, who reads it, finds the row by it', $list( 'recipes', 'saffron', 'ed' ), array( $soup['id'] ) );
eq( 'a row the read rule hides is not found', $list( 'recipes', 'roasted', null ), array( $soup['id'] ) );
eq( 'the editor finds both', $list( 'recipes', 'roasted', 'ed' ), array( $soup['id'], $staff['id'] ) );
eq( 'nor counted', array( $db->count( 'recipes', null, $as( null ), array( 'search' => 'roasted' ) ), $db->count( 'recipes', null, $as( 'ed' ), array( 'search' => 'roasted' ) ) ), array( 1, 2 ) );
eq( 'a word of a `.searchable(false)` title finds nothing', $list( 'codes', 'walnut', 'ed' ), array() );
eq( 'the marked field still finds the row', $list( 'codes', 'hazelnut', null ), array( $code['id'] ) );
eq( 'a kind with no searchable field matches nothing', $list( 'ledger', 'pecan', 'ed' ), array() );

// The API list and core's list route are the same read.
[$status, $rows] = $wp->call(
	'GET',
	'/recipes',
	query: array(
		'search' => 'roasted',
		'limit'  => '10',
	)
);
eq( 'the API list finds what a visitor may read', array( $status, $ids( $rows ?? array() ) ), array( 200, array( $soup['id'] ) ) );
[$status, $rows] = $wp->call(
	'GET',
	'/recipes',
	query: array(
		'search' => 'basil',
		'limit'  => '10',
	)
);
eq( 'and not by the unmarked field', array( $status, $ids( $rows ?? array() ) ), array( 200, array() ) );
$core = static function ( string $postType, array $params, ?string $who ) use ( $wp ): array {
	$wp->actAs( $who );
	try {
		$request = new \WP_REST_Request( 'GET', "/wp/v2/$postType" );
		$request->set_query_params( $params + array( 'per_page' => 50 ) );
		$response = rest_do_request( $request );
	} finally {
		wp_set_current_user( 0 );
	}
	$out = array_map( static fn ( array $r ): int => (int) $r['id'], rest_get_server()->response_to_data( $response, false ) );
	sort( $out );

	return array( $response->get_status(), $out );
};
eq( 'core\'s list route searches the marked fields', $core( 'sp_recipes', array( 'search' => 'slow' ), null ), array( 200, array( $soup['id'] ) ) );
eq( 'and not the unmarked one', $core( 'sp_recipes', array( 'search' => 'basil' ), 'ed' ), array( 200, array() ) );
eq( 'nor a hidden marked field for a visitor', $core( 'sp_recipes', array( 'search' => 'saffron' ), null ), array( 200, array() ) );

// ---------------------------------------------------------------- core's /wp/v2/search and the site-wide endpoint

$core_search = static function ( string $q, ?string $who ) use ( $wp ): array {
	$wp->actAs( $who );
	try {
		$request = new \WP_REST_Request( 'GET', '/wp/v2/search' );
		$request->set_query_params( array( 'search' => $q ) );
		$response = rest_do_request( $request );
	} finally {
		wp_set_current_user( 0 );
	}
	$out = array_map( static fn ( array $r ): string => $r['subtype'] . ':' . $r['id'], rest_get_server()->response_to_data( $response, false ) );
	sort( $out );

	return array( $response->get_status(), $out );
};
eq( '/wp/v2/search finds a row by a marked field', $core_search( 'slow', null ), array( 200, array( "sp_recipes:{$soup['id']}" ) ) );
eq( 'not by an unmarked one', $core_search( 'basil', 'ed' ), array( 200, array() ) );
eq( 'not by a marked field the reader may not read', $core_search( 'saffron', null ), array( 200, array() ) );
eq( 'nor a row the read rule hides', $core_search( 'roasted', null ), array( 200, array( "sp_recipes:{$soup['id']}" ) ) );
eq( 'an editor finds both', $core_search( 'roasted', 'ed' ), array( 200, array( "sp_recipes:{$soup['id']}", "sp_recipes:{$staff['id']}" ) ) );
eq( 'a `.searchable(false)` title is not matched', $core_search( 'walnut', 'ed' ), array( 200, array() ) );
eq( 'a kind with no searchable field is not searched', $core_search( 'pecan', 'ed' ), array( 200, array() ) );
[$status, $found] = $wp->call( 'GET', '/search', query: array( 'q' => 'roasted' ) );
eq(
	'the site-wide endpoint matches the same rows',
	array( $status, array_map( static fn ( array $r ): array => array( $r['kind'], $ids( $r['rows'] ) ), $found['results'] ?? array() ) ),
	array( 200, array( array( 'recipes', array( $soup['id'] ) ) ) )
);

finish( 'searchable_test' );
