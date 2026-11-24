<?php

declare(strict_types=1);

/*
 * The v2 pipeline on the blog fixture (tests/fixtures/blog: authors and posts are post-backed, comments
 * a custom table), in-process through App::handle on WordPress (tests/php/wp.php): access (role
 * ladder, filter rules, 401/403/404 masking, nested `with`), drafts transitions, lazy promotion, slug
 * derivation, revisions, hook ctx, globals, media (+ delete nulling), FK actions, extension seams.
 */

use SpacePress\App;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema                             = require dirname( __DIR__ ) . '/fixtures/blog/schema.php';
$open                               = $schema['collections']['posts'];
$open['key']                        = 'openNotes';
$open['drafts']                     = $open['revisions'] = false;
$open['content']                    = null;
$open['columns']                    = array_intersect_key( $open['columns'], array_flip( array( 'id', 'title', 'slug' ) ) );
$open['columns']['rating']          = array( 'type' => 'integer' );
$open['hooks']                      = $open['relations'] = array();
$open['access']                     = array_fill_keys( array( 'read', 'create', 'update', 'delete' ), array( 'role' => 'anyone' ) );
$open['wp']                         = array(
	'postType'       => 'sp_open_notes',
	'groupKey'       => 'group_sp_open_notes',
	'metaPrefix'     => 'sp_',
	'fieldKeyPrefix' => 'field_sp_open_notes_',
);
$schema['collections']['openNotes'] = $open;
// Signed-in-only action: on a site without spacepress-identity, only WordPress itself can sign anyone in.
$schema['actions']['signedInCount']               = array( 'access' => array( 'role' => 'authenticated' ) ) + $schema['actions']['publishedCount'];
$schema['collections']['posts']['access']['read'] = array( 'fn' => 'test_posts_access' );
$wp  = wpSite(
	'blog',
	array(
		'schema'    => $schema,
		'functions' => file_get_contents( dirname( __DIR__ ) . '/fixtures/blog/functions.php' ) . <<<'PHP'

function test_posts_access(\SpacePress\JsObject $ctx) {
    if (isset($GLOBALS['test_post_rule'])) {
        ++$GLOBALS['test_post_rule_calls'];
        return $GLOBALS['test_post_rule'];
    }
    return posts__access__read($ctx);
}
PHP,
		'users'     => array(
			'ed'    => 'editor',
			'alice' => 'author',
			'bob'   => 'author',
			'sub'   => 'subscriber',
		),
	)
);
$app = $wp->app();
$db  = \SpacePress\db();
eq( 'WordPress and the request pipeline share the validated schema', $app->schema === \SpacePress\Wp\Runtime::plugin()->schema, true );
eq( 'the database uses the validated schema', $db->schema() === $app->schema, true );
$anonymous = new \SpacePress\Viewer( null );
eq( 'an unprotected collection retains unrestricted storage visibility', $db->store()->readGuards( 'openNotes', $anonymous ), array() );
$openNote = $db->insert( 'openNotes', array( 'title' => 'Anonymous unique slug' ), true, $anonymous )[0];
eq( 'anonymous unique creation succeeds when password guards cannot narrow reads', $openNote['slug'], 'anonymous-unique-slug' );
eq( 'native unrestricted reads do not enumerate every primary key', $db->permittedKeys( 'openNotes', 'read', $anonymous ), null );

// A projection batches the pre-filter stored snapshots, including those used for nested
// fields and third-party metadata. Ordinary REST responses keep their per-item reads.
$db->insert( 'openNotes', array( array( 'title' => 'More notes' ), array( 'title' => 'Final notes' ) ) );
$projected = static function ( ?string $fields, string $context = 'view' ): array {
	$request = new \WP_REST_Request( 'GET', '/wp/v2/sp_open_notes' );
	$request->set_query_params(
		array(
			'context' => $context,
			'orderby' => 'id',
			'order'   => 'asc',
		) + ( null === $fields ? array() : array( '_fields' => $fields ) )
	);
	$queries                             = 0;
	\SpacePress\Wp\Connection::$observer = static function ( string $sql ) use ( &$queries ): void {
		if ( str_contains( $sql, "post_type = 'sp_open_notes'" ) && str_contains( $sql, 'post_title AS' ) ) {
			++$queries;
		}
	};
	try {
		$response = rest_do_request( $request );
		return array( $response->get_status(), $response->get_data(), $queries );
	} finally {
		\SpacePress\Wp\Connection::$observer = null;
	}
};
foreach ( array( 'id,title', 'id,title.rendered' ) as $fields ) {
	[$status, $items, $queries] = $projected( $fields );
	eq(
		"projected $fields uses the core title",
		array( $status, $items[0]['id'], $items[0]['title']['rendered'], $queries ),
		array( 200, $openNote['id'], 'Anonymous unique slug', 1 )
	);
}
eq( 'embed context respects a nested title projection', $projected( 'id,title.rendered', 'embed' )[2], 1 );
eq( 'unprojected native REST reads each original row', $projected( null )[2], 3 );
eq( 'nested meta projection still reads the full row', $projected( 'id,meta.slug' )[2], 1 );
$injectMeta = static function ( $response ) {
	$data         = $response->get_data();
	$data['meta'] = array( 'from_filter' => true );
	$response->set_data( $data );
	return $response;
};
add_filter( 'rest_prepare_sp_open_notes', $injectMeta );
[$status, $items, $queries] = $projected( 'id,title' );
eq( 'a response filter can add meta to a projected native response', array( $items[0]['meta']['from_filter'] ?? null, $queries ), array( true, 1 ) );
remove_filter( 'rest_prepare_sp_open_notes', $injectMeta );

// WordPress permits duplicate meta keys. Bound the bulk result, then let each original LIMIT 1
// query choose its value. Compare the projected data with the ordinary response.
add_post_meta( $openNote['id'], 'sp_rating', '7' );
add_post_meta( $openNote['id'], 'sp_rating', '11' );
$normal    = $projected( null );
$duplicate = $projected( 'id,meta.rating' );
eq(
	'duplicate metadata preserves the individual selection and bounds execution',
	array( $duplicate[1][0]['meta']['rating'], $duplicate[2] ),
	array( $normal[1][0]['meta']['rating'], 4 )
);

$users = array();
foreach ( array( 'admin', 'ed', 'alice', 'bob', 'sub' ) as $name ) {
	$users[ $name ] = $wp->user( $name );
}

/** @return array{int, mixed} [status, data or problem] */
function req( string $method, string $path, mixed $body = null, ?string $as = null, array $query = array(), array $files = array(), array $form = array() ): array {
	global $wp;
	[$status, $data] = $wp->call( $method, $path, $body, $as, $query, $files, $form );

	return array( $status, $data );
}

function isProblem( string $label, array $r, int $status, string $code, ?string $pointer = null ): void {
	[$s, $p] = $r;
	check( "$label → $status $code" . ( null === $pointer ? '' : " $pointer" ), $s === $status && ( $p['code'] ?? null ) === $code && ( $p['pointer'] ?? null ) === $pointer, $p );
}

$titles = static fn ( array $rows ) => array_column( $rows, 'title' );

// ================================================================ seed (trusted)

$aliceProfile  = $db->insert(
	'authors',
	array(
		'name'   => 'Alice',
		'email'  => 'alice@example.com',
		'userId' => $users['alice']['id'],
	),
	true
)[0];
$hidden        = $db->insert(
	'authors',
	array(
		'name'   => 'Ghost',
		'email'  => 'ghost@example.com',
		'status' => 'draft',
	),
	true
)[0];
[$pub, $draft] = $db->insert(
	'posts',
	array(
		array(
			'title'    => 'Published one',
			'authorId' => $aliceProfile['id'],
		),
		array(
			'title'    => 'Draft one',
			'status'   => 'draft',
			'authorId' => $aliceProfile['id'],
		),
	),
	true
);

// A detail page needs one ID. A second distinct ID or a list must reuse the rule and fetch
// all matching IDs only once, including when the first ID is denied.
\SpacePress\Wp\CoreAccess::flush();
$keyQueries                          = array();
\SpacePress\Wp\Connection::$observer = static function ( string $sql ) use ( &$keyQueries ): void {
	if ( str_starts_with( $sql, 'SELECT t0.ID AS `id` FROM' ) ) {
		$keyQueries[] = str_contains( $sql, 't0.ID = ?' );
	}
};
try {
	$GLOBALS['test_post_rule_calls'] = 0;
	$GLOBALS['test_post_rule']       = array( 'status' => 'published' );
	eq( 'collection permission checks only the evaluated rule', \SpacePress\Wp\CoreAccess::readDenial( 'posts', $anonymous ), null );
	$GLOBALS['test_post_rule'] = false;
	eq(
		'repeat permission checks retain the decision without selecting IDs',
		array( \SpacePress\Wp\CoreAccess::readDenial( 'posts', $anonymous ), $GLOBALS['test_post_rule_calls'], $keyQueries ),
		array( null, 1, array() )
	);
	foreach ( array( $draft['id'], $draft['id'], $pub['id'], $pub['id'] ) as $i => $id ) {
		eq( "anonymous permission check $i", \SpacePress\Wp\CoreAccess::covers( 'posts', 'read', $id, $anonymous ), $id === $pub['id'] );
	}
	eq( 'list after both items has every readable ID', \SpacePress\Wp\CoreAccess::keys( 'posts', 'read', $anonymous ), array( $pub['id'] ) );
	eq( 'permission queries are one exact ID then one complete set', $keyQueries, array( true, false ) );
	eq( 'detail and list execute the original filter without invoking the callback again', $GLOBALS['test_post_rule_calls'], 1 );
	\SpacePress\Wp\CoreAccess::flush();
	eq( 'a fresh outright refusal retains the guest denial', \SpacePress\Wp\CoreAccess::readDenial( 'posts', $anonymous )?->get_error_data()['status'] ?? null, 401 );
	$GLOBALS['test_post_rule'] = array( 'unknown_probe_field' => true );
	\SpacePress\Wp\CoreAccess::flush();
	eq( 'a malformed filter still fails the permission check', \SpacePress\Wp\CoreAccess::readDenial( 'posts', $anonymous )?->get_error_data()['status'] ?? null, 401 );
	$GLOBALS['test_post_rule'] = array( 'slug' => 'missing-permission-probe' );
	\SpacePress\Wp\CoreAccess::flush();
	eq(
		'a valid empty filter permits the collection without admitting the requested row',
		array( \SpacePress\Wp\CoreAccess::readDenial( 'posts', $anonymous ), \SpacePress\Wp\CoreAccess::keys( 'posts', 'read', $anonymous ) ),
		array( null, array() )
	);
	eq( 'only the explicit empty list executes SQL', $keyQueries, array( true, false, false ) );
	unset( $GLOBALS['test_post_rule'] );
	\SpacePress\Wp\CoreAccess::flush();
	eq( 'public item after invalidation', \SpacePress\Wp\CoreAccess::covers( 'posts', 'read', $pub['id'], $anonymous ), true );
	eq( 'a list immediately after a single item is complete', \SpacePress\Wp\CoreAccess::keys( 'posts', 'read', $anonymous ), array( $pub['id'] ) );
	eq( 'an explicit list promotes the partial key set', $keyQueries, array( true, false, false, true, false ) );
} finally {
	\SpacePress\Wp\Connection::$observer = null;
}
foreach ( array(
	'alice' => true,
	'bob'   => false,
) as $user => $owns ) {
	eq( "$user update rule on an individual post", \SpacePress\Wp\CoreAccess::covers( 'posts', 'update', $pub['id'], new \SpacePress\Viewer( $users[ $user ] ) ), $owns );
}
eq( 'editor can read the draft the guest could not read', \SpacePress\Wp\CoreAccess::covers( 'posts', 'read', $draft['id'], new \SpacePress\Viewer( $users['ed'] ) ), true );
eq( 'unrestricted rule still covers an unmaterialized ID', \SpacePress\Wp\CoreAccess::covers( 'openNotes', 'read', PHP_INT_MAX, $anonymous ), true );

// ================================================================ drafts transitions (§6.1)

check( 'status absent → published with publishedAt = now', 'published' === $pub['status'] && null !== $pub['publishedAt'], $pub );
eq( 'draft keeps a null publishedAt', array( $draft['status'], $draft['publishedAt'] ), array( 'draft', null ) );
problem(
	'scheduled without publishedAt',
	fn () => $db->insert(
		'posts',
		array(
			'title'  => 'x',
			'status' => 'scheduled',
		)
	),
	422,
	'invalid_input',
	'/publishedAt'
);
problem(
	'scheduled in the past',
	fn () => $db->insert(
		'posts',
		array(
			'title'       => 'x',
			'status'      => 'scheduled',
			'publishedAt' => '2001-01-01T00:00:00Z',
		)
	),
	422,
	'invalid_input',
	'/publishedAt'
);
$dated = $db->insert(
	'posts',
	array(
		'title'       => 'Dated',
		'status'      => 'published',
		'publishedAt' => '2031-01-01T00:00:00.000Z',
	),
	true
)[0];
eq( 'published with a future publishedAt stays published (only scheduled schedules)', array( $dated['status'], $dated['publishedAt'] ), array( 'published', '2031-01-01T00:00:00.000Z' ) );
$db->delete( 'posts', array( 'id' => $dated['id'] ) );
$published = $db->update( 'posts', array( 'status' => 'published' ), array( 'id' => $draft['id'] ), true )[0];
eq( 'publishing a draft invalidates the guest permission cache', \SpacePress\Wp\CoreAccess::covers( 'posts', 'read', $draft['id'], $anonymous ), true );
eq( 'a second published item is in the complete permission set', \SpacePress\Wp\CoreAccess::covers( 'posts', 'read', $pub['id'], $anonymous ), true );
check( 'draft → published sets publishedAt', null !== $published['publishedAt'], $published );
$again = $db->update( 'posts', array( 'status' => 'draft' ), array( 'id' => $draft['id'] ), true )[0];
eq( 'moving back to draft invalidates the complete membership set', \SpacePress\Wp\CoreAccess::covers( 'posts', 'read', $draft['id'], $anonymous ), false );
eq( 'published → draft keeps publishedAt', $again['publishedAt'], $published['publishedAt'] );
$db->update( 'posts', array( 'publishedAt' => null ), array( 'id' => $draft['id'] ) );

// ================================================================ read access (§1.6)

[$s, $rows] = req( 'GET', '/posts', query: array( 'orderBy' => 'id' ) );
eq( 'anonymous: function rule → published only', array( $s, $titles( $rows ) ), array( 200, array( 'Published one' ) ) );
$metaJoins                           = 0;
\SpacePress\Wp\Connection::$observer = static function ( string $sql ) use ( &$metaJoins ): void {
	$metaJoins += preg_match_all( '/\bJOIN\s+`?wp_postmeta\b/i', $sql );
};
try {
	$keys = $db->permittedKeys( 'posts', 'read', $anonymous );
	eq( 'checking published IDs skips unrelated post metadata', array( array_map( 'intval', $keys ), $metaJoins ), array( array( $pub['id'] ), 0 ) );
} finally {
	\SpacePress\Wp\Connection::$observer = null;
}
eq( 'subscriber: same filter', $titles( req( 'GET', '/posts', as: 'sub' )[1] ), array( 'Published one' ) );
eq( 'author: function rule returns true → drafts visible', $titles( req( 'GET', '/posts', as: 'alice', query: array( 'orderBy' => 'id' ) )[1] ), array( 'Published one', 'Draft one' ) );
eq( '?status= shorthand', $titles( req( 'GET', '/posts', as: 'ed', query: array( 'status' => 'draft' ) )[1] ), array( 'Draft one' ) );
isProblem( 'anonymous GET of a draft by id is masked', req( 'GET', "/posts/{$draft['id']}" ), 404, 'not_found' );
eq( 'shorthand read + drafts: anonymous sees published authors only', array_column( req( 'GET', '/authors' )[1], 'name' ), array( 'Alice' ) );
eq( '… editors see every status', array_column( req( 'GET', '/authors', as: 'ed', query: array( 'orderBy' => 'id' ) )[1], 'name' ), array( 'Alice', 'Ghost' ) );
eq( '… authors are below editor', array_column( req( 'GET', '/authors', as: 'alice' )[1], 'name' ), array( 'Alice' ) );
eq( 'GET /me', array( req( 'GET', '/me' )[1], req( 'GET', '/me', as: 'alice' )[1] ), array( null, $users['alice'] ) );
// No identity plugin: there is no issuer, and the only signed-in viewer is a WordPress user.
eq(
	'without spacepress-identity, SpacePress has no issuer and no guests',
	array( class_exists( \SpacePress\Identity\Plugin::class, false ), req( 'GET', '/auth/config' )[1] ),
	array(
		false,
		array(
			'issuer' => null,
			'guests' => false,
		),
	)
);
isProblem( 'without spacepress-identity, there are no guest sessions', req( 'POST', '/auth/guest', array() ), 404, 'not_found' );
eq( 'without spacepress-identity, an "anyone" action runs anonymously', req( 'POST', '/actions/publishedCount' )[0], 200 );
isProblem( 'without spacepress-identity, an "authenticated" action refuses anonymous', req( 'POST', '/actions/signedInCount' ), 401, 'unauthenticated' );
eq( 'without spacepress-identity, a WordPress user is authenticated', req( 'POST', '/actions/signedInCount', as: 'sub' )[0], 200 );

// The persistent hint skips the scan when no password is set. A stale hint still applies the
// password predicate in the row query. Unrestricted scope checks use the database directly.
$subscriber = new \SpacePress\Viewer( $wp->user( 'sub' ) );
$locked     = $db->insert( 'openNotes', array( 'title' => 'Soon locked' ), true )[0];
$visible    = static fn ( \SpacePress\Viewer $reader ): array => array_column(
	$db->findMany( 'openNotes', array( 'where' => array( 'id' => $locked['id'] ) ), $reader ),
	'id',
);
$probe      = static function () use ( $visible, $subscriber ): array {
	\SpacePress\Wp\CoreAccess::flush();
	$scans                               = 0;
	\SpacePress\Wp\Connection::$observer = static function ( string $sql ) use ( &$scans ): void {
		$scans += (int) str_starts_with( $sql, 'SELECT ID, post_password FROM ' );
	};
	try {
		return array( $visible( $subscriber ), $scans );
	} finally {
		\SpacePress\Wp\Connection::$observer = null;
	}
};
eq( 'the first signed-in read checks for protected posts', $probe(), array( array( $locked['id'] ), 1 ) );
eq( 'the next read uses the negative hint', $probe(), array( array( $locked['id'] ), 0 ) );
$wp->sql( 'UPDATE {prefix}posts SET post_password = ? WHERE ID = ?', array( 'bypassed-core', $locked['id'] ) );
eq( 'a stale negative hint cannot expose a protected row', array( $probe(), $visible( $anonymous ) ), array( array( array(), 0 ), array() ) );
wp_update_post(
	array(
		'ID'            => $locked['id'],
		'post_password' => 'saved-through-core',
	)
);
eq( 'a core write drops the hint and an editor of the row can still read it', $probe(), array( array( $locked['id'] ), 1 ) );
eq( 'the same protected row is hidden from a visitor', $visible( $anonymous ), array() );
wp_update_post(
	array(
		'ID'            => $locked['id'],
		'post_password' => '',
	)
);
eq( 'clearing the password repopulates the hint', array( $probe(), $probe() ), array( array( array( $locked['id'] ), 1 ), array( array( $locked['id'] ), 0 ) ) );
try {
	$db->transaction(
		static function () use ( $locked, $visible, $anonymous ): void {
			wp_update_post(
				array(
					'ID'            => $locked['id'],
					'post_password' => 'never-committed',
				)
			);
			eq( 'inside a transaction that sets a password, the public read is already filtered', $visible( $anonymous ), array() );
			throw new \RuntimeException( 'undo' );
		}
	);
} catch ( \RuntimeException ) {
}
eq( 'a rolled-back password leaves the row readable', $visible( $anonymous ), array( $locked['id'] ) );
$db->transaction(
	static function () use ( $locked ): void {
		wp_update_post(
			array(
				'ID'            => $locked['id'],
				'post_password' => 'committed',
			)
		);
	}
);
eq( 'a committed password hides the row from visitors', $visible( $anonymous ), array() );
// Each editor save builds a store (Plugin::fillEditorDefaults); the stamp listener is the connection's, added once.
$listeners = static fn (): int => count( $GLOBALS['wp_filter']['clean_post_cache']->callbacks[10] ?? array() );
$heard     = $listeners();
foreach ( array( 'one', 'two', 'three' ) as $title ) {
	wp_update_post(
		array(
			'ID'         => $locked['id'],
			'post_title' => $title,
		)
	);
}
eq( 'editor saves add no clean_post_cache listener', $listeners(), $heard );
$db->delete( 'openNotes', array( 'id' => $locked['id'] ) );

// Native post passwords constrain every viewer-bound read before selection, not just its rendered body.
$protected = $db->insert(
	'posts',
	array(
		'title' => 'Protected native post',
		'body'  => '<p>native-password-secret</p>',
	),
	true
)[0];
$public    = $db->insert( 'posts', array( 'title' => 'Public next page' ), true )[0];
wp_update_post(
	array(
		'ID'            => $protected['id'],
		'post_password' => 'native-secret',
	)
);
$anon           = new \SpacePress\Viewer( null );
$protectedWhere = array( 'id' => $protected['id'] );
\SpacePress\Wp\CoreAccess::flush();
$queries                             = 0;
\SpacePress\Wp\Connection::$observer = static function () use ( &$queries ): void {
	++$queries;
};
try {
	$masked = $db->findMany(
		'posts',
		array(
			'where'   => $protectedWhere,
			'columns' => array( 'id' => true ),
		),
		$anon
	);
	eq( 'a projected guest read filters the password in its only SQL statement', array( $masked, $queries ), array( array(), 1 ) );
} finally {
	\SpacePress\Wp\Connection::$observer = null;
}
isProblem( 'native password masks First item', req( 'GET', "/posts/{$protected['id']}" ), 404, 'not_found' );
eq(
	'native password constrains body-filtered projections',
	$db->findMany(
		'posts',
		array(
			'where'   => array( 'body' => array( 'like' => '%native-password-secret%' ) ),
			'columns' => array( 'body' => true ),
		),
		$anon
	),
	array()
);
eq(
	'native password is applied before page limits',
	array_column(
		$db->findMany(
			'posts',
			array(
				'where'   => array( 'id' => array( 'in' => array( $protected['id'], $public['id'] ) ) ),
				'orderBy' => array( 'id' => 'asc' ),
				'limit'   => 1,
			),
			$anon
		),
		'id'
	),
	array( $public['id'] )
);
$linked  = $db->insert(
	'comments',
	array(
		'postId'   => $protected['id'],
		'name'     => 'Linked',
		'body'     => 'Visible comment',
		'approved' => true,
	),
	true
)[0];
$related = $db->findFirst(
	'comments',
	array(
		'where' => array( 'id' => $linked['id'] ),
		'with'  => array( 'postId' => true ),
	),
	$anon
);
eq( 'native password hides attached relation', $related['postId'], null );
eq(
	'native password prevents relation-filter inference',
	$db->findMany(
		'comments',
		array(
			'where' => array(
				'id'     => $linked['id'],
				'postId' => array( 'body' => array( 'like' => '%native-password-secret%' ) ),
			),
		),
		$anon
	),
	array()
);
$wp->actAs( 'admin' );
$nativeController = new \WP_REST_Posts_Controller( 'sp_posts' );
add_filter( 'post_password_required', array( $nativeController, 'check_password_required' ), 10, 2 );
eq( 'native edit-context filter trusts the ambient administrator', post_password_required( $protected['id'] ), false );
eq( 'anonymous viewer does not borrow ambient admin authority', $db->findMany( 'posts', array( 'where' => $protectedWhere ), $anon ), array() );
eq( 'subscriber viewer does not borrow ambient admin authority', $db->findMany( 'posts', array( 'where' => $protectedWhere ), new \SpacePress\Viewer( $users['sub'] ) ), array() );
remove_filter( 'post_password_required', array( $nativeController, 'check_password_required' ) );
$wp->actAs( null );
eq( 'explicit editor retains native protected-post editing', $db->findFirst( 'posts', array( 'where' => $protectedWhere ), new \SpacePress\Viewer( $users['ed'] ) )['body'] ?? null, $protected['body'] );
eq( 'trusted null viewer retains server authority', $db->findFirst( 'posts', array( 'where' => $protectedWhere ) )['body'], $protected['body'] );
$wp->actAs( 'ed' );
$nativeEdit = new \WP_REST_Request( 'GET', '/wp/v2/sp_posts/' . $protected['id'] );
$nativeEdit->set_param( 'context', 'edit' );
$nativeEdited = rest_do_request( $nativeEdit );
eq( 'native editor can still load protected content for editing', array( $nativeEdited->get_status(), $nativeEdited->get_data()['content']['raw'] ?? null ), array( 200, $protected['body'] ) );
$wp->actAs( null );
wp_update_post(
	array(
		'ID'            => $protected['id'],
		'post_password' => '0',
	)
);
eq( 'WordPress empty-password semantics remain public', array( post_password_required( $protected['id'] ), $db->findFirst( 'posts', array( 'where' => $protectedWhere ), $anon )['body'] ?? null ), array( false, $protected['body'] ) );
foreach ( array( '0 ', ' ', 'Native-secret', 'native-secret ' ) as $password ) {
	wp_update_post(
		array(
			'ID'            => $protected['id'],
			'post_password' => $password,
		)
	);
	eq( 'only exact empty passwords are public: ' . json_encode( $password ), $db->findMany( 'posts', array( 'where' => $protectedWhere ), $anon ), array() );
}
wp_update_post(
	array(
		'ID'            => $protected['id'],
		'post_password' => 'native-secret',
	)
);
$coreRead = static function () use ( $protected ) {
	return rest_do_request( new \WP_REST_Request( 'GET', '/wp/v2/sp_posts/' . $protected['id'] ) );
};
eq( 'native core access shares the password row boundary', $coreRead()->get_status(), 404 );
wp_update_post(
	array(
		'ID'            => $public['id'],
		'post_password' => 'another-native-secret',
	)
);
$corePassword = static function ( string $password, bool $list = false ) use ( $protected, $public ) {
	$request = new \WP_REST_Request( 'GET', '/wp/v2/sp_posts' . ( $list ? '' : '/' . $protected['id'] ) );
	$request->set_query_params( array( 'password' => $password ) + ( $list ? array( 'include' => array( $protected['id'], $public['id'] ) ) : array() ) );

	return rest_do_request( $request );
};
eq( 'native item rejects a wrong password parameter', $corePassword( 'wrong-password' )->get_status(), 403 );
$concealed = new \WP_REST_Request( 'GET', '/wp/v2/sp_posts/' . $draft['id'] );
$concealed->set_query_params( array( 'password' => 'wrong-password' ) );
eq( 'wrong native password cannot distinguish a schema-hidden row', rest_do_request( $concealed )->get_status(), 404 );
$unlocked = $corePassword( 'native-secret' );
eq( 'native item accepts its password parameter', array( $unlocked->get_status(), str_contains( $unlocked->get_data()['content']['rendered'] ?? '', 'native-password-secret' ) ), array( 200, true ) );
$unlockedList = $corePassword( 'native-secret', true );
eq( 'native list accepts its password parameter for matching rows', array( $unlockedList->get_status(), array_column( $unlockedList->get_data(), 'id' ), str_contains( $unlockedList->get_data()[0]['content']['rendered'] ?? '', 'native-password-secret' ) ), array( 200, array( $protected['id'] ), true ) );
eq( 'native list keeps rows locked with the wrong password', $corePassword( 'wrong-password', true )->get_data(), array() );
eq( 'native password parameter does not authorize a subsequent SpacePress read', $db->findMany( 'posts', array( 'where' => $protectedWhere ), $anon ), array() );
$nestedProof  = null;
$inspectProof = static function ( $response, $post ) use ( &$nestedProof, $coreRead, $corePassword, $db, $protectedWhere, $anon ) {
	if ( null === $nestedProof ) {
		$nestedProof = array(); // Nested dispatch must not recurse into this observation.
		$nestedProof = array( $coreRead()->get_status(), $corePassword( 'wrong-password' )->get_status(), $db->findFirst( 'posts', array( 'where' => $protectedWhere ), $anon )['body'] ?? null );
	}

	return $response;
};
add_filter( 'rest_prepare_sp_posts', $inspectProof, 20, 2 );
$corePassword( 'native-secret' );
remove_filter( 'rest_prepare_sp_posts', $inspectProof );
eq( 'nested native requests suspend and then restore the outer password proof', $nestedProof, array( 404, 403, $protected['body'] ) );
$wp->actAs( 'admin' );
$borrowedProof = null;
$inspectViewer = static function ( $response ) use ( &$borrowedProof, $db, $protectedWhere, $anon ) {
	$borrowedProof = $db->findMany( 'posts', array( 'where' => $protectedWhere ), $anon );

	return $response;
};
add_filter( 'rest_prepare_sp_posts', $inspectViewer );
$corePassword( 'native-secret' );
remove_filter( 'rest_prepare_sp_posts', $inspectViewer );
$wp->actAs( null );
eq( 'native admin password proof does not authorize an explicit anonymous viewer', $borrowedProof, array() );
wp_update_post(
	array(
		'ID'            => $public['id'],
		'post_password' => '',
	)
);
$ability = wp_get_ability( 'blog/posts-list' );
eq( 'native password applies to agent ability reads', $ability->execute( array( 'where' => $protectedWhere ) ), array( 'rows' => array() ) );
require_once ABSPATH . WPINC . '/class-phpass.php';
$hasher                                 = new \PasswordHash( 8, true );
$_COOKIE[ 'wp-postpass_' . COOKIEHASH ] = $hasher->HashPassword( 'wrong-password' );
eq( 'wrong native cookie keeps protected rows hidden', array( post_password_required( $protected['id'] ), $db->findMany( 'posts', array( 'where' => $protectedWhere ), $anon ) ), array( true, array() ) );
$_COOKIE[ 'wp-postpass_' . COOKIEHASH ] = $hasher->HashPassword( 'native-secret' );
eq( 'valid native cookie unlocks the same viewer-bound body as WordPress', array( post_password_required( $protected['id'] ), $db->findFirst( 'posts', array( 'where' => $protectedWhere ), $anon )['body'] ?? null, $coreRead()->get_status() ), array( false, $protected['body'], 200 ) );
unset( $_COOKIE[ 'wp-postpass_' . COOKIEHASH ] );
eq( 'removing password proof invalidates visibility', array( $db->findMany( 'posts', array( 'where' => $protectedWhere ), $anon ), $coreRead()->get_status() ), array( array(), 404 ) );
$wp->startServer();
$wire = json_decode(
	file_get_contents(
		$wp->url() . '/wp-json/spacepress/v1/posts/' . $protected['id'],
		false,
		stream_context_create(
			array(
				'http' => array(
					'ignore_errors' => true,
					'timeout'       => 10,
				),
			)
		)
	),
	true
);
eq( 'anonymous HTTP cannot read a native password-protected record', array( $wire['status'] ?? null, $wire['code'] ?? null ), array( 404, 'not_found' ) );
$db->delete( 'comments', array( 'id' => $linked['id'] ) );
$db->delete( 'posts', array( 'id' => array( 'in' => array( $protected['id'], $public['id'] ) ) ) );

// Forty unrelated protected rows add one batch query, not one query per row.
$wp->actAs( null );
$protectedIds = array();
for ( $i = 0; $i < 40; $i++ ) {
	$protectedIds[] = wp_insert_post(
		array(
			'post_type'     => 'sp_posts',
			'post_title'    => "Batch protected $i",
			'post_password' => "batch-secret-$i",
			'post_status'   => 'publish',
		)
	);
}
wp_cache_flush();
\SpacePress\Wp\CoreAccess::flush();
$queries      = $wpdb->num_queries;
$page         = $db->findMany(
	'posts',
	array(
		'where'   => array( 'id' => array( 'in' => array_merge( $protectedIds, array( $pub['id'] ) ) ) ),
		'orderBy' => array( 'id' => 'asc' ),
		'limit'   => 1,
	),
	$anon
);
$firstQueries = $wpdb->num_queries - $queries;
eq( 'batch visibility preserves a full public page', array_column( $page, 'id' ), array( $pub['id'] ) );
check( 'protected visibility primes forty posts in a bounded query count', $firstQueries <= 5, $firstQueries );
eq( 'anonymous pagination never primes unrelated protected posts', wp_cache_get( $protectedIds[0], 'posts' ), false );
$proofChecks       = 0;
$countCapabilities = static function ( $caps ) use ( &$proofChecks ) {
	++$proofChecks;
	return $caps;
};
add_filter( 'map_meta_cap', $countCapabilities, 1 );
$viewer = new \SpacePress\Viewer( $users['ed'] );
$db->findMany( 'posts', array( 'limit' => 1 ), $viewer );
$firstChecks = $proofChecks;
$db->findMany( 'posts', array( 'limit' => 1 ), $viewer );
remove_filter( 'map_meta_cap', $countCapabilities, 1 );
eq( 'same viewer and proof reuse visibility without rechecking every protected capability', array( $firstChecks > 0, $proofChecks ), array( true, $firstChecks ) );
wp_cache_flush();
\SpacePress\Wp\CoreAccess::flush();
$failPostLookup = static function ( string $sql ) use ( $wpdb ): string {
	return preg_match( '/^\s*SELECT\b/i', $sql ) && str_contains( $sql, $wpdb->posts )
		? 'SELECT * FROM sp_missing_post_storage'
		: $sql;
};
add_filter( 'query', $failPostLookup );
$suppressed = $wpdb->suppress_errors( true );
try {
	eq( 'SQL policy still hides protected rows when the WP post-cache lookup fails', $db->findMany( 'posts', array( 'where' => array( 'id' => $protectedIds[0] ) ), $anon ), array() );
	problem( 'unresolved protected posts refuse editor reads', fn () => $db->findMany( 'posts', array( 'where' => array( 'id' => $protectedIds[0] ) ), $viewer ), 503, 'storage_unavailable' );
} finally {
	remove_filter( 'query', $failPostLookup );
	$wpdb->suppress_errors( $suppressed );
}
eq( 'recovered lookups do not reuse permissive visibility from failed reads', $db->findMany( 'posts', array( 'where' => array( 'id' => $protectedIds[0] ) ), $anon ), array() );
eq( 'recovered lookups do not retain failed visibility for an authorized viewer', $db->findFirst( 'posts', array( 'where' => array( 'id' => $protectedIds[0] ) ), $viewer )['id'] ?? null, $protectedIds[0] );
wp_update_post(
	array(
		'ID'            => $protectedIds[0],
		'post_password' => '',
	)
);
eq( 'a native write invalidates protected visibility', $db->findFirst( 'posts', array( 'where' => array( 'id' => $protectedIds[0] ) ), $anon )['id'] ?? null, $protectedIds[0] );
foreach ( $protectedIds as $id ) {
	wp_delete_post( $id, true ); }

// ================================================================ write access

isProblem( 'anonymous create → 401', req( 'POST', '/posts', array( 'title' => 'x' ) ), 401, 'unauthenticated' );
isProblem( 'subscriber create → 403', req( 'POST', '/posts', array( 'title' => 'x' ), 'sub' ), 403, 'forbidden' );
[$s, $mine] = req(
	'POST',
	'/posts',
	array(
		'title'  => 'Alice writes',
		'status' => 'draft',
	),
	'alice'
);
eq( 'author creates; beforeCreate saw ctx.user and filled authorId', array( $s, $mine['authorId'] ?? null ), array( 201, $aliceProfile['id'] ) );
[$s, $bobs] = req( 'POST', '/posts', array( 'title' => 'Bob writes' ), 'bob' );
eq( 'no profile → authorId stays null', array( $s, array_key_exists( 'authorId', $bobs ), $bobs['authorId'] ), array( 201, true, null ) );
isProblem( 'update filter: another author\'s post is masked as 404', req( 'PATCH', "/posts/{$mine['id']}", array( 'title' => 'hijack' ), 'bob' ), 404, 'not_found' );
eq( 'update filter: own post', req( 'PATCH', "/posts/{$mine['id']}", array( 'excerpt' => 'mine' ), 'alice' )[1]['excerpt'] ?? null, 'mine' );
eq( 'editor updates anyone\'s', req( 'PATCH', "/posts/{$bobs['id']}", array( 'excerpt' => 'edited' ), 'ed' )[1]['excerpt'] ?? null, 'edited' );
isProblem( 'delete is editor+', req( 'DELETE', "/posts/{$mine['id']}", as: 'alice' ), 403, 'forbidden' );
isProblem( 'function rule returning a filter for anonymous → masked 404', req( 'PATCH', "/posts/{$pub['id']}", array( 'title' => 'x' ) ), 404, 'not_found' );
isProblem( 'role rule, anonymous → 401 before any lookup', req( 'PATCH', '/comments/999999', array( 'name' => 'x' ) ), 401, 'unauthenticated' );

// ================================================================ validation pointers, references

isProblem(
	'nested rule pointer',
	req(
		'POST',
		'/posts',
		array(
			'title'   => 'G',
			'gallery' => array(
				array(
					'image'   => 1,
					'caption' => str_repeat( 'c', 121 ),
				),
			),
		),
		'ed'
	),
	422,
	'invalid_input',
	'/gallery/0/caption'
);
isProblem(
	'dangling reference (pipeline-checked)',
	req(
		'POST',
		'/posts',
		array(
			'title'    => 'R',
			'authorId' => 999,
		),
		'ed'
	),
	409,
	'reference_violation',
	'/authorId'
);
isProblem(
	'unique email',
	req(
		'POST',
		'/authors',
		array(
			'name'  => 'A2',
			'email' => 'alice@example.com',
		),
		'admin'
	),
	409,
	'unique_violation',
	'/email'
);

// ================================================================ slugs (§3.3 4b)

eq( 'slug derived from the source column', $mine['slug'], 'alice-writes' );
$dup = req( 'POST', '/posts', array( 'title' => 'Alice Writes!' ), 'ed' )[1];
eq( 'collision → -2', $dup['slug'], 'alice-writes-2' );
eq(
	'explicit slug kept',
	req(
		'POST',
		'/posts',
		array(
			'title' => 'T',
			'slug'  => 'custom',
		),
		'ed'
	)[1]['slug'],
	'custom'
);
eq( 'title change alone keeps the slug', req( 'PATCH', "/posts/{$dup['id']}", array( 'title' => 'Renamed' ), 'ed' )[1]['slug'], 'alice-writes-2' );
eq( 'slug: null re-derives', req( 'PATCH', "/posts/{$dup['id']}", array( 'slug' => null ), 'ed' )[1]['slug'], 'renamed' );

// ================================================================ comments: rule filter, nested with, action access, hook ctx

[$s, $c1] = req(
	'POST',
	'/comments',
	array(
		'postId' => $pub['id'],
		'name'   => 'Anon',
		'body'   => 'Nice',
	),
	null
);
eq( 'anonymous create (create: anyone), unapproved', array( $s, $c1['approved'] ?? null ), array( 201, false ) );
isProblem(
	'validate message reaches the API',
	req(
		'POST',
		'/comments',
		array(
			'postId' => $pub['id'],
			'name'   => 'S',
			'body'   => 'http://spam',
		)
	),
	422,
	'invalid_input',
	'/body'
);
eq( 'anonymous: unapproved comments filtered', req( 'GET', '/comments' )[1], array() );
$withComments = req( 'GET', "/posts/{$pub['id']}", query: array( 'with' => 'comments' ) )[1];
eq( 'nested with applies the target read rule', $withComments['comments'], array() );
eq( 'signed-in readers see them through with', count( req( 'GET', "/posts/{$pub['id']}", as: 'sub', query: array( 'with' => '{"comments":true}' ) )[1]['comments'] ), 1 );
isProblem( 'action access: anonymous', req( 'POST', '/actions/approveComment', array( 'id' => $c1['id'] ) ), 401, 'unauthenticated' );
isProblem( 'action access: author below editor', req( 'POST', '/actions/approveComment', array( 'id' => $c1['id'] ), 'alice' ), 403, 'forbidden' );
eq( 'editor approves through the action', req( 'POST', '/actions/approveComment', array( 'id' => $c1['id'] ), 'ed' )[1]['approved'] ?? null, true );
eq( 'approved comment now public', count( req( 'GET', '/comments' )[1] ), 1 );
$staff = req(
	'POST',
	'/comments',
	array(
		'postId' => $pub['id'],
		'name'   => 'Ed',
		'body'   => 'Staff',
	),
	'ed'
)[1];
eq( 'staff comment approved on sight (afterCreate saw ctx.user)', $db->findFirst( 'comments', array( 'where' => array( 'id' => $staff['id'] ) ) )['approved'], true );
eq( 'action access "anyone"; the handler\'s db is trusted and filters status itself', req( 'POST', '/actions/publishedCount' )[1], array( 'count' => 4 ) );

// ================================================================ scheduling (§6.3)

// Posts are WordPress posts: a scheduled row is a `future` post, hidden until WP cron publishes it
// (promotion itself is proven in tests/wp/rest.test.ts, where cron runs).
$future      = '2031-01-01T00:00:00.000Z';
[$s, $sched] = req(
	'POST',
	'/posts',
	array(
		'title'       => 'Later',
		'status'      => 'scheduled',
		'publishedAt' => $future,
	),
	'ed'
);
eq( 'editor schedules', array( $s, $sched['status'] ?? null, get_post_status( $sched['id'] ) ), array( 201, 'scheduled', 'future' ) );
check( 'scheduled is invisible to anonymous', ! in_array( 'Later', $titles( req( 'GET', '/posts' )[1] ), true ) );
eq( '… and listed for editors with its date', array( in_array( 'Later', $titles( req( 'GET', '/posts', as: 'ed' )[1] ), true ), $db->findFirst( 'posts', array( 'where' => array( 'id' => $sched['id'] ) ) )['publishedAt'] ), array( true, $future ) );

// ================================================================ revisions (§6.4)

$p = req(
	'POST',
	'/posts',
	array(
		'title'   => 'Rev 1',
		'excerpt' => 'first',
	),
	'alice'
)[1];
req(
	'PATCH',
	"/posts/{$p['id']}",
	array(
		'title'   => 'Rev 2',
		'excerpt' => 'second',
	),
	'alice'
);
\SpacePress\Extensions::onRead(
	static function ( array $rows, string $c, ?\SpacePress\Viewer $viewer ): array {
		if ( 'posts' === $c && null !== $viewer ) {
			foreach ( $rows as &$row ) {
				if ( in_array( $row['title'], array( 'Rev 1', 'Rev 2' ), true ) ) {
					unset( $row['excerpt'] );
				}
			}
			unset( $row );
		}

		return $rows;
	},
	constraintSafe: true
);
[$s, $list] = req( 'GET', "/posts/{$p['id']}/revisions", as: 'alice' );
eq(
	'one revision per create/update, newest first, with the user',
	array( $s, count( $list ), $list[0]['user'] ?? null, $list[0]['id'] > $list[1]['id'] ),
	array(
		200,
		2,
		array(
			'id'   => $users['alice']['id'],
			'name' => 'alice',
		),
		true,
	)
);
eq( 'revision row is the state written then', req( 'GET', "/posts/{$p['id']}/revisions/{$list[1]['id']}", as: 'alice' )[1]['title'] ?? null, 'Rev 1' );
isProblem( 'revisions need update access on the row (other author: masked)', req( 'GET', "/posts/{$p['id']}/revisions", as: 'bob' ), 404, 'not_found' );
isProblem( 'unknown revision', req( 'GET', "/posts/{$p['id']}/revisions/999999", as: 'alice' ), 404, 'not_found' );
[$s, $restored] = req( 'POST', "/posts/{$p['id']}/revisions/{$list[1]['id']}/restore", as: 'alice' );
eq(
	'restore uses full revision data while hiding response fields',
	array(
		$s,
		$restored['title'] ?? null,
		array_key_exists( 'excerpt', $restored ),
		$db->findFirst( 'posts', array( 'where' => array( 'id' => $p['id'] ) ) )['excerpt'],
		count( req( 'GET', "/posts/{$p['id']}/revisions", as: 'alice' )[1] ),
	),
	array( 200, 'Rev 1', false, 'first', 3 )
);
eq( 'table() kinds have native revisions by default', req( 'GET', "/comments/{$c1['id']}/revisions", as: 'ed' )[0], 200 );
isProblem( 'collections without revisions', req( 'GET', "/openNotes/{$openNote['id']}/revisions", as: 'ed' ), 404, 'not_found' );

// ================================================================ globals (§3.6)

eq(
	'never written → defaults',
	req( 'GET', '/globals/settings' )[1],
	array(
		'siteTitle'    => 'My blog',
		'tagline'      => null,
		'postsPerPage' => 10,
		'social'       => null,
	)
);
isProblem( 'update needs editor: anonymous', req( 'PATCH', '/globals/settings', array( 'tagline' => 'x' ) ), 401, 'unauthenticated' );
isProblem( 'update needs editor: author', req( 'PATCH', '/globals/settings', array( 'tagline' => 'x' ), 'alice' ), 403, 'forbidden' );
isProblem(
	'nested validation in a global',
	req(
		'PATCH',
		'/globals/settings',
		array(
			'social' => array(
				array(
					'label' => 'X',
					'href'  => 'nope',
				),
			),
		),
		'ed'
	),
	422,
	'invalid_input',
	'/social/0/href'
);
isProblem( 'rules in a global', req( 'PATCH', '/globals/settings', array( 'postsPerPage' => 0 ), 'ed' ), 422, 'invalid_input', '/postsPerPage' );
isProblem( 'unknown global field', req( 'PATCH', '/globals/settings', array( 'nope' => 1 ), 'ed' ), 422, 'invalid_input', '/nope' );
req(
	'PATCH',
	'/globals/settings',
	array(
		'tagline' => 'Hi',
		'social'  => array(
			array(
				'label' => 'Site',
				'href'  => 'https://example.com',
			),
		),
	),
	'ed'
);
eq(
	'patch merges; untouched fields keep their defaults',
	req( 'PATCH', '/globals/settings', array( 'postsPerPage' => 20 ), 'ed' )[1],
	array(
		'siteTitle'    => 'My blog',
		'tagline'      => 'Hi',
		'postsPerPage' => 20,
		'social'       => array(
			array(
				'label' => 'Site',
				'href'  => 'https://example.com',
			),
		),
	)
);
eq( 'trusted db sees the same values', $db->globalGet( 'settings' )['postsPerPage'], 20 );
isProblem( 'unknown global', req( 'GET', '/globals/nope' ), 404, 'not_found' );

// Native SCF writes cross WordPress's scalar-meta serialization before SpacePress decodes them.
// A nullable boolean must retain explicit false separately from null and an omitted default.
( static function () use ( $db ): void {
	$fields = array(
		'featured' => array(
			'type'    => 'boolean',
			'default' => array( 'value' => false ),
		),
	);
	// Each type has a separate SCF writer and a different sub-field key shape.
	foreach ( array(
		'group'    => array(
			'type'   => 'group',
			'fields' => $fields,
		),
		'repeater' => array(
			'type'   => 'repeater',
			'fields' => $fields,
		),
		'blocks'   => array(
			'type'    => 'blocks',
			'layouts' => array( 'toggle' => $fields ),
		),
	) as $type => $def ) {
		$key   = 'field_sp_nullable_' . $type;
		$field = \SpacePress\Wp\Scf::fieldFor( $db->schema(), $key, 'sp_nullable_' . $type, 'probe', $def, array() );
		acf_add_local_field_group(
			array(
				'key'    => 'group_sp_nullable_' . $type,
				'title'  => 'Nullable probe',
				'fields' => array( $field ),
			)
		);
		$id   = wp_insert_post(
			array(
				'post_type'   => 'post',
				'post_title'  => 'SCF round trip',
				'post_status' => 'draft',
			)
		);
		$save = static function ( array $input ) use ( $id, $key, $def, $type ): mixed {
			$raw = match ( $type ) {
				'group' => $input,
				'repeater' => array( $input ),
				'blocks' => array( array( 'acf_fc_layout' => 'toggle' ) + $input ),
			};
			update_field( $key, $raw, $id );
			$row = \SpacePress\Wp\Scf::fromScf( $def, get_field( $key, $id, false ), $key );

			return ( 'group' === $type ? $row : $row[0] )['featured'];
		};
		if ( 'group' === $type ) {
			eq( 'SCF omitted nested boolean takes its declared default', $save( array() ), false );
		}
		eq( "SCF $type nullable false survives WordPress meta storage", $save( array( 'featured' => false ) ), false );
		eq( "SCF $type explicit null stays null", $save( array( 'featured' => null ) ), null );
		eq( "SCF $type checked nullable boolean stays true", $save( array( 'featured' => true ) ), true );
		wp_delete_post( $id, true );
	}
} )();

\SpacePress\Features::register(); // Re-registering bootstrap modules must not duplicate the media route.

// ================================================================ media (§4.6)

$png = tempnam( sys_get_temp_dir(), 'zimg' );
$im  = imagecreatetruecolor( 3, 2 );
imagepng( $im, $png );
$txt = tempnam( sys_get_temp_dir(), 'ztxt' );
file_put_contents( $txt, 'plain text' );
$upload = static fn ( string $path, string $name, ?string $as, array $form = array() ) => req(
	'POST',
	'/media',
	as: $as,
	files: array(
		'file' => array(
			'name'     => $name,
			'tmp_name' => $path,
			'error'    => UPLOAD_ERR_OK,
			'size'     => filesize( $path ),
		),
	),
	form: $form
);

isProblem( 'upload needs author: anonymous', $upload( $png, 'a.png', null ), 401, 'unauthenticated' );
[$s, $img] = $upload( $png, 'cover.png', 'alice', array( 'alt' => 'A cover' ) );
check(
	'upload → 201 media row, an attachment under wp-content/uploads',
	201 === $s && 'image/png' === $img['mime'] && array( $img['width'], $img['height'] ) === array( 3, 2 )
	&& 'A cover' === $img['alt'] && 'cover.png' === $img['filename'] && preg_match( '#/wp-content/uploads/\d{4}/\d{2}/cover\.png$#', $img['url'] ) === 1
	&& is_file( $wp->uploadPath( $img['url'] ) ) && get_post_type( $img['id'] ) === 'attachment',
	$img
);
$doc = $upload( $txt, 'notes.txt', 'alice' )[1];
isProblem( 'missing file part', req( 'POST', '/media', as: 'alice' ), 422, 'invalid_input', '/file' );
isProblem( 'accept: image rejects other mimes', req( 'PATCH', "/posts/{$mine['id']}", array( 'cover' => $doc['id'] ), 'alice' ), 422, 'invalid_input', '/cover' );
isProblem( 'unknown media id', req( 'PATCH', "/posts/{$mine['id']}", array( 'cover' => 999999 ), 'alice' ), 422, 'invalid_input', '/cover' );
req( 'PATCH', "/posts/{$mine['id']}", array( 'cover' => $img['id'] ), 'alice' );
eq( 'without with: the id', req( 'GET', "/posts/{$mine['id']}", as: 'alice' )[1]['cover'], $img['id'] );
eq( 'with: { cover: true } populates in place', req( 'GET', "/posts/{$mine['id']}", as: 'alice', query: array( 'with' => '{"cover":true}' ) )[1]['cover'], $img );
eq( 'GET /media/{id} and list', array( req( 'GET', "/media/{$img['id']}" )[1], array_column( req( 'GET', '/media', query: array( 'where' => '{"mime":"image/png"}' ) )[1], 'id' ) ), array( $img, array( $img['id'] ) ) );
eq( 'an empty media filter object is no filter', array( req( 'GET', '/media', query: array( 'where' => '{}' ) )[0], req( 'GET', '/media', query: array( 'where' => '{"AND":[{}]}' ) )[0] ), array( 200, 200 ) );
isProblem( 'media delete needs editor', req( 'DELETE', "/media/{$img['id']}", as: 'alice' ), 403, 'forbidden' );
$revs = count( $db->revisions( 'posts', $mine['id'] ) );
eq( 'editor deletes', req( 'DELETE', "/media/{$img['id']}", as: 'ed' )[1]['id'] ?? null, $img['id'] );
$after = $db->findFirst( 'posts', array( 'where' => array( 'id' => $mine['id'] ) ) );
eq( 'referencing media columns nulled through the pipeline (revision written)', array( $after['cover'], count( $db->revisions( 'posts', $mine['id'] ) ) ), array( null, $revs + 1 ) );
check( 'file removed after commit', ! is_file( $wp->uploadPath( $img['url'] ) ) );
isProblem( 'deleted media is gone', req( 'GET', "/media/{$img['id']}" ), 404, 'not_found' );

// ================================================================ FK actions in the pipeline (§4.2)

$db->delete( 'authors', array( 'id' => $aliceProfile['id'] ) );
eq( 'onDelete set null', array_unique( array_column( $db->findMany( 'posts', array( 'where' => array( 'id' => array( 'in' => array( $pub['id'], $mine['id'] ) ) ) ) ), 'authorId' ) ), array( null ) );
$db->delete( 'posts', array( 'id' => $pub['id'] ) );
eq( 'onDelete cascade', $db->findMany( 'comments', array( 'where' => array( 'postId' => $pub['id'] ) ) ), array() );

// ================================================================ extension seams

\SpacePress\SystemTables::register(
	'seam',
	array(
		'CREATE TABLE IF NOT EXISTS `{prefix}sp__seam` (`id` BIGINT NOT NULL AUTO_INCREMENT, `event` LONGTEXT NOT NULL, `extra` LONGTEXT, PRIMARY KEY (`id`)) ENGINE=InnoDB',
	)
);
\SpacePress\SystemTables::apply( $db->store() );
$wp->exec( 'INSERT INTO {prefix}sp__seam (`id`, `event`, `extra`) VALUES (1, ?, ?)', array( 'kept', 'upgraded' ) );
\SpacePress\SystemTables::apply( $db->store() );
eq( 'reapplying system table DDL preserves data', $wp->sql( 'SELECT `event` FROM {prefix}sp__seam' )[0], array( 'event' => 'kept' ) );
problem( 'system DDL rejects request transactions', fn () => $db->transaction( fn () => \SpacePress\SystemTables::apply( $db->store() ) ), 500, 'internal' );

$transformMutationRows = false;
\SpacePress\Extensions::onRead(
	static function ( array $rows, string $c ) use ( &$transformMutationRows ): array {
		if ( $transformMutationRows && 'posts' === $c ) {
			foreach ( $rows as &$row ) {
				$row['excerpt'] = 'display only';
			}
			unset( $row );
		}

		return $rows;
	},
	constraintSafe: true
);
\SpacePress\Extensions::normalizeWrite(
	static function ( string $op, string $c, array &$data, ?array $existing ): void {
		if ( 'posts' === $c ) {
			unset( $data['translationOf'] );
			if ( array_key_exists( 'password', $data ) ) {
				eq( 'input normalization receives the full stored row', $existing['excerpt'], 'extension' );
				$data['excerpt'] = $data['password'];
				unset( $data['password'] );
			}
		}
	}
);
\SpacePress\Extensions::onWrite(
	static function ( string $op, string $c, array &$data, ?array $existing, ?\SpacePress\Viewer $viewer, array $provided ): void {
		if ( 'posts' === $c && ( $data['title'] ?? '' ) === 'Extension' ) {
			eq(
				'write extension retains virtual input and distinguishes it from defaults',
				$provided,
				array(
					'title'         => 'Extension',
					'translationOf' => 123,
				)
			);
			// Defaults precede the extension, and the application hook derives authorId afterwards.
			$data['title']   = $data['status'] . ' ' . $viewer->user['name'];
			$data['excerpt'] = 'extension';
		}
		if ( 'posts' === $c && 'update' === $op && ( $data['excerpt'] ?? '' ) === 'revise' ) {
			eq( 'update extension retains the original virtual patch', $provided, array( 'password' => 'revise' ) );
			$data['excerpt'] = $existing['excerpt'] . ' revised';
		}
		if ( 'posts' === $c && 'delete' === $op && 'extension revised' === $data['excerpt'] ) {
			throw new \SpacePress\JsError( 'extension refused delete' );
		}
	}
);
\SpacePress\Extensions::onWritten(
	static function ( string $op, string $c, array $row, ?array $previous ) use ( $db ): void {
		if ( 'posts' !== $c || ! str_starts_with( $row['excerpt'] ?? '', 'extension' ) ) {
			return;
		}
		$db->insert(
			'comments',
			array(
				'postId' => $row['id'],
				'name'   => $op,
				'body'   => $previous['excerpt'] ?? 'created',
			)
		);
		if ( 'extension fail' === $row['excerpt'] ) {
			throw new \SpacePress\JsError( 'extension rolled back' );
		}
		\SpacePress\Extensions::afterCommit(
			static function () use ( $db, $op, $row ): void {
				$GLOBALS['wp']->exec( 'INSERT INTO {prefix}sp__seam (`event`) VALUES (?)', array( $op . ':' . $row['excerpt'] ) );
			}
		);
	}
);
$seamAuthor      = $db->insert(
	'authors',
	array(
		'name'   => 'Alice again',
		'email'  => 'again@example.com',
		'userId' => $users['alice']['id'],
	),
	true
)[0];
[$status, $seam] = req(
	'POST',
	'/posts',
	array(
		'title'         => 'Extension',
		'translationOf' => 123,
	),
	'alice'
);
eq( 'write extension sees defaults and viewer before the application hook', array( $status, $seam['title'], $seam['excerpt'], $seam['authorId'] ), array( 201, 'published alice', 'extension', $seamAuthor['id'] ) );
$transformMutationRows = true;
$seam                  = req( 'PATCH', '/posts/' . $seam['id'], array( 'password' => 'revise' ), 'ed' )[1];
$transformMutationRows = false;
eq(
	'update extension receives stored data and transforms only its response',
	array(
		$seam['excerpt'],
		$db->findFirst( 'posts', array( 'where' => array( 'id' => $seam['id'] ) ) )['excerpt'],
	),
	array( 'display only', 'extension revised' )
);
isProblem(
	'normalization still rejects unconsumed create inputs',
	req(
		'POST',
		'/posts',
		array(
			'title'   => 'Rejected',
			'unknown' => true,
		),
		'ed'
	),
	422,
	'invalid_input',
	'/unknown'
);
isProblem( 'normalization still rejects unconsumed update inputs', req( 'PATCH', '/posts/' . $seam['id'], array( 'unknown' => true ), 'ed' ), 422, 'invalid_input', '/unknown' );
eq(
	'written extension can nest writes and schedule durable effects',
	array(
		array_column(
			$db->findMany(
				'comments',
				array(
					'where'   => array( 'postId' => $seam['id'] ),
					'orderBy' => array( 'id' => 'asc' ),
				)
			),
			'body'
		),
		array_column( $wp->sql( 'SELECT `event` FROM {prefix}sp__seam ORDER BY `id`' ), 'event' ),
	),
	array( array( 'created', 'extension' ), array( 'kept', 'create:extension', 'update:extension revised' ) )
);
isProblem( 'written extension failure rolls back row and nested effects', req( 'PATCH', '/posts/' . $seam['id'], array( 'excerpt' => 'extension fail' ), 'ed' ), 422, 'rejected' );
eq(
	'failed write preserves row and nested data',
	array(
		$db->findFirst( 'posts', array( 'where' => array( 'id' => $seam['id'] ) ) )['excerpt'],
		count( $db->findMany( 'comments', array( 'where' => array( 'postId' => $seam['id'] ) ) ) ),
		$wp->scalar( 'SELECT COUNT(*) FROM {prefix}sp__seam' ),
	),
	array( 'extension revised', 2, 3 )
);
$transformMutationRows = true;
isProblem( 'delete extension receives stored data before deletion', req( 'DELETE', '/posts/' . $seam['id'], as: 'ed' ), 422, 'rejected' );
$transformMutationRows = false;

// The lookup seam primes a page cache which a read transform consumes, including nested relations.
$cache = array();
\SpacePress\Extensions::onLookup(
	static function ( string $c, array $pks ) use ( &$cache ): void {
		$cache[ $c ] = array_fill_keys( $pks, 'looked up' );
	}
);
// Receipt display changes no row membership or constraint values.
\SpacePress\Extensions::onRead(
	static function ( array $rows, string $c, ?\SpacePress\Viewer $viewer ) use ( &$cache ): array {
		if ( null !== $viewer && 'posts' === $c ) {
			foreach ( $rows as &$row ) {
				if ( 'Replay seam' === $row['title'] ) {
					$row['excerpt'] = $cache[ $c ][ $row['id'] ] ?? 'missing cache';
				}
			}
			unset( $row );
		}

		return $rows;
	},
	constraintSafe: true
);

// The receipt and download proofs run before the linkage-hiding read transform below is registered:
// that transform is not constraint-safe, so viewer-bound unique writes are refused once it exists (#72).
\SpacePress\Extensions::aroundOperation(
	static function ( string $scope, array $spec, string $raw, array $headers, ?\SpacePress\Viewer $viewer, callable $next ) use ( $wp ): \SpacePress\Response {
		if ( ! isset( $headers['idempotency-key'] ) ) {
			return $next();
		}
		$key    = 'receipt:' . $scope . ':' . ( $viewer?->user['id'] ?? 'anonymous' ) . ':' . $headers['idempotency-key'];
		$stored = $wp->scalar( 'SELECT `extra` FROM {prefix}sp__seam WHERE `event` = ?', array( $key ) );
		if ( null !== $stored ) {
			$receipt = json_decode( $stored, true );

			return \SpacePress\Response::json( $receipt['data'], $receipt['status'], array( 'Idempotent-Replayed' => 'true' ) );
		}
		$result = $next();
		$wp->exec(
			'INSERT INTO {prefix}sp__seam (`event`, `extra`) VALUES (?, ?)',
			array(
				$key,
				json_encode(
					\SpacePress\Seam::toWire(
						array(
							'status' => $result->status,
							'data'   => $result->data,
						)
					)
				),
			)
		);
		if ( 'fail' === $headers['idempotency-key'] ) {
			throw new \SpacePress\JsError( 'Receipt persistence failed' );
		}

		return $result;
	}
);
$receiptHeaders = array( 'Idempotency-Key' => 'create' );
$firstReceipt   = $wp->handle( 'POST', '/posts', '{"title":"Replay seam"}', 'ed', $receiptHeaders );
$cache          = array();
$replayReceipt  = $wp->handle( 'POST', '/posts', '{"title":"Replay seam"}', 'ed', $receiptHeaders );
eq(
	'create replay primes fresh lookup caches without repeating its write pipeline',
	array(
		$firstReceipt[0],
		$replayReceipt[0],
		$replayReceipt[1]['Idempotent-Replayed'],
		$firstReceipt[2] === $replayReceipt[2],
		json_decode( $replayReceipt[2], true )['data']['excerpt'],
		count( $db->findMany( 'posts', array( 'where' => array( 'title' => 'Replay seam' ) ) ) ),
	),
	array( 201, 201, 'true', true, 'looked up', 1 )
);
eq( 'create authorization still runs before replay middleware', $wp->handle( 'POST', '/posts', '{"title":"Replay seam"}', null, array( 'Idempotency-Key' => 'create' ) )[0], 401 );
$failedReceipt = $wp->handle( 'POST', '/posts', '{"title":"Rolled back receipt"}', 'ed', array( 'Idempotency-Key' => 'fail' ) );
eq(
	'failed operation wrapper rolls back both its result and receipt',
	array(
		$failedReceipt[0],
		$db->findMany( 'posts', array( 'where' => array( 'title' => 'Rolled back receipt' ) ) ),
		$wp->scalar( 'SELECT COUNT(*) FROM {prefix}sp__seam WHERE `event` LIKE ?', array( 'receipt:%:fail' ) ),
	),
	array( 422, array(), 0 )
);

\SpacePress\Extensions::route(
	'download-proof',
	static function () use ( $wp ): \SpacePress\Response {
		$wp->exec( 'INSERT INTO {prefix}sp__seam (`event`) VALUES (?)', array( 'download prepared' ) );
		\SpacePress\Extensions::afterCommit( static fn () => $wp->exec( 'INSERT INTO {prefix}sp__seam (`event`) VALUES (?)', array( 'download committed' ) ) );

		return \SpacePress\Response::raw(
			static function () use ( $wp ): void {
				echo "file\0bytes:" . $wp->scalar( 'SELECT `event` FROM {prefix}sp__seam ORDER BY `id` DESC LIMIT 1' );
			},
			200,
			array(
				'content-type'        => 'text/plain',
				'Content-Disposition' => 'attachment; filename="proof.bin"',
				'Cache-Control'       => 'public',
			)
		)
		->withHeaders(
			array(
				'CACHE-CONTROL'                 => 'private, no-store',
				'access-control-allow-origin'   => 'https://app.example',
				'access-control-expose-headers' => 'Content-Disposition',
			)
		);
	}
);
[$downloadStatus, $downloadHeaders, $downloadBody] = $wp->handle( 'GET', '/download-proof' );
ob_start();
\SpacePress\Response::emit( $downloadBody );
$emitted = ob_get_clean();
eq(
	'download response streams raw bytes and headers after commit',
	array(
		$downloadStatus,
		$downloadHeaders['content-type'],
		$downloadHeaders['Content-Disposition'],
		$downloadHeaders['CACHE-CONTROL'],
		$emitted,
		$downloadHeaders['access-control-allow-origin'],
		$downloadHeaders['access-control-expose-headers'],
		count( $downloadHeaders ) === count( array_change_key_case( $downloadHeaders ) ),
	),
	array( 200, 'text/plain', 'attachment; filename="proof.bin"', 'private, no-store', "file\0bytes:download committed", 'https://app.example', 'Content-Disposition', true )
);

\SpacePress\Extensions::onRead(
	static function ( array $rows, string $c, ?\SpacePress\Viewer $viewer ) use ( &$cache ): array {
		if ( null === $viewer ) {
			return $rows;
		}
		foreach ( $rows as &$row ) {
			if ( 'posts' === $c && 'extension revised' === $row['excerpt'] ) {
				$row['excerpt'] = $cache[ $c ][ $row['id'] ] . ( isset( $row['comments'] ) ? ' after with' : ' before with' );
				unset( $row['authorId'], $row['cover'] );
			} elseif ( 'comments' === $c && in_array( $row['name'], array( 'create', 'update' ), true ) ) {
				$row['body'] = $cache[ $c ][ $row['id'] ] . ( true === $row['approved'] ? ' decoded' : ' raw' );
				unset( $row['postId'] );
			}
		}
		unset( $row );

		return $rows;
	}
);
$read = req( 'GET', '/posts/' . $seam['id'], as: 'ed', query: array( 'with' => 'comments,authorId,cover' ) )[1];
eq( 'lookup precedes decoded read transforms, before with, at every relation level', array( $read['excerpt'], array_column( $read['comments'], 'body' ) ), array( 'looked up before with', array( 'looked up decoded', 'looked up decoded' ) ) );

eq(
	'read stripping keeps relation linkage private and does not resurrect populated media',
	array(
		is_array( $read['authorId'] ?? null ),
		array_key_exists( 'cover', $read ),
		$read['authorId']['id'],
		array_key_exists( 'postId', $read['comments'][0] ),
	),
	array( true, false, $seamAuthor['id'], false )
);
$revisionId = $db->revisions( 'posts', $seam['id'] )[0]['id'];
eq( 'revisions use the same read transform', array_key_exists( 'authorId', req( 'GET', '/posts/' . $seam['id'] . '/revisions/' . $revisionId, as: 'ed' )[1] ), false );
eq( 'write responses use the read transform after trusted hooks', array_key_exists( 'authorId', req( 'PATCH', '/posts/' . $seam['id'], array( 'body' => 'changed' ), 'ed' )[1] ), false );
\SpacePress\Extensions::beforeRead(
	static function ( string $c, array &$opts, ?\SpacePress\Viewer $viewer ): void {
		if ( isset( $opts['idsOnly'] ) ) {
			$opts['columns'] = array( 'id' => true );
			unset( $opts['idsOnly'] );
		}
		if ( 'posts' !== $c ) {
			return;
		}
		if ( null !== $viewer && isset( $opts['orderBy']['excerpt'] ) ) {
			throw new \SpacePress\HttpError( 403, 'forbidden', 'Cannot order by transformed data', '/orderBy/excerpt' );
		}
		if ( isset( $opts['seamId'] ) ) {
			$opts['where'] = array( 'id' => $opts['seamId'] );
			unset( $opts['seamId'] );
		}
		if ( array_key_exists( 'locale', $opts ) ) {
			if ( 'de' !== $opts['locale'] ) {
				throw \SpacePress\HttpError::invalidQuery( 'Unsupported test locale', '/locale' );
			}
			$opts['where'] = array( 'AND' => array( $opts['where'] ?? array(), array( 'title' => 'published alice' ) ) );
			unset( $opts['locale'] );
		}
	}
);
eq(
	'query extensions normalize filters and projections at every relation level',
	$db->findMany(
		'posts',
		array(
			'seamId'  => $seam['id'],
			'idsOnly' => true,
			'with'    => array( 'authorId' => array( 'idsOnly' => true ) ),
		)
	),
	array(
		array(
			'id'       => $seam['id'],
			'authorId' => array( 'id' => $seamAuthor['id'] ),
		),
	)
);
problem( 'query extensions reject forbidden selectors before the query', fn () => $db->findMany( 'posts', array( 'orderBy' => array( 'excerpt' => 'asc' ) ), new \SpacePress\Viewer( $users['ed'] ) ), 403, 'forbidden', '/orderBy/excerpt' );
eq(
	'REST list and item queries deliver feature options before SQL',
	array(
		array_column( req( 'GET', '/posts', as: 'ed', query: array( 'locale' => 'de' ) )[1], 'id' ),
		req( 'GET', '/posts/' . $seam['id'], as: 'ed', query: array( 'locale' => 'de' ) )[1]['id'],
	),
	array( array( $seam['id'] ), $seam['id'] )
);
isProblem( 'feature query validation reaches item REST', req( 'GET', '/posts/' . $seam['id'], query: array( 'locale' => 'invalid' ) ), 400, 'invalid_query', '/locale' );
isProblem( 'unconsumed feature options remain invalid on other collections', req( 'GET', '/authors', query: array( 'locale' => 'de' ) ), 400, 'invalid_query', '/locale' );

$db->setActor( $users['sub'] );
$invoked = $app->invoke(
	'POST',
	'/comments',
	array(),
	array(
		'postId' => $seam['id'],
		'name'   => 'dispatch',
		'body'   => 'approved as editor',
	),
	new \SpacePress\Viewer( $users['ed'] )
);
eq( 'operation invocation uses explicit authority and restores its caller actor', array( $db->findFirst( 'comments', array( 'where' => array( 'id' => $invoked['id'] ) ) )['approved'], $db->actor() ), array( true, $users['sub'] ) );
problem( 'operation invocation throws access errors without serializing them', fn () => $app->invoke( 'POST', '/actions/approveComment', array(), array( 'id' => $invoked['id'] ), new \SpacePress\Viewer( $users['sub'] ) ), 403, 'forbidden' );
eq( 'throwing operation invocation also restores the caller actor', $db->actor(), $users['sub'] );
$db->setActor( null );

\SpacePress\Extensions::schemaDescribe( static fn ( array $d ): array => $d + array( 'seam' => array( 'version' => 1 ) ) );
eq( 'public schema description extensions reach HTTP', req( 'GET', '/_schema' )[1]['seam'], array( 'version' => 1 ) );

\SpacePress\Extensions::route(
	'posts',
	static function ( string $method, array $segments, array $query, string $body, \SpacePress\Viewer $viewer, array $files, array $form ): array {
		App::allow( $method, array( 'POST' ) );

		return array( 202, array( $segments, $query, $body, $viewer->user['name'] ?? null, $files, $form ) );
	}
);
eq(
	'route extension owns a prefix before collections and receives all request parts',
	req( 'POST', '/posts/a%20b/c/d/e/f', array( 'raw' => true ), 'ed', array( 'q' => 'value' ), array( 'file' => array( 'name' => 'x' ) ), array( 'alt' => 'y' ) ),
	array( 202, array( array( 'posts', 'a b', 'c', 'd', 'e', 'f' ), array( 'q' => 'value' ), '{"raw":true}', 'ed', array( 'file' => array( 'name' => 'x' ) ), array( 'alt' => 'y' ) ) )
);
isProblem( 'extension errors use the normal problem envelope', req( 'GET', '/posts' ), 405, 'method_not_allowed' );
isProblem( 'prefix dispatch matches complete segments', req( 'GET', '/postsExtra' ), 404, 'not_found' );

\SpacePress\Extensions::beforeAction(
	static function ( array $spec, string $name, string $raw, array $headers, ?\SpacePress\Viewer $viewer ): void {
		if ( 'approveComment' === $name && ( $headers['x-proof'] ?? '' ) !== hash( 'sha256', $raw ) ) {
			throw new \SpacePress\HttpError( 403, 'forbidden', 'Bad raw-body proof' );
		}
		if ( 'publishedCount' === $name && null === $viewer && trim( $raw ) === '{"reject":true}' ) {
			throw new \SpacePress\JsError( 'CLI action extension' );
		}
	}
);
$seamComment = $db->findFirst( 'comments', array( 'where' => array( 'postId' => $seam['id'] ) ) );
$raw         = '{ "id": ' . $seamComment['id'] . ' }';
[$s, , $out] = $wp->handle( 'POST', '/actions/approveComment', $raw, 'ed', array( 'X-Proof' => hash( 'sha256', $raw ) ) );
eq( 'action invocation extension gets exact raw body and normalized headers', array( $s, json_decode( $out, true )['data']['id'] ), array( 200, $seamComment['id'] ) );
[$s, , $out] = $wp->handle( 'POST', '/actions/approveComment', $raw, 'ed' );
eq( 'action extension may reject before handler execution', array( $s, json_decode( $out, true )['code'] ), array( 403, 'forbidden' ) );
$actionHeaders = array(
	'x-proof'         => hash( 'sha256', $raw ),
	'idempotency-key' => 'action',
);
$wp->handle( 'POST', '/actions/approveComment', $raw, 'ed', $actionHeaders );
[$s, $replayedHeaders, $out] = $wp->handle( 'POST', '/actions/approveComment', $raw, 'ed', $actionHeaders );
eq( 'action middleware receives result and can replay it with response metadata', array( $s, $replayedHeaders['Idempotent-Replayed'], json_decode( $out, true )['data']['id'] ), array( 200, 'true', $seamComment['id'] ) );
$actionHeaders['x-proof'] = 'invalid';
eq( 'action signature guard still runs before replay middleware', $wp->handle( 'POST', '/actions/approveComment', $raw, 'ed', $actionHeaders )[0], 403 );
[$code, $out] = $app->cli( array( 'action', 'publishedCount', '{"reject":true}' ) );
eq( 'trusted CLI actions share the invocation extension', array( $code, json_decode( $out, true )['error']['code'] ), array( 1, 'rejected' ) );
\SpacePress\Extensions::cli(
	'seam',
	static function ( array $args, array $flags ) use ( $wp ): array {
		$wp->exec( 'INSERT INTO {prefix}sp__seam (`event`) VALUES (?)', array( $args[0] ) );
		if ( isset( $flags['fail'] ) ) {
			throw new \SpacePress\JsError( 'CLI extension rollback' );
		}

		return array(
			'args'  => $args,
			'flags' => $flags,
		);
	}
);
[$code, $out] = $app->cli( array( 'seam', 'saved', '--mode=local' ) );
eq(
	'CLI extension runs through the canonical envelope',
	array( $code, json_decode( $out, true )['data'] ),
	array(
		0,
		array(
			'args'  => array( 'saved' ),
			'flags' => array( 'mode' => 'local' ),
		),
	)
);
$app->cli( array( 'seam', 'discarded', '--fail' ) );
eq( 'CLI extension effects join the command transaction', $wp->scalar( 'SELECT `event` FROM {prefix}sp__seam ORDER BY `id` DESC LIMIT 1' ), 'saved' );

try {
	\SpacePress\Extensions::route( 'sync', static fn (): array => array( 200, null ) );
	check( 'a second owner for an extension route is refused', false );
} catch ( \LogicException ) {
	check( 'a second owner for an extension route is refused', true );
}

finish( 'blog_test' );
