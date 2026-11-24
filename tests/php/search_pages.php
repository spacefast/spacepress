<?php

declare(strict_types=1);

/*
 * `<Search>` and `<SearchResults>` (docs/decisions/2026-11-14-search.md): tests/fixtures/search, built
 * by `spacepress build`, on WordPress with php -S. Each page is fetched as a browser with JavaScript off
 * would. Prints one JSON object of what each step saw.
 *
 *   SP_WP_THEMES=1 php tests/php/search_pages.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite(
	'search-pages',
	array(
		'wpContent' => $argv[1],
		'users'     => array( 'chief' => 'editor' ),
		'muPlugins' => array(
			'host' => <<<'PHP'
<?php
// A host that keeps cached pages: the page cache records what cacheable renders read.
add_action('sp_purge_urls', static function (array $paths): void {});
PHP,
		),
	)
);
wp_set_current_user( 1 );
$db = \SpacePress\db();
foreach ( array( 'Tea ceremony', 'Tea gardens', 'Tea history', 'Coffee notes' ) as $t ) {
	$db->insert(
		'notes',
		array(
			'title'  => $t,
			'status' => 'published',
		)
	);
}
$db->insert(
	'notes',
	array(
		'title'  => 'Draft about tea',
		'status' => 'draft',
	)
);
$db->insert(
	'notes',
	array(
		'title'  => 'Plain note',
		'secret' => 'zebrafish',
		'status' => 'published',
	)
);
$db->insert(
	'guides',
	array(
		'title'  => 'Tea guide',
		'status' => 'published',
	)
);
$db->insert(
	'memos',
	array(
		'title'  => 'Tea memo',
		'status' => 'published',
	)
);
$site->actAs( null );
$site->startServer();
$url = $site->url();

function fetch( string $url, array $headers = array() ): array {
	$ch  = curl_init( $url );
	$out = array();
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 30,
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
	$body = (string) curl_exec( $ch );
	return array(
		'status'  => (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE ),
		'headers' => $out,
		'body'    => $body,
	);
}

function x( string $html ): DOMXPath {
	$doc = new DOMDocument();
	$doc->loadHTML( '<?xml encoding="utf-8"?>' . $html, LIBXML_NOERROR | LIBXML_NOWARNING );
	return new DOMXPath( $doc );
}

/** What a results page shows: count text, result titles with their paths, group headings, "more" links, pagination. */
function seen( array $r ): array {
	$x     = x( $r['body'] );
	$texts = static fn ( string $q ): array => array_map( static fn ( $n ) => trim( $n->textContent ), iterator_to_array( $x->query( $q ) ) );
	return array(
		'status'        => $r['status'],
		'cache'         => $r['headers']['cache-control'][0] ?? null,
		'robots header' => $r['headers']['x-robots-tag'][0] ?? null,
		'robots meta'   => str_contains( $r['body'], 'noindex' ),
		'count'         => $texts( "//*[@class='spacepress-search-count']" )[0] ?? null,
		'results'       => array_map( static fn ( $a ) => trim( $a->textContent ) . ' ' . parse_url( $a->getAttribute( 'href' ), PHP_URL_PATH ), iterator_to_array( $x->query( "//li[@class='spacepress-search-result']/a" ) ) ),
		'groups'        => $texts( "//section[@class='spacepress-search-group']/h2" ),
		'more'          => array_map( static fn ( $a ) => parse_url( $a->getAttribute( 'href' ), PHP_URL_PATH ) . '?' . parse_url( $a->getAttribute( 'href' ), PHP_URL_QUERY ), iterator_to_array( $x->query( "//p[@class='spacepress-search-more']/a" ) ) ),
		'pages'         => array_map( static fn ( $a ) => trim( $a->textContent ) . ' ' . parse_url( $a->getAttribute( 'href' ), PHP_URL_QUERY ), iterator_to_array( $x->query( "//nav[contains(@class,'spacepress-pagination')]//a" ) ) ),
		'too long'      => $texts( "//*[@class='spacepress-search-too-long']" )[0] ?? null,
		'input'         => ( $i = $x->query( "//form[@role='search']//input[@type='search']" )->item( 0 ) ) ? array( $i->getAttribute( 'name' ), $i->getAttribute( 'maxlength' ), $i->getAttribute( 'value' ) ) : null,
	);
}

global $wpdb;
$reads = static fn (): int => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}sp__app_reads" );
$out   = array();
// The bare form: cacheable, indexable, and the form posts nowhere but a GET with `q`.
$home           = fetch( "$url/" );
$hx             = x( $home['body'] );
$form           = $hx->query( "//form[@role='search']" )->item( 0 );
$out['form']    = array(
	'method' => $form?->getAttribute( 'method' ),
	'action' => $form?->getAttribute( 'action' ),
	'cache'  => $home['headers']['cache-control'][0] ?? null,
	'robots' => $home['headers']['x-robots-tag'][0] ?? null,
);
$out['empty']   = seen( fetch( "$url/find/" ) );
$out['blank q'] = seen( fetch( "$url/find/?q=%20%20" ) );
$before         = $reads();
// Site-wide: every kind with a URL (notes and guides, not memos), two per kind with a link to the rest.
$out['site'] = seen( fetch( "$url/find/?q=tea" ) );
// One kind, paged by `page`; links keep `q`. A draft and a hidden-field match never show or count.
$out['one kind']     = seen( fetch( "$url/notes-search/?q=tea" ) );
$out['page two']     = seen( fetch( "$url/notes-search/?q=tea&page=2" ) );
$out['hidden field'] = seen( fetch( "$url/notes-search/?q=zebrafish" ) );
// Narrowing the site-wide page to a kind: its rows; a kind it doesn't cover gives nothing.
$out['narrowed']            = seen( fetch( "$url/find/?q=tea&kind=notes" ) );
$out['narrowed to memos']   = seen( fetch( "$url/find/?q=tea&kind=memos" ) );
$out['narrowed to nothing'] = seen( fetch( "$url/find/?q=tea&kind=nope" ) );
// A query longer than the input allows, typed into the URL: a plain message, never an error page.
$out['too long'] = seen( fetch( "$url/notes-search/?q=" . str_repeat( 'a', 201 ) ) );
// Three different searches left nothing in the page cache's read index.
fetch( "$url/find/?q=gardens" );
fetch( "$url/find/?q=history" );
$out['recorded'] = $reads() - $before;

// A signed-in editor: the draft and the hidden-field match, at the same URL, never shared.
$id                   = $site->userId( 'chief' );
$expires              = time() + 3600;
$token                = WP_Session_Tokens::get_instance( $id )->create( $expires );
$editor               = array( 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode( wp_generate_auth_cookie( $id, $expires, 'logged_in', $token ) ) );
$out['editor']        = seen( fetch( "$url/notes-search/?q=tea", $editor ) );
$out['editor hidden'] = seen( fetch( "$url/notes-search/?q=zebrafish", $editor ) )['results'];

echo json_encode( $out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT ), "\n";
$site->destroy();
