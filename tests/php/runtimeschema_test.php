<?php

declare(strict_types=1);

/*
 * Runtime schema changes (docs/spec/spec.md §2.10) on an in-process WordPress: a field added to a
 * collection of a running site, stored as a numbered version, with no build.
 *
 * The site runs the compiled schema of tests/runtime-schema/base. Changes are applied in this
 * process; what they do is read back the way a client sees it, over HTTP from the harness's
 * `php -S`, because a version takes effect from the next request.
 */

use SpacePress\RuntimeSchema\Loader;
use SpacePress\RuntimeSchema\Refused;
use SpacePress\Wp\SchemaVersions;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$base = require dirname( __DIR__ ) . '/runtime-schema/base.schema.php';
// The build's articles have hooks that return a replacement object, as compiled code may.
$base['collections']['articles']['hooks'] = array(
	'beforeCreate' => 'articles__hook__beforeCreate',
	'beforeUpdate' => 'articles__hook__beforeUpdate',
);
$wp                                       = wpSite(
	'rtschema',
	array(
		'schema'    => $base,
		'server'    => true,
		'identity'  => true,
		'muPlugins' => array(
			'rtschema-propose' => <<<'PHP'
<?php
// Test only: proposes the posted change set in a fresh request, which sees the build as deployed now.
add_action('init', static function (): void {
    if (parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH) !== '/__rtschema_propose') {
        return;
    }
    try {
        $out = [200, \SpacePress\Wp\SchemaVersions::of(\SpacePress\Wp\Runtime::plugin())->propose(json_decode((string) file_get_contents('php://input'), true))];
    } catch (\SpacePress\HttpError $e) {
        $out = [$e->status, ['code' => $e->errorCode, 'pointer' => $e->pointer]];
    }
    status_header($out[0]);
    header('Content-Type: application/json');
    echo json_encode($out[1]);
    exit;
}, 99);
PHP,
		),
		'functions' => <<<'PHP'
function articles__hook__beforeCreate(\SpacePress\JsObject $data, \SpacePress\JsObject $ctx): \SpacePress\JsObject
{
    return new \SpacePress\JsObject(['title' => \SpacePress\Js::prop($data, 'title') . '!'] + array_diff_key($data->p, ['title' => 1]));
}

function articles__hook__beforeUpdate(\SpacePress\JsObject $patch, \SpacePress\JsObject $existing, \SpacePress\JsObject $ctx): \SpacePress\JsObject
{
    // A replacement built from the fields of the build it was compiled with: a runtime field in
    // the patch is not in it.
    return new \SpacePress\JsObject(array_intersect_key($patch->p, \SpacePress\RuntimeSchema\Loader::compiled()['collections']['articles']['columns']));
}
PHP,
	)
);
$api                                      = $wp->url() . '/wp-json/spacepress/v1';

/** @return array{int, mixed} status and decoded body, as $as (a test user name) or anonymous */
function http( string $method, string $url, mixed $body = null, ?string $as = null ): array {
	global $wp;
	$ch = curl_init( $url );
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_CUSTOMREQUEST  => $method,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 60,
			CURLOPT_HTTPHEADER     => array( 'Content-Type: application/json', ...( null === $as ? array() : array( 'Authorization: Basic ' . base64_encode( $wp->appPassword( $as ) ) ) ) ),
		)
	);
	if ( null !== $body ) {
		curl_setopt( $ch, CURLOPT_POSTFIELDS, json_encode( $body ) );
	}
	$res = curl_exec( $ch );

	return array( (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE ), is_string( $res ) ? json_decode( $res, true ) : null );
}
$described = static fn (): array => http( 'GET', $GLOBALS['api'] )[1]['data'];
$refusal   = static function ( callable $fn ): string {
	try {
		$fn();

		return 'accepted';
	} catch ( Refused $e ) {
		return "$e->status {$e->verdict()} $e->pointer";
	}
};
$add       = static fn ( string $field, array $definition, string $kind = 'articles' ): array => array(
	'format'  => 1,
	'changes' => array(
		array(
			'op'         => 'addField',
			'kind'       => $kind,
			'field'      => $field,
			'definition' => $definition,
		),
	),
);
$admin     = array(
	'user'  => $wp->userId( 'admin' ),
	'login' => 'admin',
	'via'   => 'test',
);

$versions = SchemaVersions::of( $wp->plugin() ) ?? throw new RuntimeException( 'the app set runtimeSchema: true' );

// ================================================================ before any change
eq(
	'a site starts at version 0',
	array( $versions->active(), $versions->list() ),
	array(
		array(
			'version' => 0,
			'hash'    => '',
		),
		array(),
	)
);
$d = $described();
eq(
	'the API says which schema version it describes',
	$d['runtimeSchema'],
	array(
		'version' => 0,
		'hash'    => '',
		'build'   => array(
			'version' => 0,
			'hash'    => '',
		),
	)
);
check( 'the kind has the build\'s fields only', ! isset( $d['kinds']['articles']['columns']['subtitle'] ) && isset( $d['kinds']['articles']['columns']['rating'] ), $d['kinds']['articles'] );
[$status, $old] = http( 'POST', "$api/articles", array( 'title' => 'Written before the change' ), 'editor' );
eq( 'an item is created on the build\'s schema', $status, 201 );
[$status, $problem] = http(
	'POST',
	"$api/articles",
	array(
		'title'    => 'Too early',
		'subtitle' => 'x',
	),
	'editor'
);
eq( 'a field the schema doesn\'t have is refused', array( $status, $problem['code'] ?? null, $problem['pointer'] ?? null ), array( 422, 'invalid_input', '/subtitle' ) );

// ================================================================ propose writes nothing
$subtitle = $add(
	'subtitle',
	array(
		'rules' => array( 'max' => 20 ),
		'type'  => 'text',
		'ui'    => array( 'label' => 'Subtitle' ),
	)
);
$proposal = $versions->propose( $subtitle );
eq(
	'a proposal names its parent and returns the change in stored form',
	array( $proposal['parent'], $proposal['changes'] ),
	array(
		0,
		array(
			array(
				'op'         => 'addField',
				'kind'       => 'articles',
				'field'      => 'subtitle',
				'definition' => array(
					'type'  => 'text',
					'rules' => array( 'max' => 20 ),
					'ui'    => array( 'label' => 'Subtitle' ),
				),
			),
		),
	)
);
eq(
	'and what it does to stored data',
	$proposal['effects'][0],
	array(
		'op'            => 'addField',
		'kind'          => 'articles',
		'field'         => 'subtitle',
		'storage'       => 'post meta sp_subtitle on sp_articles',
		'existingItems' => 1,
		'note'          => 'existing items have no value until they are edited',
	)
);
eq( 'a proposal stores nothing', array( $versions->list(), get_option( Loader::option( 'rtschema' ), 'absent' ) ), array( array(), 'absent' ) );
check( 'nor does it change the schema requests see', ! isset( $described()['kinds']['articles']['columns']['subtitle'] ) );

// ================================================================ refusals
eq( 'a field the build declares can\'t be redefined', $refusal( fn () => $versions->propose( $add( 'rating', array( 'type' => 'text' ) ) ) ), '422 F3001 /changes/0/field' );
eq(
	'a rule the compiler has is refused with its code',
	$refusal(
		fn () => $versions->propose(
			$add(
				'subtitle',
				array(
					'type'  => 'text',
					'rules' => array(
						'min' => 9,
						'max' => 2,
					),
				)
			)
		)
	),
	'422 F3001 /changes/0/definition'
);
eq( 'a table() kind is build-only', $refusal( fn () => $versions->propose( $add( 'note', array( 'type' => 'text' ), 'votes' ) ) ), '422 F3001 /changes/0/definition' );
eq(
	'removing a field the build declares is build-only',
	$refusal(
		fn () => $versions->propose(
			array(
				'format'  => 1,
				'changes' => array(
					array(
						'op'    => 'removeField',
						'kind'  => 'articles',
						'field' => 'rating',
					),
				),
			)
		)
	),
	'422 schema_build_only /changes/0/field'
);
eq(
	'renaming a field is build-only',
	$refusal(
		fn () => $versions->propose(
			array(
				'format'  => 1,
				'changes' => array(
					array(
						'op'    => 'renameField',
						'kind'  => 'articles',
						'field' => 'rating',
						'to'    => 'stars',
					),
				),
			)
		)
	),
	'422 schema_build_only /changes/0/op'
);
eq(
	'a required field needs a default',
	$refusal(
		fn () => $versions->propose(
			$add(
				'subtitle',
				array(
					'type'    => 'text',
					'notNull' => true,
				)
			)
		)
	),
	'422 schema_required /changes/0/definition/notNull'
);
eq( 'refusals store nothing', $versions->list(), array() );

// ================================================================ apply: version 1
$v1 = $versions->apply( 0, $subtitle, $admin );
eq( 'the first change is version 1 on parent 0', array( $v1['version'], $v1['parent'], $v1['format'], $v1['actor'] ), array( 1, 0, 1, $admin ) );
eq( 'it records the build it was validated on', $v1['build'], hash_file( 'sha256', "$wp->content/plugins/spacepress-app-rtschema/sp/app/schema.php" ) );
check( 'and when', preg_match( '/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z\z/', $v1['createdAt'] ) === 1, $v1['createdAt'] );
eq( 'the stored version reads back as it was applied', $versions->list(), array( $v1 ) );
eq( 'its hash covers the row and the parent\'s hash', $v1['hash'], SchemaVersions::hashOf( '', $v1 ) );

$d = $described();
eq(
	'the next request describes version 1',
	$d['runtimeSchema'],
	array(
		'version' => 1,
		'hash'    => $v1['hash'],
		'build'   => array(
			'version' => 0,
			'hash'    => '',
		),
	)
);
eq(
	'with the new field as stored',
	$d['kinds']['articles']['columns']['subtitle'],
	array(
		'type'  => 'text',
		'rules' => array( 'max' => 20 ),
		'ui'    => array( 'label' => 'Subtitle' ),
	)
);
[$status, $new] = http(
	'POST',
	"$api/articles",
	array(
		'title'    => 'Written after',
		'subtitle' => 'Now it fits',
	),
	'editor'
);
eq( 'a write takes the new field, and the build\'s hook still runs', array( $status, $new['data']['subtitle'] ?? null, $new['data']['title'] ?? null ), array( 201, 'Now it fits', 'Written after!' ) );
[$status, $problem] = http(
	'POST',
	"$api/articles",
	array(
		'title'    => 'Too long',
		'subtitle' => str_repeat( 's', 21 ),
	),
	'editor'
);
eq( 'and its rule is enforced', array( $status, $problem['code'] ?? null, $problem['pointer'] ?? null ), array( 422, 'invalid_input', '/subtitle' ) );
$before = http( 'GET', "$api/articles/{$old['data']['id']}" )[1]['data'];
eq( 'an item written before the change reads the field as empty', array( array_key_exists( 'subtitle', $before ), $before['subtitle'] ?? null ), array( true, null ) );
[$status, $patched] = http( 'PATCH', "$api/articles/{$old['data']['id']}", array( 'subtitle' => 'Added later' ), 'editor' );
eq( 'and takes a value through a hook that returns a replacement built from the build\'s fields', array( $status, $patched['data']['subtitle'] ?? null ), array( 200, 'Added later' ) );
eq( 'the value is post meta under the field\'s name', $wp->scalar( "SELECT meta_value FROM {prefix}postmeta WHERE post_id = ? AND meta_key = 'sp_subtitle'", array( $new['data']['id'] ) ), 'Now it fits' );
[$status, $core] = http( 'GET', $wp->url() . "/wp-json/wp/v2/sp_articles/{$new['data']['id']}?context=edit", null, 'editor' );
eq( 'core REST serves it as registered meta', array( $status, $core['meta']['subtitle'] ?? null ), array( 200, 'Now it fits' ) );
[$status, $core] = http( 'POST', $wp->url() . "/wp-json/wp/v2/sp_articles/{$new['data']['id']}", array( 'meta' => array( 'subtitle' => str_repeat( 's', 21 ) ) ), 'editor' );
eq( 'and core REST enforces the rule too', $status, 422 );
[$status, $types] = http( 'GET', $wp->url() . '/wp-json/wp/v2/sp_articles/' . $new['data']['id'] . '?context=edit&_fields=acf', null, 'editor' );
check( 'the editor\'s field group has the field', array_key_exists( 'sp_subtitle', $types['acf'] ?? array() ), $types );

// ================================================================ two changes on one parent
eq( 'a second change on the same parent is a 409', $refusal( fn () => $versions->apply( 0, $add( 'stars', array( 'type' => 'integer' ) ), $admin ) ), '409 schema_conflict /parent' );
eq( 'and stores nothing', count( $versions->list() ), 1 );
eq( 'a name an earlier version added is taken', $refusal( fn () => $versions->apply( 1, $add( 'subtitle', array( 'type' => 'text' ) ), $admin ) ), '422 F3001 /changes/0/field' );
$v2 = $versions->apply(
	1,
	$add(
		'stars',
		array(
			'type'    => 'integer',
			'notNull' => true,
			'default' => array( 'value' => 3 ),
			'rules'   => array(
				'min' => 1,
				'max' => 5,
			),
		)
	),
	$admin
);
eq( 'proposed again on the new parent it is version 2, chained to version 1', array( $v2['version'], $v2['parent'], $v2['hash'] ), array( 2, 1, SchemaVersions::hashOf( $v1['hash'], $v2 ) ) );
[$status, $defaulted] = http( 'POST', "$api/articles", array( 'title' => 'Defaulted' ), 'editor' );
eq( 'a default applies to new items', array( $status, $defaulted['data']['stars'] ?? null ), array( 201, 3 ) );

// Two processes apply on the same parent at the same moment: one becomes the next version, the other gets the 409.
$script = "$wp->dir/apply.php";
file_put_contents(
	$script,
	'<?php
require ' . var_export( __DIR__ . '/wp.php', true ) . ';
$dir = ' . var_export( $wp->dir, true ) . ';
$site = json_decode((string) file_get_contents("$dir/site.json"), true, 512, JSON_THROW_ON_ERROR);
wpDefine($dir, $site["url"]);
$_SERVER["REQUEST_METHOD"] = "GET";
require_once ABSPATH . "wp-settings.php";
$versions = \SpacePress\Wp\SchemaVersions::of(\SpacePress\Wp\Runtime::plugin());
fwrite(STDOUT, "ready\n");
// Both processes are loaded and waiting here until the test lets go of the gate.
flock(fopen("$dir/gate", "c"), LOCK_SH);
try {
    $row = $versions->apply(2, ["format" => 1, "changes" => [["op" => "addField", "kind" => "articles", "field" => $argv[1], "definition" => ["type" => "text"]]]], ["user" => 1, "login" => "admin", "via" => "test"]);
    echo json_encode(["version" => $row["version"], "field" => $argv[1]]), "\n";
} catch (\SpacePress\RuntimeSchema\Refused $e) {
    echo json_encode(["status" => $e->status, "code" => $e->errorCode]), "\n";
}
'
);
$gate = fopen( "$wp->dir/gate", 'c' );
flock( $gate, LOCK_EX );
$children = array();
foreach ( array( 'left', 'right' ) as $field ) {
	$process            = proc_open(
		array( PHP_BINARY, '-d', 'memory_limit=512M', $script, $field ),
		array(
			1 => array( 'pipe', 'w' ),
			2 => array( 'file', "$wp->dir/apply-$field.log", 'a' ),
		),
		$pipes
	);
	$children[ $field ] = array( $process, $pipes[1] );
}
foreach ( $children as [, $out] ) {
	fgets( $out ) === "ready\n" || throw new RuntimeException( 'a concurrent writer did not start' );
}
flock( $gate, LOCK_UN );
$outcomes = array();
foreach ( $children as $field => [$process, $out] ) {
	$outcomes[] = json_decode( (string) stream_get_contents( $out ), true );
	proc_close( $process );
}
usort( $outcomes, static fn ( array $a, array $b ): int => isset( $b['version'] ) <=> isset( $a['version'] ) );
check(
	'of two concurrent changes on one parent, one is version 3 and the other is refused with a 409',
	( $outcomes[0]['version'] ?? null ) === 3 && $outcomes[1] === array(
		'status' => 409,
		'code'   => 'schema_conflict',
	),
	$outcomes
);
$rows = $versions->list();
eq( 'exactly one of them was stored', array( count( $rows ), $rows[2]['changes'][0]['field'] ), array( 3, $outcomes[0]['field'] ) );
$winner = $outcomes[0]['field'];

// ================================================================ apply and deploy share one lock
// A deploy holds the schema lock while it migrates. An apply that starts meanwhile waits for it, and
// then checks the change against the build that is live, not the one its own request loaded. On a
// managed build store each build has its own directory, so the deploy changes which build the site
// runs (the recorded build hash), never the file this request loaded: that is what the deploy here does.
$hold = "$wp->dir/hold.php";
file_put_contents(
	$hold,
	'<?php
require ' . var_export( __DIR__ . '/wp.php', true ) . ';
$dir = ' . var_export( $wp->dir, true ) . ';
$site = json_decode((string) file_get_contents("$dir/site.json"), true, 512, JSON_THROW_ON_ERROR);
wpDefine($dir, $site["url"]);
$_SERVER["REQUEST_METHOD"] = "GET";
require_once ABSPATH . "wp-settings.php";
$plugin = \SpacePress\Wp\Runtime::plugin();
$option = "sp_" . $plugin->schema->name() . "_schema";
// The lock a deploy takes (Plugin::migrateLocked).
\SpacePress\Wp\Migrator::locked($plugin->connection(), $option, static function () use ($option): void {
    fwrite(STDOUT, "held\n");
    usleep(1500000);
    // Just before it lets go, the deploy records the build it migrated to (Plugin::migrateNow).
    update_option($option, hash("sha256", "another build"), false);
});
'
);
$recorded = get_option( 'sp_rtschema_schema' );
$deployer = proc_open(
	array( PHP_BINARY, '-d', 'memory_limit=512M', $hold ),
	array(
		1 => array( 'pipe', 'w' ),
		2 => array( 'file', "$wp->dir/hold.log", 'a' ),
	),
	$pipes
);
eq( 'the deploy holds the lock', fgets( $pipes[1] ), "held\n" );
// Without the shared lock this apply would land before the deploy records its build, and be accepted.
$lockRefusal = $refusal( fn () => $versions->apply( count( $versions->list() ), $add( 'lockProbe', array( 'type' => 'text' ) ), $admin ) );
proc_close( $deployer );
eq( 'an apply during a deploy waits for it, and is checked against the build the deploy made live', $lockRefusal, '409 schema_build_changed /changes' );
update_option( 'sp_rtschema_schema', $recorded, false );

// ================================================================ the option is a copy of the versions
delete_option( Loader::option( 'rtschema' ) );
check( 'without its option the site serves the build\'s schema', ! isset( $described()['kinds']['articles']['columns']['subtitle'] ) );
$v4      = $versions->apply(
	3,
	$add(
		'teaser',
		array(
			'type'      => 'text',
			'multiline' => true,
		)
	),
	$admin
);
$columns = $described()['kinds']['articles']['columns'];
check( 'the next change rebuilds it from the stored versions', 4 === $v4['version'] && isset( $columns['subtitle'], $columns['stars'], $columns[ $winner ], $columns['teaser'] ), array_keys( $columns ) );
eq( 'and the stored value is still there', http( 'GET', "$api/articles/{$new['data']['id']}" )[1]['data']['subtitle'], 'Now it fits' );

// ================================================================ a build deployed over runtime changes
// A build that declares the field itself (as it would after `spacepress pull`, here with a tighter rule): its declaration is used.
$declares = $base;
$declares['collections']['articles']['columns']['subtitle'] = array(
	'type'  => 'text',
	'rules' => array( 'max' => 5 ),
);
$wp->writeSchema( $declares );
$d = $described();
eq(
	'a build that declares a runtime field uses its own declaration',
	$d['kinds']['articles']['columns']['subtitle'],
	array(
		'type'  => 'text',
		'rules' => array( 'max' => 5 ),
	)
);
eq( 'and still gets the fields it doesn\'t declare', isset( $d['kinds']['articles']['columns']['stars'], $d['kinds']['articles']['columns']['teaser'] ), true );
[$status] = http( 'PATCH', "$api/articles/{$new['data']['id']}", array( 'subtitle' => 'Longer than five' ), 'editor' );
eq( 'the build\'s rule is the one enforced', $status, 422 );
eq( 'the value stored under the runtime field is the build\'s field\'s value', http( 'GET', "$api/articles/{$new['data']['id']}" )[1]['data']['subtitle'], 'Now it fits' );

// A build that declares a relation under a runtime field's name: the relation is used, the field's data stays.
$related = $base;
$related['collections']['articles']['relations']['stars'] = array(
	'kind'       => 'many',
	'collection' => 'votes',
	'from'       => 'id',
	'to'         => 'article',
	'optional'   => false,
);
$wp->writeSchema( $related );
$columns = $described()['kinds']['articles']['columns'];
check( 'a build\'s relation wins over a runtime field of the same name', ! isset( $columns['stars'] ) && isset( $columns['teaser'] ), array_keys( $columns ) );
eq( 'and the field\'s stored values are untouched', $wp->scalar( "SELECT meta_value FROM {prefix}postmeta WHERE post_id = ? AND meta_key = 'sp_stars'", array( $defaulted['data']['id'] ) ), '3' );

// A build that ran on the site declared `mood` as an integer. Another build is served now, without
// it; a runtime change can't give `mood` another type, whichever build the request runs.
$moody = $base;
$moody['collections']['articles']['columns']['mood'] = array( 'type' => 'integer' );
$wp->writeSchema( $moody );
eq( 'the build that declares mood initializes on the site', http( 'GET', "$api/articles?limit=1" )[0], 200 );
$wp->writeSchema( $base );
http( 'GET', "$api/articles?limit=1" );
[$status, $retype] = http( 'POST', $wp->url() . '/__rtschema_propose', $add( 'mood', array( 'type' => 'text' ) ) );
eq( 'a runtime field can\'t take a name an earlier build stored as another type', array( $status, $retype['code'] ?? null, $retype['pointer'] ?? null ), array( 422, 'schema_retype', '/changes/0/definition/type' ) );
[$status] = http( 'POST', $wp->url() . '/__rtschema_propose', $add( 'mood', array( 'type' => 'integer' ) ) );
eq( 'it can take it with the same type', $status, 200 );

// A build without the runtime changes (the project was not pulled): nothing is dropped.
$wp->writeSchema( $base );
$d = $described();
eq(
	'a build without the runtime fields keeps them',
	array( $d['runtimeSchema']['version'], $d['kinds']['articles']['columns']['subtitle'] ),
	array(
		4,
		array(
			'type'  => 'text',
			'rules' => array( 'max' => 20 ),
			'ui'    => array( 'label' => 'Subtitle' ),
		),
	)
);
eq( 'and their data', http( 'GET', "$api/articles/{$new['data']['id']}" )[1]['data']['subtitle'], 'Now it fits' );

// A build that drops the collection: the versions stay, and its fields have nowhere to go.
$without = $base;
unset( $without['collections']['articles'] );
$wp->writeSchema( $without );
eq( 'a build without the kind serves without it', array( isset( $described()['kinds']['articles'] ), count( $versions->list() ) ), array( false, 4 ) );

// ================================================================ the flag off
$off = $base;
unset( $off['runtimeSchema'] );
$wp->writeSchema( $off );
$d = $described();
check( 'with the flag off the schema is the build\'s alone', ! isset( $d['runtimeSchema'] ) && ! isset( $d['kinds']['articles']['columns']['subtitle'] ) && isset( $d['kinds']['articles']['columns']['rating'] ), $d['kinds']['articles']['columns'] );
[$status] = http(
	'POST',
	"$api/articles",
	array(
		'title'    => 'Flag off',
		'subtitle' => 'x',
	),
	'editor'
);
eq( 'and a runtime field is unknown again', $status, 422 );
eq( 'its stored values and versions are untouched', array( $wp->scalar( "SELECT meta_value FROM {prefix}postmeta WHERE post_id = ? AND meta_key = 'sp_subtitle'", array( $new['data']['id'] ) ), count( $versions->list() ) ), array( 'Now it fits', 4 ) );
$wp->writeSchema( $base );
eq( 'turning the flag back on brings the fields and values back', http( 'GET', "$api/articles/{$new['data']['id']}" )[1]['data']['subtitle'], 'Now it fits' );

// ================================================================ new kinds, labels, removal and rollback
$set          = static fn ( array ...$changes ): array => array(
	'format'  => 1,
	'changes' => $changes,
);
$count        = static fn (): int => count( $GLOBALS['versions']->list() );
$next         = $count();
$kindsVersion = $versions->apply(
	$next,
	$set(
		array(
			'op'         => 'addCollection',
			'kind'       => 'events',
			'definition' => array(
				'label'  => 'Events',
				'access' => array( 'create' => 'author' ),
				'fields' => array(
					'title'   => array(
						'type'    => 'text',
						'notNull' => true,
						'rules'   => array( 'max' => 60 ),
					),
					'content' => array( 'type' => 'richText' ),
					'starts'  => array( 'type' => 'date' ),
				),
			),
		),
		array(
			'op'         => 'addGlobal',
			'global'     => 'banner',
			'definition' => array(
				'access' => array( 'update' => 'admin' ),
				'fields' => array(
					'text' => array( 'type' => 'text' ),
					'on'   => array(
						'type'    => 'boolean',
						'notNull' => true,
						'default' => array( 'value' => false ),
					),
				),
			),
		),
	),
	$admin
);
$d            = $described();
eq(
	'a collection added at runtime is a kind with its route',
	array( $d['kinds']['events']['route'] ?? null, $d['kinds']['events']['label'] ?? null, array_keys( $d['kinds']['events']['columns'] ?? array() ) ),
	array( '/wp/v2/sp_events', 'Events', array( 'id', 'title', 'content', 'starts', 'status', 'publishedAt', 'author', 'createdAt', 'updatedAt', 'deletedAt', 'deletedBy' ) )
);
eq( 'and a global added at runtime is a global', array_keys( $d['globals']['banner']['fields'] ?? array() ), array( 'text', 'on' ) );
$tables           = static fn (): array => array_merge( ...array_map( 'array_values', $GLOBALS['wp']->sql( 'SHOW TABLES' ) ) );
check( 'no SQL table was created for either', array_filter( $tables(), static fn ( string $t ): bool => str_contains( $t, 'sp_events' ) || str_contains( $t, 'banner' ) ) === array(), $tables() );
[$status, $event] = http(
	'POST',
	"$api/events",
	array(
		'title'   => 'Launch',
		'content' => '<p>Doors at seven.</p>',
		'starts'  => '2027-03-01',
	),
	'author'
);
eq( 'its access rule lets an author create', array( $status, $event['data']['title'] ?? null, $event['data']['starts'] ?? null ), array( 201, 'Launch', '2027-03-01' ) );
eq( 'and refuses a subscriber', http( 'POST', "$api/events", array( 'title' => 'No' ), 'subscriber' )[0], 403 );
eq( 'its field rules are enforced', http( 'POST', "$api/events", array( 'title' => str_repeat( 't', 61 ) ), 'author' )[0], 422 );
eq(
	'an item is a post of the kind\'s type, title and body in core\'s columns',
	$wp->sql( 'SELECT post_type, post_title, post_content FROM {prefix}posts WHERE ID = ?', array( $event['data']['id'] ) ),
	array(
		array(
			'post_type'    => 'sp_events',
			'post_title'   => 'Launch',
			'post_content' => '<p>Doors at seven.</p>',
		),
	)
);
eq( 'anyone reads it', http( 'GET', "$api/events/{$event['data']['id']}" )[1]['data']['title'] ?? null, 'Launch' );
eq(
	'the global reads its defaults',
	http( 'GET', "$api/banner" )[1]['data'] ?? null,
	array(
		'text' => null,
		'on'   => false,
	)
);
eq( 'an editor may not update it', http( 'PATCH', "$api/banner", array( 'on' => true ), 'editor' )[0], 403 );
eq(
	'an admin may',
	http(
		'PATCH',
		"$api/banner",
		array(
			'text' => 'Sale',
			'on'   => true,
		),
		'admin'
	)[1]['data'] ?? null,
	array(
		'text' => 'Sale',
		'on'   => true,
	)
);

// Names that are taken.
eq(
	'a collection named like the build\'s is refused',
	$refusal(
		fn () => $versions->propose(
			$set(
				array(
					'op'         => 'addCollection',
					'kind'       => 'articles',
					'definition' => array(
						'fields' => array(
							'title' => array(
								'type'    => 'text',
								'notNull' => true,
							),
						),
					),
				)
			)
		)
	),
	'422 F3001 /changes/0/kind'
);
eq(
	'and one named like a kind every site has',
	$refusal(
		fn () => $versions->propose(
			$set(
				array(
					'op'         => 'addCollection',
					'kind'       => 'posts',
					'definition' => array(
						'fields' => array(
							'title' => array(
								'type'    => 'text',
								'notNull' => true,
							),
						),
					),
				)
			)
		)
	),
	'422 schema_reserved /changes/0/kind'
);

// Fields, a label and presentation on the new kinds; then all of it rolled back as a new version.
$grown = $versions->apply(
	$count(),
	$set(
		array(
			'op'         => 'addField',
			'kind'       => 'events',
			'field'      => 'venue',
			'definition' => array( 'type' => 'text' ),
		),
		array(
			'op'    => 'setLabel',
			'kind'  => 'events',
			'label' => 'What\'s on',
		),
		array(
			'op'    => 'setFieldUi',
			'kind'  => 'articles',
			'field' => 'rating',
			'ui'    => array(
				'label' => 'Stars',
				'width' => 50,
			),
		),
		array(
			'op'    => 'setLabel',
			'kind'  => 'articles',
			'label' => 'Stories',
		),
	),
	$admin
);
$d     = $described();
eq(
	'a label and presentation replace the build\'s; the field\'s type does not move',
	array( $d['kinds']['events']['label'], $d['kinds']['articles']['label'], $d['kinds']['articles']['columns']['rating'] ),
	array(
		'What\'s on',
		'Stories',
		array(
			'type' => 'integer',
			'ui'   => array(
				'label' => 'Stars',
				'width' => 50,
			),
		),
	)
);
eq( 'the new field takes a value', http( 'PATCH', "$api/events/{$event['data']['id']}", array( 'venue' => 'Town hall' ), 'editor' )[1]['data']['venue'] ?? null, 'Town hall' );

$reversal = $versions->reversal( $grown['version'] );
eq( 'the reversal of a version is its changes undone, newest first', array_column( $reversal['changes'], 'op' ), array( 'setLabel', 'setFieldUi', 'setLabel', 'removeField' ) );
$rolledBack = $versions->apply( $count(), $reversal, $admin );
eq( 'a rollback is a new version; the one it reverses is still stored', array( $rolledBack['version'], $rolledBack['parent'], $versions->list()[ $grown['version'] - 1 ]['hash'] ), array( $grown['version'] + 1, $grown['version'], $grown['hash'] ) );
$d = $described();
eq(
	'after it the schema is the one before that version',
	array( $d['kinds']['events']['label'], $d['kinds']['articles']['label'], $d['kinds']['articles']['columns']['rating'], isset( $d['kinds']['events']['columns']['venue'] ) ),
	array( 'Events', 'Articles', array( 'type' => 'integer' ), false )
);
eq( 'the hidden field\'s value is still stored', $wp->scalar( "SELECT meta_value FROM {prefix}postmeta WHERE post_id = ? AND meta_key = 'sp_venue'", array( $event['data']['id'] ) ), 'Town hall' );
eq(
	'it can\'t come back as another type',
	$refusal(
		fn () => $versions->propose(
			$set(
				array(
					'op'         => 'addField',
					'kind'       => 'events',
					'field'      => 'venue',
					'definition' => array( 'type' => 'integer' ),
				)
			)
		)
	),
	'422 schema_retype /changes/0/definition/type'
);
$versions->apply(
	$count(),
	$set(
		array(
			'op'         => 'addField',
			'kind'       => 'events',
			'field'      => 'venue',
			'definition' => array( 'type' => 'text' ),
		)
	),
	$admin
);
eq( 'added again as the same type, its value is there', http( 'GET', "$api/events/{$event['data']['id']}" )[1]['data']['venue'] ?? null, 'Town hall' );

// Removing a kind hides it; nothing is dropped.
$removed = $versions->propose(
	$set(
		array(
			'op'   => 'removeCollection',
			'kind' => 'events',
		),
		array(
			'op'     => 'removeGlobal',
			'global' => 'banner',
		)
	)
);
eq( 'a proposal to remove a collection says how many items it hides', array( $removed['effects'][0]['existingItems'], $removed['effects'][0]['note'] ), array( 1, 'hidden from the schema; its items stay in post type sp_events and come back if the collection is added again' ) );
$removal = $versions->apply(
	$count(),
	$set(
		array(
			'op'   => 'removeCollection',
			'kind' => 'events',
		),
		array(
			'op'     => 'removeGlobal',
			'global' => 'banner',
		)
	),
	$admin
);
$d       = $described();
eq( 'a removed kind is gone from the schema and the API', array( isset( $d['kinds']['events'] ), isset( $d['globals']['banner'] ), http( 'GET', "$api/events" )[0] ), array( false, false, 404 ) );
eq( 'its items and values are kept', array( $wp->scalar( "SELECT COUNT(*) FROM {prefix}posts WHERE post_type = 'sp_events' AND post_status = 'publish'" ), $wp->scalar( "SELECT option_value FROM {prefix}options WHERE option_name = 'sp_global_banner_text'" ) ), array( 1, 'Sale' ) );
eq(
	'removing a kind the build declares is build-only',
	$refusal(
		fn () => $versions->propose(
			$set(
				array(
					'op'   => 'removeCollection',
					'kind' => 'articles',
				)
			)
		)
	),
	'422 schema_build_only /changes/0/kind'
);
$versions->apply( $count(), $versions->reversal( $removal['version'] ), $admin );
$back = http( 'GET', "$api/events/{$event['data']['id']}" )[1]['data'] ?? array();
eq( 'rolling the removal back brings the kind and its item back, later field included', array( $back['title'] ?? null, $back['starts'] ?? null, $back['venue'] ?? null ), array( 'Launch', '2027-03-01', 'Town hall' ) );
eq(
	'and the global with its values',
	http( 'GET', "$api/banner" )[1]['data'] ?? null,
	array(
		'text' => 'Sale',
		'on'   => true,
	)
);
problem( 'a version that doesn\'t exist has no reversal', fn () => $versions->reversal( 999 ), 404, 'not_found' );

// A build that declares a kind the site added (after `spacepress pull`): the build's is used.
$declared                          = $base;
$declared['collections']['events'] = array( 'label' => 'From the build' ) + \SpacePress\RuntimeSchema\Kinds::expandCollection(
	'events',
	array(
		'fields' => array(
			'title'   => array(
				'type'    => 'text',
				'notNull' => true,
			),
			'content' => array( 'type' => 'richText' ),
			'starts'  => array( 'type' => 'date' ),
		),
	)
);
$wp->writeSchema( $declared );
$d = $described();
eq( 'a build that declares a runtime kind uses its own declaration and keeps the runtime field on it', array( $d['kinds']['events']['label'], isset( $d['kinds']['events']['columns']['venue'] ) ), array( 'From the build', true ) );
eq( 'the item is the same post', http( 'GET', "$api/events/{$event['data']['id']}" )[1]['data']['title'] ?? null, 'Launch' );
// (This process loaded the build before that update, so it asks a fresh one, as a request would.)
[$status, $inUse] = http(
	'POST',
	$wp->url() . '/__rtschema_propose',
	$set(
		array(
			'op'   => 'removeCollection',
			'kind' => 'events',
		)
	)
);
eq( 'a kind the build declares can\'t be removed at runtime, whoever added it', array( $status, $inUse['code'] ?? null, $inUse['pointer'] ?? null ), array( 422, 'schema_in_use', '/changes/0/kind' ) );
$wp->writeSchema( $base );

// ================================================================ the ways in: abilities, the command, the admin screen
// Core runs a read-only ability with GET (input in the query string) and any other with POST.
$run    = static function ( string $ability, array $input, ?string $as ) use ( $wp ): array {
	$url = $wp->url() . "/wp-json/wp-abilities/v1/abilities/rtschema/$ability/run";

	if ( 'schema-apply' === $ability ) {
		return http( 'POST', $url, array( 'input' => $input ), $as );
	}
	// Over GET the changes travel as one JSON string.
	if ( isset( $input['changes'] ) ) {
		$input['changes'] = json_encode( $input['changes'] );
	}

	return http( 'GET', $url . '?' . http_build_query( array( 'input' => $input ) ), null, $as );
};
$newest = static function (): int {
	$rows = $GLOBALS['versions']->list();

	return array() === $rows ? 0 : end( $rows )['version'];
};
// `wp spacepress schema …` as WP-CLI runs it (the runtime registers it for WP-CLI only).
$schemaCli = static function ( array $args, array $flags = array() ): array {
	if ( ! class_exists( 'WP_CLI' ) ) {
		eval( 'final class WP_CLI { public static array $lines = []; public static function line(string $s): void { self::$lines[] = $s; } public static function halt(int $c): never { throw new WpCliHalt($c); } }' );
	}
	\WP_CLI::$lines = array();
	$code           = \SpacePress\RuntimeSchema\Surfaces::wpCli( $args, $flags );

	return array( $code, json_decode( implode( "\n", \WP_CLI::$lines ), true ) );
};
$count     = count( $versions->list() );

// Reading: administrators only.
eq( 'anonymous can\'t read the schema versions', $run( 'schema-read', array(), null )[0], 401 );
eq( 'an editor can\'t either', $run( 'schema-read', array(), 'editor' )[0], 403 );
[$status, $read] = $run( 'schema-read', array(), 'admin' );
eq( 'an administrator reads the active version and every stored one', array( $status, $read['version'] ?? null, count( $read['versions'] ?? array() ) ), array( 200, $newest(), $count ) );
check( 'each version says what it changed, and no secret is in it', isset( $read['versions'][0]['changes'][0]['op'] ) && ! str_contains( json_encode( $read ), $wp->appPassword( 'admin' ) ), $read['versions'][0] ?? null );

// Proposing writes nothing.
$change = array(
	'op'         => 'addField',
	'kind'       => 'articles',
	'field'      => 'byline',
	'definition' => array(
		'type'  => 'text',
		'rules' => array( 'max' => 80 ),
	),
);
eq( 'an editor can\'t propose', $run( 'schema-propose', array( 'changes' => array( $change ) ), 'editor' )[0], 403 );
[$status, $proposal] = $run( 'schema-propose', array( 'changes' => array( $change ) ), 'admin' );
eq(
	'a proposal returns the stored change and its effect, and stores nothing',
	array( $status, $proposal['changes'][0]['definition'] ?? null, $proposal['effects'][0]['op'] ?? null, count( $versions->list() ) ),
	array(
		200,
		array(
			'type'  => 'text',
			'rules' => array( 'max' => 80 ),
		),
		'addField',
		$count,
	)
);
[$status, $refused] = $run(
	'schema-propose',
	array(
		'changes' => array(
			array(
				'op'         => 'addField',
				'kind'       => 'articles',
				'field'      => 'bad-name',
				'definition' => array( 'type' => 'text' ),
			),
		),
	),
	'admin'
);
eq( 'a refusal keeps its code and pointer over the run route', array( $status, $refused['code'] ?? null, $refused['data']['pointer'] ?? null ), array( 422, 'sp_schema_invalid', '/changes/0/definition' ) );

// Applying needs its own capability; an application password can be denied it.
eq(
	'an editor can\'t apply',
	$run(
		'schema-apply',
		array(
			'parent'  => $newest(),
			'changes' => array( $change ),
		),
		'editor'
	)[0],
	403
);
[$status, $applied] = $run(
	'schema-apply',
	array(
		'parent'  => $newest(),
		'changes' => array( $change ),
	),
	'admin'
);
eq(
	'an administrator applies; the version records the user and the application password, never its secret',
	array( $status, $applied['version'] ?? null, $applied['actor']['login'] ?? null, $applied['actor']['via'] ?? null, isset( $applied['actor']['credential']['uuid'] ), $applied['actor']['credential']['name'] ?? null ),
	array( 200, $count + 1, 'admin', 'ability', true, $applied['actor']['credential']['name'] ?? 'missing' )
);
check( 'the recorded credential is the one that signed the request', in_array( $applied['actor']['credential']['uuid'] ?? '', array_column( WP_Application_Passwords::get_user_application_passwords( $wp->userId( 'admin' ) ), 'uuid' ), true ) );
[$status, $conflict] = $run(
	'schema-apply',
	array(
		'parent'  => $newest() - 1,
		'changes' => array(
			array(
				'op'    => 'setLabel',
				'kind'  => 'articles',
				'label' => 'Late',
			),
		),
	),
	'admin'
);
eq( 'a change made against an older version is a 409 over the run route too', array( $status, $conflict['code'] ?? null ), array( 409, 'sp_schema_conflict' ) );
update_option(
	'sp_rtschema_schema_apply_denied',
	array(
		array(
			'user'     => $wp->userId( 'admin' ),
			'password' => $applied['actor']['credential']['uuid'],
		),
	)
);
[$status] = $run(
	'schema-apply',
	array(
		'parent'  => $newest(),
		'changes' => array(
			array(
				'op'    => 'setLabel',
				'kind'  => 'articles',
				'label' => 'Denied',
			),
		),
	),
	'admin'
);
eq( 'an application password an administrator denied can\'t apply', $status, 403 );
eq(
	'it can still read and propose',
	array(
		$run( 'schema-read', array(), 'admin' )[0],
		$run(
			'schema-propose',
			array(
				'changes' => array(
					array(
						'op'    => 'setLabel',
						'kind'  => 'articles',
						'label' => 'x',
					),
				),
			),
			'admin'
		)[0],
	),
	array( 200, 200 )
);
// A denied password that mints another one (core's own route allows it for an unscoped password)
// hands the deny on: the new password was created by a denied credential.
[$status, $minted] = http( 'POST', $wp->url() . '/wp-json/wp/v2/users/me/application-passwords', array( 'name' => 'minted while denied' ), 'admin' );
eq( 'a denied password can still create another one through core', $status, 201 );
$mintedAuth = 'admin:' . $minted['password'];
// A password made over core's route starts read-only (SpacePress's default scope); its owner grants writes
// on purpose. Even then the deny its maker carried must hold.
// (This process read the user's passwords before the HTTP request made one: read them again.)
wp_cache_delete( $wp->userId( 'admin' ), 'user_meta' );
\SpacePress\Wp\AgentScope::store(
	$wp->userId( 'admin' ),
	$minted['uuid'],
	array(
		'write'     => true,
		'personal'  => true,
		'abilities' => null,
	)
);
$runAs                   = static function ( string $ability, array $input, string $credential ) use ( $wp ): array {
	$ch = curl_init( $wp->url() . "/wp-json/wp-abilities/v1/abilities/rtschema/$ability/run" );
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_CUSTOMREQUEST  => 'POST',
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 60,
			CURLOPT_HTTPHEADER     => array(
				'Content-Type: application/json',
				'Authorization: Basic ' . base64_encode( $credential ),
			),
			CURLOPT_POSTFIELDS     => json_encode( array( 'input' => $input ) ),
		)
	);
	$body = curl_exec( $ch );

	return array( (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE ), is_string( $body ) ? json_decode( $body, true ) : null );
};
[$status, $mintedAnswer] = $runAs(
	'schema-apply',
	array(
		'parent'  => $newest(),
		'changes' => array(
			array(
				'op'    => 'setLabel',
				'kind'  => 'articles',
				'label' => 'Minted',
			),
		),
	),
	$mintedAuth
);
eq( 'a password a denied one created can\'t apply either: the deny passed to it', array( $status, $mintedAnswer['code'] ?? null ), array( 403, 'sp_forbidden' ) );
[$status] = $runAs( 'schema-read', array(), $mintedAuth );
eq( 'it signs in fine otherwise', $status, 405 );
// Core lets an administrator create passwords for another user too: one a denied password makes for
// someone else is denied as well.
$colleague               = $wp->addUser( 'colleague_admin', 'admin' );
[$status, $forColleague] = http( 'POST', $wp->url() . "/wp-json/wp/v2/users/$colleague/application-passwords", array( 'name' => 'made by a denied password' ), 'admin' );
eq( 'a denied password can create one for another administrator through core', $status, 201 );
wp_cache_delete( $colleague, 'user_meta' );
\SpacePress\Wp\AgentScope::store(
	$colleague,
	$forColleague['uuid'],
	array(
		'write'     => true,
		'personal'  => true,
		'abilities' => null,
	)
);
eq(
	'and that one can\'t apply either',
	$runAs(
		'schema-apply',
		array(
			'parent'  => $newest(),
			'changes' => array(
				array(
					'op'    => 'setLabel',
					'kind'  => 'articles',
					'label' => 'Colleague',
				),
			),
		),
		"colleague_admin:{$forColleague['password']}"
	)[0],
	403
);
// A deny list written as the first release documented it, a list of password UUIDs, still denies.
update_option( 'sp_rtschema_schema_apply_denied', array( $applied['actor']['credential']['uuid'] ) );
eq(
	'a password UUID listed on its own is denied',
	$run(
		'schema-apply',
		array(
			'parent'  => $newest(),
			'changes' => array(
				array(
					'op'    => 'setLabel',
					'kind'  => 'articles',
					'label' => 'Old form',
				),
			),
		),
		'admin'
	)[0],
	403
);
// A user denied for SpacePress Identity access tokens who uses a token to create an application password
// through core: the new password is denied too, so the token can't get round the deny that way.
\SpacePress\Identity\Plugin::$db->insert(
	'applications',
	array(
		'id'        => 'app_rtschema',
		'name'      => 'Schema tests',
		'redirects' => '[]',
		'origins'   => '[]',
	)
);
$bearer     = \SpacePress\Identity\Plugin::$accounts->issueForUser( $wp->userId( 'admin' ), 'app_rtschema' )['access_token'];
$withBearer = static function ( string $method, string $url, mixed $body ) use ( $bearer ): array {
	$ch = curl_init( $url );
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_CUSTOMREQUEST  => $method,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 60,
			CURLOPT_HTTPHEADER     => array(
				'Content-Type: application/json',
				"Authorization: Bearer $bearer",
			),
			CURLOPT_POSTFIELDS     => json_encode( $body ),
		)
	);
	$res = curl_exec( $ch );

	return array( (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE ), is_string( $res ) ? json_decode( $res, true ) : null );
};
$applyUrl   = $wp->url() . '/wp-json/wp-abilities/v1/abilities/rtschema/schema-apply/run';
update_option(
	'sp_rtschema_schema_apply_denied',
	array(
		array(
			'user'       => $wp->userId( 'admin' ),
			'credential' => 'bearer',
		),
	)
);
eq(
	'an administrator denied for access tokens can\'t apply with one',
	$withBearer(
		'POST',
		$applyUrl,
		array(
			'input' => array(
				'parent'  => $newest(),
				'changes' => array(
					array(
						'op'    => 'setLabel',
						'kind'  => 'articles',
						'label' => 'Bearer',
					),
				),
			),
		)
	)[0],
	403
);
[$status, $fromBearer] = $withBearer( 'POST', $wp->url() . '/wp-json/wp/v2/users/me/application-passwords', array( 'name' => 'made with a denied token' ) );
eq( 'the token can create an application password through core', $status, 201 );
wp_cache_delete( $wp->userId( 'admin' ), 'user_meta' );
\SpacePress\Wp\AgentScope::store(
	$wp->userId( 'admin' ),
	$fromBearer['uuid'],
	array(
		'write'     => true,
		'personal'  => true,
		'abilities' => null,
	)
);
eq(
	'and that password can\'t apply: the token\'s deny passed to it',
	$runAs(
		'schema-apply',
		array(
			'parent'  => $newest(),
			'changes' => array(
				array(
					'op'    => 'setLabel',
					'kind'  => 'articles',
					'label' => 'From bearer',
				),
			),
		),
		"admin:{$fromBearer['password']}"
	)[0],
	403
);
eq( 'it signs in fine otherwise', $runAs( 'schema-read', array(), "admin:{$fromBearer['password']}" )[0], 405 );
// Denying a user's application passwords as a kind: every one of them, present and future.
update_option(
	'sp_rtschema_schema_apply_denied',
	array(
		array(
			'user'       => $wp->userId( 'admin' ),
			'credential' => 'application-password',
		),
	)
);
eq(
	'denying all of a user\'s application passwords covers the one they sign in with now',
	$run(
		'schema-apply',
		array(
			'parent'  => $newest(),
			'changes' => array(
				array(
					'op'    => 'setLabel',
					'kind'  => 'articles',
					'label' => 'Kind',
				),
			),
		),
		'admin'
	)[0],
	403
);
delete_option( 'sp_rtschema_schema_apply_denied' );
eq(
	'nothing denied: an administrator applies',
	$run(
		'schema-apply',
		array(
			'parent'  => $newest(),
			'changes' => array(
				array(
					'op'    => 'setLabel',
					'kind'  => 'articles',
					'label' => 'Free',
				),
			),
		),
		'admin'
	)[0],
	200
);

// Revoking the capability. WordPress's own `wp cap remove administrator sp_apply_schema` removes it
// from the role; it stays removed. So does an explicit false.
$role = get_role( 'administrator' );
$role->remove_cap( \SpacePress\RuntimeSchema\Surfaces::APPLY );
eq(
	'after the capability is removed from the role, administrators can\'t apply',
	$run(
		'schema-apply',
		array(
			'parent'  => $newest(),
			'changes' => array(
				array(
					'op'    => 'setLabel',
					'kind'  => 'articles',
					'label' => 'Removed',
				),
			),
		),
		'admin'
	)[0],
	403
);
$role->add_cap( \SpacePress\RuntimeSchema\Surfaces::APPLY, false );
eq(
	'an explicit false on the role does the same',
	$run(
		'schema-apply',
		array(
			'parent'  => $newest(),
			'changes' => array(
				array(
					'op'    => 'setLabel',
					'kind'  => 'articles',
					'label' => 'No',
				),
			),
		),
		'admin'
	)[0],
	403
);
$role->add_cap( \SpacePress\RuntimeSchema\Surfaces::APPLY );
eq(
	'and they apply again once it is given back',
	$run(
		'schema-apply',
		array(
			'parent'  => $newest(),
			'changes' => array(
				array(
					'op'    => 'setLabel',
					'kind'  => 'articles',
					'label' => 'Yes',
				),
			),
		),
		'admin'
	)[0],
	200
);
// The grant happens once: an administrator account made later gets it from the role, and taking it
// from that one user holds while the role keeps it: the user gets the capability as false.
$later = $wp->addUser( 'later_admin', 'admin' );
check( 'a later administrator holds the capability through the role', user_can( $later, \SpacePress\RuntimeSchema\Surfaces::APPLY ) );
( new WP_User( $later ) )->add_cap( \SpacePress\RuntimeSchema\Surfaces::APPLY, false );
check( 'given it as false, that one administrator doesn\'t hold it, though the role does', ! user_can( $later, \SpacePress\RuntimeSchema\Surfaces::APPLY ) && user_can( $wp->userId( 'admin' ), \SpacePress\RuntimeSchema\Surfaces::APPLY ) );
// A site that took it from the role before the grant was recorded (an explicit false, as the first
// release had it) keeps it taken when the grant runs.
$role->add_cap( \SpacePress\RuntimeSchema\Surfaces::APPLY, false );
delete_option( 'sp_schema_apply_granted' );
\SpacePress\RuntimeSchema\Surfaces::grant();
check( 'the grant leaves a false on the role as it is', ! user_can( $wp->userId( 'admin' ), \SpacePress\RuntimeSchema\Surfaces::APPLY ), get_role( 'administrator' )->capabilities[ \SpacePress\RuntimeSchema\Surfaces::APPLY ] ?? 'absent' );
$role->add_cap( \SpacePress\RuntimeSchema\Surfaces::APPLY );

// The abilities are on the app's MCP server with the rest of its tools.
$tools = array_column( \SpacePress\Wp\Abilities\Register::operations(), 'agents', 'name' );
// A credential without personal data (SpacePress's default scope for agent passwords) reads the versions
// without who made them: the actor's login and application password name are personal data.
[$status, $private] = http( 'POST', $wp->url() . '/wp-json/wp/v2/users/me/application-passwords', array( 'name' => 'no personal data' ), 'admin' );
wp_cache_delete( $wp->userId( 'admin' ), 'user_meta' );
\SpacePress\Wp\AgentScope::store(
	$wp->userId( 'admin' ),
	$private['uuid'],
	array(
		'write'     => false,
		'personal'  => false,
		'abilities' => null,
	)
);
$ch = curl_init( $wp->url() . '/wp-json/wp-abilities/v1/abilities/rtschema/schema-read/run' );
curl_setopt_array(
	$ch,
	array(
		CURLOPT_RETURNTRANSFER => true,
		CURLOPT_TIMEOUT        => 60,
		CURLOPT_HTTPHEADER     => array( 'Authorization: Basic ' . base64_encode( 'admin:' . $private['password'] ) ),
	)
);
$privateRead = json_decode( (string) curl_exec( $ch ), true );
$withActor   = array_values( array_filter( $privateRead['versions'] ?? array(), static fn ( array $v ): bool => isset( $v['actor']['credential'] ) || isset( $v['actor']['login'] ) ) );
eq(
	'a credential without personal data reads every version, but no login or password name',
	array( count( $privateRead['versions'] ?? array() ) > 0, $withActor, $privateRead['versions'][0]['actor'] ?? null ),
	array(
		true,
		array(),
		array(
			'user' => $wp->userId( 'admin' ),
			'via'  => $privateRead['versions'][0]['actor']['via'] ?? null,
		),
	)
);
check( 'nor in the line saying who made each version', ! str_contains( json_encode( array_column( $privateRead['versions'] ?? array(), 'by' ) ), 'admin' ) && ! str_contains( json_encode( array_column( $privateRead['versions'] ?? array(), 'by' ) ), 'application password' ), array_column( $privateRead['versions'] ?? array(), 'by' ) );
eq( 'a credential with personal data still sees them', isset( $run( 'schema-read', array(), 'admin' )[1]['versions'][0]['actor']['login'] ), true );
// Applying answers with the stored version; without personal data, without the login and password name.
\SpacePress\Wp\AgentScope::store(
	$wp->userId( 'admin' ),
	$private['uuid'],
	array(
		'write'     => true,
		'personal'  => false,
		'abilities' => null,
	)
);
$privateApply = $runAs(
	'schema-apply',
	array(
		'parent'  => $newest(),
		'changes' => array(
			array(
				'op'    => 'setLabel',
				'kind'  => 'articles',
				'label' => 'Private',
			),
		),
	),
	'admin:' . $private['password']
);
eq(
	'applying without personal data answers without the login or password name',
	array( $privateApply[0], $privateApply[1]['actor'] ?? null ),
	array(
		200,
		array(
			'user' => $wp->userId( 'admin' ),
			'via'  => 'ability',
		),
	)
);

eq( 'the three are agent tools', array( $tools['rtschema/schema-read'] ?? null, $tools['rtschema/schema-propose'] ?? null, $tools['rtschema/schema-apply'] ?? null ), array( true, true, true ) );

// `wp spacepress schema`: list, diff, apply, rollback.
[$code, $listed] = $schemaCli( array( 'list' ) );
eq( 'schema list: one line per version, newest last', array( $code, count( $listed['data'] ), end( $listed['data'] )['version'], end( $listed['data'] )['changes'] ), array( 0, $newest(), $newest(), 1 ) );
[$code, $diff] = $schemaCli( array( 'diff', (string) $applied['version'] ) );
eq( 'schema diff: one version with its changes', array( $code, $diff['data']['changes'][0]['field'] ?? null ), array( 0, 'byline' ) );
$file = "$wp->dir/change.json";
file_put_contents(
	$file,
	json_encode(
		array(
			array(
				'op'         => 'addField',
				'kind'       => 'articles',
				'field'      => 'teaserImage',
				'definition' => array(
					'type'   => 'media',
					'accept' => 'image',
				),
			),
		)
	)
);
[$code, $cliApplied] = $schemaCli( array( 'apply', $file ) );
eq( 'schema apply: a file of changes on the newest version, recorded as WP-CLI', array( $code, $cliApplied['data']['version'] ?? null, $cliApplied['data']['actor']['via'] ?? null ), array( 0, $newest(), 'wp-cli' ) );
[$code, $stale] = $schemaCli( array( 'apply', $file ), array( 'parent' => '1' ) );
eq( 'schema apply on an older parent is the 409', array( $code, $stale['error']['code'] ?? null ), array( 1, 'schema_conflict' ) );
[$code, $rolledBack] = $schemaCli( array( 'rollback', (string) $cliApplied['data']['version'] ) );
eq(
	'schema rollback: a new version that reverses the given one',
	array( $code, $rolledBack['data']['changes'] ?? null ),
	array(
		0,
		array(
			array(
				'op'    => 'removeField',
				'kind'  => 'articles',
				'field' => 'teaserImage',
				'was'   => 'media',
			),
		),
	)
);
[$code, $bad] = $schemaCli( array( 'diff', 'x' ) );
eq( 'a bad argument says how to call it', array( $code, $bad['error']['code'] ?? null ), array( 1, 'invalid_command' ) );

// The versions screen (both admins) lists what schema-read returns: each version with who made it
// and each change in words. The screens API itself is SpacePress Admin's; its WordPress tests cover both hosts.
[, $read]   = $run( 'schema-read', array(), 'admin' );
$withByline = array_values( array_filter( $read['versions'], static fn ( array $v ): bool => in_array( 'Added articles.byline (text)', $v['summary'] ?? array(), true ) ) );
check( 'each version says what it changed, in words', array() !== $withByline && in_array( 'Hid articles.teaserImage (its values are kept)', array_merge( ...array_map( static fn ( array $v ): array => $v['summary'], $read['versions'] ) ), true ), $read['versions'] );
check( 'and who made it', str_contains( implode( ' ', array_column( $read['versions'], 'by' ) ), '(WP-CLI)' ), array_column( $read['versions'], 'by' ) );

// ================================================================ the chain and the option are checked
// The version rows are chained by hash; a row edited in the database breaks the chain. The site then
// keeps serving the last state that checked out and says why, and refuses to apply on top of it.
$table      = $wp->connection()->prefix() . 'sp__schema_versions';
$goodState  = get_option( Loader::option( 'rtschema' ) );
$rowsBefore = $versions->list();
$second     = $rowsBefore[1];
$wp->exec(
	"UPDATE `$table` SET `changes` = ? WHERE `app` = 'rtschema' AND `version` = 2",
	array(
		json_encode(
			array(
				array(
					'op'         => 'addField',
					'kind'       => 'articles',
					'field'      => 'forged',
					'definition' => array( 'type' => 'text' ),
				),
			)
		),
	)
);
$d = $described();
eq( 'the next request finds the broken chain itself, before anything reads the versions', array( $d['runtimeSchema']['version'], $d['runtimeSchema']['problem'] ?? null ), array( $goodState['version'], 'schema version 2 does not match its hash' ) );
// A deployment's preflight reads the versions through verify(): the same refusal, and nothing written.
$optionBefore = get_option( Loader::option( 'rtschema' ) );
eq( 'verify refuses a broken chain as list does', $refusal( fn () => $versions->verify() ), '409 schema_chain_broken /changes' );
wp_cache_delete( 'alloptions', 'options' );
wp_cache_delete( Loader::option( 'rtschema' ), 'options' );
eq( 'and records nothing on the option', get_option( Loader::option( 'rtschema' ) ), $optionBefore );
eq( 'a broken chain refuses the next change, naming the first version that doesn\'t check out', $refusal( fn () => $versions->apply( count( $rowsBefore ), $add( 'afterForgery', array( 'type' => 'text' ) ), $admin ) ), '409 schema_chain_broken /changes' );
// The admin screen says so instead of failing.
wp_set_current_user( $wp->userId( 'admin' ) );
$screenLines = ( static function (): array|string {
	try {
		return \SpacePress\RuntimeSchema\Surfaces::summary();
	} catch ( \Throwable $e ) {
		return get_class( $e );
	}
} )();
eq( 'the admin screen shows a broken chain instead of failing', is_array( $screenLines ) && str_contains( implode( ' ', $screenLines ), 'does not match its hash' ), true );
// An option written while the chain is broken stays unserved: nothing seals content no version made.
$planted = $goodState;
$planted['collections']['articles']['columns']['planted'] = array( 'type' => 'text' );
unset( $planted['seal'] );
update_option( Loader::option( 'rtschema' ), $planted, true );
$refusal( fn () => $versions->list() );
check( 'a broken chain never seals an option it didn\'t check', ! isset( $described()['kinds']['articles']['columns']['planted'] ), array_keys( $described()['kinds']['articles']['columns'] ) );
update_option( Loader::option( 'rtschema' ), $goodState, true );
eq( 'it exports no lock from a broken chain', $refusal( fn () => $versions->lock() ) !== 'accepted', true );
$d = $described();
eq(
	'requests keep serving the last state that checked out, and the API says the chain is broken',
	array( $d['runtimeSchema']['version'], $d['runtimeSchema']['problem'] ?? null, isset( $d['kinds']['articles']['columns']['forged'] ) ),
	array( $goodState['version'], 'schema version 2 does not match its hash', false )
);
$wp->exec( "UPDATE `$table` SET `changes` = ? WHERE `app` = 'rtschema' AND `version` = 2", array( json_encode( $second['changes'] ) ) );
eq( 'restoring the row restores the chain the next time the versions are read', array( count( $versions->list() ), $described()['runtimeSchema']['problem'] ?? null ), array( count( $rowsBefore ), null ) );

// An option rewritten by something other than apply: its own hash no longer matches its content.
$forged = $goodState;
$forged['collections']['articles']['columns']['planted'] = array( 'type' => 'text' );
update_option( Loader::option( 'rtschema' ), $forged, true );
$verified = $versions->verify();
wp_cache_delete( 'alloptions', 'options' );
wp_cache_delete( Loader::option( 'rtschema' ), 'options' );
eq( 'verify compares against the stored versions and leaves the edited option as it is', array( $verified['site']['version'], get_option( Loader::option( 'rtschema' ) ) ), array( $goodState['version'], $forged ) );
eq( 'verify answers what deployCheck answers', $versions->verify(), $versions->deployCheck() );
update_option( Loader::option( 'rtschema' ), $forged, true );
$d = $described();
eq(
	'an option edited outside apply is not served: the build\'s schema is, and the API says why',
	array( isset( $d['kinds']['articles']['columns']['planted'] ), isset( $d['kinds']['articles']['columns']['subtitle'] ), $d['runtimeSchema']['problem'] ?? null ),
	array( false, false, 'the runtime schema option does not match its own hash; apply a change, or run `wp spacepress schema list`, to rebuild it from the stored versions' )
);
[$code, $listed] = $schemaCli( array( 'list' ) );
eq( 'reading the versions rebuilds it from the table', array( $code, isset( $described()['kinds']['articles']['columns']['subtitle'] ), $described()['runtimeSchema']['problem'] ?? null ), array( 0, true, null ) );

// An option at version 0 without a seal (apply never writes one) is not served either.
$zero = array(
	'format'      => 1,
	'version'     => 0,
	'hash'        => '',
	'collections' => array( 'articles' => array( 'columns' => array( 'zeroPlanted' => array( 'type' => 'text' ) ) ) ),
);
$kept = get_option( Loader::option( 'rtschema' ) );
update_option( Loader::option( 'rtschema' ), $zero, true );
$d = $described();
eq( 'an unsealed option at version 0 is not served, and the API says so', array( isset( $d['kinds']['articles']['columns']['zeroPlanted'] ), $d['runtimeSchema']['version'], isset( $d['runtimeSchema']['problem'] ) ), array( false, 0, true ) );
update_option( Loader::option( 'rtschema' ), $kept, true );

// Deleting the newest versions is noticed: the option remembers the version it was written for.
$rowsNow = $versions->list();
$last    = end( $rowsNow );
$wp->exec( "DELETE FROM `$table` WHERE `app` = 'rtschema' AND `version` = ?", array( $last['version'] ) );
eq( 'a missing newest version breaks the chain', $refusal( fn () => $versions->list() ), '409 schema_chain_broken /changes' );
$wp->exec(
	"INSERT INTO `$table` (`app`, `version`, `parent`, `format`, `build`, `actor`, `changes`, `hash`, `createdAt`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
	array( 'rtschema', $last['version'], $last['parent'], $last['format'], $last['build'], json_encode( $last['actor'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ), json_encode( $last['changes'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ), $last['hash'], $last['createdAt'] )
);
eq( 'and putting it back mends it', count( $versions->list() ), count( $rowsNow ) );

// ================================================================ a format this runtime doesn't know
// Sealed, so it is the format check that turns it away, not the seal.
$state = get_option( Loader::option( 'rtschema' ) );
update_option( Loader::option( 'rtschema' ), Loader::sealed( array( 'format' => 2 ) + $state ), true );
$d = $described();
check( 'a state in a newer format isn\'t guessed at: the site serves the build\'s schema', ! isset( $d['kinds']['articles']['columns']['subtitle'] ) && ! isset( $d['kinds']['events'] ), array_keys( $d['kinds'] ) );
eq( 'and says which format it found', $d['runtimeSchema']['problem'] ?? null, 'the site\'s runtime schema is in format 2; this runtime reads format 1' );
update_option( Loader::option( 'rtschema' ), $state, true );
check( 'and the known format loads again', isset( $described()['kinds']['articles']['columns']['subtitle'] ) );

finish( 'runtimeschema' );
