<?php

declare(strict_types=1);

/** Opt-in measurements for the disposable shop used by drive_store.php. */
final class DriveStoreProfile {

	public const PLUGIN = <<<'PLUGIN'
<?php
if (isset($_SERVER['HTTP_X_SP_DRIVE_PROFILE'])) {
    $statements = 0;
    $postmetaJoins = 0;
    add_action('plugins_loaded', static function () use (&$statements, &$postmetaJoins) {
        global $wpdb;
        $join = '/\bJOIN\s+`?' . preg_quote($wpdb->postmeta, '/') . '`?\b/i';
        \SpacePress\Wp\Connection::$observer = static function (string $sql) use (&$statements, &$postmetaJoins, $join) {
            ++$statements;
            $postmetaJoins += preg_match_all($join, $sql);
        };
    }, PHP_INT_MIN);
    register_shutdown_function(static function () use (&$statements, &$postmetaJoins) {
        global $wpdb;
        file_put_contents(WP_CONTENT_DIR . '/drive-profile.json', json_encode([
            'sample' => $_SERVER['HTTP_X_SP_DRIVE_PROFILE'],
            'sql' => $wpdb->num_queries + $statements,
            'spacepress_sql' => $statements,
            'spacepress_postmeta_joins' => $postmetaJoins,
            'php_files' => count(get_included_files()),
        ], JSON_THROW_ON_ERROR));
    });
}
PLUGIN;

	private array $states = array();

	public function __construct( private readonly string $output ) {}

	/** A warm-up followed by five GETs. Mutations still run only once in the surrounding functional test. */
	public function measure( WpSite $site, string $state, string $path, int $status = 200, string $session = '' ): void {
		$headers = array();
		if ( '' !== $session ) {
			$headers[] = "Cookie: $session";
		}
		$samples = array();
		for ( $run = 0; $run <= 5; ++$run ) {
			$sample  = "$state/$run";
			$start   = hrtime( true );
			$page    = fetch( $site->url() . $path, headers: array( ...$headers, "X-SP-Drive-Profile: $sample" ) );
			$elapsed = ( hrtime( true ) - $start ) / 1e6;
			if ( $page['status'] !== $status ) {
				throw new RuntimeException( "$state returned {$page['status']}, expected $status" );
			}
			if ( 0 === $run ) {
				continue;
			}
			$metrics = json_decode( file_get_contents( $site->content . '/drive-profile.json' ), true, 512, JSON_THROW_ON_ERROR );
			if ( ( $metrics['sample'] ?? null ) !== $sample ) {
				throw new RuntimeException( "Missing metrics for $sample" );
			}
			unset( $metrics['sample'] );
			$metrics['get_ms']     = round( $elapsed, 2 );
			$metrics['body_bytes'] = strlen( $page['body'] );
			foreach ( $metrics as $metric => $value ) {
				$samples[ $metric ][] = $value;
			}
		}
		foreach ( $samples as $metric => $values ) {
			sort( $values, SORT_NUMERIC );
			$this->states[ $state ][ $metric ] = $values[2];
		}
	}

	public function save(): void {
		$report = array(
			'wordpress'           => $GLOBALS['wp_version'],
			'woocommerce'         => WC_VERSION,
			'php'                 => PHP_VERSION,
			'warm_gets_per_state' => 5,
			'states'              => $this->states,
		);
		if ( file_put_contents( $this->output, json_encode( $report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR ) . "\n" ) === false ) {
			throw new RuntimeException( "Could not write {$this->output}" );
		}
	}
}
