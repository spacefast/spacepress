<?php
/**
 * Test-only host seams for tests/wp/store-run.sh: implements every hook docs/host-contract.md lists
 * and records each call in the `sp_test_contract` option, so the lane proves the runtime calls
 * them. Installed as a must-use plugin beside host.php.
 */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

( static function (): void {
	$record = static function ( string $hook, mixed $value ): void {
		$log          = get_option( 'sp_test_contract', array() );
		$log[ $hook ] = $value;
		update_option( 'sp_test_contract', $log, false );
	};
	add_filter(
		'sp_mail_transport',
		static function ( mixed $accepted, array $message ) use ( $record ): bool {
			$record( 'sp_mail_transport', $message['subject'] ?? null );
			return true;
		},
		10,
		2
	);
	add_action( 'sp_purge_urls', static fn ( array $paths ) => $record( 'sp_purge_urls', count( $paths ) ) );
	add_filter(
		'sp_identity_providers',
		static function ( array $providers ) use ( $record ): array {
			$record( 'sp_identity_providers', array_keys( $providers ) );
			return $providers;
		}
	);
	add_action( 'sp_runtime_loaded', static fn () => $record( 'sp_runtime_loaded', true ) );
	add_action( 'sp_realtime_changes', static fn ( array $notice ) => $record( 'sp_realtime_changes', array_column( $notice['changes'], 'collection' ) ) );
	add_action(
		'sp_runtime_loaded',
		static function () use ( $record ): void {
			\SpacePress\Realtime\Module::publish(
				new class($record) implements \SpacePress\Realtime\Publisher {
					public function __construct( private \Closure $record ) {}
					public function publish( array $notice ): void {
						( $this->record )( 'SpacePress\\Realtime\\Publisher', count( $notice['changes'] ) ); }
				}
			);
		}
	);
} )();
