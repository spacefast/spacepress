<?php

declare(strict_types=1);

/*
 * sp/app/ pages inside the active block theme's templates (docs/pages.md "Block templates",
 * docs/decisions/2026-11-16-pages-in-block-templates.md), over HTTP with php -S:
 * tests/fixtures/block-templates, built by `spacepress build`, on SpacePress's default block theme. Prints
 * one JSON object: label => observed.
 *
 *   SP_WP_THEMES=1 php tests/php/block_templates.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$inspectPageQuery = <<<'PHP'
<?php
add_action('loop_start', static function (WP_Query $query): void {
    if ($query->is_main_query() && $query->is_page()) {
        $vars = [];
        foreach (['fields', 'cache_results', 'update_post_term_cache', 'update_post_meta_cache'] as $name) {
            $vars[$name] = $query->get($name);
        }
        header('X-Test-Page-Query: ' . wp_json_encode($vars));
    }
});
PHP;
$site             = wpSite(
	'block-templates',
	array(
		'wpContent' => $argv[1],
		'users'     => array( 'reader' => 'subscriber' ),
		'muPlugins' => array( 'inspect-page-query' => $inspectPageQuery ),
	)
);
wp_set_current_user( 1 );
update_option( 'blogdescription', 'Tagline from WordPress' );
\SpacePress\db()->insert(
	'notes',
	array(
		'title'  => 'Hello',
		'status' => 'published',
	)
);
$site->actAs( null );
$site->startServer();
$url      = $site->url();
$password = 'correct horse battery stapler';
$site->addUser( 'ana', 'subscriber', $password );

function fetch( string $url, string $method = 'GET', array $headers = array(), ?string $body = null ): array {
	$ch  = curl_init( $url );
	$out = array();
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_CUSTOMREQUEST  => $method,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 60,
			CURLOPT_HTTPHEADER     => array( ...$headers, 'Cookie: wordpress_test_cookie=WP+Cookie+check' ),
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

/** What a page shows: the theme's parts, the app's markup, the head. */
function shape( array $r ): array {
	$doc = new DOMDocument();
	@$doc->loadHTML( '<?xml encoding="utf-8"?>' . $r['body'] );
	$x     = new DOMXPath( $doc );
	$count = static fn ( string $q ): int => $x->query( $q )->length;
	$text  = static fn ( string $q ): ?string => ( $n = $x->query( $q )->item( 0 ) ) ? trim( preg_replace( '/\s+/', ' ', $n->textContent ) ) : null;
	return array(
		'status'             => $r['status'],
		'title'              => $text( '//title' ),
		'titles'             => $count( '//title' ),
		'description'        => $x->query( '//meta[@name="description"]' )->item( 0 )?->getAttribute( 'content' ),
		'canonicals'         => $count( '//link[@rel="canonical"]' ),
		// The theme's parts: SpacePress's default theme has the site title in its header and the tagline in its footer.
		'theme header'       => $count( '//header[contains(@class,"wp-block-template-part")]//*[contains(@class,"wp-block-site-title")]' ),
		'theme footer'       => $count( '//footer[contains(@class,"wp-block-template-part")]//*[contains(@class,"wp-block-site-tagline")]' ),
		'site blocks'        => $count( '//div[contains(concat(" ",@class," ")," wp-site-blocks ")]' ),
		'region'             => $count( '//*[@data-wp-router-region="sp/main"]' ),
		'region in template' => $count( '//div[contains(concat(" ",@class," ")," wp-site-blocks ")]//*[@data-wp-router-region="sp/main"]' ),
		'page'               => $text( '//*[@data-wp-router-region="sp/main"]//h1' ),
		'root layout'        => $count( '//nav[@class="app-nav"]' ),
		'global styles'      => str_contains( $r['body'], 'global-styles-inline-css' ),
		'router module'      => str_contains( $r['body'], 'sp/Render/client/router.js' ),
		'cache'              => $r['headers']['cache-control'][0] ?? null,
		'location'           => $r['headers']['location'][0] ?? null,
		'template'           => $x->query( '//body' )->item( 0 )?->getAttribute( 'data-sp-template' ),
	);
}

/** Each same-site <Link>'s path and the template its target renders in. */
function links( array $r ): array {
	preg_match_all( '#<a href="https?://[^/"]+(/[a-z/]*)" data-wp-interactive="sp/router" data-wp-on--click="actions.navigate" data-sp-template="([^"]+)"#', $r['body'], $m, PREG_SET_ORDER );
	return array_map( static fn ( array $a ): array => array( $a[1], $a[2] ), $m );
}

$admin      = array( 'Authorization: Basic ' . base64_encode( $site->appPassword( 'admin' ) ), 'Content-Type: application/json' );
$stylesheet = get_stylesheet();
$out        = array(
	'stylesheet'  => $stylesheet,
	'block theme' => wp_is_block_theme(),
);
$files      = \SpacePress\Wp\Runtime::plugin()->schema->app()['files'];
foreach ( array( 'app/bare/page.tsx', 'app/studio/layout.tsx', 'app/layout.tsx' ) as $file ) {
	$out['compiled templates'][ $file ] = $files[ $file ]['template'] ?? null;
}

// The theme's template wraps each page; the root layout's chrome isn't doubled.
$home              = fetch( "$url/" );
$out['home']       = shape( $home );
$out['home list']  = str_contains( $home['body'], '<li>Hello</li>' );
$out['home query'] = json_decode( $home['headers']['x-test-page-query'][0] ?? 'null', true );
$out['notes']      = shape( fetch( "$url/notes/" ) );
// A layout that places <TemplatePart> itself: the blank template, its own footer.
$studio        = fetch( "$url/studio/" );
$out['studio'] = shape( $studio ) + array( 'own footer' => str_contains( $studio['body'], 'Studio footer' ) );
// `template = "blank"` on a page: no theme parts, the root layout renders.
$out['bare'] = shape( fetch( "$url/bare/" ) );
// A guard sends a signed-out visitor to sign in.
$out['guard'] = shape( fetch( "$url/account/" ) );
// not-found.tsx inside the theme's 404 template.
$out['404'] = shape( fetch( "$url/no/such/page" ) );

// The Site Editor's templates (REST): SpacePress's, and the theme's 404 with not-found.tsx as its content.
$list  = json_decode( fetch( "$url/wp-json/wp/v2/templates?context=edit", headers: $admin )['body'], true );
$slugs = array();
foreach ( is_array( $list ) ? $list : array() as $t ) {
	$slugs[ $t['slug'] ] = array(
		'source'     => $t['source'],
		'page block' => str_contains( (string) ( $t['content']['raw'] ?? '' ), 'wp:sp/page' ),
	);
}
$out['templates'] = array_intersect_key( $slugs, array_flip( array( 'sp-page', 'sp-blank', 'sp-login', '404' ) ) );

// The sign-in template: login.tsx inside it, posting to wp-login.php.
$login                       = static function () use ( $url ): array {
	$r = fetch( "$url/wp-login.php" );
	$s = shape( $r );
	return $s + array(
		'app'            => str_contains( $r['body'], 'Sign in to Field Notes' ),
		'owner text'     => str_contains( $r['body'], 'Owner sign-in text' ),
		'posts to'       => preg_match( '#<form name="loginform" id="loginform"[^>]*action="([^"]+)"#', $r['body'], $m ) ? $m[1] : null,
		'wordpress page' => str_contains( $r['body'], 'login.min.css' ),
	);
};
$out['login']                = $login();
$wrong                       = fetch(
	"$url/wp-login.php",
	'POST',
	array( 'Content-Type: application/x-www-form-urlencoded' ),
	http_build_query(
		array(
			'log'        => 'ana',
			'pwd'        => 'nope',
			'testcookie' => '1',
		)
	)
);
$out['login wrong password'] = array(
	'status'       => $wrong['status'],
	'error'        => str_contains( $wrong['body'], 'class="problem"' ),
	'theme header' => shape( $wrong )['theme header'],
);

// The owner edits the sign-in template in the Site Editor (a wp_template post saved through REST).
$saved                              = fetch(
	"$url/wp-json/wp/v2/templates/$stylesheet//sp-login",
	'POST',
	$admin,
	json_encode(
		array(
			'content' =>
						"<!-- wp:paragraph --><p>Owner sign-in text</p><!-- /wp:paragraph -->\n<!-- wp:sp/page /-->",
		)
	)
);
$out['login saved']                 = $saved['status'];
$out['login edited']                = $login();
$wrong                              = fetch(
	"$url/wp-login.php",
	'POST',
	array( 'Content-Type: application/x-www-form-urlencoded' ),
	http_build_query(
		array(
			'log'        => 'ana',
			'pwd'        => 'nope',
			'testcookie' => '1',
		)
	)
);
$out['login edited wrong password'] = array(
	'status'     => $wrong['status'],
	'error'      => str_contains( $wrong['body'], 'class="problem"' ),
	'owner text' => str_contains( $wrong['body'], 'Owner sign-in text' ),
);
// Rebuilt without code: the Login form block alone, its own notices shown.
fetch(
	"$url/wp-json/wp/v2/templates/$stylesheet//sp-login",
	'POST',
	$admin,
	json_encode(
		array(
			'content' =>
						"<!-- wp:paragraph --><p>Owner sign-in text</p><!-- /wp:paragraph -->\n<!-- wp:sp/login-form {\"submitLabel\":\"Go\"} /-->",
		)
	)
);
$out['login block']                = $login() + array( 'button' => (bool) preg_match( '#<button type="submit" name="wp-submit" id="wp-submit">Go</button>#', fetch( "$url/wp-login.php" )['body'] ) );
$wrong                             = fetch(
	"$url/wp-login.php",
	'POST',
	array( 'Content-Type: application/x-www-form-urlencoded' ),
	http_build_query(
		array(
			'log'        => 'ana',
			'pwd'        => 'nope',
			'testcookie' => '1',
		)
	)
);
$out['login block wrong password'] = array(
	'status' => $wrong['status'],
	'error'  => str_contains( $wrong['body'], 'id="login_error"' ),
);
$right                             = fetch(
	"$url/wp-login.php",
	'POST',
	array( 'Content-Type: application/x-www-form-urlencoded' ),
	http_build_query(
		array(
			'log'         => 'ana',
			'pwd'         => $password,
			'testcookie'  => '1',
			'redirect_to' => "$url/account/",
		)
	)
);
$out['login block sign in']        = array(
	'status'   => $right['status'],
	'location' => $right['headers']['location'][0] ?? null,
);

// The owner edits the 404 template: their text around the app's not-found page.
fetch(
	"$url/wp-json/wp/v2/templates/$stylesheet//404",
	'POST',
	$admin,
	json_encode(
		array(
			'content' =>
						"<!-- wp:paragraph --><p>Owner 404 text</p><!-- /wp:paragraph -->\n<!-- wp:sp/page /-->",
		)
	)
);
$missing           = fetch( "$url/no/such/page" );
$out['404 edited'] = array(
	'status'     => $missing['status'],
	'owner text' => str_contains( $missing['body'], 'Owner 404 text' ),
	'page'       => shape( $missing )['page'],
);

// 1. A title with markup prints as text in WordPress's <title>.
$xss        = fetch( "$url/xss/" );
$out['xss'] = array(
	'status' => $xss['status'],
	'script' => str_contains( $xss['body'], '<script>window.pwned' ),
	'titles' => shape( $xss )['titles'],
	'title'  => shape( $xss )['title'],
);
// 4. <Link> carries its target's template; the page says its own.
$home         = fetch( "$url/" );
$out['links'] = array(
	'page'  => shape( $home )['template'],
	'links' => links( $home ),
);
// 10. A route group's layout under the chrome-less root renders; one at the top is the root.
$out['group'] = shape( fetch( "$url/cart/" ) ) + array( 'group layout' => str_contains( fetch( "$url/cart/" )['body'], 'Shop banner' ) );
// 9. <TemplatePart> attributes are block attributes, never markup: a value can't open a block.
$out['template part attrs'] = (string) \SpacePress\Wp\BlockTemplates::part( 'header', 'header', 'x --><!-- wp:site-tagline /--><!-- wp:x' )->html();
$out['template part attrs'] = array(
	'tagline' => str_contains( $out['template part attrs'], 'wp-block-site-tagline' ),
	'header'  => str_contains( $out['template part attrs'], 'wp-block-site-title' ),
);
// 3. A Login form block in a public template with a plugin's per-request field: never shared.
file_put_contents( $site->dir . '/content/mu-plugins/login-field.php', "<?php add_action('login_form', static function (): void { echo '<input type=\"hidden\" name=\"challenge\" value=\"' . bin2hex(random_bytes(4)) . '\">'; });" );
fetch(
	"$url/wp-json/wp/v2/templates/$stylesheet//sp-page",
	'POST',
	$admin,
	json_encode(
		array(
			'content' =>
						"<!-- wp:template-part {\"slug\":\"header\",\"tagName\":\"header\"} /-->\n<!-- wp:sp/page /-->\n<!-- wp:sp/login-form /-->",
		)
	)
);
$withForm                 = fetch( "$url/notes/" );
$out['public login form'] = array(
	'status' => $withForm['status'],
	'form'   => str_contains( $withForm['body'], 'name="challenge"' ),
	'cache'  => $withForm['headers']['cache-control'][0] ?? null,
);
unlink( $site->dir . '/content/mu-plugins/login-field.php' );
// 7. A trashed custom template doesn't render: the registered one answers again.
$saved = json_decode( fetch( "$url/wp-json/wp/v2/templates/$stylesheet//sp-page?context=edit", headers: $admin )['body'], true );
wp_trash_post( (int) ( $saved['wp_id'] ?? 0 ) );
$trashed                 = fetch( "$url/notes/" );
$out['trashed template'] = array(
	'login form'   => str_contains( $trashed['body'], 'id="loginform"' ),
	'theme header' => shape( $trashed )['theme header'],
	'page'         => shape( $trashed )['page'],
);
// 8. A template whose page block lives in a template part still places the page; one with none
// falls back to sp-page, never a blank 200.
// The failed render's own block styles (a styled group's) don't reach the fallback page, and the
// head's tags print once.
$noPage = '<!-- wp:paragraph --><p>No page here</p><!-- /wp:paragraph -->';
fetch( "$url/wp-json/wp/v2/templates/$stylesheet//sp-blank", 'POST', $admin, json_encode( array( 'content' => $noPage ) ) );
$bare                         = fetch( "$url/bare/" );
$out['template without page'] = array(
	'status'       => $bare['status'],
	'page'         => shape( $bare )['page'],
	'owner text'   => str_contains( $bare['body'], 'No page here' ),
	'theme header' => shape( $bare )['theme header'],
);
// A template that places the page block, whose render a plugin then drops (a filter on
// render_block): the page renders in sp-page, without the scripts the dropped render's blocks
// enqueued, and its head tags print once. When sp-page loses it too, SpacePress's own document.
$placed = "<!-- wp:paragraph --><p>Dropped render</p><!-- /wp:paragraph -->\n<!-- wp:search {\"buttonPosition\":\"button-only\"} /-->\n<!-- wp:sp/page /-->";
fetch( "$url/wp-json/wp/v2/templates/$stylesheet//sp-blank", 'POST', $admin, json_encode( array( 'content' => $placed ) ) );
file_put_contents( $site->dir . '/content/mu-plugins/drop-page.php', "<?php add_filter('render_block_sp/page', static fn (string \$html): string => isset(\$_GET['drop']) && (\$_GET['drop'] === 'all' || !str_contains((string) (\$GLOBALS['_wp_current_template_id'] ?? ''), 'sp-page')) ? '' : \$html);" );
$dropped                            = fetch( "$url/bare/?drop=blank" );
$out['page render dropped']         = array(
	'status'       => $dropped['status'],
	'page'         => shape( $dropped )['page'],
	'template'     => shape( $dropped )['template'],
	'dropped text' => str_contains( $dropped['body'], 'Dropped render' ),
	'descriptions' => substr_count( $dropped['body'], '<meta name="description"' ),
	'scripts'      => str_contains( $dropped['body'], 'block-library/search/view' ),
);
$plain                              = fetch( "$url/bare/?drop=all" );
$out['no template places the page'] = array(
	'status'       => $plain['status'],
	'page'         => shape( $plain )['page'],
	'template'     => shape( $plain )['template'],
	'titles'       => substr_count( $plain['body'], '<title>' ),
	'descriptions' => substr_count( $plain['body'], '<meta name="description"' ),
	'scripts'      => str_contains( $plain['body'], 'block-library/search/view' ),
);
unlink( $site->dir . '/content/mu-plugins/drop-page.php' );
fetch( "$url/wp-json/wp/v2/templates/$stylesheet//sp-blank", 'POST', $admin, json_encode( array( 'content' => $noPage ) ) );
// B. A wp_navigation post created while a page renders (core's lazy fallback menu): no purge.
file_put_contents( $site->dir . '/content/mu-plugins/purge-log.php', "<?php add_action('sp_purge_urls', static function (array \$paths): void { file_put_contents(WP_CONTENT_DIR . '/purges.log', json_encode(\$paths) . \"\\n\", FILE_APPEND); });" );
file_put_contents( $site->dir . '/content/mu-plugins/render-nav.php', "<?php add_action('wp_head', static function (): void { if (isset(\$_GET['make-nav'])) { wp_insert_post(['post_type' => 'wp_navigation', 'post_status' => 'publish', 'post_title' => 'Fallback', 'post_content' => '']); } });" );
fetch( "$url/notes/?make-nav=1" );
$out['render purge'] = array_values( array_filter( explode( "\n", (string) @file_get_contents( $site->dir . '/content/purges.log' ) ) ) );
unlink( $site->dir . '/content/mu-plugins/render-nav.php' );
@unlink( $site->dir . '/content/purges.log' );
// 6. A Site Editor save announces a whole-site purge and forgets the prebuilt pages.
file_put_contents( $site->dir . '/content/mu-plugins/purge-log.php', "<?php add_action('sp_purge_urls', static function (array \$paths): void { file_put_contents(WP_CONTENT_DIR . '/purges.log', json_encode(\$paths) . \"\\n\", FILE_APPEND); });" );
fetch( "$url/wp-json/wp/v2/templates/$stylesheet//sp-blank", 'POST', $admin, json_encode( array( 'content' => '<!-- wp:sp/page /-->' ) ) );
$out['design purge'] = array_values( array_filter( explode( "\n", (string) @file_get_contents( $site->dir . '/content/purges.log' ) ) ) );
unlink( $site->dir . '/content/mu-plugins/purge-log.php' );

// 2. The sign-in template the owner saved with the Page content block, after login.tsx is gone:
// wp-login.php still shows a form (the default content, the Login form block).
fetch(
	"$url/wp-json/wp/v2/templates/$stylesheet//sp-login",
	'POST',
	$admin,
	json_encode(
		array(
			'content' =>
						"<!-- wp:paragraph --><p>Owner sign-in text</p><!-- /wp:paragraph -->\n<!-- wp:sp/page /-->",
		)
	)
);
if ( isset( $argv[2] ) ) {
	$site->stopServer();
	$app = glob( $site->dir . '/content/plugins/spacepress-app-*' )[0];
	exec( 'rm -rf ' . escapeshellarg( $app ) );
	wpCopy( $argv[2] . '/plugins/' . basename( $app ), $app );
	$site->startServer();
	$url                            = $site->url();
	$r                              = fetch( "$url/wp-login.php" );
	$out['login without login.tsx'] = array(
		'status'         => $r['status'],
		'form'           => str_contains( $r['body'], 'id="loginform"' ),
		'app'            => str_contains( $r['body'], 'Sign in to Field Notes' ),
		'wordpress page' => str_contains( $r['body'], 'login.min.css' ),
	);
}

// The slot can be nested in a theme part. Stop consulting parts as soon as one contains it.
$lookups  = array();
$contents = array(
	'slot-test' => '<!-- wp:template-part {"slug":"outer"} /--><!-- wp:template-part {"slug":"unused"} /-->',
	'outer'     => '<!-- wp:template-part {"slug":"inner"} /-->',
	'inner'     => '<!-- wp:sp/page /-->',
	'unused'    => '<!-- wp:paragraph /-->',
);
$fixture  = static function ( $found, $id, $type ) use ( $contents, &$lookups ) {
	$slug = explode( '//', $id, 2 )[1] ?? '';
	if ( ! isset( $contents[ $slug ] ) || $type !== ( 'slot-test' === $slug ? 'wp_template' : 'wp_template_part' ) ) {
		return $found;
	}
	$lookups[]         = $slug;
	$template          = new WP_Block_Template();
	$template->slug    = $slug;
	$template->content = $contents[ $slug ];
	return $template;
};
add_filter( 'pre_get_block_template', $fixture, 10, 3 );
try {
	$resolved = \SpacePress\Wp\BlockTemplates::resolve( 'slot-test' );
	if ( 'slot-test' !== $resolved?->slug || $lookups !== array( 'slot-test', 'outer', 'inner' ) ) {
		throw new RuntimeException( 'Expected the nested page slot to satisfy the template' );
	}
} finally {
	remove_filter( 'pre_get_block_template', $fixture );
}

echo json_encode( $out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ), "\n";
$site->destroy();
