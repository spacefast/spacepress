<?php

declare(strict_types=1);

// WP-CLI supplies the arguments of eval-file in $args.
try {
	$request                           = json_decode( $args[0] ?? '', true, flags: JSON_THROW_ON_ERROR );
	[$operation, $positionals, $flags] = $request;
	if ( 'tables' === $operation ) {
		require_once __DIR__ . '/import-tables.php';
		if ( count( $positionals ) !== 1 || array_diff( array_keys( $flags ), array( 'apply', 'dry-run' ) ) !== array()
			|| ( isset( $flags['apply'] ) && ( true !== $flags['apply'] || isset( $flags['dry-run'] ) ) )
			|| ( isset( $flags['dry-run'] ) && true !== $flags['dry-run'] ) ) {
			throw new RuntimeException( 'Usage: wordpress tables <table-import.json> [--apply]' );
		}
		global $wpdb;
		WP_CLI::line( wp_json_encode( array( 'data' => spacepress_migrate_tables( $wpdb, $positionals[0], isset( $flags['apply'] ) ) ) ) );
		return;
	}

	$plugin = \SpacePress\Wp\Runtime::plugin();
	if ( null === $plugin || $plugin->unavailable() !== null ) {
		throw new RuntimeException( 'Activate and initialize the destination SpacePress app first' );
	}
	require_once __DIR__ . '/bootstrap.php';
	$code = \SpacePress\Wp\Legacy\Module::wpCli( $plugin, $operation, $positionals, $flags );
	if ( 0 !== $code ) {
		WP_CLI::halt( $code );
	}
} catch ( Throwable $error ) {
	WP_CLI::line(
		wp_json_encode(
			array(
				'error' => array(
					'code'   => 'migration_refused',
					'detail' => $error->getMessage(),
				),
			)
		)
	);
	WP_CLI::halt( 1 );
}
