<?php
// Test stack only: what a host does to enforce a sealed build's allow-list before plugins load
// (docs/sealed.md). Installed as a must-use plugin by tests/wp/hardening/sealed.test.ts while it runs:
// WordPress reads `active_plugins` after mu-plugins load, so this filter decides which plugins load.
// The list is the one the build wrote; the helper is the loader's.
defined( 'ABSPATH' ) || exit;
( static function (): void {
	$manifest = json_decode( (string) @file_get_contents( WP_CONTENT_DIR . '/spacepress-manifest.json' ), true );
	$sealed   = is_array( $manifest['sealed'] ?? null ) ? $manifest['sealed'] : null;
	$loader   = WP_CONTENT_DIR . '/spacepress-loader.php';
	if ( null === $sealed || ! is_file( $loader ) ) {
		return;
	}
	require_once $loader;
	define( 'SP_SEALED_ENFORCED', true );
	$filter = static fn ( $active ) => \SpacePress\Loader\Loader::allowedPlugins( (array) $active, $sealed );
	add_filter( 'option_active_plugins', $filter, PHP_INT_MAX );
	// WordPress writes the option back from what it read: the entries the filter hid stay stored.
	add_filter(
		'pre_update_option_active_plugins',
		static function ( $new ) use ( $filter, $sealed ) {
			remove_filter( 'option_active_plugins', $filter, PHP_INT_MAX );
			$stored = (array) get_option( 'active_plugins', array() );
			add_filter( 'option_active_plugins', $filter, PHP_INT_MAX );

			return \SpacePress\Loader\Loader::keepUnlisted( (array) $new, $stored, $sealed );
		},
		PHP_INT_MAX
	);
} )();
