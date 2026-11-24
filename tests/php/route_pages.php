<?php

declare(strict_types=1);

/*
 * Code-owned WordPress Pages for static sp/app/ routes (docs/spec/rendering.md §7;
 * tests/app_router.rs `static_routes_have_code_owned_pages`): the fixture tests/fixtures/app-router
 * on WordPress with php -S. Prints one JSON object of what WordPress, wp-admin, REST and the
 * router see of those Pages.
 *
 *   SP_WP_THEMES=1 php tests/php/route_pages.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite(
	'route-pages',
	array(
		'wpContent' => $argv[1],
		'users'     => array( 'chief' => 'editor' ),
		'muPlugins' => array(
			'query-warnings' => <<<'PHP'
<?php
// A theme's post loop must work with the main query supplied by the app router.
set_error_handler(static function (int $level, string $message, string $file, int $line): bool {
    if ($level === E_WARNING && str_ends_with($file, '/class-wp-query.php')) {
        throw new ErrorException($message, 0, $level, $file, $line);
    }
    return false;
});
PHP,
		),
	)
);
// A page an editor made before the app existed, at no route's address.
wp_set_current_user( 1 );
$native = wp_insert_post(
	array(
		'post_type'   => 'page',
		'post_status' => 'publish',
		'post_title'  => 'Native',
		'post_name'   => 'native',
	)
);
$site->actAs( null );
// The first request after a build stores the Pages.
\SpacePress\Wp\RoutePages::instance()->reconcile();
$codePages = \SpacePress\Wp\RoutePages::instance()->pages();
$summary   = static function () use ( &$codePages ): array {
	$out = array();
	foreach ( $codePages as $route => $id ) {
		$post          = get_post( $id );
		$out[ $route ] = array(
			'status' => $post->post_status,
			'title'  => $post->post_title,
			'link'   => get_permalink( $id ),
			'meta'   => get_post_meta( $id, '_sp_route', true ),
		);
	}
	ksort( $out );
	return $out;
};
$out       = array(
	'pages'     => $summary(),
	'front'     => array( get_option( 'show_on_front' ), (int) get_option( 'page_on_front' ) === ( $codePages['/'] ?? -1 ) ),
	'canonical' => wp_get_canonical_url( $codePages['notes'] ),
);
// wp-admin's Pages list and counts, and REST edit lists, as an editor.
$site->actAs( 'chief' );
require_once ABSPATH . 'wp-admin/includes/class-wp-screen.php';
require_once ABSPATH . 'wp-admin/includes/screen.php';
set_current_screen( 'edit-page' );
$admin                      = new WP_Query(
	array(
		'post_type'      => 'page',
		'post_status'    => 'any',
		'posts_per_page' => -1,
	)
);
$out['admin list']          = array_map( static fn ( WP_Post $p ): string => $p->post_title, $admin->posts );
$out['admin count publish'] = (int) wp_count_posts( 'page' )->publish;
$out['can edit']            = array( current_user_can( 'edit_post', $codePages['notes'] ), current_user_can( 'delete_post', $codePages['notes'] ), current_user_can( 'edit_post', $native ) );
// A write that skips capability checks keeps the stored fields.
wp_update_post(
	array(
		'ID'          => $codePages['notes'],
		'post_title'  => 'Hijacked',
		'post_status' => 'draft',
	)
);
$out['after bypass']       = array( get_post( $codePages['notes'] )->post_title, get_post( $codePages['notes'] )->post_status );
$GLOBALS['current_screen'] = null;
// REST, outside wp-admin: an edit list leaves them out, a public list has them like any page.
$request = new WP_REST_Request( 'GET', '/wp/v2/pages' );
$request->set_param( 'context', 'edit' );
$out['rest edit'] = array_map( static fn ( array $p ): string => $p['title']['raw'], rest_do_request( $request )->get_data() );
$out['rest view'] = array_map( static fn ( array $p ): string => $p['title']['rendered'], rest_do_request( new WP_REST_Request( 'GET', '/wp/v2/pages' ) )->get_data() );
$site->actAs( null );
// Menus see the Page as any other.
$menu = wp_create_nav_menu( 'Main' );
wp_update_nav_menu_item(
	$menu,
	0,
	array(
		'menu-item-object-id' => $codePages['(site)/about'],
		'menu-item-object'    => 'page',
		'menu-item-type'      => 'post_type',
		'menu-item-status'    => 'publish',
	)
);
$out['menu'] = array_map( static fn ( $i ): string => $i->url, wp_get_nav_menu_items( $menu ) );
// A second build of the same routes keeps every ID.
delete_option( 'sp_approuter_route_pages' );
\SpacePress\Wp\RoutePages::instance()->reconcile();
$out['adopted'] = \SpacePress\Wp\RoutePages::instance()->pages() === $codePages;

$site->startServer();
$url                     = $site->url();
$get                     = static function ( string $path ) use ( $url ): array {
	$ch      = curl_init( $url . $path );
	$headers = array();
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_HEADERFUNCTION => static function ( $ch, string $line ) use ( &$headers ): int {
				if ( str_contains( $line, ':' ) ) {
					[$k, $v]                             = explode( ':', $line, 2 );
					$headers[ strtolower( trim( $k ) ) ] = trim( $v );
				}
				return strlen( $line );
			},
		)
	);
	$body = (string) curl_exec( $ch );
	return array( (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE ), $headers['location'] ?? null, $body );
};
[$status, $location]     = $get( '/?page_id=' . $codePages['(site)/about'] );
$out['page_id redirect'] = array( $status, $location );
$out['slug redirect']    = array_slice( $get( '/spacepress-home/' ), 0, 2 );
$out['about']            = $get( '/about/' )[0];
$out['native']           = $get( '/native/' )[0];
$out['sitemap pages']    = substr_count( $get( '/wp-sitemap-posts-page-1.xml' )[2], '<loc>' );
$out['sitemap app']      = substr_count( $get( '/wp-sitemap-spacepress-app-pages-1.xml' )[2], '<loc>' );
// The route renders with its Page as the queried object, as the page template would.
$out['body class']      = (bool) preg_match( '/<body class="[^"]*\bpage-id-' . $codePages['(site)/about'] . '\b/', $get( '/about/' )[2] );
$out['home body class'] = (bool) preg_match( '/<body class="[^"]*\bhome\b[^"]*"/', $get( '/' )[2] );
echo json_encode( $out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT ), "\n";
$site->destroy();
