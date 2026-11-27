<?php

declare(strict_types=1);

use SpacePress\HttpError;
use SpacePress\Wp\Connection;
use SpacePress\Wp\InstallMarker;
use SpacePress\Wp\Plugin;

$plugin               = Plugin::instance() ?? throw new RuntimeException( 'No app loaded' );
$db                   = $plugin->connection();
$wpdb                 = $db->wpdb();
$table                = $db->prefix() . 'sp_engine_drift_probe';
$condition            = static function ( bool $ok, string $problem ): void {
	if ( ! $ok ) {
		throw new RuntimeException( $problem );
	}
};
$checks               = 0;
Connection::$observer = static function ( string $sql ) use ( &$checks ): void {
	if ( str_contains( $sql, 'information_schema.TABLES' ) ) {
		++$checks;
	}
};
$read                 = static fn (): int => (int) $db->run( "SELECT value FROM `$table`" )[0]['value'];
$write                = static fn ( int $value ): array => $db->run( "UPDATE `$table` SET value = ?", array( $value ) );
$wpWrite              = static fn (): int|false => $wpdb->query( "UPDATE `$table` SET value = 3" );
$db->run( "CREATE TABLE `$table` (value INT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4" );
try {
	$condition( InstallMarker::current(), 'Expected an active install marker' );
	$db->run( "INSERT INTO `$table` VALUES (0)" );
	$db->transaction(
		static function () use ( $db, $write ): void {
			$write( 1 );
			$db->transaction( static fn () => $write( 2 ) );
		}
	);
	$condition( 1 === $checks && $read() === 2, 'Expected one check across nested writes' );
	$db->run( "ALTER TABLE `$table` ENGINE=MyISAM" );
	$condition( $db->transaction( $read ) === 2 && $db->reading( $read ) === 2 && 1 === $checks, 'Reads queried the storage engine' );
	$refuse = static function ( callable $write ) use ( $condition, $db, $read ): void {
		try {
			$write();
			throw new RuntimeException( 'A MyISAM write was allowed' );
		} catch ( HttpError $e ) {
			$condition( 503 === $e->status && 'unavailable' === $e->errorCode, 'Unexpected storage refusal' );
		}
		$condition( ! $db->inTransaction() && $read() === 2, 'The refused transaction left changes or stayed open' );
	};
	$refuse( static fn () => $db->transaction( static fn () => $write( 3 ) ) );
	$refuse( static fn () => $db->reading( static fn () => $write( 3 ) ) );
	$refuse( static fn () => $db->transaction( $wpWrite ) );
	$refuse( static fn () => $db->reading( $wpWrite ) );
	$refuse( static fn () => $db->reading( static fn () => $db->beforeCommit( $wpWrite ) ) );
	$refuse( static fn () => $db->reading( static fn () => $db->run( "SELECT value FROM `$table` FOR UPDATE" ) ) );
	$condition( 7 === $checks, 'Expected a fresh check for every refused transaction' );
	$db->run( "ALTER TABLE `$table` ENGINE=InnoDB" );
	$db->reading( $wpWrite );
	$condition( 8 === $checks && $read() === 3, 'Restoring InnoDB did not restore writes on the same connection' );
	$condition( InstallMarker::current(), 'The engine check invalidated the install marker' );
} finally {
	Connection::$observer = null;
	$db->run( "DROP TABLE `$table`" );
}
