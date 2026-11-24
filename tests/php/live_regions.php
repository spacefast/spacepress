<?php

declare(strict_types=1);

/*
 * The subscription endpoint's `page` read (docs/decisions/2026-11-14-live-regions.md):
 * tests/fixtures/live-regions, built by `spacepress build`, on WordPress with php -S. Every answer comes
 * from `POST /wp-json/spacepress/v1/_live` over HTTP, as the browser asks. Prints one JSON object.
 *
 *   SP_WP_THEMES=1 php tests/php/live_regions.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite(
	'live-regions',
	array(
		'wpContent' => $argv[1],
		'users'     => array( 'chief' => 'editor' ),
		'muPlugins' => array(
			'host' => <<<'PHP'
<?php
// A host that keeps cached pages: the page cache records what cacheable renders read.
add_action('sp_purge_urls', static function (array $paths): void {});
if (isset($_SERVER['HTTP_X_SP_TEST_SEED_FAILURE'])) {
    add_filter('salt', static function ($salt) {
        if (in_array(\SpacePress\Live\Token::class, array_column(debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 8), 'class'), true)) {
            throw new RuntimeException('Test seed issuance failure');
        }
        return $salt;
    });
}
// Counts the page renders `_live` runs, to tell "not modified" by counter from by hash.
add_action('sp_app_live_rendered', static function (): void {
    update_option('test_live_renders', (int) get_option('test_live_renders', 0) + 1, false);
});
PHP,
		),
	)
);
wp_set_current_user( 1 );
\SpacePress\db()->insert(
	'notes',
	array(
		'title'  => 'One',
		'slug'   => 'one',
		'status' => 'published',
	)
);
$site->actAs( null );
$site->startServer();
$url = $site->url();

function post( string $url, array $queries, array $headers = array() ): array {
	$ch = curl_init( "$url/wp-json/spacepress/v1/_live" );
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_POST           => true,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 30,
			CURLOPT_HTTPHEADER     => array( 'Content-Type: application/json', ...$headers ),
			CURLOPT_POSTFIELDS     => json_encode( array( 'queries' => $queries ) ),
		)
	);
	$body   = (string) curl_exec( $ch );
	$status = (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE );
	$json   = json_decode( $body, true );
	return 200 === $status ? $json['data']['results'] : array(
		'status' => $status,
		'body'   => $json ?? $body,
	);
}

$page  = static fn ( string $path, string $region, ?string $token = null ): array => array(
	'op'   => 'page',
	'args' => array(
		'url'    => $path,
		'region' => $region,
	),
) + ( null === $token ? array() : array( 'token' => $token ) );
$shape = static function ( array $r ): string {
	return isset( $r['error'] ) ? 'error ' . $r['error']['status'] . ' ' . $r['error']['code'] : ( isset( $r['pending'] ) ? 'pending' : ( $r['changed'] ? 'changed' : 'unchanged' ) );
};
$items = static fn ( array $r ): array => isset( $r['data']['html'] ) && preg_match_all( '#<li[^>]*class="note"[^>]*>([^<]*)</li>#', $r['data']['html'], $m ) ? $m[1] : array();
global $wpdb;
$reads = static fn (): int => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}sp__app_reads" );

$out     = array();
$renders = static function (): int {
	global $wpdb;
	return (int) $wpdb->get_var( "SELECT option_value FROM {$wpdb->options} WHERE option_name = 'test_live_renders'" );
};
function pageSeed( string $url, string $id, array $headers = array() ): array {
	$ch = curl_init( $url );
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_HTTPHEADER     => $headers,
			CURLOPT_TIMEOUT        => 30,
		)
	);
	$body = curl_exec( $ch );
	if ( false === $body ) {
		throw new RuntimeException( curl_error( $ch ) );
	}
	$doc = new DOMDocument();
	@$doc->loadHTML( $body );
	$element = ( new DOMXPath( $doc ) )->query( "//*[@data-sp-live='$id']" )->item( 0 );
	return json_decode( $element->getAttribute( 'data-sp-live-seed' ), true, 512, JSON_THROW_ON_ERROR );
}

$was                       = $renders();
$seed                      = pageSeed( "$url/", 'notes' );
$out['page seed']          = array( $renders() - $was, $seed['kinds'] );
$was                       = $renders();
[$checked]                 = post( $url, array( $page( '/', 'notes', $seed['token'] ) ) );
$out['first poll']         = array( $shape( $checked ), $renders() - $was );
$unsealed                  = pageSeed( "$url/", 'notes', array( 'X-SP-Test-Seed-Failure: 1' ) );
[$retry]                   = post( $url, array( $page( $unsealed['url'], 'notes', $unsealed['token'] ?? null ) ) );
$out['unsealed page seed'] = array( isset( $unsealed['token'] ), $unsealed['kinds'], $shape( $retry ), $items( $retry ) );

// The first answer: the region's HTML, and only the region's.
[$first]      = post( $url, array( $page( '/', 'notes' ) ) );
$out['first'] = array( $shape( $first ), $items( $first ), str_contains( $first['data']['html'], '<h1>' ), $first['data']['kinds'] );
// Asked again with its token and nothing changed: "not modified" (by counter: notes has one for anonymous visitors).
$was          = $renders();
[$again]      = post( $url, array( $page( '/', 'notes', $first['token'] ) ) );
$out['again'] = array(
	$shape( $again ),
	'rendered' => $renders() - $was,
);
// Determinism: rendered twice without the counter shortcut (no token), the same hash, so a held
// token from one render answers "unchanged" after another.
[$fresh]          = post( $url, array( $page( '/', 'notes' ) ) );
$out['same hash'] = $fresh['data']['html'] === $first['data']['html'];
// A write the region read: changed on the next poll.
wp_set_current_user( 1 );
\SpacePress\db()->insert(
	'notes',
	array(
		'title'  => 'Two',
		'status' => 'published',
	)
);
$site->actAs( null );
[$after]                        = post( $url, array( $page( '/', 'notes', $again['token'] ) ) );
$out['after write']             = array( $shape( $after ), $items( $after ) );
[$changedSinceGet]              = post( $url, array( $page( '/', 'notes', $seed['token'] ) ) );
$out['write before first poll'] = array( $shape( $changedSinceGet ), $items( $changedSinceGet ) );
// A draft doesn't show to anonymous visitors, and doesn't count as a change for them.
wp_set_current_user( 1 );
\SpacePress\db()->insert(
	'notes',
	array(
		'title'  => 'Draft',
		'status' => 'draft',
	)
);
$site->actAs( null );
[$draft]            = post( $url, array( $page( '/', 'notes', $after['token'] ) ) );
$out['after draft'] = $shape( $draft );
// A page that reads nothing has no counters: it renders and compares every time (here, unchanged).
[$empty]         = post( $url, array( $page( '/about', 'static' ) ) );
$was             = $renders();
[$empty2]        = post( $url, array( $page( '/about', 'static', $empty['token'] ) ) );
$out['no reads'] = array(
	$shape( $empty ),
	$shape( $empty2 ),
	'rendered' => $renders() - $was,
);
// Refusals: a guarded page answers its problem, never HTML; unknown regions, URLs that aren't pages,
// hosts, and bad region ids are refused.
$out['guarded anonymous'] = $shape( post( $url, array( $page( '/desk', 'count' ) ) )[0] );
$out['missing region']    = $shape( post( $url, array( $page( '/', 'nope' ) ) )[0] );
$out['not a page']        = $shape( post( $url, array( $page( '/wp-admin/', 'notes' ) ) )[0] );
$out['host']              = $shape( post( $url, array( $page( '//evil.example/', 'notes' ) ) )[0] );
$out['scheme']            = $shape( post( $url, array( $page( 'https://evil.example/', 'notes' ) ) )[0] );
$out['bad region']        = $shape( post( $url, array( $page( '/', 'Bad Id' ) ) )[0] );
// At most four page reads render per request; the fifth answers `pending` (the client asks again
// at once), so a page with more regions than the cap still fills them all on the next request.
$five       = post( $url, array_fill( 0, 5, $page( '/about', 'static' ) ) );
$again5     = post( $url, array( $page( '/about', 'static' ) ) );
$out['cap'] = array( array_map( $shape, $five ), $shape( $again5[0] ) );

// Signed in: an editor reads the guarded page's count, and a `_live` render records nothing in
// the page cache's read index, while an anonymous GET of the page does.
$id                          = $site->userId( 'chief' );
$expires                     = time() + 3600;
$token                       = WP_Session_Tokens::get_instance( $id )->create( $expires );
$logged                      = wp_generate_auth_cookie( $id, $expires, 'logged_in', $token );
$_COOKIE[ LOGGED_IN_COOKIE ] = $logged;
wp_set_current_user( $id );
$nonce = wp_create_nonce( 'wp_rest' );
wp_set_current_user( 0 );
unset( $_COOKIE[ LOGGED_IN_COOKIE ] );
$editor                        = array( 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode( $logged ), "X-WP-Nonce: $nonce" );
$before                        = $reads();
[$desk]                        = post( $url, array( $page( '/desk', 'count' ) ), $editor );
[$home]                        = post( $url, array( $page( '/', 'notes' ) ), $editor );
$out['editor']                 = array( $shape( $desk ), preg_match( '#class="count">(\d+)<#', $desk['data']['html'] ?? '', $m ) ? (int) $m[1] : null, $items( $home ) );
$out['records nothing']        = $reads() - $before;
$publicSeed                    = pageSeed( "$url/about/", 'static' );
[$crossViewer]                 = post( $url, array( $page( $publicSeed['url'], 'static', $publicSeed['token'] ) ), $editor );
$out['page seed other viewer'] = $shape( $crossViewer );
$ch                            = curl_init( "$url/" );
curl_setopt_array( $ch, array( CURLOPT_RETURNTRANSFER => true ) );
curl_exec( $ch );
$out['a GET records'] = $reads() - $before > 0;

// `<Live>` around `<Comments>`: a new approved comment shows on the next poll, not after the
// five-minute trust window, because the thread marks the page as reading something unseen.
$slug     = (string) \SpacePress\db()->findFirst( 'notes', array( 'where' => array( 'title' => 'One' ) ) )['slug'];
$noteId   = (int) \SpacePress\db()->findFirst( 'notes', array( 'where' => array( 'title' => 'One' ) ) )['id'];
[$thread] = post( $url, array( $page( "/notes/$slug", 'thread' ) ) );
wp_insert_comment(
	array(
		'comment_post_ID'  => $noteId,
		'comment_content'  => 'Live hello',
		'comment_author'   => 'admin',
		'user_id'          => 1,
		'comment_approved' => 1,
	)
);
$was             = $renders();
[$thread2]       = post( $url, array( $page( "/notes/$slug", 'thread', $thread['token'] ) ) );
$out['comments'] = array(
	$shape( $thread ),
	str_contains( $thread['data']['html'] ?? '', 'Live hello' ),
	$shape( $thread2 ),
	str_contains( $thread2['data']['html'] ?? '', 'Live hello' ),
	'rendered' => $renders() - $was,
	'kinds'    => $thread['data']['kinds'] ?? null,
);

// The visitor key includes the post-password cookie: a password-protected note is in the region
// only for a visitor holding its cookie, and a token issued to one visitor is never "not modified"
// for the other.
wp_set_current_user( 1 );
\SpacePress\db()->insert(
	'notes',
	array(
		'title'  => 'Locked',
		'slug'   => 'locked',
		'status' => 'published',
	)
);
wp_update_post(
	array(
		'ID'            => (int) \SpacePress\db()->findFirst( 'notes', array( 'where' => array( 'slug' => 'locked' ) ) )['id'],
		'post_password' => 'open sesame',
	)
);
$site->actAs( null );
require_once ABSPATH . WPINC . '/class-phpass.php';
$pass            = array( 'Cookie: wp-postpass_' . COOKIEHASH . '=' . rawurlencode( ( new PasswordHash( 8, true ) )->HashPassword( 'open sesame' ) ) );
[$without]       = post( $url, array( $page( '/', 'notes' ) ) );
[$with]          = post( $url, array( $page( '/', 'notes' ) ), $pass );
[$crossA]        = post( $url, array( $page( '/', 'notes', $without['token'] ) ), $pass );
[$crossB]        = post( $url, array( $page( '/', 'notes', $with['token'] ) ) );
$out['password'] = array(
	'without'                    => in_array( 'Locked', $items( $without ), true ),
	'with'                       => in_array( 'Locked', $items( $with ), true ),
	'without token, with cookie' => array( $shape( $crossA ), in_array( 'Locked', $items( $crossA ), true ) ),
	'with token, without cookie' => array( $shape( $crossB ), in_array( 'Locked', $items( $crossB ), true ) ),
);
wp_set_current_user( 1 );
wp_delete_post( (int) \SpacePress\db()->findFirst( 'notes', array( 'where' => array( 'slug' => 'locked' ) ) )['id'], true );
$site->actAs( null );

// A cached page's seed: its token is older than TRUST_SECONDS (a page cache served it later). The
// counters may not answer for it: the region renders and compares, and answers unchanged.
[$fresh]          = post( $url, array( $page( '/', 'notes' ) ) );
$claims           = \SpacePress\Live\Token::open( $fresh['token'] );
$claims['t']     -= \SpacePress\Live\Module::TRUST_SECONDS + 100;
$old              = \SpacePress\Live\Token::seal( $claims );
$was              = $renders();
[$aged]           = post( $url, array( $page( '/', 'notes', $old ) ) );
$out['aged seed'] = array(
	$shape( $aged ),
	'rendered' => $renders() - $was,
);

// A new build of the same page: the held token is a different question, so the region renders.
$schemaFile = \SpacePress\Wp\Runtime::plugin()->dir . '/sp/app/schema.php';
[$held]     = post( $url, array( $page( '/', 'notes' ) ) );
file_put_contents( $schemaFile, file_get_contents( $schemaFile ) . "\n// another build\n" );
[$rebuilt]        = post( $url, array( $page( '/', 'notes', $held['token'] ) ) );
$out['new build'] = array( $shape( $rebuilt ), isset( $rebuilt['data'] ) );

echo json_encode( $out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT ), "\n";
$site->destroy();
