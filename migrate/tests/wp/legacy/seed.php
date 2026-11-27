<?php
// Runs inside WordPress with the ORIGINAL Zero kernel loaded (kernel.php). Creates content only
// through the kernel's own write paths (core REST with its hooks, and an SCF form save), then prints
// every row it produced as JSON: that capture is site.json, which replay.php loads where the
// original kernel isn't available (CI).
declare(strict_types=1);

global $wpdb;
$before = (int) $wpdb->get_var( "SELECT COALESCE(MAX(ID), 0) FROM {$wpdb->posts}" );

$space = $GLOBALS['SPACEFAST_CONTENT_SPACE_ID'];
spacefast_content_model_ensure_collection_terms( spacefast_content_model_active_release() );
$term = static fn ( string $id ): int => get_term_by( 'slug', spacefast_content_model_collection_term_slug( $space, $id ), 'zero_collection' )->term_id;
$rest = static function ( string $method, string $route, array $params = array(), ?string $body = null, array $headers = array() ): array {
	$request = new WP_REST_Request( $method, $route );
	foreach ( $headers as $k => $v ) {
		$request->set_header( $k, $v );
	}
	null === $body ? $request->set_body_params( $params ) : $request->set_body( $body );
	$response = rest_do_request( $request );
	if ( $response->is_error() || $response->get_status() >= 300 ) {
		throw new RuntimeException( "$method $route: " . wp_json_encode( $response->get_data() ) );
	}
	return $response->get_data();
};
$as   = static fn ( string $login ) => wp_set_current_user( get_user_by( 'login', $login )->ID );

$as( 'admin' );
$png   = base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' );
$media = array();
foreach ( array( 'cover.png', 'still.png' ) as $name ) {
	$media[] = $rest(
		'POST',
		'/wp/v2/media',
		array(),
		$png,
		array(
			'content-disposition' => "attachment; filename=\"$name\"",
			'content-type'        => 'image/png',
		)
	)['id'];
}

$apollo = $rest(
	'POST',
	'/wp/v2/posts',
	array(
		'title'           => 'Apollo',
		'status'          => 'publish',
		'zero_collection' => array( $term( 'projects' ) ),
		'meta'            => array(
			'_zero_projects_budget'  => 12.5,
			'_zero_projects_active'  => true,
			'_zero_projects_kickoff' => '2026-03-01T10:00:00Z',
			'_zero_projects_stage'   => 'live',
			'_zero_projects_tags'    => array( 'red', 'blue' ),
			'_zero_projects_cover'   => $media[0],
			'_zero_projects_gallery' => array( $media[0], $media[1] ),
		),
	)
)['id'];
// A second edit cuts a WordPress revision of the project.
$rest(
	'POST',
	"/wp/v2/posts/$apollo",
	array(
		'title' => 'Apollo 11',
		'meta'  => array( '_zero_projects_budget' => 25 ),
	)
);

// The wp-admin path: an SCF form save writes the value plus SCF's `_<name>` field-key reference.
$gemini = $rest(
	'POST',
	'/wp/v2/posts',
	array(
		'title'           => 'Gemini',
		'status'          => 'draft',
		'zero_collection' => array( $term( 'projects' ) ),
	)
)['id'];
$rest(
	'POST',
	"/wp/v2/posts/$gemini",
	array(
		'acf' => array(
			'_zero_projects_budget' => 7,
			'_zero_projects_active' => false,
			'_zero_projects_stage'  => 'idea',
		),
	)
);
// Tags chosen, then all cleared: the original kept an empty list (a:0:{}), not an absent value.
$rest( 'POST', "/wp/v2/posts/$gemini", array( 'meta' => array( '_zero_projects_tags' => array( 'red' ) ) ) );
$rest( 'POST', "/wp/v2/posts/$gemini", array( 'meta' => array( '_zero_projects_tags' => array() ) ) );

$scheduled = $rest(
	'POST',
	'/wp/v2/posts',
	array(
		'title'           => 'Artemis',
		'status'          => 'future',
		'date_gmt'        => '2031-01-01T09:00:00',
		'zero_collection' => array( $term( 'projects' ) ),
	)
)['id'];

$as( 'editor' );
$parent = $rest(
	'POST',
	'/wp/v2/posts',
	array(
		'title'           => 'Plan launch',
		'status'          => 'publish',
		'zero_collection' => array( $term( 'tasks' ) ),
		'meta'            => array(
			'_zero_tasks_project' => $apollo,
			'_zero_tasks_notes'   => "Line one\nLine two",
		),
	)
)['id'];
$child  = $rest(
	'POST',
	'/wp/v2/posts',
	array(
		'title'           => 'Book the pad',
		'status'          => 'draft',
		'zero_collection' => array( $term( 'tasks' ) ),
		'meta'            => array(
			'_zero_tasks_project' => $apollo,
			'_zero_tasks_parent'  => $parent,
		),
	)
)['id'];
$rest( 'POST', "/wp/v2/posts/$child", array( 'title' => 'Book the launch pad' ) );

// Trash is not a record: the migration leaves it alone.
$as( 'admin' );
$trashed = $rest(
	'POST',
	'/wp/v2/posts',
	array(
		'title'           => 'Scrapped',
		'status'          => 'publish',
		'zero_collection' => array( $term( 'projects' ) ),
	)
)['id'];
$rest( 'DELETE', "/wp/v2/posts/$trashed" );

$posts   = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$wpdb->posts} WHERE ID > %d ORDER BY ID", $before ), ARRAY_A );
$ids     = array_map( 'intval', array_column( $posts, 'ID' ) );
$in      = implode( ',', $ids );
$terms   = $wpdb->get_results( "SELECT t.*, tt.term_taxonomy_id, tt.taxonomy, tt.description, tt.parent, tt.count FROM {$wpdb->terms} t JOIN {$wpdb->term_taxonomy} tt ON tt.term_id = t.term_id WHERE tt.taxonomy = 'zero_collection' ORDER BY t.term_id", ARRAY_A );
$termIds = implode( ',', array_map( 'intval', array_column( $terms, 'term_id' ) ) ?: array( 0 ) );
// The bytes of each upload, from the Space's private storage root (replay.php writes them there).
$files = array();
foreach ( $media as $mid ) {
	$files[ (string) $mid ] = base64_encode( (string) file_get_contents( get_attached_file( $mid ) ) );
}
echo wp_json_encode(
	array(
		'ids'                => compact( 'media', 'apollo', 'gemini', 'scheduled', 'parent', 'child', 'trashed' ),
		'storage'            => wp_upload_dir()['basedir'],
		'files'              => $files,
		'posts'              => $posts,
		'postmeta'           => $wpdb->get_results( "SELECT post_id, meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id IN ($in) ORDER BY meta_id", ARRAY_A ),
		'terms'              => $terms,
		'termmeta'           => $wpdb->get_results( "SELECT term_id, meta_key, meta_value FROM {$wpdb->termmeta} WHERE term_id IN ($termIds) ORDER BY meta_id", ARRAY_A ),
		'term_relationships' => $wpdb->get_results( "SELECT object_id, term_taxonomy_id, term_order FROM {$wpdb->term_relationships} WHERE object_id IN ($in) ORDER BY object_id, term_taxonomy_id", ARRAY_A ),
		// Other terms the posts carry (the default category) and the counts the original site had.
		'counts'             => $wpdb->get_results( "SELECT term_taxonomy_id, count FROM {$wpdb->term_taxonomy} WHERE taxonomy <> 'zero_collection' AND term_taxonomy_id IN (SELECT term_taxonomy_id FROM {$wpdb->term_relationships} WHERE object_id IN ($in))", ARRAY_A ),
	),
	JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
), "\n";
