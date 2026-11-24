<?php

declare(strict_types=1);

namespace SpacePress;

/**
 * Access rules (§1.6). A rule is ['allow' => bool] | ['role' => 'anyone'|'authenticated'|Role] | ['self' => true] | ['fn' => name].
 * evaluate() returns true (allowed / all rows), false (denied) or a filter array (rows matching it).
 */
final class Access {

	public const DEFAULT_READ  = array( 'role' => 'anyone' );
	public const DEFAULT_WRITE = array( 'role' => 'editor' );
	/** The built-in media collection's fixed rules (§4.6). */
	public const MEDIA = array(
		'read'   => array( 'role' => 'anyone' ),
		'create' => array( 'role' => 'author' ),
		'update' => array( 'role' => 'editor' ),
		'delete' => array( 'role' => 'editor' ),
	);

	/**
	 * Per-request memoization for compiled access callbacks evaluated without row/patch data,
	 * together with any render dependencies recorded during the evaluation so cache hits keep
	 * page-cache invalidation intact. Cleared whenever Db mutates rows/globals, rolls back a
	 * transaction, switches instances, or WordPress flushes CoreAccess.
	 *
	 * @var array<string, array{result: bool|array, reads: array<string, array{ids: list<int|string>, listed: bool}>, also: list<string>}>
	 */
	private static array $cache = array();

	public static function clearCache(): void {
		self::$cache = array();
	}

	/** @return array{read: array, create: array, update: array, delete: array, restore: array, purge: array} */
	public static function collectionRules( array $spec ): array {
		$a      = $spec['access'] ?? array();
		$delete = $a['delete'] ?? self::DEFAULT_WRITE;

		return array(
			'read'    => $a['read'] ?? self::DEFAULT_READ,
			'create'  => $a['create'] ?? self::DEFAULT_WRITE,
			'update'  => $a['update'] ?? self::DEFAULT_WRITE,
			'delete'  => $delete,
			'restore' => $a['restore'] ?? $delete,
			'purge'   => $a['purge'] ?? array( 'allow' => false ),
		);
	}

	/** @return array{read: array, update: array} */
	public static function globalRules( array $global ): array {
		$a = $global['access'] ?? array();

		return array(
			'read'   => $a['read'] ?? self::DEFAULT_READ,
			'update' => $a['update'] ?? self::DEFAULT_WRITE,
		);
	}

	public static function evaluate( array $rule, Viewer $viewer, string $op, ?array $data = null, ?array $dataShape = null, ?string $collection = null ): bool|array {
		$user = $viewer->user;
		if ( array_key_exists( 'allow', $rule ) ) {
			return (bool) $rule['allow'];
		}
		if ( ( $rule['self'] ?? false ) === true ) {
			// "self" (auth collections, §6.2): the viewer's own row; anonymous viewers get nothing.
			return null === $user ? false : array( 'id' => $user['id'] );
		}
		if ( isset( $rule['role'] ) ) {
			return match ( $rule['role'] ) {
				'anyone' => true,
				'authenticated' => null !== $user,
				default => null !== $user && Schema::roleRank( $user['role'] ) >= Schema::roleRank( $rule['role'] ),
			};
		}
		if ( isset( $rule['fn'] ) ) {
			$slot      = $rule['fn'];
			$cache_key = null;
			if ( is_string( $slot ) && null === $data ) {
				$cache_key = Db::currentId() . "\0" . $slot . "\0" . ( $user['id'] ?? '' ) . "\0" . ( $user['role'] ?? '' ) . "\0" . $op . "\0" . ( $collection ?? '' );
				if ( array_key_exists( $cache_key, self::$cache ) ) {
					$cached = self::$cache[ $cache_key ];
					Render\Reads::replay( $cached['reads'], $cached['also'] );

					return $cached['result'];
				}
			}
			$fn  = is_string( $slot ) ? '\\SpacePressApp\\' . $slot : $slot;
			$ctx = array(
				'user' => $user,
				'op'   => $op,
				'data' => $data,
			);
			$ctx = is_string( $slot ) ? Seam::ctx( $ctx, $dataShape ) : $ctx;
			// Access-rule queries always run trusted, never under an outer render's bound viewer,
			// so `db.query.*` and file hydration can't re-enter access rules recursively.
			$run = static fn () => Seam::asViewer( null, static fn () => $fn( $ctx ) );
			if ( null !== $cache_key ) {
				$dep_reads = array();
				$dep_also  = array();
				$r         = Render\Reads::during( $run, $dep_reads, $dep_also );
				Render\Reads::replay( $dep_reads, $dep_also );
			} else {
				$r = $run();
			}
			if ( $r instanceof JsObject || is_array( $r ) ) {
				if ( null === $collection ) {
					throw new \LogicException( 'A filter-valued access rule requires its collection' );
				}
				$r = Seam::filter( $collection, $r );
			}
			$result = is_array( $r ) ? $r : ( true === $r );
			if ( null !== $cache_key ) {
				self::$cache[ $cache_key ] = array(
					'result' => $result,
					'reads'  => $dep_reads,
					'also'   => $dep_also,
				);
			}

			return $result;
		}

		throw new \LogicException( 'Invalid access rule' );
	}

	/** True when the rule can only return a boolean (draft visibility applies to these, §1.6). */
	public static function isShorthand( array $rule ): bool {
		return ! isset( $rule['fn'] );
	}

	public static function deny( ?array $user, string $what = 'this' ): HttpError {
		return null === $user
			? new HttpError( 401, 'unauthenticated', "Sign in to do $what" )
			: new HttpError( 403, 'forbidden', "You don't have access to $what" );
	}

	/** An access rule that is a plain boolean check (create, actions, globals, media): throw unless allowed. */
	public static function require( array $rule, Viewer $viewer, string $op, ?array $data, string $what, ?array $dataShape = null ): void {
		$r = self::evaluate( $rule, $viewer, $op, $data, $dataShape );
		if ( is_array( $r ) ) {
			throw new \LogicException( "The $op rule for $what returned a filter; it must return a boolean" );
		}
		if ( ! $r ) {
			throw self::deny( $viewer->user, $what );
		}
	}
}
