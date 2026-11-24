<?php

declare(strict_types=1);

/* Real Gutenberg routes and storage, rather than a replacement relay or permission mock. */
use SpacePress\Wp\AgentScope;
use SpacePress\Wp\Coediting;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$base              = ( require dirname( __DIR__ ) . '/fixtures/blog/schema.php' )['collections']['posts'];
$base['columns']   = array_intersect_key( $base['columns'], array_flip( array( 'id', 'title', 'slug', 'body', 'excerpt', 'status', 'publishedAt' ) ) );
$base['relations'] = array();
$base['hooks']     = array();
$base['access']    = array(
	'read'   => array( 'role' => 'editor' ),
	'create' => array( 'role' => 'editor' ),
	'update' => array( 'role' => 'editor' ),
	'delete' => array( 'role' => 'editor' ),
);
$schema            = array(
	'name'        => 'coediting',
	'collections' => array(),
);
foreach ( array( 'documents', 'noread', 'noupdate', 'fieldread', 'fieldupdate', 'nested', 'callable', 'references', 'nativeposts' ) as $key ) {
	$kind        = $base;
	$kind['key'] = $key;
	$kind['wp']  = array(
		'postType'       => "sp_$key",
		'groupKey'       => "group_sp_$key",
		'metaPrefix'     => 'sp_',
		'fieldKeyPrefix' => "field_sp_{$key}_",
	);
	if ( 'nativeposts' === $key ) {
		$kind['native']         = true;
		$kind['wp']['postType'] = 'post';
		$kind['excerpt']        = 'excerpt';
	} elseif ( 'noread' === $key ) {
		$kind['access']['read'] = array( 'role' => 'admin' );
	} elseif ( 'noupdate' === $key ) {
		$kind['access']['update'] = array( 'role' => 'admin' );
	} elseif ( 'fieldread' === $key || 'fieldupdate' === $key ) {
		$op                                   = 'fieldread' === $key ? 'read' : 'update';
		$kind['columns']['excerpt']['access'] = array( $op => array( 'role' => 'admin' ) );
	} elseif ( 'nested' === $key ) {
		$kind['columns']['details'] = array(
			'type'   => 'group',
			'fields' => array(
				'secret' => array(
					'type'   => 'text',
					'access' => array( 'read' => array( 'role' => 'admin' ) ),
				),
			),
		);
	} elseif ( 'callable' === $key ) {
		$kind['access']['update'] = array( 'fn' => 'document_update' );
	} elseif ( 'references' === $key ) {
		$kind['columns']['related'] = array(
			'type'       => 'integer',
			'references' => array(
				'collection' => 'documents',
				'column'     => 'id',
				'onDelete'   => 'set null',
			),
		);
	}
	$schema['collections'][ $key ] = $kind;
}
$site = wpSite(
	'coediting',
	array(
		'schema'    => $schema,
		'functions' => 'function document_update($ctx) { return true; }',
		'users'     => array( 'limited' => 'editor' ),
		'plugins'   => array(
			'gutenberg' => array(
				'version' => '24.4.1',
				'sha256'  => 'bdd790a279bc35c750dd70253658868df105ff29e04fb6db5aeb82fd4d3e0b02',
			),
		),
		'muPlugins' => array(
			'coediting-experiment' => <<<'PHP'
<?php
add_filter('pre_option_gutenberg-experiments', static fn () => ['gutenberg-real-time-collaboration' => true]);
PHP,
		),
	)
);
$ids  = array();
foreach ( $schema['collections'] as $key => $kind ) {
	$ids[ $key ] = (int) wp_insert_post(
		array(
			'post_type'    => $kind['wp']['postType'],
			'post_status'  => 'draft',
			'post_author'  => $site->userId( 'editor' ),
			'post_title'   => 'Original title',
			'post_content' => '<!-- wp:paragraph --><p>Original body</p><!-- /wp:paragraph -->',
		)
	);
}
$pid  = $ids['documents'];
$room = "postType/sp_documents:$pid";

/** A browser-shaped poll payload; each item names its room, as Gutenberg's polling manager does. */
function pollRoom( string $room, int $client = 101, ?string $data = null ): array {
	return array(
		'room'      => $room,
		'client_id' => $client,
		'after'     => 0,
		'awareness' => null,
		'updates'   => null === $data ? array() : array(
			array(
				'type' => 'update',
				'data' => $data,
			),
		),
	);
}

/** Run the real WordPress REST dispatcher as an authenticated editor. */
function native( string $method, string $route, array $body = array(), string $as = 'editor', bool $withSchema = true ): WP_REST_Response {
	global $site, $schema;
	$site->actAs( $as );
	$request = new WP_REST_Request( $method, $route );
	foreach ( $body as $name => $value ) {
		$request->set_param( $name, $value );
	}
	if ( $withSchema ) {
		$schemas = array();
		foreach ( $schema['collections'] as $key => $kind ) {
			$schemas[ $kind['wp']['postType'] ] = Coediting::fingerprint( $key );
		}
		$request->set_header( Coediting::HEADER, json_encode( $schemas ) );
	}
	try {
		return rest_do_request( $request );
	} finally {
		wp_set_current_user( 0 );
	}
}

function refused( string $label, WP_REST_Response $response, ?array $rooms = null ): void {
	$data = $response->get_data();
	eq( $label, array( $response->get_status(), $data['code'] ?? null ), array( 403, 'sp_coediting_unavailable' ) );
	if ( null !== $rooms ) {
		eq( "$label names only denied rooms", $data['data']['rooms'] ?? null, $rooms );
	}
}

$site->actAs( 'editor' );
check( 'the actual pinned Gutenberg plugin is active', defined( 'GUTENBERG_VERSION' ) && GUTENBERG_VERSION === '24.4.1' );
check( 'upstream collaboration experiment is enabled', wp_is_collaboration_enabled() );
check( 'the unrestricted collection is eligible', Coediting::eligible( 'documents' ) );
check( 'eligible collection is enabled for the upstream editor', ! wp_is_post_type_collaboration_disabled( 'sp_documents' ) );
check( 'field-restricted collection is disabled for the upstream editor', wp_is_post_type_collaboration_disabled( 'sp_fieldread' ) );
check( 'a create-only editor uses ordinary editing', wp_is_post_type_collaboration_disabled( 'sp_noupdate' ) );
$postType                 = get_post_type_object( 'sp_documents' );
$namespace                = $postType->rest_namespace;
$postType->rest_namespace = 'custom/v1';
check( 'a custom REST namespace cannot opt into collaboration', ! Coediting::eligible( 'documents' ) );
check( 'a custom REST namespace cannot authorize opaque meta', ! Coediting::authorizeMeta( true, Coediting::DOCUMENT, $pid ) );
$postType->rest_namespace = $namespace;
wp_set_current_user( 0 );

// Core's Add New editor already owns a post ID before its first save.
$create_only = (int) wp_insert_post(
	array(
		'post_type'   => 'sp_noupdate',
		'post_status' => 'auto-draft',
		'post_author' => $site->userId( 'editor' ),
		'post_title'  => '',
	)
);
eq(
	'a create-only editor can still make an ordinary first save',
	native(
		'POST',
		"/wp/v2/sp_noupdate/$create_only",
		array(
			'title'  => 'Created without collaboration',
			'status' => 'draft',
		)
	)->get_status(),
	200
);
$auto      = (int) wp_insert_post(
	array(
		'post_type'   => 'sp_documents',
		'post_status' => 'auto-draft',
		'post_author' => $site->userId( 'editor' ),
		'post_title'  => '',
	)
);
$auto_room = "postType/sp_documents:$auto";
refused(
	'another user cannot join an authors auto-draft',
	native(
		'POST',
		'/wp-sync/v1/updates',
		array( 'rooms' => array( pollRoom( $auto_room ) ) ),
		'admin'
	),
	array( $auto_room )
);
eq(
	'the author can start their own auto-draft room',
	native(
		'POST',
		'/wp-sync/v1/updates',
		array( 'rooms' => array( pollRoom( $auto_room ) ) )
	)->get_status(),
	200
);
$first_save = native(
	'POST',
	"/wp/v2/sp_documents/$auto",
	array(
		'title'   => 'First collaborative save',
		'status'  => 'draft',
		'content' => '<p>First body</p>',
		'meta'    => array(
			Coediting::DOCUMENT => 'first document',
			'excerpt'           => 'First field',
		),
	)
);
eq(
	'the authors first save accepts content fields and CRDT state together',
	array(
		$first_save->get_status(),
		$first_save->get_data()['title']['raw'] ?? null,
		$first_save->get_data()['meta']['excerpt'] ?? null,
		get_post( $auto )->post_status,
	),
	array( 200, 'First collaborative save', 'First field', 'draft' )
);
$site->actAs( 'editor' );
eq( 'the first save persists the authorized CRDT document', get_post_meta( $auto, Coediting::DOCUMENT, true ), 'first document' );
wp_set_current_user( 0 );

// Core post roles keep separate publishing authority, even among trusted HTML editors.
get_userdata( $site->userId( 'limited' ) )->add_cap( 'publish_posts', false );
$site->actAs( 'limited' );
check( 'limited editor retains trusted HTML and core post editing', current_user_can( 'unfiltered_html' ) && current_user_can( 'edit_post', $ids['nativeposts'] ) );
check( 'limited editor cannot publish core posts', ! current_user_can( 'publish_posts' ) );
check( 'native posts cannot share opaque collaboration state', ! Coediting::eligible( 'nativeposts' ) );
wp_set_current_user( 0 );
$native_room = "postType/post:{$ids['nativeposts']}";
refused( 'limited core editor cannot submit opaque updates to an administrator peer', native( 'POST', '/wp-sync/v1/updates', array( 'rooms' => array( pollRoom( $native_room ) ) ), 'limited' ), array( $native_room ) );
refused( 'administrator cannot join the native post room either', native( 'POST', '/wp-sync/v1/updates', array( 'rooms' => array( pollRoom( $native_room, 202 ) ) ), 'admin' ), array( $native_room ) );
refused( 'native post snapshots are refused through ordinary REST', native( 'POST', "/wp/v2/posts/{$ids['nativeposts']}", array( 'meta' => array( Coediting::DOCUMENT => 'opaque publish request' ) ), 'limited' ) );

// Relay two distinct WordPress users through upstream storage. The payload is opaque to PHP.
$payload = base64_encode( 'opaque Yjs bytes' );
$posted  = native( 'POST', '/wp-sync/v1/updates', array( 'rooms' => array( pollRoom( $room, 101, $payload ) ) ) );
eq( 'eligible editor sends updates using upstream list shape', $posted->get_status(), 200 );
$received = native( 'POST', '/wp-sync/v1/updates', array( 'rooms' => array( pollRoom( $room, 202 ) ) ), 'admin' );
eq(
	'another user receives the exact upstream update',
	$received->get_data()['rooms'][0]['updates'] ?? null,
	array(
		array(
			'data' => $payload,
			'type' => 'update',
		),
	)
);
eq( 'sending editor does not receive their own update', $posted->get_data()['rooms'][0]['updates'] ?? null, array() );

// Turning off the upstream experiment also closes routes already registered this request.
remove_all_filters( 'pre_option_gutenberg-experiments' );
update_option( 'gutenberg-experiments', array() );
refused( 'disabling the upstream experiment closes existing rooms', native( 'POST', '/wp-sync/v1/updates', array( 'rooms' => array( pollRoom( $room ) ) ) ), array( $room ) );
refused(
	'disabling the upstream experiment closes snapshot saves',
	native(
		'POST',
		'/wp-sync/v1/save',
		array(
			'room' => $room,
			'doc'  => 'disabled',
		)
	),
	array( $room )
);
add_filter( 'pre_option_gutenberg-experiments', static fn () => array( 'gutenberg-real-time-collaboration' => true ) );

// Both room entry points apply the same policy. Refusal must happen before any batch mutation.
foreach ( array( 'noread', 'noupdate', 'fieldread', 'fieldupdate', 'nested', 'callable', 'references' ) as $key ) {
	$denied_room = "postType/sp_$key:{$ids[$key]}";
	refused( "$key poll refused", native( 'POST', '/wp-sync/v1/updates', array( 'rooms' => array( pollRoom( $denied_room ) ) ) ), array( $denied_room ) );
	refused(
		"$key snapshot refused",
		native(
			'POST',
			'/wp-sync/v1/save',
			array(
				'room' => $denied_room,
				'doc'  => 'forbidden',
			)
		),
		array( $denied_room )
	);
	refused( "$key ordinary REST snapshot refused", native( 'POST', "/wp/v2/sp_$key/{$ids[$key]}", array( 'meta' => array( Coediting::DOCUMENT => 'forbidden' ) ) ) );
}
refused( 'the experiment requires the current schema header', native( 'POST', '/wp-sync/v1/updates', array( 'rooms' => array( pollRoom( $room ) ) ), withSchema: false ), array( $room ) );
refused( 'uppercase updates route has the same boundary', native( 'POST', '/WP-SYNC/V1/UPDATES', array( 'rooms' => array( pollRoom( $denied_room = "postType/sp_fieldread:{$ids['fieldread']}" ) ) ) ), array( $denied_room ) );
refused(
	'uppercase save route has the same boundary',
	native(
		'POST',
		'/WP-SYNC/V1/SAVE',
		array(
			'room' => $denied_room,
			'doc'  => 'forbidden',
		)
	),
	array( $denied_room )
);
refused( 'uppercase native route has the same boundary', native( 'POST', "/WP/V2/SP_FIELDREAD/{$ids['fieldread']}", array( 'meta' => array( Coediting::DOCUMENT => 'forbidden' ) ) ) );
refused(
	'autosave snapshots also require schema identity',
	native(
		'POST',
		"/wp/v2/sp_documents/$pid/autosaves",
		array(
			'title'         => 'Snapshot attempt',
			'crdt_snapshot' => 'snapshot',
		),
		withSchema: false
	)
);
refused( 'an author without trusted HTML authority cannot join', native( 'POST', '/wp-sync/v1/updates', array( 'rooms' => array( pollRoom( $room ) ) ), 'author' ), array( $room ) );
$storage_before = $site->sql( "SELECT p.ID, m.meta_key, m.meta_value FROM {prefix}posts p LEFT JOIN {prefix}postmeta m ON m.post_id = p.ID WHERE p.post_type = 'wp_sync_storage' ORDER BY p.ID, m.meta_id" );
$denied_room    = "postType/sp_fieldread:{$ids['fieldread']}";
refused( 'a mixed batch refuses the full request', native( 'POST', '/wp-sync/v1/updates', array( 'rooms' => array( pollRoom( $room, 101, base64_encode( 'must not persist' ) ), pollRoom( $denied_room ) ) ) ), array( $denied_room ) );
eq( 'a mixed batch creates neither updates nor awareness state', $site->sql( "SELECT p.ID, m.meta_key, m.meta_value FROM {prefix}posts p LEFT JOIN {prefix}postmeta m ON m.post_id = p.ID WHERE p.post_type = 'wp_sync_storage' ORDER BY p.ID, m.meta_id" ), $storage_before );

// Alternate room spellings cannot escape the managed collection boundary.
$revision = wp_insert_post(
	array(
		'post_type'   => 'revision',
		'post_parent' => $pid,
		'post_status' => 'inherit',
		'post_title'  => 'Revision',
	)
);
foreach ( array( 'postType/sp_documents', "postType/post:$pid", "postType/revision:$revision", "postType/sp_documents:0$pid" ) as $alias ) {
	refused( "alias $alias refused", native( 'POST', '/wp-sync/v1/updates', array( 'rooms' => array( pollRoom( $alias ) ) ) ), array( $alias ) );
}

$saved = native(
	'POST',
	'/wp-sync/v1/save',
	array(
		'room' => $room,
		'doc'  => 'first snapshot',
	)
);
eq( 'eligible snapshot is saved by the real upstream endpoint', $saved->get_status(), 200 );
$site->actAs( 'editor' );
eq( 'eligible editor can read the persisted opaque snapshot', get_post_meta( $pid, Coediting::DOCUMENT, true ), 'first snapshot' );
wp_set_current_user( 0 );
$ordinary = native(
	'POST',
	"/wp/v2/sp_documents/$pid",
	array(
		'meta'  => array(
			Coediting::DOCUMENT => 'native snapshot',
			'excerpt'           => 'Typed field',
		),
		'title' => 'Native save',
	)
);
eq( 'ordinary native REST saves typed fields and the upstream snapshot together', array( $ordinary->get_status(), $ordinary->get_data()['title']['raw'] ?? null, $ordinary->get_data()['meta']['excerpt'] ?? null ), array( 200, 'Native save', 'Typed field' ) );
$reader = native( 'GET', "/wp/v2/sp_documents/$pid", array( 'context' => 'edit' ) );
eq( 'REST edit context exposes only the current authorized snapshot', $reader->get_data()['meta'][ Coediting::DOCUMENT ] ?? null, 'native snapshot' );
refused( 'a direct snapshot REST write also requires schema identity', native( 'POST', "/wp/v2/sp_documents/$pid", array( 'meta' => array( Coediting::DOCUMENT => 'stale tab' ) ), withSchema: false ) );
$site->actAs( 'author' );
eq( 'a less privileged reader cannot inspect opaque post metadata', get_post_meta( $pid, Coediting::DOCUMENT, true ), '' );
wp_set_current_user( 0 );

// A classic editor remains a different editing session and its lock still protects saves.
require_once ABSPATH . 'wp-admin/includes/post.php';
$site->actAs( 'admin' );
wp_set_post_lock( $pid );
wp_set_current_user( 0 );
$locked = native( 'POST', "/wp/v2/sp_documents/$pid", array( 'title' => 'Must not overwrite classic editor' ) );
eq( 'classic edit lock still refuses a coeditor save', array( $locked->get_status(), $locked->get_data()['code'] ?? null ), array( 409, 'sp_locked' ) );
eq( 'the locked title is unchanged', get_post( $pid )->post_title, 'Native save' );
// Expire, rather than delete, this test-owned lock.
update_post_meta( $pid, '_edit_lock', ( time() - 600 ) . ':' . $site->userId( 'admin' ) );

// HTTP gives scoped credentials and an actual fresh schema boot, not mutated process globals.
$site->startServer();
function httpNative( string $method, string $route, array $body, string $credential, array $headers = array() ): array {
	global $site;
	$ch = curl_init( $site->url() . '/wp-json' . $route );
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_CUSTOMREQUEST  => $method,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 60,
			CURLOPT_HTTPHEADER     => array( 'Content-Type: application/json', 'Authorization: Basic ' . base64_encode( $credential ), ...$headers ),
			CURLOPT_POSTFIELDS     => json_encode( $body ),
		)
	);
	$out    = curl_exec( $ch );
	$status = (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE );

	return array( $status, is_string( $out ) ? json_decode( $out, true ) : null );
}
$site->actAs( 'admin' );
[$password, $item] = WP_Application_Passwords::create_new_application_password( $site->userId( 'admin' ), array( 'name' => 'test coediting scope' ) );
AgentScope::store(
	$site->userId( 'admin' ),
	$item['uuid'],
	array(
		'write'     => true,
		'personal'  => false,
		'abilities' => null,
	)
);
$headers = array( Coediting::HEADER . ': ' . json_encode( array( 'sp_documents' => Coediting::fingerprint( 'documents' ) ) ) );
wp_set_current_user( 0 );
$scoped          = 'admin:' . $password;
[$status, $data] = httpNative( 'POST', '/wp-sync/v1/updates', array( 'rooms' => array( pollRoom( $room ) ) ), $scoped, $headers );
eq( 'scoped credential cannot enter an opaque room', array( $status, $data['code'] ?? null ), array( 403, 'sp_coediting_unavailable' ) );
[$status, $data] = httpNative( 'GET', "/wp/v2/sp_documents/$pid?context=edit", array(), $scoped );
eq( 'scoped native reader still reads ordinary content', $status, 200 );
check( 'scoped native reader receives no opaque document', ! isset( $data['meta'][ Coediting::DOCUMENT ] ) || '' === $data['meta'][ Coediting::DOCUMENT ] );
[$status, $data] = httpNative( 'POST', "/wp/v2/sp_documents/$pid", array( 'meta' => array( Coediting::DOCUMENT => 'scoped attempt' ) ), $scoped, $headers );
eq( 'scoped ordinary REST snapshot writes are refused', array( $status, $data['code'] ?? null ), array( 403, 'sp_coediting_unavailable' ) );

$schema['collections']['documents']['columns']['newField'] = array( 'type' => 'text' );
$site->writeSchema( $schema );
[$status, $data] = httpNative( 'GET', "/wp/v2/sp_documents/$pid?context=edit", array(), $site->appPassword( 'editor' ) );
eq( 'new schema retains ordinary content', array( $status, $data['title']['raw'] ?? null ), array( 200, 'Native save' ) );
check( 'new schema never exposes the previous opaque snapshot', ! isset( $data['meta'][ Coediting::DOCUMENT ] ) || '' === $data['meta'][ Coediting::DOCUMENT ] );
[$status, $data] = httpNative( 'POST', '/wp-sync/v1/updates', array( 'rooms' => array( pollRoom( $room ) ) ), $site->appPassword( 'editor' ), $headers );
eq( 'an old tab cannot join the new schema room', array( $status, $data['code'] ?? null ), array( 403, 'sp_coediting_unavailable' ) );
eq( 'schema change preserves the stored snapshot history', $site->scalar( 'SELECT meta_value FROM {prefix}postmeta WHERE post_id = ? AND meta_key = ?', array( $pid, Coediting::DOCUMENT ) ), 'native snapshot' );

// Read the public fingerprint from another real WordPress boot after the schema update.
$probe             = 'require ' . var_export( __DIR__ . '/wp.php', true ) . '; wpLoad(' . var_export( $site->dir, true ) . '); echo \\SpacePress\\Wp\\Coediting::fingerprint("documents");';
$fresh_fingerprint = trim( (string) shell_exec( escapeshellarg( PHP_BINARY ) . ' -d memory_limit=512M -r ' . escapeshellarg( $probe ) ) );
check( 'fresh schema fingerprint is available', preg_match( '/^[a-f0-9]{64}$/D', $fresh_fingerprint ) === 1 );
$fresh_headers   = array( Coediting::HEADER . ': ' . json_encode( array( 'sp_documents' => $fresh_fingerprint ) ) );
[$status, $data] = httpNative( 'POST', '/wp-sync/v1/updates', array( 'rooms' => array( pollRoom( $room, 303 ) ) ), $site->appPassword( 'editor' ), $fresh_headers );
eq( 'new schema starts an empty relay namespace', array( $status, $data['rooms'][0]['updates'] ?? null ), array( 200, array() ) );
eq( 'previous schema relay history is retained', $site->sql( "SELECT p.ID, m.meta_key, m.meta_value FROM {prefix}posts p JOIN {prefix}postmeta m ON m.post_id = p.ID WHERE p.post_type = 'wp_sync_storage' AND m.meta_key = 'wp_sync_update_data' ORDER BY p.ID, m.meta_id" ), array_values( array_filter( $storage_before, static fn ( $row ) => 'wp_sync_update_data' === $row['meta_key'] ) ) );
[$status, $autosave] = httpNative(
	'POST',
	"/wp/v2/sp_documents/$pid/autosaves",
	array(
		'title'         => 'Autosaved new schema',
		'content'       => '<!-- wp:paragraph --><p>Changed body</p><!-- /wp:paragraph -->',
		'crdt_snapshot' => 'new schema autosave',
	),
	$site->appPassword( 'editor' ),
	$fresh_headers
);
check(
	'upstream creates a revision autosave under the new schema',
	$status >= 200 && $status < 300 && ( $autosave['id'] ?? $pid ) !== $pid,
	array(
		'status' => $status,
		'data'   => $autosave,
	)
);
$probe = 'require ' . var_export( __DIR__ . '/wp.php', true ) . '; wpLoad(' . var_export( $site->dir, true ) . '); wp_set_current_user(' . $site->userId( 'editor' ) . '); echo get_post_meta(' . (int) ( $autosave['id'] ?? 0 ) . ', \\SpacePress\\Wp\\Coediting::SNAPSHOT, true);';
eq( 'current autosave snapshot is readable on its own revision', trim( (string) shell_exec( escapeshellarg( PHP_BINARY ) . ' -d memory_limit=512M -r ' . escapeshellarg( $probe ) ) ), 'new schema autosave' );
[$status, $data] = httpNative( 'GET', "/wp/v2/sp_documents/$pid?context=edit", array(), $site->appPassword( 'editor' ) );
check( 'a new autosave cannot make the stale parent document readable', ! isset( $data['meta'][ Coediting::DOCUMENT ] ) || '' === $data['meta'][ Coediting::DOCUMENT ] );

$site->destroy();
finish( 'coediting' );
