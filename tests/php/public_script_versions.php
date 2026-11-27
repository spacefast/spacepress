<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';

function metadataScripts( string $html ): array {
	preg_match_all( '#<script id="spacepress-app-script-[0-9a-f]+-js-module" src="([^"]*)" type="module">#', $html, $matches );
	return array_map( 'html_entity_decode', $matches[1] );
}

function moduleResponse( string $url, bool $managed = false, string $method = 'GET' ): array {
	$headers = $managed ? array( 'X-SP-Test-Managed: 1' ) : array();
	$out     = array();
	$c       = curl_init( $url );
	curl_setopt_array(
		$c,
		array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_NOBODY         => 'HEAD' === $method,
			CURLOPT_HTTPHEADER     => $headers,
			CURLOPT_TIMEOUT        => 30,
			CURLOPT_HEADERFUNCTION => static function ( $c, string $line ) use ( &$out ): int {
				if ( str_contains( $line, ':' ) ) {
					[$name, $value]             = explode( ':', $line, 2 );
					$out[ strtolower( $name ) ] = trim( $value );
				}
				return strlen( $line );
			},
		)
	);
	$body = curl_exec( $c );
	return array( curl_getinfo( $c, CURLINFO_RESPONSE_CODE ), $out, $body );
}

// Mirror the compiled store tree into wp-content/spacepress-assets, as SpacePressPlugin\Trees::mirror does.
$mirror = static function ( string $store, string $assets, string $appHash ): void {
	$src = "$store/app/$appHash/plugins";
	$dst = "$assets/app/$appHash/plugins";
	wpCopy( $src, $dst );
};

// Boot and initialize the loose copy normally. Requests with the fixture header mount the
// immutable compiler output through the real Loader with `url` pointing at wp-content/spacepress-assets.
$mount    = sprintf(
	<<<'PHP'
<?php
if (!isset($_SERVER['HTTP_X_SP_TEST_MANAGED'])) {
    return;
}
add_filter('option_active_plugins', static fn (array $plugins): array => array_values(array_filter(
    $plugins, static fn (string $plugin): bool => !str_starts_with($plugin, 'spacepress-'),
)));
$root = %s;
require $root . '/runtime/' . %s . '/spacepress-loader.php';
\SpacePress\Loader\Loader::load($root, %s, [
    'url' => content_url('spacepress-assets'),
    'assetsDir' => WP_CONTENT_DIR . '/spacepress-assets',
]);
header_register_callback(static function (): void {
    foreach (get_included_files() as $file) {
        if (str_ends_with($file, '/sp/app/functions.php')) {
            header('X-Test-App-Code-Loaded: 1');
            break;
        }
    }
});
PHP,
	var_export( $argv[2], true ),
	var_export( $argv[3], true ),
	var_export( $argv[4], true )
);
$site     = wpSite(
	'public-script-versions',
	array(
		'wpContent' => $argv[1],
		'muPlugins' => array( 'managed-preview' => $mount ),
	)
);
$manifest = json_decode( (string) file_get_contents( $argv[2] . '/build/' . $argv[4] . '.json' ), true, 16, JSON_THROW_ON_ERROR );
$mirror( $argv[2], $site->content . '/spacepress-assets', (string) $manifest['app'] );
$site->startServer();
$base = $site->url();

$looseScripts   = metadataScripts( (string) file_get_contents( "$base/" ) );
$managedPage    = moduleResponse( "$base/", true );
$managedScripts = metadataScripts( $managedPage[2] );

$loose       = moduleResponse( $looseScripts[0] );
$managed     = moduleResponse( $managedScripts[0], true );
$managedHead = moduleResponse( $managedScripts[0], true, 'HEAD' );
$body        = $loose[2];

foreach ( array( $loose, $managed ) as $resp ) {
	if ( 200 !== $resp[0] || $resp[2] !== $body || isset( $resp[1]['x-test-app-code-loaded'] ) ) {
		throw new RuntimeException( 'Unexpected module response: ' . json_encode( $resp, JSON_THROW_ON_ERROR ) );
	}
}
if ( 200 !== $managedHead[0] || '' !== $managedHead[2] || ( $managedHead[1]['content-length'] ?? null ) !== (string) strlen( $body ) ) {
	throw new RuntimeException( 'Unexpected HEAD response: ' . json_encode( $managedHead, JSON_THROW_ON_ERROR ) );
}

echo json_encode(
	array(
		'base'           => $base,
		'scripts'        => $looseScripts,
		'managedScripts' => $managedScripts,
		'plain'          => metadataScripts( (string) file_get_contents( "$base/plain/" ) ),
		'body'           => $body,
	),
	JSON_THROW_ON_ERROR
), "\n";
$site->destroy();
