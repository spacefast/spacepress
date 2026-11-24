<?php

declare(strict_types=1);

/*
 * `taxonomy()` and `terms()` on WordPress, in-process (tests/php/wp.php), on the app in
 * tests/fixtures/taxonomy (schema.php is what `spacepress build` emits for it, checked by tests/compiler.rs):
 * term rows and their implicit fields, term meta fields, assigning through `on` and `terms()`, write
 * order, list filters, `with` both ways, access (assigning vs creating), the hierarchy and term URLs
 * (docs/decisions/2026-11-11-authoring-surface.md, rulings 25-34).
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$fixture                              = dirname( __DIR__ ) . '/fixtures/taxonomy';
$schema                               = require "$fixture/schema.php";
$merchantTags                         = $schema['taxonomies']['tags'];
$merchantTags['key']                  = 'merchantTags';
$merchantTags['label']                = 'Merchant tags';
$merchantTags['columns']['uid']       = array( 'type' => 'text' );
$merchantTags['relations']            = array();
$merchantTags['url']                  = null;
$merchantTags['wp']                   = array(
	'taxonomy'       => 'sp_merchant_tags',
	'groupKey'       => 'group_sp_merchant_tags',
	'metaPrefix'     => 'sp_',
	'fieldKeyPrefix' => 'field_sp_merchant_tags_',
	'on'             => array( 'posts' ),
);
$schema['taxonomies']['merchantTags'] = $merchantTags;
$wp                                   = wpSite(
	'taxonomy',
	array(
		'schema'    => $schema,
		'functions' => file_get_contents( "$fixture/functions.php" ),
		'users'     => array(
			'ed'    => 'editor',
			'alice' => 'author',
			'sub'   => 'subscriber',
		),
	)
);
$db                                   = \SpacePress\db();

/** @return array{int, mixed} */
function req( string $method, string $path, mixed $body = null, ?string $as = null, array $query = array() ): array {
	global $wp;
	[$status, $data] = $wp->call( $method, $path, $body, $as, $query );

	return array( $status, $data );
}

function isProblem( string $label, array $r, int $status, string $code, ?string $pointer = null ): void {
	[$s, $p] = $r;
	check( "$label → $status $code" . ( null === $pointer ? '' : " $pointer" ), $s === $status && ( $p['code'] ?? null ) === $code && ( $p['pointer'] ?? null ) === $pointer, $p );
}

$names = static fn ( array $rows ): array => array_column( $rows, 'name' );

// Authored uid keeps ordinary term metadata, including SCF's underscore-prefixed field reference.
$merchant = wp_insert_term( 'Existing merchant tag', 'sp_merchant_tags' )['term_id'];
update_term_meta( $merchant, 'sp_uid', 'merchant-42' );
update_term_meta( $merchant, '_sp_uid', 'field_sp_merchant_tags_uid' );
eq( 'existing authored taxonomy uid values keep their metadata key', $db->findFirst( 'merchantTags', array( 'where' => array( 'id' => $merchant ) ) )['uid'], 'merchant-42' );
eq( 'authored uid filters use the existing metadata', array_column( $db->findMany( 'merchantTags', array( 'where' => array( 'uid' => 'merchant-42' ) ) ), 'id' ), array( $merchant ) );
$db->update( 'merchantTags', array( 'uid' => 'merchant-43' ), array( 'id' => $merchant ) );
eq( 'API writes preserve authored uid storage and the SCF field reference', array( get_term_meta( $merchant, 'sp_uid', true ), get_term_meta( $merchant, '_sp_uid', true ) ), array( 'merchant-43', 'field_sp_merchant_tags_uid' ) );
eq( 'SCF reads the authored uid written through the API', get_field( 'field_sp_merchant_tags_uid', 'term_' . $merchant ), 'merchant-43' );
update_field( 'field_sp_merchant_tags_uid', 'merchant-44', 'term_' . $merchant );
eq( 'API reads the authored uid written through SCF', $db->findFirst( 'merchantTags', array( 'where' => array( 'id' => $merchant ) ) )['uid'], 'merchant-44' );
$newMerchant = $db->insert(
	'merchantTags',
	array(
		'name' => 'New merchant tag',
		'uid'  => 'merchant-45',
	),
	true
)[0];
eq( 'API-created authored uid values use ordinary term metadata', array( $newMerchant['uid'], get_term_meta( $newMerchant['id'], 'sp_uid', true ) ), array( 'merchant-45', 'merchant-45' ) );

// ================================================================ registration (ruling 25)

$taxonomy = get_taxonomy( 'sp_topics' );
check( 'the taxonomy registers as sp_<name> for its kinds', $taxonomy instanceof \WP_Taxonomy && $taxonomy->object_type === array( 'sp_posts', 'sp_pages' ), $taxonomy?->object_type );
eq( '… hierarchical, in REST under sp_<name>, with no rewrite or query var', array( $taxonomy->hierarchical, $taxonomy->show_in_rest, $taxonomy->rest_base, $taxonomy->rewrite, $taxonomy->query_var ), array( true, true, 'sp_topics', false, false ) );
eq( '… keeping write order', array( $taxonomy->sort, $taxonomy->args ), array( true, array( 'orderby' => 'term_order' ) ) );
eq(
	'… with per-taxonomy capabilities',
	(array) $taxonomy->cap,
	array(
		'manage_terms' => 'manage_sp_topics',
		'edit_terms'   => 'edit_sp_topics',
		'delete_terms' => 'delete_sp_topics',
		'assign_terms' => 'assign_sp_topics',
	)
);
eq( 'a taxonomy with a url is public', array( $taxonomy->public, get_taxonomy( 'sp_tags' )->public ), array( true, true ) );
eq( 'terms() registers the taxonomy for its kind', get_taxonomy( 'sp_tags' )->object_type, array( 'sp_posts' ) );
check( 'term fields are registered term meta', isset( get_registered_meta_keys( 'term', 'sp_topics' )['sp_color'] ), array_keys( get_registered_meta_keys( 'term', 'sp_topics' ) ) );
$group = acf_get_local_field_group( 'group_sp_topics' );
check(
	'the SCF field group sits on the taxonomy',
	is_array( $group ) && $group['location'][0][0] === array(
		'param'    => 'taxonomy',
		'operator' => '==',
		'value'    => 'sp_topics',
	),
	$group
);
eq( 'no table is created for a taxonomy', $wp->connection()->run( "SELECT name FROM sqlite_master WHERE name LIKE '%sp_topics%'" ), array() );

// ================================================================ term rows (ruling 27)

$news = $db->insert(
	'topics',
	array(
		'name'   => 'News',
		'color'  => 'red',
		'shades' => array( 'dark' ),
	),
	true
)[0];
eq( 'a term row: implicit fields, then the authored ones', array_keys( $news ), array( 'id', 'name', 'slug', 'description', 'parent', 'count', 'url', 'color', 'icon', 'owner', 'shades', 'note' ) );
eq( '… slug derived from the name, empty description, no parent, no items', array( $news['slug'], $news['description'], $news['parent'], $news['count'] ), array( 'news', '', null, 0 ) );
eq( '… url from the pattern', $news['url'], home_url( '/topics/news/' ) );
eq( '… term meta in SpacePress\'s value form', array( $news['color'], $news['shades'] ), array( 'red', array( 'dark' ) ) );
eq( '… stored under sp_<field>', get_term_meta( $news['id'], 'sp_color', true ), 'red' );
eq( 'the id is core\'s term id', get_term( $news['id'], 'sp_topics' )->name, 'News' );
$sports = $db->insert(
	'topics',
	array(
		'name' => 'Sports',
		'slug' => 'sport',
	),
	true
)[0];
eq( 'a given slug is kept', $sports['slug'], 'sport' );
$other = $db->insert(
	'topics',
	array(
		'name' => 'Other',
		'slug' => 'sport',
	),
	true
)[0];
eq( 'a taken slug is made unique within the taxonomy, as core makes it', $other['slug'], 'sport-2' );
$db->delete( 'topics', array( 'id' => $other['id'] ) );
problem( 'a taken name is a 409 at name', fn () => $db->insert( 'topics', array( 'name' => 'News' ) ), 409, 'unique_violation', '/name' );
problem( 'name is required', fn () => $db->insert( 'topics', array( 'color' => 'x' ) ), 422, 'invalid_input', '/name' );
problem(
	'count is read-only',
	fn () => $db->insert(
		'topics',
		array(
			'name'  => 'Counted',
			'count' => 4,
		)
	),
	422,
	'invalid_input',
	'/count'
);
problem( 'url is read-only', fn () => $db->update( 'topics', array( 'url' => 'x' ), array( 'id' => $news['id'] ) ), 422, 'invalid_input', '/url' );
problem(
	'a term has no author',
	fn () => $db->insert(
		'topics',
		array(
			'name'   => 'A',
			'author' => 1,
		)
	),
	422,
	'invalid_input',
	'/author'
);
$updated = $db->update(
	'topics',
	array(
		'name'        => 'World news',
		'description' => 'Everywhere',
		'color'       => null,
	),
	array( 'id' => $news['id'] ),
	true
)[0];
eq( 'an update writes core\'s fields and term meta', array( $updated['name'], $updated['slug'], $updated['description'], $updated['color'] ), array( 'World news', 'news', 'Everywhere', null ) );
eq( 'a cleared field is gone from term meta', get_term_meta( $news['id'], 'sp_color', true ), '' );
$short = $db->insert( 'tags', array( 'name' => 'Short' ), true )[0];
eq( 'a term with no fields of its own is a row too', array_keys( $short ), array( 'id', 'name', 'slug', 'description', 'count', 'url' ) );

// ================================================================ hierarchy (ruling 30)

$local = $db->insert(
	'topics',
	array(
		'name'   => 'Local',
		'parent' => $news['id'],
	),
	true
)[0];
$city  = $db->insert(
	'topics',
	array(
		'name'   => 'City',
		'parent' => $local['id'],
	),
	true
)[0];
eq( 'parent is a term of the same taxonomy', $local['parent'], $news['id'] );
eq( '`:path` is the chain of ancestor slugs', $city['url'], home_url( '/topics/news/local/city/' ) );
$tag = $db->insert( 'tags', array( 'name' => 'Elsewhere' ), true )[0];
foreach ( array( $tag, $short ) as $row ) {
	wp_cache_delete( $row['id'], 'terms' );
}
$readUrls   = static fn () => array_column( $db->findMany( 'tags', array( 'columns' => array( 'url' => true ) ) ), 'url' );
$beforeUrls = $wpdb->num_queries;
eq( 'term lists use the core permalink for each row', $readUrls(), array( home_url( '/tags/elsewhere/' ), home_url( '/tags/short/' ) ) );
$coldQueries = $wpdb->num_queries - $beforeUrls;
$beforeUrls  = $wpdb->num_queries;
$readUrls();
eq( 'cold term links need one more WordPress query than cached links', $coldQueries - ( $wpdb->num_queries - $beforeUrls ), 1 );
problem(
	'a parent from another taxonomy is refused',
	fn () => $db->insert(
		'topics',
		array(
			'name'   => 'X',
			'parent' => $tag['id'],
		)
	),
	409,
	'reference_violation',
	'/parent'
);
problem( 'a term can\'t be its own parent', fn () => $db->update( 'topics', array( 'parent' => $local['id'] ), array( 'id' => $local['id'] ) ), 409, 'reference_violation', '/parent' );
problem(
	'a flat taxonomy has no parent',
	fn () => $db->insert(
		'tags',
		array(
			'name'   => 'Y',
			'parent' => $tag['id'],
		)
	),
	422,
	'invalid_input',
	'/parent'
);

// ================================================================ assigning terms (ruling 26)

$p1 = $db->insert(
	'posts',
	array(
		'title'  => 'First',
		'topics' => array( $sports['id'], $news['id'] ),
		'labels' => array( $tag['id'] ),
	),
	true
)[0];
eq( '`on` gives the item a field named after the taxonomy, in write order', $p1['topics'], array( $sports['id'], $news['id'] ) );
eq( 'terms() is the same kind of field', $p1['labels'], array( $tag['id'] ) );
eq(
	'the links are core\'s term relationships, in that order',
	wp_get_object_terms(
		$p1['id'],
		'sp_topics',
		array(
			'fields'  => 'ids',
			'orderby' => 'term_order',
		)
	),
	array( $sports['id'], $news['id'] )
);
eq( 'core keeps the counts', $db->findFirst( 'topics', array( 'where' => array( 'id' => $sports['id'] ) ) )['count'], 1 );
$p2 = $db->insert(
	'posts',
	array(
		'title'  => 'Second',
		'topics' => array( $news['id'] ),
	),
	true
)[0];
$p3 = $db->insert( 'posts', array( 'title' => 'Third' ), true )[0];
eq( 'an item with no terms holds []', $p3['topics'], array() );
$reordered = $db->update( 'posts', array( 'topics' => array( $news['id'], $local['id'], $sports['id'] ) ), array( 'id' => $p1['id'] ), true )[0];
eq( 'a write replaces the set, in its new order', $reordered['topics'], array( $news['id'], $local['id'], $sports['id'] ) );
problem( 'a term of another taxonomy is refused', fn () => $db->update( 'posts', array( 'topics' => array( $tag['id'] ) ), array( 'id' => $p3['id'] ) ), 409, 'reference_violation', '/topics/0' );
problem( 'a duplicate id is refused', fn () => $db->update( 'posts', array( 'topics' => array( $news['id'], $news['id'] ) ), array( 'id' => $p3['id'] ) ), 422, 'invalid_input', '/topics/1' );
problem( 'a name never creates a term', fn () => $db->update( 'posts', array( 'topics' => array( 'Brand new' ) ), array( 'id' => $p3['id'] ) ), 422, 'invalid_input', '/topics/0' );
check( '… and none was created', get_term_by( 'name', 'Brand new', 'sp_topics' ) === false );

// ================================================================ queries (ruling 28)

$titles = static fn ( array $rows ): array => array_column( $rows, 'title' );
$order  = array( 'orderBy' => array( 'id' => 'asc' ) );
eq( 'has: items carrying the term', $titles( $db->findMany( 'posts', array( 'where' => array( 'topics' => array( 'has' => $news['id'] ) ) ) + $order ) ), array( 'First', 'Second' ) );
eq( 'has is exact: a parent doesn\'t match items with only its children', $titles( $db->findMany( 'posts', array( 'where' => array( 'topics' => array( 'has' => $local['id'] ) ) ) + $order ) ), array( 'First' ) );
eq( '[]: items with none', $titles( $db->findMany( 'posts', array( 'where' => array( 'topics' => array() ) ) + $order ) ), array( 'Third' ) );
eq( 'true / false: some or none', array( $titles( $db->findMany( 'posts', array( 'where' => array( 'topics' => true ) ) + $order ) ), $titles( $db->findMany( 'posts', array( 'where' => array( 'topics' => false ) ) + $order ) ) ), array( array( 'First', 'Second' ), array( 'Third' ) ) );
eq( 'a filter on the linked terms', $titles( $db->findMany( 'posts', array( 'where' => array( 'topics' => array( 'slug' => 'sport' ) ) ) + $order ) ), array( 'First' ) );
$with = $db->findFirst(
	'posts',
	array(
		'where' => array( 'id' => $p1['id'] ),
		'with'  => array( 'topics' => true ),
	)
);
eq( 'with: the term rows in write order', $names( $with['topics'] ), array( 'World news', 'Local', 'Sports' ) );
$nested = $db->findFirst(
	'posts',
	array(
		'where' => array( 'id' => $p1['id'] ),
		'with'  => array(
			'topics' => array(
				'orderBy' => array( 'name' => 'asc' ),
				'limit'   => 2,
			),
		),
	)
);
eq( '… nested orderBy and limit apply per item', $names( $nested['topics'] ), array( 'Local', 'Sports' ) );
eq( 'terms list by name, then id', $names( $db->findMany( 'topics' ) ), array( 'City', 'Local', 'Sports', 'World news' ) );
eq(
	'where and orderBy on term fields',
	$names(
		$db->findMany(
			'topics',
			array(
				'where'   => array( 'parent' => null ),
				'orderBy' => array( 'slug' => 'desc' ),
			)
		)
	),
	array( 'Sports', 'World news' )
);
eq(
	'the reverse relation is named after the kind',
	array_column(
		$db->findFirst(
			'topics',
			array(
				'where' => array( 'id' => $news['id'] ),
				'with'  => array( 'posts' => true ),
			)
		)['posts'],
		'title'
	),
	array( 'First', 'Second' )
);
eq(
	'… and .reverse() renames it',
	array_column(
		$db->findFirst(
			'tags',
			array(
				'where' => array( 'id' => $tag['id'] ),
				'with'  => array( 'labelled' => true ),
			)
		)['labelled'],
		'title'
	),
	array( 'First' )
);
eq( 'a reverse filter', $names( $db->findMany( 'topics', array( 'where' => array( 'posts' => array( 'title' => 'Second' ) ) ) ) ), array( 'World news' ) );
problem( 'terms is not an orderBy key', fn () => $db->findMany( 'posts', array( 'orderBy' => array( 'topics' => 'asc' ) ) ), 400, 'invalid_query', '/orderBy/topics' );
eq( 'the item URL uses the first term\'s slug', get_permalink( $p1['id'] ), home_url( '/notes/news/first/' ) );
eq( 'an item with no term has no URL yet', str_contains( (string) get_permalink( $p3['id'] ), '/notes/' ), false );

// ================================================================ access (ruling 29)

eq( 'anyone reads terms', req( 'GET', '/topics' )[0], 200 );
[$s, $read] = req( 'GET', '/topics', query: array( 'where' => '{"slug":"sport"}' ) );
eq( '… through SpacePress\'s pipeline', array( $s, $names( $read ) ), array( 200, array( 'Sports' ) ) );
check( 'a field with a read rule is masked', ! array_key_exists( 'note', $read[0] ), $read[0] );
[$s, $created] = req( 'POST', '/topics', array( 'name' => 'By alice' ), as: 'alice' );
eq( 'the create rule (author) lets an author create', array( $s, $created['name'] ?? null ), array( 201, 'By alice' ) );
isProblem( 'a subscriber can\'t create', req( 'POST', '/topics', array( 'name' => 'By sub' ), as: 'sub' ), 403, 'forbidden' );
isProblem( 'the update rule (editor) refuses an author', req( 'PATCH', "/topics/{$created['id']}", array( 'name' => 'Renamed' ), as: 'alice' ), 403, 'forbidden' );
isProblem( 'tags: an author may not create', req( 'POST', '/tags', array( 'name' => 'nope' ), as: 'alice' ), 403, 'forbidden' );
[$s, $assigned] = req(
	'POST',
	'/pages',
	array(
		'title'  => 'By alice',
		'topics' => array( $news['id'] ),
	),
	as: 'alice'
);
eq( 'assigning needs the item\'s rule (pages: author), not the taxonomy\'s update rule', array( $s, $assigned['topics'] ?? null ), array( 201, array( $news['id'] ) ) );
isProblem(
	'… and an item kind the author may not write refuses',
	req(
		'POST',
		'/posts',
		array(
			'title'  => 'No',
			'labels' => array( $tag['id'] ),
		),
		as: 'alice'
	),
	403,
	'forbidden'
);
wp_set_current_user( $wp->userId( 'alice' ) );
check( 'assign_sp_topics is granted to someone who may write an attached kind', current_user_can( 'assign_sp_topics' ) );
check( '… assign_sp_tags is not: posts are editor-only', ! current_user_can( 'assign_sp_tags' ) );
check( 'edit_sp_topics (core\'s create check on a hierarchical taxonomy) follows the create rule', current_user_can( 'edit_sp_topics' ) );
check( '… delete_sp_topics follows the delete rule (editor)', ! current_user_can( 'delete_sp_topics' ) );
check( 'core\'s create path is refused without the create rule', is_wp_error( wp_insert_term( 'Sneaky', 'sp_tags' ) ) );
wp_set_current_user( $wp->userId( 'sub' ) );
check( 'a subscriber who may write no attached kind has no assign capability', ! current_user_can( 'assign_sp_tags' ) );
wp_set_current_user( 0 );

// ================================================================ deletes (ruling 30)

$db->delete( 'topics', array( 'id' => $local['id'] ) );
$city = $db->findFirst( 'topics', array( 'where' => array( 'id' => $city['id'] ) ) );
eq( 'deleting a term moves its children to its parent', $city['parent'], $news['id'] );
eq( '… and removes its links', $db->findFirst( 'posts', array( 'where' => array( 'id' => $p1['id'] ) ) )['topics'], array( $news['id'], $sports['id'] ) );
$before = $db->findFirst( 'topics', array( 'where' => array( 'id' => $news['id'] ) ) )['count'];
$db->delete( 'posts', array( 'id' => $p2['id'] ) );
eq( 'deleting an item removes its links and recounts (count spans every attached kind)', array( $before, $db->findFirst( 'topics', array( 'where' => array( 'id' => $news['id'] ) ) )['count'] ), array( 3, 2 ) );
eq(
	'deleting a term removes its meta',
	( function () use ( $db, $sports ): array {
		$db->update( 'topics', array( 'color' => 'blue' ), array( 'id' => $sports['id'] ) );
		$db->delete( 'topics', array( 'id' => $sports['id'] ) );
		return get_term_meta( $sports['id'] );
	} )(),
	array()
);

// Deleting a parent term must not reparent child terms the viewer can't read (#522).
( static function () use ( $wp, $schema ): void {
	$db         = \SpacePress\db();
	$parent     = $db->insert( 'topics', array( 'name' => 'Visible Parent' ), true )[0];
	$child      = $db->insert(
		'topics',
		array(
			'name'   => 'Hidden Child',
			'parent' => $parent['id'],
		),
		true
	)[0];
	$restricted = $schema;
	$restricted['taxonomies']['topics']['access']['read'] = array( 'fn' => static fn (): array => array( 'id' => array( 'ne' => $child['id'] ) ) );
	$restrictedSchema                                     = new \SpacePress\Schema( $restricted );
	$store        = \SpacePress\Wp\CompositeStore::create( $restrictedSchema, $wp->connection() );
	$restrictedDb = new \SpacePress\Db( $store, $restrictedSchema, $db->media() );
	$editor       = new \SpacePress\Viewer(
		array(
			'id'   => $wp->userId( 'ed' ),
			'name' => 'ed',
			'role' => 'editor',
		)
	);
	$previous     = \SpacePress\Db::instance();
	\SpacePress\Db::setInstance( $restrictedDb );
	try {
		problem(
			'deleting a parent term refuses when a child term may be hidden from the viewer',
			fn () => $restrictedDb->delete( 'topics', array( 'id' => $parent['id'] ), false, $editor ),
			409,
			'reference_violation',
		);
		eq( 'the parent term stays', $db->findFirst( 'topics', array( 'where' => array( 'id' => $parent['id'] ) ) )['name'] ?? null, 'Visible Parent' );
		eq( 'the hidden child keeps its parent', $db->findFirst( 'topics', array( 'where' => array( 'id' => $child['id'] ) ) )['parent'] ?? null, $parent['id'] );
	} finally {
		\SpacePress\Db::setInstance( $previous );
	}
	// A viewer who can read every term in the taxonomy can still delete the parent.
	$db->delete( 'topics', array( 'id' => $parent['id'] ), false, $editor );
	eq( 'with full read visibility, deleting the parent reparents the child to root', $db->findFirst( 'topics', array( 'where' => array( 'id' => $child['id'] ) ) )['parent'], null );
	$db->delete( 'topics', array( 'id' => $child['id'] ) );
} )();

// ================================================================ core internals the term route relies on
// TermsController subclasses core's WP_REST_Terms_Controller and TermMeta its WP_REST_Term_Meta_Fields
// (docs/wordpress-internals.md). A core release that renames, hides or reshapes one of these fails here
// by name, against the WordPress this suite runs on.
$member   = static function ( string $class, string $name ): array {
	$m = new ReflectionMethod( $class, $name );
	return array( $m->isProtected() ? 'protected' : ( $m->isPublic() ? 'public' : 'private' ), $m->getNumberOfParameters(), $m->getNumberOfRequiredParameters() );
};
$property = static function ( string $class, string $name ): string {
	$p = new ReflectionProperty( $class, $name );
	return $p->isProtected() ? 'protected' : ( $p->isPublic() ? 'public' : 'private' );
};
eq( 'core terms controller: get_term($id) is protected, one parameter', $member( WP_REST_Terms_Controller::class, 'get_term' ), array( 'protected', 1, 1 ) );
eq( 'core terms controller: $meta and $taxonomy are protected properties', array( $property( WP_REST_Terms_Controller::class, 'meta' ), $property( WP_REST_Terms_Controller::class, 'taxonomy' ) ), array( 'protected', 'protected' ) );
eq(
	'core terms controller: the overridden handlers take ($request)',
	array_map( static fn ( string $m ) => $member( WP_REST_Terms_Controller::class, $m ), array( 'get_items', 'get_item', 'create_item', 'update_item', 'delete_item', 'get_items_permissions_check', 'get_item_permissions_check', 'create_item_permissions_check', 'update_item_permissions_check', 'delete_item_permissions_check' ) ),
	array_fill( 0, 10, array( 'public', 1, 1 ) )
);
eq( 'core terms controller: prepare_item_for_response($item, $request), get_collection_params()', array( $member( WP_REST_Terms_Controller::class, 'prepare_item_for_response' ), $member( WP_REST_Terms_Controller::class, 'get_collection_params' ) ), array( array( 'public', 2, 2 ), array( 'public', 0, 0 ) ) );
eq( 'core term meta fields: constructed with ($taxonomy); get_value($object_id, $request)', array( $member( WP_REST_Term_Meta_Fields::class, '__construct' ), $member( WP_REST_Meta_Fields::class, 'get_value' ) ), array( array( 'public', 1, 1 ), array( 'public', 2, 2 ) ) );

// `columns` on a term-backed kind: only what was asked (and the key) is selected, the result as before.
$statements                          = array();
\SpacePress\Wp\Connection::$observer = static function ( string $sql ) use ( &$statements ): void {
	$statements[] = $sql;
};
$narrow                              = $db->findMany(
	'topics',
	array(
		'columns' => array(
			'name'   => true,
			'shades' => true,
		),
		'orderBy' => array( 'id' => 'asc' ),
	)
);
\SpacePress\Wp\Connection::$observer = null;
$wide                                = array_map( static fn ( array $r ): array => array_intersect_key( $r, array_flip( array( 'name', 'shades' ) ) ), $db->findMany( 'topics', array( 'orderBy' => array( 'id' => 'asc' ) ) ) );
eq( 'a term read with columns returns what reading every column gave', $narrow, $wide );
$termSql = array_values( array_filter( $statements, static fn ( string $s ): bool => str_contains( $s, 'AS `name`' ) ) )[0] ?? '';
check( 'and selects no other term field or meta join', ! str_contains( $termSql, 'AS `color`' ) && ! str_contains( $termSql, 'AS `description`' ) && ! str_contains( $termSql, "meta_key = 'sp_color'" ), $termSql );

// Older sites can share the same term ID across taxonomies. Core never caches an ambiguous ID.
$wpdb->insert(
	$wpdb->term_taxonomy,
	array(
		'term_id'     => $tag['id'],
		'taxonomy'    => 'category',
		'description' => '',
	)
);
wp_cache_delete( $tag['id'], 'terms' );
check( 'a shared term still has its taxonomy-specific URL', in_array( home_url( '/tags/elsewhere/' ), $readUrls(), true ) );
$shared = get_term( $tag['id'] );
check( 'listing URLs keeps unqualified shared term IDs ambiguous', is_wp_error( $shared ) && $shared->get_error_code() === 'ambiguous_term_id' );

// A viewer's term delete refuses while an item they can't read carries the term, and keeps its link
// (docs/decisions/2026-11-16-per-row-delete-visibility.md); core's own delete would remove it.
( static function () use ( $db, $fixture ): void {
	$term = $db->insert( 'tags', array( 'name' => 'Hidden link' ), true )[0];
	$post = $db->insert(
		'posts',
		array(
			'title'  => 'Admin only',
			'labels' => array( $term['id'] ),
			'status' => 'draft',
		),
		true
	)[0];
	$raw  = require "$fixture/schema.php";
	$raw['collections']['posts']['access']['read'] = array( 'role' => 'admin' );
	$probe  = new \SpacePress\Db( $db->store(), new \SpacePress\Schema( $raw ), $db->media() );
	$editor = new \SpacePress\Viewer(
		array(
			'id'   => 7,
			'name' => 'ed',
			'role' => 'editor',
		)
	);
	problem( 'a term on an item the viewer can\'t read refuses the delete', fn () => $probe->delete( 'tags', array( 'id' => $term['id'] ), false, $editor ), 409, 'reference_violation' );
	eq( '… and the item keeps the term', wp_get_object_terms( $post['id'], 'sp_tags', array( 'fields' => 'ids' ) ), array( $term['id'] ) );
	// An item in WordPress's trash still carries its terms, and core's term delete removes them.
	$trashedTerm = $db->insert( 'tags', array( 'name' => 'On a trashed item' ), true )[0];
	$trashed     = $db->insert(
		'posts',
		array(
			'title'  => 'Trashed',
			'labels' => array( $trashedTerm['id'] ),
			'status' => 'draft',
		),
		true
	)[0];
	\SpacePress\Wp\Plugin::instance()->connection()->core( static fn () => wp_trash_post( $trashed['id'] ) );
	problem( 'a term on a trashed item the viewer can\'t read refuses the delete', fn () => $probe->delete( 'tags', array( 'id' => $trashedTerm['id'] ), false, $editor ), 409, 'reference_violation' );
	eq( '… and the trashed item keeps it', wp_get_object_terms( $trashed['id'], 'sp_tags', array( 'fields' => 'ids' ) ), array( $trashedTerm['id'] ) );
	$free = $db->insert( 'tags', array( 'name' => 'Free' ), true )[0];
	eq( 'a term no item carries deletes', count( $probe->delete( 'tags', array( 'id' => $free['id'] ), true, $editor ) ), 1 );
} )();

// A term delete removes the term from items as the viewer's own update of each: an item they can read
// but not update keeps the term, and the delete refuses.
( static function () use ( $db, $fixture ): void {
	$term = $db->insert( 'tags', array( 'name' => 'Read-only post link' ), true )[0];
	$post = $db->insert(
		'posts',
		array(
			'title'  => 'Readable protected post',
			'labels' => array( $term['id'] ),
			'status' => 'published',
		),
		true
	)[0];
	$raw  = require "$fixture/schema.php";
	$raw['collections']['posts']['access']['read']   = array( 'role' => 'anyone' );
	$raw['collections']['posts']['access']['update'] = array( 'role' => 'admin' );
	$probe  = new \SpacePress\Db( $db->store(), new \SpacePress\Schema( $raw ), $db->media() );
	$editor = new \SpacePress\Viewer(
		array(
			'id'   => 7,
			'name' => 'ed',
			'role' => 'editor',
		)
	);
	problem( 'editor cannot directly remove protected post term', fn () => $probe->update( 'posts', array( 'labels' => array() ), array( 'id' => $post['id'] ), false, $editor ), 403, 'forbidden' );
	$result = null;
	try {
		$probe->delete( 'tags', array( 'id' => $term['id'] ), false, $editor );
		$result = array( 'status' => 200 ); } catch ( \Throwable $e ) {
		$result = \SpacePress\App::problem( $e ); }
		$links = wp_get_object_terms( $post['id'], 'sp_tags', array( 'fields' => 'ids' ) );
		eq( 'deleting term must enforce linked post update rule', array( $result['status'], $links ), array( 409, array( $term['id'] ) ) );
} )();


// The delete check reads only the posts that carry the term: unrelated password-protected posts are
// never loaded, however many or large, at 128M.
( static function () use ( $db, $fixture, $wp ): void {
	$term = $db->insert( 'tags', array( 'name' => 'Only a public post carries this' ), true )[0];
	$db->insert(
		'posts',
		array(
			'title'  => 'Public link',
			'labels' => array( $term['id'] ),
			'status' => 'published',
		),
		true
	);
	$hiddenId = \SpacePress\Wp\Plugin::instance()->connection()->core(
		static fn () => wp_insert_post(
			array(
				'post_type'     => 'sp_posts',
				'post_title'    => 'Unrelated hidden post',
				'post_status'   => 'publish',
				'post_password' => 'not-a-credential-fixture',
				'post_content'  => 'Unrelated hidden content',
			),
			true
		)
	);
	check( 'an unrelated protected post was seeded', is_int( $hiddenId ) );
	$raw = require "$fixture/schema.php";
	$raw['taxonomies']['tags']['access']['delete'] = array( 'role' => 'anyone' );
	$probe       = new \SpacePress\Db( \SpacePress\Wp\CompositeStore::create( new \SpacePress\Schema( $raw ), $db->store()->db ), new \SpacePress\Schema( $raw ), $db->media() );
	$visitor     = new \SpacePress\Viewer(
		array(
			'id'   => 7777,
			'name' => 'visitor',
			'role' => 'subscriber',
		)
	);
	{
		$payload = str_repeat( 'x', 2 * 1024 * 1024 );
		$wp->connection()->run( 'UPDATE wp_posts SET post_content = ? WHERE ID = ?', array( $payload, $hiddenId ) );
		unset( $payload );
		$cols = 'post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt, post_status, comment_status, ping_status, post_password, post_name, to_ping, pinged, post_modified, post_modified_gmt, post_content_filtered, post_parent, guid, menu_order, post_type, post_mime_type, comment_count';
	for ( $i = 0; $i < 6; $i++ ) {
		$wp->connection()->run( "INSERT INTO wp_posts ($cols) SELECT $cols FROM wp_posts WHERE post_type = ? AND post_password = ?", array( 'sp_posts', 'not-a-credential-fixture' ) );
	}
		echo "hidden-volume setup: 1 * 2^6 unrelated protected posts * 2 MiB content; lowering request memory to 128M\n";
	}
	$limit = ini_get( 'memory_limit' );
	ini_set( 'memory_limit', '128M' );
	wp_cache_flush();
	\SpacePress\Wp\CoreAccess::flush();
	eq( 'hidden post is not cached before viewer delete', wp_cache_get( $hiddenId, 'posts' ), false );
	try {
		$probe->delete( 'tags', array( 'id' => $term['id'] ), false, $visitor );
		$result = array( 'status' => 200 ); } catch ( \Throwable $e ) {
		$result = \SpacePress\App::problem( $e ); }
		ini_set( 'memory_limit', $limit );
		$cached = wp_cache_get( $hiddenId, 'posts' );
		eq( 'the viewer\'s check loads no unrelated protected post', false !== $cached, false );
		eq( '… and the delete answers as it would without them (a subscriber can\'t update the public post)', $result['status'], 409 );
} )();


// A draft hidden by status alone refuses the term delete for a subscriber.
( static function () use ( $db, $fixture ): void {
	$term = $db->insert( 'tags', array( 'name' => 'Draft-only link' ), true )[0];
	$post = $db->insert(
		'posts',
		array(
			'title'  => 'Draft-only owner',
			'labels' => array( $term['id'] ),
			'status' => 'draft',
		),
		true
	)[0];
	$raw  = require "$fixture/schema.php";
	$raw['taxonomies']['tags']['access']['delete'] = array( 'role' => 'anyone' );
	$probe   = new \SpacePress\Db( $db->store(), new \SpacePress\Schema( $raw ), $db->media() );
	$visitor = new \SpacePress\Viewer(
		array(
			'id'   => 7777,
			'name' => 'visitor',
			'role' => 'subscriber',
		)
	);
	problem( 'draft-only term owner refuses deletion for subscriber', fn () => $probe->delete( 'tags', array( 'id' => $term['id'] ), false, $visitor ), 409, 'reference_violation' );
	eq( 'refused draft-only term owner retains link', wp_get_object_terms( $post['id'], 'sp_tags', array( 'fields' => 'ids' ) ), array( $term['id'] ) );
} )();

// Password-protected posts that carry the deleted term are decided in SQL, never loaded: one or 64
// such posts of 2 MiB each answer the same refusal at 128M. An editor, who could open them, is refused
// too (the check fails closed).
( static function () use ( $db, $fixture, $wp ): void {
	$raw = require "$fixture/schema.php";
	$raw['taxonomies']['tags']['access']['delete'] = array( 'role' => 'anyone' );
	$schema                                        = new \SpacePress\Schema( $raw );
	$probe  = new \SpacePress\Db( \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() ), $schema, $db->media() );
	$viewer = new \SpacePress\Viewer(
		array(
			'id'   => 7777,
			'name' => 'visitor',
			'role' => 'subscriber',
		)
	);
	$single = $db->insert( 'tags', array( 'name' => 'single protected referring post' ), true )[0];
	$bulk   = $db->insert( 'tags', array( 'name' => 'many protected referring posts' ), true )[0];
	$one    = \SpacePress\Wp\Plugin::instance()->connection()->core(
		static fn () => wp_insert_post(
			array(
				'post_type'     => 'sp_posts',
				'post_title'    => 'Q516 protected single',
				'post_status'   => 'publish',
				'post_password' => 'q516-fixture',
			),
			true
		)
	);
	wp_set_object_terms( $one, array( $single['id'] ), 'sp_tags' );
	$seed    = \SpacePress\Wp\Plugin::instance()->connection()->core(
		static fn () => wp_insert_post(
			array(
				'post_type'     => 'sp_posts',
				'post_title'    => 'Q516 protected bulk',
				'post_status'   => 'publish',
				'post_password' => 'q516-fixture',
			),
			true
		)
	);
	$payload = str_repeat( 'x', 2 * 1024 * 1024 );
	$wp->connection()->run( 'UPDATE wp_posts SET post_content = ? WHERE ID = ?', array( $payload, $seed ) );
	unset( $payload );
	$cols = 'post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt, post_status, comment_status, ping_status, post_password, post_name, to_ping, pinged, post_modified, post_modified_gmt, post_content_filtered, post_parent, guid, menu_order, post_type, post_mime_type, comment_count';
	for ( $i = 0; $i < 6; $i++ ) {
		$wp->connection()->run( "INSERT INTO wp_posts ($cols) SELECT $cols FROM wp_posts WHERE post_title = ?", array( 'Q516 protected bulk' ) );
	}
	$tt = get_term( $bulk['id'], 'sp_tags' )->term_taxonomy_id;
	$wp->connection()->run( 'INSERT INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) SELECT ID, ?, 0 FROM wp_posts WHERE post_title = ?', array( $tt, 'Q516 protected bulk' ) );
	wp_cache_flush();
	\SpacePress\Wp\CoreAccess::flush();
	$limit = ini_get( 'memory_limit' );
	ini_set( 'memory_limit', '128M' );
	problem( 'a protected post carrying the term refuses its delete', fn () => $probe->delete( 'tags', array( 'id' => $single['id'] ), false, $viewer ), 409, 'reference_violation' );
	problem( '… and 64 large ones answer alike, loading none', fn () => $probe->delete( 'tags', array( 'id' => $bulk['id'] ), false, $viewer ), 409, 'reference_violation' );
	ini_set( 'memory_limit', $limit );
	$editor = new \SpacePress\Viewer(
		array(
			'id'   => 7,
			'name' => 'ed',
			'role' => 'editor',
		)
	);
	problem( 'an editor is refused too: password visibility here is decided in SQL and fails closed', fn () => $probe->delete( 'tags', array( 'id' => $single['id'] ), false, $editor ), 409, 'reference_violation' );
} )();

// A post-password cookie is checked against the passwords of the posts that carry the term only:
// unrelated protected posts' passwords are never read, and the cookie still opens the post it fits.
( static function () use ( $db, $fixture, $wp ): void {
	$raw = require "$fixture/schema.php";
	$raw['taxonomies']['tags']['access']['delete']   = array( 'role' => 'anyone' );
	$raw['collections']['posts']['access']['update'] = array( 'role' => 'anyone' );
	$schema = new \SpacePress\Schema( $raw );
	$probe  = new \SpacePress\Db( \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() ), $schema, $db->media() );
	$viewer = new \SpacePress\Viewer(
		array(
			'id'   => 7777,
			'name' => 'visitor',
			'role' => 'subscriber',
		)
	);
	$core   = \SpacePress\Wp\Plugin::instance()->connection();
	foreach ( array( 'unrelated-one', 'unrelated-two', 'unrelated-three' ) as $password ) {
		$core->core(
			static fn () => wp_insert_post(
				array(
					'post_type'     => 'sp_posts',
					'post_title'    => "Unrelated $password",
					'post_status'   => 'publish',
					'post_password' => $password,
				),
				true
			)
		);
	}
	$carried = static function ( string $name ) use ( $db, $core ): array {
		$term = $db->insert( 'tags', array( 'name' => $name ), true )[0];
		$post = $core->core(
			static fn () => wp_insert_post(
				array(
					'post_type'     => 'sp_posts',
					'post_title'    => "Carries $name",
					'post_status'   => 'publish',
					'post_password' => 'scoped-fixture',
				),
				true
			)
		);
		wp_set_object_terms( $post, array( $term['id'] ), 'sp_tags' );

		return array( $term, $post );
	};
	require_once ABSPATH . WPINC . '/class-phpass.php';
	$_COOKIE[ 'wp-postpass_' . COOKIEHASH ] = ( new \PasswordHash( 8, true ) )->HashPassword( 'scoped-fixture' );
	[$term, $post]                          = $carried( 'cookie-opened link' );
	$statements                             = array();
	\SpacePress\Wp\Connection::$observer    = static function ( string $sql ) use ( &$statements ): void {
		$statements[] = $sql;
	};
	try {
		$probe->delete( 'tags', array( 'id' => $term['id'] ), false, $viewer );
		$result = array( 'status' => 200 ); } catch ( \Throwable $e ) {
		$result = \SpacePress\App::problem( $e ); }
		\SpacePress\Wp\Connection::$observer = null;
		$passwordReads                       = array_values( array_filter( $statements, static fn ( string $s ): bool => str_contains( $s, 'DISTINCT HEX(post_password)' ) ) );
		check( 'the delete check read some post passwords', array() !== $passwordReads );
		check( '… only those of the posts that carry the term', array_filter( $passwordReads, static fn ( string $s ): bool => ! str_contains( $s, ' AND ID IN (' ) ) === array(), implode( "\n", $passwordReads ) );
		eq( 'a cookie that opens the carrying post lets the delete through, removing the link', array( $result['status'], wp_get_object_terms( $post, 'sp_tags', array( 'fields' => 'ids' ) ) ), array( 200, array() ) );
		$_COOKIE[ 'wp-postpass_' . COOKIEHASH ] = ( new \PasswordHash( 8, true ) )->HashPassword( 'unrelated-one' );
		[$other]                                = $carried( 'cookie for another post' );
		problem( 'a cookie for an unrelated protected post opens nothing here', fn () => $probe->delete( 'tags', array( 'id' => $other['id'] ), false, $viewer ), 409, 'reference_violation' );
		unset( $_COOKIE[ 'wp-postpass_' . COOKIEHASH ] );
} )();

finish( 'taxonomy' );
