<?php

declare(strict_types=1);

/** Copy a Zero export's tables into the target WordPress site's namespace. */
function spacepress_migrate_tables( wpdb $db, string $manifest, bool $apply ): array {
	$text = file_get_contents( $manifest );
	if ( false === $text ) {
		throw new RuntimeException( 'Cannot read the table import manifest' );
	}
	$tables = json_decode( $text, true, flags: JSON_THROW_ON_ERROR );
	if ( ! is_array( $tables ) || array() === $tables || count( array_unique( $tables, SORT_REGULAR ) ) !== count( $tables ) ) {
		throw new RuntimeException( 'Expected a nonempty map of source to target tables' );
	}
	$run      = static function ( string $sql ) use ( $db ): void {
		if ( $db->query( $sql ) === false ) {
			throw new RuntimeException( $db->last_error );
		}
	};
	$metadata = static fn ( string $table ): ?array => $db->get_row(
		$db->prepare(
			'SELECT ENGINE, AUTO_INCREMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s',
			$table
		),
		ARRAY_A
	);
	$prefix   = $db->prefix;
	if ( ! preg_match( '/\A[A-Za-z][A-Za-z0-9_]{0,35}\z/', $prefix ) ) {
		throw new RuntimeException( 'Invalid WordPress site prefix' );
	}
	$lock = 'sp-import-' . substr( hash( 'sha256', DB_NAME . "\0" . $prefix ), 0, 40 );
	if ( 1 !== (int) $db->get_var( $db->prepare( 'SELECT GET_LOCK(%s, 10)', $lock ) ) ) {
		throw new RuntimeException( 'Another import is running for this WordPress site' );
	}
	$staged = array();
	try {
		$plan = array();
		foreach ( $tables as $source => $target ) {
			if ( ! is_string( $source ) || ! preg_match( '/\Asf_[a-z0-9_]+_[a-f0-9]{10}\z/', $source )
				|| ! is_string( $target ) || ! preg_match( '/\A' . preg_quote( $prefix, '/' ) . 'import_[a-f0-9]{20}\z/', $target ) ) {
				throw new RuntimeException( 'Invalid source table or target outside the import namespace' );
			}
			$info = $metadata( $source );
			if ( null === $info || strcasecmp( (string) $info['ENGINE'], 'InnoDB' ) !== 0 || $metadata( $target ) !== null ) {
				throw new RuntimeException( "Expected an InnoDB source and an unused target for $source to $target" );
			}
			if ( $db->get_var(
				$db->prepare(
					'SELECT 1 FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1',
					$source
				)
			) !== null ) {
				throw new RuntimeException( "Source table $source has foreign keys. Import it and its constraints with your database tools." );
			}
			$plan[ $source ] = array(
				'target' => $target,
				'nextId' => $info['AUTO_INCREMENT'],
			);
		}
		if ( $apply ) {
			foreach ( $plan as $source => $entry ) {
				$stage = $prefix . 'impstage_' . bin2hex( random_bytes( 8 ) );
				$run( "CREATE TABLE `$stage` LIKE `$source`" );
				$staged[ $stage ] = $entry['target'];
				$run( "INSERT INTO `$stage` SELECT * FROM `$source`" );
				$next = (string) $entry['nextId'];
				if ( ctype_digit( $next ) ) {
					$run( "ALTER TABLE `$stage` AUTO_INCREMENT = $next" );
				}
			}
			$renames = array();
			foreach ( $staged as $stage => $target ) {
				$renames[] = "`$stage` TO `$target`";
			}
			$run( 'RENAME TABLE ' . implode( ', ', $renames ) );
		}
		return array(
			'dryRun' => ! $apply,
			'tables' => $plan,
		);
	} catch ( Throwable $error ) {
		if ( array() !== $staged ) {
			$names = implode( ', ', array_keys( $staged ) );
			throw new RuntimeException( $error->getMessage() . ". Staging copies remain at $names.", previous: $error );
		}
		throw $error;
	} finally {
		$db->get_var( $db->prepare( 'SELECT RELEASE_LOCK(%s)', $lock ) );
	}
}
