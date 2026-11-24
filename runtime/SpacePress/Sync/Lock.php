<?php

declare(strict_types=1);

namespace SpacePress\Sync;

use SpacePress\Wp\Plugin;

use function SpacePress\db;

/**
 * Row locks for digest-guarded sync writes. MySQL runs REPEATABLE READ: plain reads see the snapshot taken
 * at the transaction's first read, while a locking read sees the latest committed row. A row whose
 * locked state differs from the snapshot changed after this transaction began, so a digest computed
 * from the snapshot is stale. The lock is held until commit, so nobody can change the row after the check.
 */
final class Lock {

	/** Lock the row; true when this transaction's snapshot still shows its latest committed state. */
	public static function fresh( string $collection, int|string $pk ): bool {
		$queries    = self::row_queries( $collection );
		$connection = Plugin::instance()->connection();
		$locked     = array_map( static fn ( string $sql ): array => $connection->run( "$sql FOR UPDATE", array( $pk ) ), $queries );
		$snapshot   = array_map( static fn ( string $sql ): array => $connection->run( $sql, array( $pk ) ), $queries );

		return $locked === $snapshot;
	}

	/** The row's uid as last committed, with the row locked until commit (the SQLite translator reads it plainly). */
	public static function uid( string $collection, int|string $pk ): ?string {
		$spec       = db()->schema()->collection( $collection );
		$connection = Plugin::instance()->connection();
		foreach ( self::row_queries( $collection ) as $sql ) {
			$connection->run( "$sql FOR UPDATE", array( $pk ) );
		}
		if ( $spec['taxonomy'] ?? false ) {
			$meta = $connection->wpdb()->termmeta;
			$uid  = $connection->run( "SELECT meta_value FROM `$meta` WHERE term_id = ? AND meta_key = '_sp_uid' FOR UPDATE", array( $pk ) )[0]['meta_value'] ?? null;
			return null === $uid || '' === $uid ? null : (string) $uid;
		}
		if ( Trash::postBacked( $spec ) ) {
			$meta = $connection->wpdb()->postmeta;
			$uid  = $connection->run( "SELECT meta_value FROM `$meta` WHERE post_id = ? AND meta_key = ? FOR UPDATE", array( $pk, \SpacePress\Wp\WpPostStore::UID_META ) )[0]['meta_value'] ?? null;
		} else {
			$quote = db()->store()->dialect()->quote( ... );
			$uid   = $connection->run(
				'SELECT ' . $quote( 'uid' ) . ' AS uid FROM ' . db()->store()->source( $collection )->table
				. ' WHERE ' . $quote( $spec['primaryKey'] ) . ' = ? FOR UPDATE',
				array( $pk )
			)[0]['uid'] ?? null;
		}

		return null === $uid || '' === $uid ? null : (string) $uid;
	}

	/** @return list<string> one-parameter SELECTs (the primary key) covering everything the row is stored in */
	private static function row_queries( string $collection ): array {
		$spec = db()->schema()->collection( $collection );
		if ( $spec['taxonomy'] ?? false ) {
			$wpdb = Plugin::instance()->connection()->wpdb();
			return array( "SELECT * FROM `{$wpdb->terms}` WHERE term_id = ?", "SELECT * FROM `{$wpdb->term_taxonomy}` WHERE term_id = ?", "SELECT * FROM `{$wpdb->termmeta}` WHERE term_id = ? ORDER BY meta_id" );
		}
		if ( Trash::postBacked( $spec ) ) {
			$wpdb = Plugin::instance()->connection()->wpdb();

			return array(
				"SELECT * FROM `{$wpdb->posts}` WHERE ID = ?",
				"SELECT meta_id, meta_key, meta_value FROM `{$wpdb->postmeta}` WHERE post_id = ? ORDER BY meta_id",
			);
		}

		return array( 'SELECT * FROM ' . db()->store()->source( $collection )->table . ' WHERE ' . db()->store()->dialect()->quote( $spec['primaryKey'] ) . ' = ?' );
	}
}
