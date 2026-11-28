<?php

declare(strict_types=1);

/*
 * A docs section as a hierarchical kind, on WordPress over HTTP (tests/app_router.rs
 * `docs_kind_*`): the fixture tests/fixtures/docs-kind as built, seeded from the records a hosted
 * compile wrote for its content/docs/ folder tree, and served by php -S. Prints one JSON object.
 *
 *   SP_WP_THEMES=1 php tests/php/docs_kind.php <wp-content dir> <seed records dir>
 */

require __DIR__ . '/wp.php';

// Test-only must-use plugin: what WordPress's main query says a page is. `X-Test-Resolved` is what
// WordPress resolved the URL to, before SpacePress's router runs; the HTML comment is what a plugin is
// told while the page renders (an SEO or breadcrumb plugin, in the footer).
$site        = wpSite(
	'docs-kind',
	array(
		'wpContent' => $argv[1],
		'users'     => array( 'chief' => 'editor' ),
		'muPlugins' => array(
			'query' => <<<'PHP'
<?php
function sp_test_query(): string
{
    $object = get_queried_object();
    return (string) wp_json_encode([
        'id' => get_queried_object_id(),
        'type' => $object instanceof WP_Post ? $object->post_type : null,
        'is_404' => is_404(),
        'is_singular' => is_singular(),
    ]);
}
add_action('template_redirect', static fn () => header('X-Test-Resolved: ' . sp_test_query()), PHP_INT_MIN);
add_action('wp_footer', static function (): void {
    echo '<!-- wp-query ' . sp_test_query() . ' -->';
});
PHP,
		),
	)
);
$out         = array();
$out['seed'] = \SpacePress\Sync\Seed::run( \SpacePress\Wp\Runtime::plugin(), $argv[2] );
$site->startServer();
$url = $site->url();

function fetch( string $url, array $headers = array() ): array {
	$ch  = curl_init( $url );
	$out = array();
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 60,
			CURLOPT_HTTPHEADER     => $headers,
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

/** What a docs page shows: its heading, tree, table of contents, pager and title. */
function doc( array $r ): array {
	$html = new DOMDocument();
	$html->loadHTML( '<?xml encoding="utf-8"?>' . $r['body'], LIBXML_NOERROR | LIBXML_NOWARNING );
	$x     = new DOMXPath( $html );
	$texts = static fn ( string $q ): array => array_map( static fn ( DOMNode $n ): string => trim( $n->textContent ), iterator_to_array( $x->query( $q ) ) );
	$tree  = static function ( DOMNode $ul ) use ( &$tree, $x ): array {
		$out = array();
		foreach ( $x->query( './li', $ul ) as $li ) {
			$a     = $x->query( './a', $li )->item( 0 );
			$mark  = $li->getAttribute( 'class' );
			$item  = array( trim( (string) $a?->textContent ) . ( '' !== $mark ? " [$mark]" : '' ) => parse_url( (string) $a?->getAttribute( 'href' ), PHP_URL_PATH ) );
			$below = $x->query( './ul', $li )->item( 0 );
			if ( null !== $below ) {
				$item['children'] = $tree( $below );
			}
			$out[] = $item;
		}
		return $out;
	};
	$root  = $x->query( '//nav[@class="tree"]/ul' )->item( 0 );
	preg_match( '#<title>(.*?)</title>#s', $r['body'], $t );
	return array(
		'status'  => $r['status'],
		'title'   => html_entity_decode( $t[1] ?? '', ENT_QUOTES ),
		'h1'      => $texts( '//article/h1' ),
		'tree'    => null === $root ? null : $tree( $root ),
		'toc'     => array_map( static fn ( DOMNode $a ): string => $a->getAttribute( 'href' ) . ' ' . trim( $a->textContent ) . ' ' . $a->parentNode->getAttribute( 'class' ), iterator_to_array( $x->query( '//aside[@class="toc"]//a' ) ) ),
		'anchors' => array_map( static fn ( DOMNode $h ): string => $h->nodeName . '#' . $h->getAttribute( 'id' ), iterator_to_array( $x->query( '//article//*[self::h2 or self::h3]' ) ) ),
		'prev'    => array_map( static fn ( DOMNode $a ): string => trim( $a->textContent ) . ' ' . parse_url( $a->getAttribute( 'href' ), PHP_URL_PATH ), iterator_to_array( $x->query( '//footer//a[@rel="prev"]' ) ) ),
		'next'    => array_map( static fn ( DOMNode $a ): string => trim( $a->textContent ) . ' ' . parse_url( $a->getAttribute( 'href' ), PHP_URL_PATH ), iterator_to_array( $x->query( '//footer//a[@rel="next"]' ) ) ),
		'cache'   => $r['headers']['cache-control'][0] ?? null,
	);
}

/** What WordPress itself says a response is: its main query, the body's classes, the headers a 404 gets. */
function wordpress( array $r ): array {
	preg_match( '#<!-- wp-query (.*?) -->#', $r['body'], $query );
	preg_match( '#<body class="([^"]*)"#', $r['body'], $body );
	return array(
		'status'   => $r['status'],
		'query'    => isset( $query[1] ) ? json_decode( $query[1], true ) : null,
		'resolved' => isset( $r['headers']['x-test-resolved'][0] ) ? json_decode( $r['headers']['x-test-resolved'][0], true ) : null,
		// The theme's own class (`wp-theme-…`) follows the WordPress version's default theme.
		'body'     => array_values( array_filter( explode( ' ', $body[1] ?? '' ), static fn ( string $c ): bool => ! str_starts_with( $c, 'wp-theme-' ) ) ),
		'expires'  => $r['headers']['expires'][0] ?? null,
		'cache'    => $r['headers']['cache-control'][0] ?? null,
		'location' => $r['headers']['location'][0] ?? null,
	);
}

$cookie = static function ( string $user ) use ( $site ): string {
	$id = $site->userId( $user );
	return 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode( wp_generate_auth_cookie( $id, time() + 3600, 'logged_in' ) );
};

// The rows as WordPress stores them: a Page-like tree in post_parent and menu_order.
global $wpdb;
$type = \SpacePress\Wp\Runtime::plugin()->schema->collection( 'docs' )['wp']['postType'];
$rows = $wpdb->get_results( $wpdb->prepare( "SELECT ID, post_name, post_parent, menu_order, post_status FROM {$wpdb->posts} WHERE post_type = %s AND post_status NOT IN ('auto-draft', 'inherit') ORDER BY post_name", $type ), ARRAY_A );
$byId = array_column( $rows, 'post_name', 'ID' );
foreach ( $rows as $row ) {
	$out['stored'][ $row['post_name'] ] = array( ( $byId[ $row['post_parent'] ] ?? null ), (int) $row['menu_order'], $row['post_status'] );
}
$out['type hierarchical'] = is_post_type_hierarchical( $type );

// A site built before the rule for `:path` was SpacePress's own: its stored rule hands the path to core's
// `pagename`, and the recorded fingerprint is the patterns alone.
$docRule = static fn (): string => (string) ( maybe_unserialize( $wpdb->get_var( "SELECT option_value FROM {$wpdb->options} WHERE option_name = 'rewrite_rules'" ) )['^docs/(.+?)/?$'] ?? '' );
$stale   = static function (): void {
	update_option( 'rewrite_rules', array_map( static fn ( string $query ): string => str_replace( 'sp_kind_path=', 'pagename=', $query ), (array) get_option( 'rewrite_rules' ) ) );
	update_option( 'sp_kind_urls', md5( (string) json_encode( array( '/docs/:path' ) ) ), true );
};
$fresh   = static function (): void {
	foreach ( array( 'sp_kind_urls', 'rewrite_rules', 'alloptions', 'notoptions' ) as $key ) {
		wp_cache_delete( $key, 'options' );
	}
};
$doc     = static fn ( string $path ): int => (int) get_page_by_path( $path, OBJECT, $type )?->ID;
// A managed build never flushes on a request: its deploy asks whether the stored rules are behind
// (Runtime::rewritesBehind reads KindUrls::recorded) and rebuilds them once (Runtime::installRewrites).
$stale();
$out['stale site']['deploy'] = array(
	'rule before'     => $docRule(),
	'recorded before' => \SpacePress\Wp\KindUrls::recorded(),
	'rebuilt'         => \SpacePress\Wp\Runtime::installRewrites()['rules'],
);
$fresh();
$out['stale site']['deploy'] += array(
	'rule after'     => $docRule(),
	'recorded after' => \SpacePress\Wp\KindUrls::recorded(),
);
// A plugin-installed site rebuilds on the first request, which is already answered from the new rule.
$stale();
$out['stale site']['request'] = array(
	'rule before'   => $docRule(),
	'first request' => wordpress( fetch( "$url/docs/guides/install/" ) ) + array( 'expected id' => $doc( 'guides/install' ) ),
);
$fresh();
$out['stale site']['request'] += array(
	'rule after'     => $docRule(),
	'recorded after' => \SpacePress\Wp\KindUrls::recorded(),
);

// What the rest of WordPress sees at a doc's URL: the doc, as a singular item of its post type, nested
// or at the top; a path with no item is the app's 404, and WordPress's too.
foreach ( array(
	'install'      => 'guides/install',
	'introduction' => 'introduction',
	'space'        => 'guides/deploy/space',
) as $key => $path ) {
	$out['wordpress'][ $key ] = wordpress( fetch( "$url/docs/$path/" ) ) + array( 'expected id' => $doc( $path ) );
}
$out['wordpress']['missing'] = wordpress( fetch( "$url/docs/no-such-doc/" ) );
// The page's own `?page=2` (core's `<!--nextpage-->` var): still the doc to WordPress.
$out['wordpress']['paged'] = wordpress( fetch( "$url/docs/guides/install/?page=2" ) ) + array( 'expected id' => $doc( 'guides/install' ) );
$out['wordpress']['type']  = $type;
// One address per page (#462): the bare spelling 301s to the one the permalink structure gives,
// with its query string; that address, a `.md` twin, an API route and WordPress's own paths don't move.
$moved            = static function ( string $path ) use ( $url ): array {
	$r = fetch( "$url$path" );
	return array( $r['status'], ( $r['headers']['location'][0] ?? null ) === null ? null : str_replace( $url, '', $r['headers']['location'][0] ) );
};
$out['spellings'] = array(
	'bare'            => $moved( '/docs/introduction' ),
	'bare nested'     => $moved( '/docs/guides/deploy/space' ),
	'bare with query' => $moved( '/docs/introduction?ref=nav&page=2' ),
	'bare section'    => $moved( '/docs' ),
	'canonical'       => $moved( '/docs/introduction/' ),
	'twin'            => $moved( '/docs/introduction.md' ),
	'api'             => $moved( '/wp-json/spacepress/v1/docs' ),
	'api slash'       => $moved( '/wp-json/spacepress/v1/docs/' ),
	'rest'            => $moved( '/wp-json/' ),
	'sitemap'         => $moved( '/wp-sitemap.xml' ),
	'missing'         => $moved( '/docs/no-such-doc' ),
);
// Another case of a path is the same item: one URL per item, so it redirects to the item's own.
$out['wordpress']['case']             = array_intersect_key(
	wordpress( fetch( "$url/docs/Guides/Install" ) ),
	array(
		'status'   => 1,
		'location' => 1,
	)
);
$out['wordpress']['case']['location'] = parse_url( (string) $out['wordpress']['case']['location'], PHP_URL_PATH );
// WordPress's sitemap lists the published items at the kind's URLs (sorted here: core lists by id).
preg_match_all( '#<loc>([^<]+)</loc>#', fetch( "$url/wp-sitemap.xml" )['body'], $index );
preg_match_all( '#<loc>([^<]+)</loc>#', fetch( "$url/wp-sitemap-spacepress-docs-1.xml" )['body'], $locs );
$paths = array_map( static fn ( string $u ): ?string => parse_url( $u, PHP_URL_PATH ), $locs[1] );
sort( $paths );
$out['sitemap'] = array( array_map( static fn ( string $u ): ?string => parse_url( $u, PHP_URL_PATH ), $index[1] ), $paths );

$out['introduction'] = doc( fetch( "$url/docs/introduction/" ) );
$out['install']      = doc( fetch( "$url/docs/guides/install/" ) );
$out['space']        = doc( fetch( "$url/docs/guides/deploy/space/" ) );
$out['reference']    = doc( fetch( "$url/docs/reference/" ) );
$out['guides']       = doc( fetch( "$url/docs/guides/" ) );
// A draft is a 404 for visitors, and is in no visitor's tree or pager, an editor's included.
$out['roadmap']           = fetch( "$url/docs/guides/roadmap/" )['status'];
$out['roadmap as editor'] = doc( fetch( "$url/docs/guides/roadmap/", array( $cookie( 'chief' ) ) ) );
$out['install as editor'] = doc( fetch( "$url/docs/guides/install/", array( $cookie( 'chief' ) ) ) );
// A path that isn't the item's own: the wrong parent, a missing page, the slug alone.
$out['wrong parent'] = fetch( "$url/docs/reference/install/" )['status'];
$out['missing']      = fetch( "$url/docs/guides/nothing/" )['status'];
// The optional catch-all's empty match: no item, so not this page (the landing page is an app page).
$out['landing']    = fetch( "$url/docs/" )['status'];
$out['slug alone'] = array( fetch( "$url/docs/install/" )['status'], fetch( "$url/docs/install/" )['headers']['location'][0] ?? null );
// Its Markdown twin.
$out['twin']       = array( fetch( "$url/docs/guides/install.md" )['status'], fetch( "$url/docs/guides/install.md" )['body'] );
$out['twin draft'] = fetch( "$url/docs/guides/roadmap.md" )['status'];
// WordPress's own address for an item is the kind's URL.
$space            = (int) $wpdb->get_var( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = 'space'", $type ) );
$out['permalink'] = parse_url( (string) get_permalink( $space ), PHP_URL_PATH );

// An editor moves a page in wp-admin: parent and order are the post's own, so the tree follows.
wp_set_current_user( $site->userId( 'chief' ) );
$reference = (int) $wpdb->get_var( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = 'reference'", $type ) );
$guides    = (int) $wpdb->get_var( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = 'guides'", $type ) );
fetch( "$url/docs/reference" ); // the alternate spelling returns a redirect
fetch( "$url/docs/reference/" );
fetch( "$url/docs/reference.md" );
$purges = array();
add_action(
	'sp_purge_urls',
	static function ( array $paths ) use ( &$purges ): void {
		array_push( $purges, ...$paths );
	}
);
\SpacePress\Wp\Purges::flush();
$purges = array();
$db     = \SpacePress\db();
try {
	$db->transaction(
		static function () use ( $reference, $guides ): void {
			\SpacePress\Wp\Functions::tracked(
				static fn () => wp_update_post(
					array(
						'ID'          => $reference,
						'post_parent' => $guides,
					)
				)
			);
			throw new \RuntimeException( 'rollback' );
		}
	);
} catch ( \RuntimeException ) {
}
$prior                  = fetch( "$url/docs/reference/" );
$out['parent rollback'] = array(
	'purges'     => $purges,
	'status'     => $prior['status'],
	'reference'  => str_contains( $prior['body'], 'Reference' ),
	'new status' => fetch( "$url/docs/guides/reference/" )['status'],
);
wp_update_post(
	array(
		'ID'          => $reference,
		'post_parent' => $guides,
		'menu_order'  => 0,
	)
);
\SpacePress\Wp\Purges::flush();
$out['parent purge'] = array_values(
	array_intersect(
		array( '/docs/reference/', '/docs/reference.md', '/docs/guides/reference/', '/docs/guides/reference.md' ),
		$purges
	)
);
wp_set_current_user( 0 );
$out['moved']     = doc( fetch( "$url/docs/guides/reference/" ) );
$out['moved old'] = array( fetch( "$url/docs/reference/" )['status'] );
// A published page under a draft: unreachable like its parent, so not served at a path that names the draft.
$roadmap = (int) $wpdb->get_var( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = 'roadmap'", $type ) );
wp_set_current_user( $site->userId( 'chief' ) );
$under = wp_insert_post(
	array(
		'post_type'   => $type,
		'post_status' => 'publish',
		'post_title'  => 'Later',
		'post_name'   => 'later',
		'post_parent' => $roadmap,
	)
);
wp_set_current_user( 0 );
$out['under a draft'] = array( fetch( "$url/docs/guides/roadmap/later/" )['status'], fetch( "$url/docs/guides/roadmap/later.md" )['status'] );
// Nor does any other address of it redirect there: its bare spelling, another case, or `?name=`
// with the wrong path (KindUrls::oldSlug). A redirect would tell the visitor it exists.
$out['under a draft moved'] = array(
	fetch( "$url/docs/guides/roadmap/later" )['status'],
	fetch( "$url/docs/Guides/Roadmap/Later" )['status'],
	fetch( "$url/docs/later?name=later" )['status'],
);
// WordPress doesn't resolve it either, so a theme or plugin that renders what WordPress resolved shows nothing.
$out['under a draft resolved'] = wordpress( fetch( "$url/docs/guides/roadmap/later/" ) )['resolved'];
wp_delete_post( $under, true );
// A WordPress Page with a doc's slug: the doc's URL is still the doc, not a redirect loop.
$page                        = wp_insert_post(
	array(
		'post_type'   => 'page',
		'post_status' => 'publish',
		'post_title'  => 'Introduction',
		'post_name'   => 'introduction',
	)
);
$out['page with a doc slug'] = array( fetch( "$url/docs/introduction/" )['status'], doc( fetch( "$url/docs/introduction/" ) )['h1'] );
// Nor do Pages at a nested doc's whole path (`guides/install`): WordPress's queried object is the doc.
$above                      = wp_insert_post(
	array(
		'post_type'   => 'page',
		'post_status' => 'publish',
		'post_title'  => 'Guides page',
		'post_name'   => 'guides',
	)
);
$below                      = wp_insert_post(
	array(
		'post_type'   => 'page',
		'post_status' => 'publish',
		'post_title'  => 'Install page',
		'post_name'   => 'install',
		'post_parent' => $above,
	)
);
$out['pages at a doc path'] = array(
	'top'             => wordpress( fetch( "$url/docs/introduction/" ) ) + array( 'expected id' => $doc( 'introduction' ) ),
	'nested'          => wordpress( fetch( "$url/docs/guides/install/" ) ) + array(
		'expected id' => $doc( 'guides/install' ),
		'h1'          => doc( fetch( "$url/docs/guides/install/" ) )['h1'],
	),
	// The Pages keep their own addresses.
	'the page itself' => array( fetch( "$url/guides/install/" )['status'], str_contains( fetch( "$url/guides/install/" )['body'], 'Install page' ) ),
);
wp_delete_post( $below, true );
wp_delete_post( $above, true );
wp_delete_post( $page, true );
// A published page with a slug a sibling elsewhere has: both are served, each at its own path.
wp_set_current_user( $site->userId( 'chief' ) );
$twin = wp_insert_post(
	array(
		'post_type'   => $type,
		'post_status' => 'publish',
		'post_title'  => 'Install again',
		'post_name'   => 'install',
		'post_parent' => $reference,
	)
);
wp_set_current_user( 0 );
$out['same slug elsewhere'] = array(
	doc( fetch( "$url/docs/guides/reference/install/" ) )['h1'],
	doc( fetch( "$url/docs/guides/install/" ) )['h1'],
);
// Headings beside a block whose markup changes per render (a gallery's per-request ids): the
// table of contents and the page's anchors still agree.
$intro = (int) $wpdb->get_var( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = 'introduction'", $type ) );
$wpdb->update( $wpdb->posts, array( 'post_content' => get_post_field( 'post_content', $intro ) . "\n\n<!-- wp:gallery {\"linkTo\":\"none\"} -->\n<figure class=\"wp-block-gallery has-nested-images columns-default is-cropped\"></figure>\n<!-- /wp:gallery -->" ), array( 'ID' => $intro ) );
clean_post_cache( $intro );
$gallery                          = doc( fetch( "$url/docs/introduction/" ) );
$out['headings beside a gallery'] = array( $gallery['toc'], $gallery['anchors'] );

// Heading ids follow GitHub's rule: each case's id as github-slugger gives it. Prints the ones that differ.
$ids                     = json_decode( (string) file_get_contents( dirname( __DIR__ ) . '/fixtures/docs-kind/heading-ids.json' ), true, flags: JSON_THROW_ON_ERROR );
$out['heading ids']      = array_values( array_filter( array_map( static fn ( array $c ): ?array => \SpacePress\Content\Nav::slug( $c[0] ) === $c[1] ? null : array( $c[0], $c[1], \SpacePress\Content\Nav::slug( $c[0] ) ), $ids['cases'] ) ) );
$out['heading id cases'] = count( $ids['cases'] );
// A heading with its own id keeps it, and no generated id repeats it; the rest number around it.
$own            = ( "<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">Why</h2>\n<!-- /wp:heading -->\n<!-- wp:heading -->\n<h2 class=\"wp-block-heading\" id=\"why\">Mine</h2>\n<!-- /wp:heading -->\n<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">Why</h2>\n<!-- /wp:heading -->" );
$out['own ids'] = array_map( static fn ( \SpacePress\JsObject $h ): string => $h->p['id'], \SpacePress\Content\Nav::headings( array( 'content' => $own ), 'content' )->a );
// The query API reads the same tree.
$out['api'] = array_map(
	static fn ( array $r ): array => array( $r['slug'], null === $r['parent'] ? null : $byId[ $r['parent'] ] ?? $r['parent'], $r['order'] ),
	\SpacePress\Seam::toPhp(
		\SpacePress\Seam::kindList(
			'docs',
			array(
				'orderBy' => array( 'order' => 'asc' ),
				'where'   => array( 'parent' => null ),
			),
			true
		)
	)
);

// Components in Markdown: the file's tags are the app's blocks, stored as blocks, rendered through
// the components on the route, and written back as the same tags.
$installPost              = (int) $wpdb->get_var( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = 'install'", $type ) );
$stored                   = (string) get_post_field( 'post_content', $installPost );
$out['blocks stored']     = array_values( array_map( static fn ( array $b ): array => array( $b['blockName'], $b['attrs'], array_map( static fn ( array $i ): ?string => $i['blockName'], $b['innerBlocks'] ) ), array_filter( parse_blocks( $stored ), static fn ( array $b ): bool => null !== $b['blockName'] ) ) );
$out['blocks registered'] = array_values( array_filter( array_keys( WP_Block_Type_Registry::get_instance()->get_all_registered() ), static fn ( string $n ): bool => str_starts_with( $n, 'docskind/' ) ) );
$page                     = fetch( "$url/docs/guides/install/" );
preg_match( '#<aside class="callout callout-warning".*?</aside>#s', $page['body'], $callout );
preg_match( '#<span class="badge">.*?</span>#s', $page['body'], $badge );
$out['blocks rendered'] = array( $page['status'], preg_replace( '/\s+/', ' ', $callout[0] ?? '' ), $badge[0] ?? null );
$out['blocks back']     = \SpacePress\Sync\Markdown::fromBlocks( $stored );
$out['blocks twin']     = fetch( "$url/docs/guides/install.md" )['body'];
// An editor changes a prop in the block editor: the file's tag follows.
$changed                   = str_replace( '{"type":"warning","title":"Before you start"}', '{"type":"note","title":"Before you start"}', $stored );
$out['blocks edited back'] = \SpacePress\Sync\Markdown::fromBlocks( $changed );
// The editor stores a cleared text field or choice as "": written back, the prop isn't there.
$out['blocks cleared back'] = \SpacePress\Sync\Markdown::fromBlocks( '<!-- wp:docskind/status {"label":"","kind":""} /-->' . "\n\n" . '<!-- wp:docskind/badge {"label":"x","count":3} /-->' );
// What a Markdown file can't say about a block is refused with the reason, never stored half.
foreach ( array(
	'unknown tag'  => "<Tabs>\nx\n</Tabs>\n",
	'unknown prop' => "<Callout type=\"note\" colour=\"red\">\nx\n</Callout>\n",
	'enum'         => "<Callout type=\"danger\">\nx\n</Callout>\n",
	'required'     => "<Callout>\nx\n</Callout>\n",
	'number'       => "<Badge label=\"x\" count=\"three\" />\n",
	'unclosed'     => "<Callout type=\"note\">\nx\n",
) as $case => $markdown ) {
	try {
		\SpacePress\Sync\Markdown::toBlocks( $markdown );
		$out['blocks refused'][ $case ] = null;
	} catch ( \SpacePress\HttpError $e ) {
		$out['blocks refused'][ $case ] = $e->getMessage();
	}
}
// A tag inside a code fence is code, not a block.
$out['blocks fenced'] = \SpacePress\Sync\Markdown::toBlocks( "```md\n<Callout type=\"note\">\n```\n" );
// Inside a block too: a fenced tag with an expression prop, or a fenced closing tag, is code.
foreach ( array(
	// A fence line with an info string never closes a fence; the fenced </Callout> stays code.
	'info string' => "<Callout type=\"note\">\n```md\n```tsx\n</Callout>\n```\n</Callout>\n",
	// A backtick in a ``` info string makes the line text, not a fence.
	'not a fence' => "<Callout type=\"note\">\n``` a`b\n</Callout>\n",
	// Indented four spaces, a tag is code in a list item, not a component.
	'indented' => "<Callout type=\"note\">\n1. Run:\n\n    <Shell search={entries()}>\n</Callout>\n",
	'unclosed fence' => "<Callout type=\"note\">\n```\ncode\n</Callout>\n",
) as $case => $markdown ) {
	try {
		$stored = \SpacePress\Sync\Markdown::toBlocks( $markdown );
		$out['blocks fence cases'][ $case ] = array(
			substr_count( $stored, '<!-- wp:docskind/callout' ),
			substr_count( $stored, '<!-- /wp:docskind/callout -->' ),
			str_contains( $stored, '&lt;/Callout&gt;' ),
		);
	} catch ( \SpacePress\HttpError $e ) {
		$out['blocks fence cases'][ $case ] = $e->getMessage();
	}
}
$out['blocks fenced inside'] = \SpacePress\Sync\Markdown::toBlocks("<Callout type=\"note\">\n```tsx\n<Shell search={entries()}>\n</Callout>\n```\n</Callout>\n\nAfter.\n");

// Code blocks (docs/decisions/2026-11-13-code-blocks.md): highlighted on the route, with titles,
// marked lines and a tab group, no script; written back as the same fences.
$setup = fetch( "$url/docs/guides/setup/" );
$html  = new DOMDocument();
$html->loadHTML( '<?xml encoding="utf-8"?>' . $setup['body'], LIBXML_NOERROR | LIBXML_NOWARNING );
$x                = new DOMXPath( $html );
$text             = static fn ( ?DOMNode $n ): ?string => null === $n ? null : trim( $n->textContent );
$out['code']      = array(
	'status'      => $setup['status'],
	'titles'      => array_map( $text, iterator_to_array( $x->query( '//figcaption[@class="spacepress-code-title"]' ) ) ),
	'keywords'    => array_map( $text, iterator_to_array( $x->query( '//pre[contains(@class, "language-ts")]//span[@class="hljs-keyword"]' ) ) ),
	'marked'      => array_map( $text, iterator_to_array( $x->query( '//span[contains(@class, "spacepress-code-marked")]' ) ) ),
	'tabs'        => array_map( $text, iterator_to_array( $x->query( '//div[@class="spacepress-code-group"]/label' ) ) ),
	'tab inputs'  => $x->query( '//div[@class="spacepress-code-group"]/input[@type="radio"]' )->length,
	'panels'      => array_map( static fn ( DOMNode $n ): string => trim( $n->textContent ), iterator_to_array( $x->query( '//div[@class="spacepress-code-group"]/figure' ) ) ),
	'plain'       => $text( $x->query( '//pre[contains(@class, "language-text")]' )->item( 0 ) ),
	'plain spans' => $x->query( '//pre[contains(@class, "language-text")]//span[starts-with(@class, "hljs")]' )->length,
	'stylesheet'  => $x->query( '//link[@id="spacepress-code-css"]' )->length,
	'scripts'     => array_values( array_filter( array_map( static fn ( DOMNode $n ): string => (string) $n->getAttribute( 'src' ), iterator_to_array( $x->query( '//script[@src]' ) ) ), static fn ( string $s ): bool => str_contains( $s, 'code' ) ) ),
);
$css              = fetch( $x->query( '//link[@id="spacepress-code-css"]' )->item( 0 )?->getAttribute( 'href' ) ?? "$url/none" );
$out['code css']  = array(
	$css['status'],
	str_contains( $css['body'], '@media (prefers-color-scheme: dark)' ),
	str_contains( $css['body'], '.spacepress-code .hljs-keyword' ),
	// A page's own theme switch wins over the scheme: data-theme="dark" or "light" on <html>.
	str_contains( $css['body'], ':root[data-theme="dark"] .spacepress-code .hljs-keyword' ) && str_contains( $css['body'], ':root:not([data-theme="light"]) .spacepress-code .hljs-keyword' ),
);
$setupPost        = (int) $wpdb->get_var( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = 'setup'", $type ) );
$out['code back'] = \SpacePress\Sync\Markdown::fromBlocks( (string) get_post_field( 'post_content', $setupPost ) );

echo json_encode( $out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ), "\n";
$site->destroy();
