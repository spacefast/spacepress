<?php

declare(strict_types=1);

/*
 * Private file buckets on WordPress (phase 2 §7.2), in-process through App::handle (tests/php/wp.php):
 * accept/maxBytes, the owner rule, signed download URLs, `file` columns, rollback. The site's php -S
 * answers the private-files probe (the router denies /wp-content/uploads/spacepress-private/, as the
 * .htaccess does under Apache), so uploads are open.
 */

use SpacePress\App;
use SpacePress\Wp\WpFiles;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = array(
	'name'        => 'talks',
	'files'       => array(
		'decks'  => array(
			'accept'   => array( 'application/pdf', 'text/*' ),
			'maxBytes' => 64,
			'access'   => array(
				'read'   => array( 'owner' => true ),
				'create' => array( 'role' => 'author' ),
				'delete' => array( 'owner' => true ),
			),
		),
		'shared' => array(
			'accept'   => array( 'text/plain' ),
			'maxBytes' => 64,
			'access'   => array(
				'read'   => array( 'role' => 'anyone' ),
				'create' => array( 'role' => 'authenticated' ),
				'delete' => array( 'role' => 'editor' ),
			),
		),
	),
	'collections' => array(
		'talks' => array(
			'primaryKey' => 'id',
			'columns'    => array(
				'id'     => array(
					'type'          => 'integer',
					'primaryKey'    => true,
					'autoIncrement' => true,
					'notNull'       => true,
				),
				'title'  => array(
					'type'    => 'text',
					'notNull' => true,
				),
				'deck'   => array(
					'type'   => 'file',
					'bucket' => 'decks',
				),
				'backup' => array(
					'type'   => 'file',
					'bucket' => 'decks',
				),
				'extra'  => array(
					'type'   => 'group',
					'fields' => array(
						'handout' => array(
							'type'   => 'file',
							'bucket' => 'decks',
						),
					),
				),
			),
			'relations'  => array(),
			'hooks'      => array(
				'beforeCreate' => 'talks__beforeCreate',
				'beforeUpdate' => 'talks__beforeUpdate',
			),
			'access'     => array(
				'read'   => array( 'role' => 'anyone' ),
				'create' => array( 'role' => 'author' ),
				'update' => array( 'role' => 'author' ),
				'delete' => array( 'role' => 'author' ),
			),
			'api'        => array(
				'list'   => true,
				'get'    => true,
				'create' => true,
				'update' => true,
				'delete' => true,
			),
			'revisions'  => false,
		),
	),
);
// A before-hook that swaps in a file id: the column check must see the final value.
$functions = <<<'PHP'
<?php
namespace SpacePressApp;
function talks__beforeCreate(\SpacePress\JsObject $data): \SpacePress\JsObject
{
    return ($data->p['title'] ?? '') === 'hooked' ? new \SpacePress\JsObject(['deck' => 999999] + $data->p) : $data;
}
/** A hook that pins the deck: deleting the file must not leave it dangling. */
function talks__beforeUpdate(\SpacePress\JsObject $patch, \SpacePress\JsObject $existing): \SpacePress\JsObject
{
    // 'pinned' keeps deck on every update; 'restore' puts deck back while backup is being nulled.
    return match (true) {
        $existing->p['title'] === 'pinned' => new \SpacePress\JsObject(['deck' => $existing->p['deck']] + $patch->p),
        $existing->p['title'] === 'restore' && array_key_exists('backup', $patch->p) => new \SpacePress\JsObject(['deck' => $existing->p['backup']] + $patch->p),
        default => $patch,
    };
}
PHP;

$wp  = wpSite(
	'files',
	array(
		'schema'    => $schema,
		'functions' => $functions,
		'users'     => array(
			'alice' => 'author',
			'bob'   => 'author',
			'ed'    => 'editor',
			'sub'   => 'subscriber',
		),
		'server'    => true,
	)
);
$app = $wp->app();
eq( 'the activation probe passed: uploads are open', ( new WpFiles( $wp->connection(), 'talks' ) )->unavailable(), null );
$private = WpFiles::root() . '/talks/decks';

/** @return array{int, mixed, array<string, string>, string|\Closure} */
function call( string $method, string $path, ?string $as = null, mixed $body = null, array $query = array(), array $files = array() ): array {
	global $wp;
	[$status, $data, $headers, $payload] = $wp->call( $method, $path, $body, $as, $query, $files );

	return array( $status, $data, $headers, $payload );
}

function isProblem( string $label, array $r, int $status, string $code, ?string $pointer = null ): void {
	check( "$label → $status $code", $r[0] === $status && ( $r[1]['code'] ?? null ) === $code && ( $r[1]['pointer'] ?? null ) === $pointer, $r[1] );
}

$upload = static function ( string $bucket, string $bytes, string $name, ?string $as ): array {
	$tmp = tempnam( sys_get_temp_dir(), 'zf' );
	file_put_contents( $tmp, $bytes );

	return call(
		'POST',
		"/files/$bucket",
		$as,
		files: array(
			'file' => array(
				'name'     => $name,
				'tmp_name' => $tmp,
				'error'    => UPLOAD_ERR_OK,
			),
		)
	);
};
/** Follow a signed url in-process (its path below the facade prefix); returns [status, headers as sent, body]. */
$download = static function ( string $url ) use ( $wp ): array {
	$parts = parse_url( $url );
	parse_str( $parts['query'] ?? '', $query );
	[$status, $headers, $payload] = $wp->handle( 'GET', (string) preg_replace( '#^.*?/wp-json/spacepress/v1#', '', $parts['path'] ), '', null, array(), $query );
	ob_start();
	\SpacePress\Response::emit( $payload );

	return array( $status, $headers, (string) ob_get_clean() );
};

// ================================================================ upload rules

isProblem( 'anonymous upload: create rule', $upload( 'decks', 'hello', 'a.txt', null ), 401, 'unauthenticated' );
isProblem( 'subscriber below the create role', $upload( 'decks', 'hello', 'a.txt', 'sub' ), 403, 'forbidden' );
isProblem( 'mime sniffed and checked against accept', $upload( 'decks', "\x89PNG\r\n\x1a\n" . str_repeat( "\0", 16 ), 'fake.pdf', 'alice' ), 422, 'invalid_input', '/file' );
isProblem( 'maxBytes', $upload( 'decks', str_repeat( 'x', 65 ), 'big.txt', 'alice' ), 413, 'payload_too_large' );
isProblem( 'unknown bucket', $upload( 'nope', 'x', 'a.txt', 'alice' ), 404, 'not_found' );
[$s, $deck] = $upload( 'decks', "Slide one\n", 'Q3 "plan"/é.txt', 'alice' );
eq(
	'201 row: sniffed mime, owner = uploader, no storage path',
	array( $s, $deck['bucket'], $deck['filename'], $deck['mime'], $deck['size'], $deck['ownerId'], array_key_exists( 'path', $deck ) ),
	array( 201, 'decks', 'é.txt', 'text/plain', 10, $wp->userId( 'alice' ), false )
);
check(
	'bytes live under uploads/spacepress-private/<app>/<bucket>, behind the deny rules, never in the media library',
	count( glob( "$private/*" ) ) === 1 && is_file( WpFiles::root() . '/.htaccess' ) && array_diff( scandir( $wp->uploads() ), array( '.', '..', 'spacepress-private' ) ) === array(),
	glob( "$private/*" )
);
$deckFile = glob( "$private/*" )[0];

// ================================================================ signed downloads

[$s, $headers, $body] = $download( $deck['url'] );
eq(
	'a signed url streams the bytes with the security headers',
	array(
		$s,
		$body,
		$headers['Content-Type'],
		$headers['X-Content-Type-Options'],
		$headers['Content-Security-Policy'],
		$headers['Cache-Control'],
		$headers['Content-Disposition'],
	),
	array( 200, "Slide one\n", 'text/plain', 'nosniff', 'sandbox', 'private, no-store', "attachment; filename=\"__.txt\"; filename*=UTF-8''%C3%A9.txt" )
);
parse_str( parse_url( $deck['url'], PHP_URL_QUERY ), $q );
check( 'url expires 300 s from now', (int) $q['exp'] - time() <= 300 && (int) $q['exp'] - time() >= 295, $q );
$path = "/files/decks/{$deck['id']}/download";
isProblem(
	'forged signature',
	call(
		'GET',
		$path,
		query: array(
			'exp' => $q['exp'],
			'sig' => str_repeat( '0', 64 ),
		)
	),
	403,
	'forbidden'
);
isProblem( 'signature of another file', call( 'GET', '/files/decks/999/download', query: $q ), 403, 'forbidden' );
isProblem(
	'an extended exp invalidates the signature',
	call(
		'GET',
		$path,
		query: array(
			'exp' => (string) ( (int) $q['exp'] + 1 ),
			'sig' => $q['sig'],
		)
	),
	403,
	'forbidden'
);
putenv( 'SP_NOW=' . ( ( (int) $q['exp'] + 1 ) * 1000 ) );
isProblem( 'expired url', call( 'GET', $path, query: $q ), 403, 'forbidden' );
putenv( 'SP_NOW=' . ( ( (int) $q['exp'] - 600 ) * 1000 ) );
isProblem( 'exp more than 300 s ahead is refused even when signed', call( 'GET', $path, query: $q ), 403, 'forbidden' );
putenv( 'SP_NOW' );

// ================================================================ owner rule

isProblem( 'owner rule: another author cannot read', call( 'GET', "/files/decks/{$deck['id']}", 'bob' ), 403, 'forbidden' );
isProblem( 'owner rule: anonymous', call( 'GET', "/files/decks/{$deck['id']}" ), 401, 'unauthenticated' );
[$s, $again] = call( 'GET', "/files/decks/{$deck['id']}", 'alice' );
check( 'the owner gets the row with a fresh signed url', 200 === $s && "Slide one\n" === $download( $again['url'] )[2], $again );
isProblem( 'wrong bucket in the path', call( 'GET', "/files/shared/{$deck['id']}", 'alice' ), 404, 'not_found' );
isProblem( 'owner rule on delete', call( 'DELETE', "/files/decks/{$deck['id']}", 'ed' ), 403, 'forbidden' );

// ================================================================ file(bucket) columns

$shared = $upload( 'shared', 'everyone', 'pub.txt', 'bob' )[1];
isProblem(
	'file column: unknown id',
	call(
		'POST',
		'/talks',
		'alice',
		array(
			'title' => 'x',
			'deck'  => 999999,
		)
	),
	422,
	'invalid_input',
	'/deck'
);
isProblem(
	'file column: id from another bucket',
	call(
		'POST',
		'/talks',
		'alice',
		array(
			'title' => 'x',
			'deck'  => $shared['id'],
		)
	),
	422,
	'invalid_input',
	'/deck'
);
$talk = call(
	'POST',
	'/talks',
	'alice',
	array(
		'title' => 'Q3',
		'deck'  => $deck['id'],
	)
)[1];
eq( 'without with: the id', call( 'GET', "/talks/{$talk['id']}", 'bob' )[1]['deck'], $deck['id'] );
$own = call( 'GET', "/talks/{$talk['id']}", 'alice', query: array( 'with' => 'deck' ) )[1]['deck'];
check( 'with: { deck: true } populates for a reader the bucket admits, with a working url', is_array( $own ) && $own['id'] === $deck['id'] && 200 === $download( $own['url'] )[0], $own );
// A page's read (`db.query.talks.findFirst({ columns, with })`): `with` asked for the column, so a
// `columns` selection that leaves it out, or excludes it, still returns the file.
$viewer = new \SpacePress\Viewer( $wp->user( 'alice' ) );
eq(
	'with: { deck: true } loads the file through a `columns` selection that leaves the column out, or excludes it',
	array_map(
		static function ( array $columns ) use ( $talk, $viewer ): array {
			$row = \SpacePress\db()->findFirst(
				'talks',
				array(
					'where'   => array( 'id' => $talk['id'] ),
					'columns' => $columns,
					'with'    => array( 'deck' => true ),
				),
				$viewer
			);

			return array( array_key_exists( 'title', $row ), $row['deck']['filename'] ?? null );
		},
		array(
			array( 'id' => true ),
			array(
				'deck'  => false,
				'title' => false,
			),
		)
	),
	array( array( false, $own['filename'] ), array( false, $own['filename'] ) )
);
eq( 'with: { deck: true } keeps the id for a reader the owner rule refuses', array( call( 'GET', "/talks/{$talk['id']}", 'bob', query: array( 'with' => 'deck' ) )[1]['deck'], call( 'GET', '/talks', query: array( 'with' => 'deck' ) )[1][0]['deck'] ), array( $deck['id'], $deck['id'] ) );

isProblem( 'a before-hook cannot slip in an unchecked file id', call( 'POST', '/talks', 'alice', array( 'title' => 'hooked' ) ), 422, 'invalid_input', '/deck' );
eq( '… and the rejected create left no row', in_array( 'hooked', array_column( call( 'GET', '/talks' )[1], 'title' ), true ), false );

// Rollback: an upload inside a failing transaction leaves no row and no bytes; a failed delete keeps both.
$before = glob( "$private/*" );
$tmp    = tempnam( sys_get_temp_dir(), 'zf' );
file_put_contents( $tmp, 'rolled back' );
try {
	\SpacePress\db()->transaction(
		static function () use ( $tmp ): void {
			\SpacePress\Media\Files::upload( 'decks', $tmp, 'r.txt', null );
			throw new \RuntimeException( 'roll back' );
		}
	);
} catch ( \RuntimeException ) {
}
eq( 'a rolled-back upload leaves no bytes behind', glob( "$private/*" ), $before );
try {
	\SpacePress\db()->transaction(
		static function () use ( $deck ): void {
			\SpacePress\Media\Files::delete( 'decks', $deck['id'], null );
			throw new \RuntimeException( 'roll back' );
		}
	);
} catch ( \RuntimeException ) {
}
eq(
	'a rolled-back delete keeps the row, the reference and the bytes',
	array( call( 'GET', "/files/decks/{$deck['id']}", 'alice' )[0], call( 'GET', "/talks/{$talk['id']}" )[1]['deck'], glob( "$private/*" ) ),
	array( 200, $deck['id'], $before )
);

// Nested file fields: checked on write; a delete is refused while one still holds the id.
isProblem(
	'a nested file field is checked too',
	call(
		'POST',
		'/talks',
		'alice',
		array(
			'title' => 'n',
			'extra' => array( 'handout' => 999999 ),
		)
	),
	422,
	'invalid_input',
	'/extra/handout'
);
[, $handout] = $upload( 'decks', 'handout', 'h.txt', 'alice' );
$nested      = call(
	'POST',
	'/talks',
	'alice',
	array(
		'title' => 'n',
		'extra' => array( 'handout' => $handout['id'] ),
	)
)[1];
isProblem( 'deleting a file a nested field holds is refused', call( 'DELETE', "/files/decks/{$handout['id']}", 'alice' ), 409, 'reference_violation' );
call( 'PATCH', "/talks/{$nested['id']}", 'alice', array( 'extra' => array( 'handout' => null ) ) );
eq( 'cleared, it deletes', call( 'DELETE', "/files/decks/{$handout['id']}", 'alice' )[0], 200 );

// A before-update hook that pins the reference cannot leave a dangling id: the delete rolls back.
[, $pinnedDeck] = $upload( 'decks', 'pinned', 'p.txt', 'alice' );
$pinned         = call(
	'POST',
	'/talks',
	'alice',
	array(
		'title' => 'pinned',
		'deck'  => $pinnedDeck['id'],
	)
)[1];
isProblem( 'a hook that keeps the reference blocks the delete', call( 'DELETE', "/files/decks/{$pinnedDeck['id']}", 'alice' ), 409, 'reference_violation', '/deck' );
eq( '… and the file and reference are intact', array( call( 'GET', "/files/decks/{$pinnedDeck['id']}", 'alice' )[0], call( 'GET', "/talks/{$pinned['id']}" )[1]['deck'] ), array( 200, $pinnedDeck['id'] ) );
call( 'DELETE', "/talks/{$pinned['id']}", 'alice' );

// Two columns hold the file; nulling the second puts it back in the first: still refused.
[, $twice] = $upload( 'decks', 'twice', 'tw.txt', 'alice' );
$restore   = call(
	'POST',
	'/talks',
	'alice',
	array(
		'title'  => 'restore',
		'deck'   => $twice['id'],
		'backup' => $twice['id'],
	)
)[1];
isProblem( 'a hook on a later column cannot restore an already nulled one', call( 'DELETE', "/files/decks/{$twice['id']}", 'alice' ), 409, 'reference_violation', '/deck' );
eq( '… and nothing changed', array( call( 'GET', "/files/decks/{$twice['id']}", 'alice' )[0], call( 'GET', "/talks/{$restore['id']}" )[1]['deck'] ), array( 200, $twice['id'] ) );
call( 'DELETE', "/talks/{$restore['id']}", 'alice' );

[$s, $gone] = call( 'DELETE', "/files/decks/{$deck['id']}", 'alice' );
eq( 'owner deletes; referencing columns are nulled', array( $s, $gone['id'], call( 'GET', "/talks/{$talk['id']}" )[1]['deck'] ), array( 200, $deck['id'], null ) );
check( 'bytes removed after commit', ! is_file( $deckFile ) );
[, $fresh] = $upload( 'decks', 'temp', 't.txt', 'alice' );
call( 'DELETE', "/files/decks/{$fresh['id']}", 'alice' );
[$s] = $download( $fresh['url'] );
eq( 'a still-valid signed url for a deleted file → 404', $s, 404 );

eq(
	'GET /_schema lists buckets without rules',
	call( 'GET', '/_schema' )[1]['files'],
	array(
		'decks'  => array(
			'accept'   => array( 'application/pdf', 'text/*' ),
			'maxBytes' => 64,
		),
		'shared' => array(
			'accept'   => array( 'text/plain' ),
			'maxBytes' => 64,
		),
	)
);

// ================================================================ host directory
// A host whose web server ignores `.htaccess` names a directory outside its web root with
// `sp_private_dir`: uploads open without a passing probe and the bytes land there, not under uploads.
$hostDir = sys_get_temp_dir() . '/sp-host-private-' . bin2hex( random_bytes( 4 ) );
$hostDirFilter = static fn () => $hostDir;
update_option( WpFiles::OK, '0', true );
eq( 'a failed probe closes uploads', is_string( ( new WpFiles( $wp->connection(), 'talks' ) )->unavailable() ), true );
add_filter( 'sp_private_dir', $hostDirFilter );
eq( 'the host directory opens uploads without a probe', ( new WpFiles( $wp->connection(), 'talks' ) )->unavailable(), null );
eq( 'the host directory is the private root', WpFiles::root(), $hostDir );
[$s, $hosted] = $upload( 'decks', 'host bytes', 'h.txt', 'alice' );
eq( 'upload into the host directory', $s, 201 );
check( 'bytes stored under the host directory', count( glob( "$hostDir/talks/decks/*" ) ) === 1 );
check( 'no .htaccess written into the host directory', ! file_exists( "$hostDir/.htaccess" ) );
[$s, , $body] = $download( $hosted['url'] );
eq( 'the signed url streams it from the host directory', array( $s, $body ), array( 200, 'host bytes' ) );
eq( 'GET /_schema reports the host directory as protected', call( 'GET', '/_schema' )[1]['runtime']['privateFiles'] ?? null, array( 'protected' => true, 'checkedAt' => null ) );
call( 'DELETE', "/files/decks/{$hosted['id']}", 'alice' );
check( 'delete removes the bytes from the host directory', glob( "$hostDir/talks/decks/*" ) === array() );
remove_filter( 'sp_private_dir', $hostDirFilter );
update_option( WpFiles::OK, '1', true );

finish( 'files_test' );
