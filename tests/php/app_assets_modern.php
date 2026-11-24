<?php

declare(strict_types=1);

/*
 * Modern asset pipeline end-to-end on WordPress over HTTP (tests/app_router.rs
 * `modern_asset_pipeline_works_end_to_end_on_wordpress`): tests CSS @import bundling, minification,
 * small-CSS inlining vs large-CSS external linking, @font-face + priority <Image> preloads,
 * auto image dimensions, Vite query modifiers (?raw/?inline/?url/?meta), and client component asset imports.
 */

require __DIR__ . '/wp.php';

$site = wpSite( 'modern-assets', array( 'wpContent' => $argv[1] ) );
$site->startServer();
$url = $site->url();

function fetchUrl( string $url ): array {
	$ch = curl_init( $url );
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 30,
		)
	);
	$body = (string) curl_exec( $ch );
	return array(
		'status' => (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE ),
		'type'   => (string) curl_getinfo( $ch, CURLINFO_CONTENT_TYPE ),
		'body'   => $body,
	);
}

$page = fetchUrl( "$url/" );
$html = new DOMDocument();
$html->loadHTML( $page['body'], LIBXML_NOERROR | LIBXML_NOWARNING );
$xpath = new DOMXPath( $html );

$inlineStyles = array();
foreach ( $xpath->query( '//style[starts-with(@id, "spacepress-app-")]' ) as $s ) {
	$inlineStyles[] = trim( $s->textContent );
}
$externalStyles = array();
foreach ( $xpath->query( '//link[@rel="stylesheet"][starts-with(@id, "spacepress-app-")]' ) as $l ) {
	$href             = (string) $l->getAttribute( 'href' );
	$r                = fetchUrl( $href );
	$externalStyles[] = array(
		'file'   => basename( (string) parse_url( $href, PHP_URL_PATH ) ),
		'status' => $r['status'],
		'len'    => strlen( $r['body'] ),
	);
}

$preloads = array();
foreach ( $xpath->query( '//link[@rel="preload"]' ) as $p ) {
	$preloads[] = array(
		'as'            => $p->getAttribute( 'as' ),
		'type'          => $p->getAttribute( 'type' ),
		'crossorigin'   => $p->getAttribute( 'crossorigin' ),
		'fetchpriority' => $p->getAttribute( 'fetchpriority' ),
		'file'          => basename( (string) parse_url( $p->getAttribute( 'href' ), PHP_URL_PATH ) ),
		'status'        => fetchUrl( (string) $p->getAttribute( 'href' ) )['status'],
	);
}

$imgs = array();
foreach ( $xpath->query( '//img' ) as $img ) {
	$src                                   = (string) $img->getAttribute( 'src' );
	$imgs[ $img->getAttribute( 'class' ) ] = array(
		'src'           => $src,
		'width'         => $img->getAttribute( 'width' ),
		'height'        => $img->getAttribute( 'height' ),
		'loading'       => $img->getAttribute( 'loading' ),
		'decoding'      => $img->getAttribute( 'decoding' ),
		'fetchpriority' => $img->getAttribute( 'fetchpriority' ),
		'status'        => str_starts_with( $src, 'data:' ) ? 200 : fetchUrl( $src )['status'],
	);
}

$rawNode    = $xpath->query( '//*[@data-raw]' )->item( 0 );
$cssUrlNode = $xpath->query( '//*[@data-css-url]' )->item( 0 );
$cssUrlHref = $cssUrlNode instanceof DOMElement ? $cssUrlNode->getAttribute( 'data-css-url' ) : '';

// Inspect the Interactivity API config script for client component assets.
$configScript = '';
foreach ( $xpath->query( '//script[@id="wp-script-module-data-@wordpress/interactivity"]' ) as $sc ) {
	$configScript = $sc->textContent;
}
$interactivity = json_decode( $configScript, true );

echo json_encode(
	array(
		'status'             => $page['status'],
		'inlineStyles'       => $inlineStyles,
		'externalStyles'     => $externalStyles,
		'preloads'           => $preloads,
		'imgs'               => $imgs,
		'raw'                => $rawNode instanceof DOMElement ? $rawNode->getAttribute( 'data-raw' ) : null,
		'cssUrlStatus'       => '' !== $cssUrlHref ? fetchUrl( $cssUrlHref )['status'] : 0,
		'cssUrlFile'         => basename( (string) parse_url( $cssUrlHref, PHP_URL_PATH ) ),
		'clientConfigAssets' => $interactivity['config']['modernassets/Badge']['assets'] ?? null,
	),
	JSON_UNESCAPED_SLASHES
), "\n";

$site->destroy();
