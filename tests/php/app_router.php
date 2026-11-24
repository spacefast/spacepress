<?php

declare(strict_types=1);

/*
 * `app_router_serves_pages_on_wordpress` in tests/app_router.rs builds the app-router fixture
 * with the page-access routes and serves it through WordPress with the theme active.
 *
 *   SP_WP_THEMES=1 php tests/php/app_router.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

// The webhook secret, as a wp-config constant would set it (env() reads constants first).
$site = wpSite(
	'app',
	array(
		'wpContent' => $argv[1],
		'users'     => array(
			'reader' => 'subscriber',
			'chief'  => 'editor',
		),
		'muPlugins' => array( 'secret' => "<?php define('APPROUTER_HOOK_SECRET', 'hook-secret');" ),
	)
);
wp_set_current_user( 1 );
\SpacePress\db()->insert(
	'notes',
	array(
		'title'  => 'Hello',
		'slug'   => 'hello',
		'secret' => 'desk only',
		'status' => 'published',
	)
);
\SpacePress\db()->insert(
	'notes',
	array(
		'title'  => 'Draft',
		'slug'   => 'draft',
		'status' => 'draft',
	)
);
// What a site owner sets in WordPress: a Global Styles color (the Styles screen, the Site Editor),
// Additional CSS, and a site icon. SpacePress's pages must print each, as the theme's own templates do.
$styles = WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles( wp_get_theme(), true );
wp_update_post(
	array(
		'ID'           => $styles['ID'],
		'post_content' => wp_json_encode(
			array(
				'version'                     => WP_Theme_JSON::LATEST_SCHEMA,
				'isGlobalStylesUserThemeJSON' => true,
				'settings'                    => array(
					'color' => array(
						'palette' => array(
							'custom' => array(
								array(
									'slug'  => 'brand',
									'color' => '#123456',
									'name'  => 'Brand',
								),
							),
						),
					),
				),
			)
		),
	)
);
wp_update_custom_css_post( '.owner-css { color: #654321; }' );
$icon = wp_insert_attachment(
	array(
		'post_mime_type' => 'image/png',
		'post_title'     => 'icon',
		'post_status'    => 'inherit',
	),
	'icon.png'
);
update_option( 'site_icon', $icon );
$site->actAs( null );
$site->startServer();
$url = $site->url();

function fetch( string $url, string $method = 'GET', array $headers = array(), ?string $body = null ): array {
	$ch  = curl_init( $url );
	$out = array();
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_CUSTOMREQUEST  => $method,
			CURLOPT_NOBODY         => 'HEAD' === $method,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 30,
			CURLOPT_HTTPHEADER     => $headers,
			CURLOPT_POSTFIELDS     => $body,
			CURLOPT_HEADERFUNCTION => static function ( $ch, string $line ) use ( &$out ): int {
				if ( str_contains( $line, ':' ) ) {
					[$name, $value]                       = explode( ':', $line, 2 );
					$out[ strtolower( trim( $name ) ) ][] = trim( $value );
				}
				return strlen( $line );
			},
		)
	);
	$text = (string) curl_exec( $ch );
	return array(
		'status'  => (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE ),
		'headers' => $out,
		'body'    => $text,
	);
}

/** The router region's contents and the document title. */
function page( array $r ): array {
	preg_match( '#<title>(.*?)</title>#s', $r['body'], $t );
	preg_match( '#data-wp-router-region="sp/main">(.*)</div><!-- /sp/main -->#s', $r['body'], $m );
	return array(
		'status' => $r['status'],
		'title'  => html_entity_decode( $t[1] ?? '', ENT_QUOTES ),
		'body'   => $m[1] ?? null,
	);
}

// One session per user: the logged-in cookie and a REST nonce minted for the same session token,
// as a browser holds them after signing in.
$sessions = array();
$session  = static function ( string $user ) use ( $site, &$sessions ): array {
	if ( isset( $sessions[ $user ] ) ) {
		return $sessions[ $user ];
	}
	$id                          = $site->userId( $user );
	$expires                     = time() + 3600;
	$token                       = WP_Session_Tokens::get_instance( $id )->create( $expires );
	$cookie                      = wp_generate_auth_cookie( $id, $expires, 'logged_in', $token );
	$_COOKIE[ LOGGED_IN_COOKIE ] = $cookie;
	wp_set_current_user( $id );
	$nonce = wp_create_nonce( 'wp_rest' );
	wp_set_current_user( 0 );
	unset( $_COOKIE[ LOGGED_IN_COOKIE ] );
	return $sessions[ $user ] = array(
		'cookie' => 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode( $cookie ),
		'nonce'  => 'X-WP-Nonce: ' . $nonce,
	);
};
$cookie   = static fn ( string $user ): string => $session( $user )['cookie'];

$access = array();
foreach ( array(
	'guest'  => null,
	'reader' => 'reader',
	'admin'  => 'admin',
) as $viewer => $user ) {
	$headers = null === $user ? array() : array( $cookie( $user ) );
	$listing = fetch( "$url/directory/all/", headers: $headers );
	$doc     = new DOMDocument();
	@$doc->loadHTML( $listing['body'] );
	foreach ( ( new DOMXPath( $doc ) )->query( '//main//a' ) as $a ) {
		$access['links'][ $viewer ][ trim( $a->textContent ) ] = array(
			$a->getAttribute( 'href' ),
			$a->hasAttribute( 'data-wp-on--click' ),
			$a->hasAttribute( 'data-wp-on--mouseenter' ),
		);
	}
	$live                               = fetch(
		"$url/wp-json/spacepress/v1/_live",
		'POST',
		array(
			'Content-Type: application/json',
			...$headers,
			...( null === $user ? array() : array( $session( $user )['nonce'] ) ),
		),
		json_encode(
			array(
				'queries' => array(
					array(
						'op'   => 'page',
						'args' => array(
							'url'    => '/office/',
							'region' => 'records',
						),
					),
				),
			)
		)
	);
	$region                             = json_decode( $live['body'], true )['data']['results'][0] ?? array();
	$access['live'][ $viewer ]          = array( $region['error']['status'] ?? $live['status'], str_contains( $region['data']['html'] ?? '', 'Office records' ) );
	$toolsPost                          = fetch( "$url/members/tools/", 'POST', array( ...$headers, ...( null === $user ? array() : array( $session( $user )['nonce'] ) ) ) );
	$access['tools POST'][ $viewer ]    = array( $toolsPost['status'], 'Accepted' === $toolsPost['body'] );
	$queue                              = fetch( "$url/api/editor-queue", headers: $headers );
	$access['queue'][ $viewer ]         = array( $queue['status'], 'Queue' === $queue['body'] );
	$post                               = fetch(
		"$url/checkout/",
		'POST',
		array(
			...$headers,
			...( null === $user ? array() : array( $session( $user )['nonce'] ) ),
		),
		''
	);
	$access['checkout POST'][ $viewer ] = array( $post['status'], 'Order received' === $post['body'] );
	foreach ( array(
		'/office/?view=todo'     => 'Office records',
		'/members/archive/2026/' => 'Member archive',
		'/checkout/'             => 'Checkout',
		'/signed-desk/'          => 'Signed desk',
		'/members/tools/'        => 'Admin tools',
		'/guest/'                => 'Guest preview',
		'/onboarding/'           => 'Admin onboarding',
	) as $path => $heading ) {
		$response                               = fetch( $url . $path, headers: $headers );
		$access['pages'][ $viewer ][ $heading ] = array( $response['status'], str_contains( $response['body'], "<h1>$heading</h1>" ) );
		if ( 'guest' === $viewer && 'Guest preview' === $heading ) {
			$access['guest cache'] = $response['headers']['cache-control'][0] ?? null;
		}
		if ( 'guest' === $viewer && 'Office records' === $heading ) {
			$access['direct login'] = array( $response['headers']['location'][0] ?? null, wp_login_url( $url . $path ) );
		}
		if ( 'guest' === $viewer && 'Admin onboarding' === $heading ) {
			$access['guard redirect'] = $response['headers']['location'][0] ?? null;
		}
	}
}
foreach ( array(
	'Office'  => '/office/?view=todo#queue',
	'Archive' => '/members/archive/2026/',
	'Tools'   => '/members/tools/',
) as $link => $path ) {
	$access['login'][ $link ] = wp_login_url( $url . $path );
}
$pages = \SpacePress\Wp\RoutePages::instance()->pages();
foreach ( array( 'office', 'members/tools' ) as $name ) {
	$access['private pages'][] = isset( $pages[ $name ] ) ? get_post_status( $pages[ $name ] ) : null;
}
foreach ( array(
	'unsigned'       => array(),
	'unsigned admin' => array( $cookie( 'admin' ), $session( 'admin' )['nonce'] ),
	'wrong'          => array( 'X-Hook-Signature: invalid' ),
	'signed'         => array( 'X-Hook-Signature: ' . hash_hmac( 'sha256', 'delivery', 'hook-secret' ) ),
) as $kind => $headers ) {
	$response                       = fetch( "$url/signed-desk/", 'POST', $headers, 'delivery' );
	$access['signed POST'][ $kind ] = array( $response['status'], 'delivery' === $response['body'] );
}
$access['checkout without nonce'] = fetch( "$url/checkout/", 'POST', array( $cookie( 'admin' ) ), '' )['status'];
$access['private twin']           = fetch( "$url/office.md", headers: array( $cookie( 'admin' ) ) )['status'];

$home = fetch( "$url/" );
$out  = array(
	'base'                => $url,
	'page access'         => $access,
	'home'                => page( $home ),
	'home description'    => str_contains( $home['body'], '<meta name="description" content="Notes.">' ),
	'home cache'          => $home['headers']['cache-control'] ?? null,
	'router module'       => str_contains( $home['body'], 'sp/Render/client/router.js' ),
	'note'                => page( fetch( "$url/notes/hello/" ) ),
	'note canonical'      => (bool) preg_match( '#<link rel="canonical" href="' . preg_quote( $url, '#' ) . '/notes/hello/">#', fetch( "$url/notes/hello/" )['body'] ),
	// The layout's Open Graph type, card and link, with the page's image and link added.
	'note social'         => ( static function ( string $body ): array {
		preg_match_all( '#<meta (?:property|name)="((?:og|twitter):[a-z]+)" content="([^"]*)">#', $body, $meta, PREG_SET_ORDER );
		preg_match_all( '#<link rel="(describedby|alternate)" href="([^"]*)" type="([^"]*)">#', $body, $links, PREG_SET_ORDER );
		preg_match_all( '#<script id="spacepress-app-script-[0-9a-f]+-js-module" src="([^"]*)" type="module">#', $body, $scripts );
		return array(
			'meta'    => array_map( static fn ( $m ) => array( $m[1], html_entity_decode( $m[2], ENT_QUOTES ) ), $meta ),
			'links'   => array_map( static fn ( $m ) => array_slice( $m, 1 ), $links ),
			'scripts' => $scripts[1],
		);
	} )( fetch( "$url/notes/hello/" )['body'] ),
	'note as editor'      => page( fetch( "$url/notes/hello/", headers: array( $cookie( 'chief' ) ) ) ),
	'draft'               => page( fetch( "$url/notes/draft/" ) ),
	'missing'             => page( fetch( "$url/notes/nope/" ) ),
	'unrouted'            => page( fetch( "$url/no/such/page/" ) ),
	'search'              => page( fetch( "$url/notes/?page=3&q=tea" ) ),
	'search defaults'     => page( fetch( "$url/notes/?page=abc" ) ),
	// `<Pagination>` on page 6 of 12, reached from a URL with another argument and a flash marker.
	'pagination'          => ( static function () use ( $url ): array {
		$doc = new DOMDocument();
		@$doc->loadHTML( (string) fetch( "$url/notes/?q=tea&page=6&_flash=abcdefabcdef" )['body'] );
		$x   = new DOMXPath( $doc );
		$nav = $x->query( '//nav[@class="spacepress-pagination"]' )->item( 0 );
		$out = array(
			'label' => $nav?->getAttribute( 'aria-label' ),
			'items' => array(),
		);
		foreach ( null === $nav ? array() : $x->query( './/li', $nav ) as $li ) {
			$a              = $x->query( './/a', $li )->item( 0 );
			$current        = $x->query( './/*[@aria-current="page"]', $li )->item( 0 );
			$out['items'][] = trim( $li->textContent ) . ( $a ? ' ' . parse_url( $a->getAttribute( 'href' ), PHP_URL_PATH ) . '?' . parse_url( $a->getAttribute( 'href' ), PHP_URL_QUERY ) . ( $a->getAttribute( 'rel' ) ? ' rel=' . $a->getAttribute( 'rel' ) : '' ) : '' ) . ( $current ? ' current' : '' );
		}
		return $out;
	} )(),
	'pagination first'    => ( static function () use ( $url ): array {
		$doc = new DOMDocument();
		@$doc->loadHTML( (string) fetch( "$url/notes/" )['body'] );
		$x = new DOMXPath( $doc );
		return array_map( static fn ( $li ) => trim( $li->textContent ), iterator_to_array( $x->query( '//nav[@class="spacepress-pagination"]//li' ) ) );
	} )(),
	'search noindex'      => str_contains( fetch( "$url/notes/" )['body'], 'noindex' ),
	'group'               => page( fetch( "$url/about/" ) ),
	'docs index'          => page( fetch( "$url/docs/" ) ),
	'docs deep'           => page( fetch( "$url/docs/a/b/" ) ),
	'guard anonymous'     => array( fetch( "$url/account/" )['status'], str_contains( ( fetch( "$url/account/" )['headers']['location'][0] ?? '' ), 'wp-login.php' ) ),
	'guard subscriber'    => page( fetch( "$url/account/", headers: array( $cookie( 'reader' ) ) ) ),
	'broken'              => page( fetch( "$url/broken/" ) ),
	'api'                 => array( fetch( "$url/api/notes" )['status'], fetch( "$url/api/notes" )['body'] ),
	'api method'          => fetch( "$url/api/notes", 'DELETE' )['status'],
	// The page's handler guard restricts POST to subscribers, with the REST nonce as every cookie write needs.
	'page POST anonymous' => fetch( "$url/notes/hello/", 'POST', array( 'Content-Type: application/x-www-form-urlencoded' ), 'x=1' )['status'],
	'page POST'           => ( function () use ( $url, $session ): array {
		$r = fetch( "$url/notes/hello/", 'POST', array( $session( 'reader' )['cookie'], $session( 'reader' )['nonce'] ), 'x=1' );
		return array( $r['status'], $r['headers']['location'][0] ?? null );
	} )(),
	// A signed webhook: a wrong signature is refused, the right one runs as the system (it counts the draft).
	'webhook unsigned'    => fetch( "$url/webhooks/notify", 'POST', array(), 'ping' )['status'],
	'webhook bad'         => fetch( "$url/webhooks/notify", 'POST', array( 'X-Hook-Signature: ' . str_repeat( '0', 64 ) ), 'ping' )['status'],
	'webhook'             => ( function () use ( $url ): array {
		$r = fetch( "$url/webhooks/notify", 'POST', array( 'X-Hook-Signature: ' . hash_hmac( 'sha256', 'ping', 'hook-secret' ) ), 'ping' );
		return array( $r['status'], $r['body'] );
	} )(),
	'HEAD'                => array( fetch( "$url/", 'HEAD' )['status'], fetch( "$url/", 'HEAD' )['body'] ),
	// The app router must leave REST, feeds and reserved paths to WordPress.
	// Markdown twins of app pages (rendering.md §5): the page's own output, never its layout's
	// navigation, rendered as an anonymous visitor; advertised by the HTML page.
	'twin home'           => array( fetch( "$url/index.md" )['status'], fetch( "$url/index.md" )['body'], fetch( "$url/index.md" )['headers']['content-type'][0] ?? null ),
	'twin note'           => array( fetch( "$url/notes/hello.md" )['status'], fetch( "$url/notes/hello.md" )['body'] ),
	'twin note as editor' => fetch( "$url/notes/hello.md", headers: array( $cookie( 'chief' ) ) )['body'],
	'twin draft'          => fetch( "$url/notes/draft.md" )['status'],
	'twin guarded'        => fetch( "$url/account.md", headers: array( $cookie( 'reader' ) ) )['status'],
	'twin link'           => array( fetch( "$url/notes/hello/" )['headers']['link'] ?? array(), str_contains( fetch( "$url/notes/hello/" )['body'], '<link rel="alternate" type="text/markdown" href="' . $url . '/notes/hello.md"' ) ),
	'llms'                => fetch( "$url/llms.txt" )['body'],
	'rest'                => fetch( "$url/wp-json/" )['status'],
	'feed'                => fetch( "$url/feed/" )['status'],
	'reserved'            => str_contains( fetch( "$url/wp-content/nothing-here" )['body'], 'No such page' ),
	// The theme's presets as CSS variables, the owner's Global Styles and Additional CSS, the site icon.
	'styles'              => ( static function ( string $head ): array {
		return array(
			'theme preset'   => str_contains( $head, '--wp--preset--font-family--system:' ),
			'core preset'    => str_contains( $head, '--wp--preset--color--black:' ),
			// The project's sp/theme.json, over the theme's...
			'project preset' => str_contains( $head, '--wp--preset--color--code: #0000aa' ),
			// ...and the owner's Global Styles over the project's, for the slug both name.
			'global styles'  => str_contains( $head, '--wp--preset--color--brand: #123456' ) && ! str_contains( $head, '#000001' ),
			'additional css' => str_contains( $head, '.owner-css { color: #654321; }' ),
			'site icon'      => (bool) preg_match( '#<link rel="icon" href="[^"]*icon\.png"#', $head ),
		);
	} )( explode( '</head>', fetch( "$url/notes/hello/" )['body'] )[0] ),
);
// `wp spacepress styles export`, which `spacepress styles pull` writes to sp/theme.json: the project's file
// with the owner's Global Styles merged over it, settings and styles only.
$export               = \SpacePress\Wp\ThemeStyles::export();
$out['styles export'] = array( array_keys( $export ), array_map( static fn ( array $c ): string => $c['slug'] . ' ' . $c['color'], $export['settings']['color']['palette'] ?? array() ) );
echo json_encode( $out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ), "\n";
$site->destroy();
