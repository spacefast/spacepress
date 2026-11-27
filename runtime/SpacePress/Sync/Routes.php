<?php

declare(strict_types=1);

namespace SpacePress\Sync;

use SpacePress\Access;
use SpacePress\App;
use SpacePress\Extensions;
use SpacePress\HttpError;
use SpacePress\Js;
use SpacePress\Response;
use SpacePress\Viewer;

use function SpacePress\db;

/**
 * `/sync/{collection}` (§5.3): paged reads of every record, guarded writes keyed by uid with an expected
 * digest, trash, and the two pure helpers the CLI delegates to (body conversion and three-way merge).
 */
final class Routes {

	private const PAGE  = 100;
	private const BATCH = 100;

	/** @return array{int, mixed}|Response */
	public static function dispatch( string $method, array $segments, array $query, string $body, Viewer $viewer, array $files, array $form ): array|Response {
		$n = count( $segments );
		if ( $n < 2 || $n > 3 ) {
			throw HttpError::notFound( 'No such sync route' );
		}
		$collection = $segments[1];
		$spec       = db()->schema()->collection( $collection );
		if ( ( $spec['sync'] ?? null ) === null ) {
			throw HttpError::notFound( "$collection does not sync with files" );
		}
		$action = $segments[2] ?? null;
		if ( null === $action ) {
			App::allow( $method, array( 'GET', 'POST' ) );
			if ( 'GET' === $method ) {
				self::require_sync_read( $spec, $viewer, $collection );

				return array( 200, self::page( $collection, $spec, $query, $viewer ) );
			}

			$decoded = self::decode( $body );
			return self::apply( $collection, $spec, \SpacePress\Seam::sync( $collection, $decoded ), $decoded, $viewer );
		}
		App::allow( $method, array( 'POST' ) );

		return match ( $action ) {
			'trash' => self::trash( $collection, $spec, self::input( $collection, $body ), $viewer ),
			'convert' => array( 200, self::batch( $spec, self::input( $collection, $body ), $viewer, $collection, self::convert( ... ) ) ),
			'merge' => array( 200, self::batch( $spec, self::input( $collection, $body ), $viewer, $collection, self::merge( ... ) ) ),
			default => throw HttpError::notFound( 'No such sync route' ),
		};
	}

	// ================================================================ read

	private static function page( string $collection, array $spec, array $query, Viewer $viewer ): array {
		$after = self::int_param( $query, 'after', 0, PHP_INT_MAX ) ?? 0;
		$first = self::int_param( $query, 'first', 1, self::PAGE ) ?? self::PAGE;
		$pk    = $spec['primaryKey'];
		$rows  = self::rows(
			$collection,
			array(
				'where'   => array( $pk => array( 'gt' => $after ) ),
				'orderBy' => array( $pk => 'asc' ),
				'limit'   => $first + 1,
			),
			$viewer
		);
		$items = array();
		foreach ( Wire::encode( $collection, $rows ) as $i => $item ) {
			$items[] = array(
				$rows[ $i ][ $pk ],
				isset( $item['record'] )
					? array(
						'record'  => $item['record'],
						'digest'  => $item['digest'],
						'trashed' => false,
					)
					: $item + array( 'trashed' => false ),
			);
		}
		foreach ( Trash::listed( $collection, $spec, $after, $first + 1 ) as $id => $uid ) {
			$items[] = array(
				$id,
				array(
					'uid'     => $uid,
					'record'  => null,
					'digest'  => null,
					'trashed' => true,
				),
			);
		}
		usort( $items, static fn ( array $a, array $b ): int => $a[0] <=> $b[0] );
		$more  = count( $items ) > $first;
		$items = array_slice( $items, 0, $first );

		return array(
			'records' => array_column( $items, 1 ),
			'next'    => $more ? $items[ $first - 1 ][0] : null,
		);
	}

	/** Sync reads every status the viewer may export. */
	private static function rows( string $collection, array $opts, ?Viewer $viewer ): array {
		// Apply the native post visibility and collection read rule before the page limit.
		if ( null !== $viewer && ( db()->schema()->collection( $collection )['native'] ?? false ) ) {
			return Module::ensureUids( $collection, Module::find( $collection, $opts, $viewer ) );
		}
		$rows = Module::ensureUids( $collection, Module::find( $collection, $opts ) );

		return Extensions::read( $rows, $collection, $viewer );
	}

	/** @return ?array{record?: array, digest?: string, refused?: string, message?: string, row: array} */
	private static function current( string $collection, string $uid, ?Viewer $viewer ): ?array {
		$row = self::rows(
			$collection,
			array(
				'where' => array( 'uid' => $uid ),
				'limit' => 1,
			),
			$viewer
		)[0] ?? null;

		return null === $row ? null : Wire::encode( $collection, array( $row ) )[0] + array( 'row' => $row );
	}

	/** Trusted spacepress-sync apply used by the publish seed; HTTP dispatch always supplies a viewer. */
	public static function seedRecord( string $collection, array $spec, mixed $record ): string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$record = \SpacePress\Seam::container( $record );
		if ( ! is_array( $record ) || ! Uid::valid( $record['uid'] ?? null ) ) {
			throw HttpError::invalidInput( 'seed record.uid must match zr_ + 20 hex characters', '/uid' );
		}
		unset( $record['path'] );
		$uid     = $record['uid'];
		$current = self::current( $collection, $uid, null );
		if ( null === $current && Trash::trashed( $spec, $uid ) !== null ) {
			return 'trashed_skipped';
		}
		if ( null !== $current ) {
			$data = Wire::decode( $collection, $record, false, current: $current['row'] );
			$same = true;
			foreach ( $data as $field => $value ) {
				$normalized = \SpacePress\Schema::normalize( $spec['columns'][ $field ], $value, $field, '/fields' . HttpError::seg( $field ) );
				if ( Canon::json( $normalized ) !== Canon::json( $current['row'][ $field ] ?? null ) ) {
					$same = false; }
			}
			if ( $same ) {
				return 'unchanged'; }
			if ( ( $spec['editor'] ?? true ) || isset( $spec['commerce'] ) || ( $spec['taxonomy'] ?? false ) ) {
				return 'skipped_existing'; }
		}
		$decoded = array(
			'record' => $record,
			'expect' => $current['digest'] ?? 'absent',
		);
		$result  = self::apply( $collection, $spec, \SpacePress\Seam::sync( $collection, $decoded ), $decoded, null );
		if ( $result instanceof Response || $result[0] >= 400 ) {
			throw new HttpError( 409, 'sync_stale', "Seed record $collection $uid changed while publishing; retry the publish." );
		}
		return null === $current ? 'created' : 'updated';
	}

	// ================================================================ write

	/** One instant for the whole apply: the create rule previews the same `now` defaults the write stores. */
	private static function apply( string $collection, array $spec, array $in, mixed $decoded, ?Viewer $viewer ): array|Response {
		return Js::atInstant( static fn () => self::apply_at( $collection, $spec, $in, $decoded, $viewer ) );
	}

	private static function apply_at( string $collection, array $spec, array $in, mixed $decoded, ?Viewer $viewer ): array|Response {
		$record = $in['record'] ?? null;
		if ( ! is_array( $record ) || ( array() !== $record && array_is_list( $record ) ) ) {
			throw HttpError::invalidInput( 'record must be an object', '/record' );
		}
		$uid = $record['uid'] ?? null;
		if ( ! Uid::valid( $uid ) ) {
			throw HttpError::invalidInput( 'record.uid must match zr_ + 20 hex characters', '/uid' );
		}
		$expect = self::expect( $in );
		// Digest the record as sent, objects kept: PHP arrays can't tell `{}` from `[]`, so a value the
		// runtime stores differently comes back as `normalized` instead of a digest the client can't reach.
		$raw          = \SpacePress\Seam::container( \SpacePress\Seam::container( $decoded )['record'] );
		$sent         = Wire::record( $uid, $raw['fields'] ?? array(), $raw['body'] ?? null, array_key_exists( 'body', $raw ) );
		$pk           = $spec['primaryKey'];
		$current      = self::current( $collection, $uid, $viewer );
		$trashed      = null === $current && 'absent' === $expect ? Trash::trashed( $spec, $uid ) : null;
		$soft_deleted = null === $current && null === $trashed && 'absent' === $expect && ! Trash::postBacked( $spec ) && ( $spec['softDelete'] ?? false )
			? ( db()->findFirst(
				$collection,
				array(
					'where'   => array( 'uid' => $uid ),
					'deleted' => 'only',
				)
			)[ $pk ] ?? null )
			: null;
		$op           = null === $current && null === $trashed && null === $soft_deleted ? 'create' : 'update';
		// A rule that refuses this viewer whatever the values refuses before anything is looked up.
		if ( null !== $viewer && Access::isShorthand( Access::collectionRules( $spec )[ $op ] ) && Access::evaluate( Access::collectionRules( $spec )[ $op ], $viewer, $op ) === false ) {
			throw Access::deny( $viewer->user, "$op $collection rows" );
		}
		// Reference lookups answer only after authorization, so they can't probe for uids either.
		$missing = array();
		$data    = Wire::decode( $collection, $record, null === $current, $missing, $current['row'] ?? null, $viewer );
		// Authorize with the values the pipeline will see, before answering anything about the row.
		// Every stale answer comes before the first write: a returned 409 still commits the request.
		if ( null !== $trashed ) {
			// A trashed post is outside every filter, so restoring it needs an update rule that allows every row.
			if ( null !== $viewer && Access::evaluate( Access::collectionRules( $spec )['update'], $viewer, 'update', $data, $spec['columns'], $collection ) !== true ) {
				throw Access::deny( $viewer->user, "restore $collection rows" );
			}
			self::raise_missing( $missing );
			if ( ! Lock::fresh( $collection, $trashed ) ) {
				return self::stale( $collection, $spec, $viewer, false, "$collection $uid changed while this request ran; read it again" );
			}
			Trash::restore( $trashed );
			$current = self::current( $collection, $uid, $viewer );
			// Decode again against the restored row, so a body it already holds isn't rewritten (and a
			// read-only one doesn't refuse the restore).
			$data = Wire::decode( $collection, $record, false, $missing, $current['row'] ?? null, $viewer );
		} elseif ( null !== $soft_deleted ) {
			if ( null !== $viewer && Access::evaluate( Access::collectionRules( $spec )['update'], $viewer, 'update', $data, $spec['columns'], $collection ) !== true ) {
				throw Access::deny( $viewer->user, "restore $collection rows" );
			}
			self::raise_missing( $missing );
			db()->restore( $collection, array( $pk => $soft_deleted ), false, $viewer );
			$current = self::current( $collection, $uid, $viewer );
			$data    = Wire::decode( $collection, $record, false, $missing, $current['row'] ?? null, $viewer );
		} elseif ( null === $current ) {
			if ( null !== $viewer ) {
				Access::require( Access::collectionRules( $spec )['create'], $viewer, 'create', self::create_data( $collection, $spec, array( 'uid' => $uid ) + $data, $viewer ), "create $collection rows", $spec['columns'] );
			}
			if ( 'absent' !== $expect ) {
				return self::stale( $collection, $spec, $viewer, null, "$collection $uid is not on the site" );
			}
			self::raise_missing( $missing );
		} else {
			self::authorize_row( $collection, $spec, 'update', $viewer, $current['row'][ $pk ], $data );
			if ( ! Lock::fresh( $collection, $current['row'][ $pk ] ) ) {
				return self::stale( $collection, $spec, $viewer, false, "$collection $uid changed while this request ran; read it again" );
			}
			if ( $expect !== self::digest_of( $current ) ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
				return self::stale( $collection, $spec, $viewer, $current, "$collection $uid changed since it was read" );
			}
			if ( Canon::digest( $sent ) === $current['digest'] ) {
				return array(
					200,
					array(
						'uid'    => $uid,
						'digest' => $current['digest'],
						'status' => 'unchanged',
					),
				);
			}
			self::raise_missing( $missing );
		}
		// The pipeline authorizes the write itself again.
		null === $current
			? db()->insert( $collection, array( 'uid' => $uid ) + $data, false, $viewer )
			: ( db()->update( $collection, $data, array( $pk => $current['row'][ $pk ] ), true, $viewer )[0] ?? throw HttpError::notFound( "No such $collection row" ) );
		// The answer is what a pull by this viewer returns: same read transforms, same digest.
		$stored = self::current( $collection, $uid, $viewer ) ?? throw new \RuntimeException( "$collection $uid vanished after write" );
		if ( ! isset( $stored['record'] ) ) {
			throw new HttpError( 422, 'not_representable', $stored['message'] ?? 'The stored record cannot be written back' );
		}
		$normalized = $stored['digest'] !== Canon::digest( $sent ); // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
		$out        = array(
			'uid'    => $uid,
			'digest' => $stored['digest'],
			'status' => $normalized ? 'normalized' : 'applied',
		);
		if ( $normalized && self::may_sync_read( $collection, $spec, $viewer ) ) {
			$out['record'] = $stored['record'];
		}

		return array( null === $current ? 201 : 200, $out );
	}

	private static function trash( string $collection, array $spec, array $in, Viewer $viewer ): array|Response {
		$uid = $in['uid'] ?? null;
		if ( ! Uid::valid( $uid ) ) {
			throw HttpError::invalidInput( 'uid must match zr_ + 20 hex characters', '/uid' );
		}
		$expect = self::expect( $in );
		if ( Access::evaluate( Access::collectionRules( $spec )['delete'], $viewer, 'delete', null, $spec['columns'], $collection ) === false ) {
			throw Access::deny( $viewer->user, "trash $collection rows" );
		}
		$current = self::current( $collection, $uid, $viewer );
		if ( null === $current ) {
			return array(
				200,
				array(
					'uid'    => $uid,
					'status' => 'unchanged',
				),
			);
		}
		$pk = $spec['primaryKey'];
		$id = $current['row'][ $pk ];
		self::authorize_row( $collection, $spec, 'delete', $viewer, $id, null );
		if ( ! Lock::fresh( $collection, $id ) ) {
			return self::stale( $collection, $spec, $viewer, false, "$collection $uid changed while this request ran; read it again" );
		}
		if ( $expect !== self::digest_of( $current ) ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
			return self::stale( $collection, $spec, $viewer, $current, "$collection $uid changed since it was read" );
		}
		if ( ! Trash::trash( $collection, $spec, db()->editorRow( $collection, $id ), $viewer ) ) {
			db()->delete( $collection, array( $pk => $id ), false, $viewer );
		}

		return array(
			200,
			array(
				'uid'    => $uid,
				'status' => 'applied',
			),
		);
	}

	// ================================================================ pure helpers

	/** One item or `{ records: [...] }` (≤ 100), answered item by item. */
	private static function batch( array $spec, array $in, Viewer $viewer, string $collection, callable $one ): array {
		self::require_sync_read( $spec, $viewer, $collection );
		if ( ! array_key_exists( 'records', $in ) ) {
			return $one( $in, '' );
		}
		$items = $in['records'];
		if ( ! is_array( $items ) || ! array_is_list( $items ) || count( $items ) > self::BATCH ) {
			throw HttpError::invalidInput( 'records must be a list of at most ' . self::BATCH . ' items', '/records' );
		}
		$out = array();
		foreach ( $items as $i => $item ) {
			if ( ! is_array( $item ) ) {
				throw HttpError::invalidInput( 'Each item must be an object', "/records/$i" );
			}
			try {
				$out[] = $one( $item, "/records/$i" );
			} catch ( HttpError $e ) {
				if ( 'not_representable' !== $e->errorCode ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
					throw $e;
				}
				$out[] = array(
					'refused' => 'not_representable',
					'message' => $e->getMessage(),
				);
			}
		}

		return array( 'records' => $out );
	}

	private static function convert( array $in, string $ptr ): array {
		$text = self::text( $in, 'text', $ptr );

		return array(
			'text' => match ( $in['direction'] ?? null ) {
				'toMarkdown' => Markdown::fromBlocks( $text ),
				'toBlocks' => Markdown::toBlocks( $text ),
				'toHtml' => Html::strip( $text ),
				'fromHtml' => Html::fromHtml( $text ),
				default => throw HttpError::invalidInput( 'direction must be toMarkdown, toBlocks, toHtml or fromHtml', "$ptr/direction" ),
			},
		);
	}

	private static function merge( array $in, string $ptr ): array {
		return Merge::bodies( self::text( $in, 'base', $ptr ), self::text( $in, 'ours', $ptr ), self::text( $in, 'theirs', $ptr ) );
	}

	// ================================================================ helpers

	/**
	 * Reading a collection as sync records (pull, conversions, the `current` record of a conflict) needs
	 * its update rule to allow every row: true, not a filter. Writes are authorized row by row instead.
	 */
	private static function may_sync_read( string $collection, array $spec, ?Viewer $viewer ): bool {
		return null === $viewer || Access::evaluate( Access::collectionRules( $spec )['update'], $viewer, 'update', null, $spec['columns'], $collection ) === true;
	}

	private static function require_sync_read( array $spec, Viewer $viewer, string $collection ): void {
		if ( ! self::may_sync_read( $collection, $spec, $viewer ) ) {
			throw Access::deny( $viewer->user, "sync $collection" );
		}
	}

	/**
	 * The viewer may $op this existing row: its rule allows every row, or is a filter the row matches.
	 * A row outside the filter is masked as 404, as phase-1 item routes do.
	 */
	private static function authorize_row( string $collection, array $spec, string $op, ?Viewer $viewer, int|string $id, ?array $data ): void {
		if ( null === $viewer ) {
			return; }
		if ( ( $spec['native'] ?? false ) && ! \SpacePress\Wp\NativePosts::allows( $viewer, $op, (int) $id ) ) {
			throw HttpError::notFound( "No such $collection row" );
		}
		$rule = Access::evaluate( Access::collectionRules( $spec )[ $op ], $viewer, $op, $data, $spec['columns'], $collection );
		if ( false === $rule ) {
			throw Access::deny( $viewer->user, "$op $collection rows" );
		}
		$pk = $spec['primaryKey'];
		if ( is_array( $rule ) && Module::find(
			$collection,
			array(
				'where' => array( 'AND' => array( array( $pk => $id ), $rule ) ),
				'limit' => 1,
			)
		) === array() ) {
			throw HttpError::notFound( "No such $collection row" );
		}
	}

	/** A create's values as the pipeline's create rule sees them: column defaults and the default status filled. */
	private static function create_data( string $collection, array $spec, array $data, Viewer $viewer ): array {
		$data = db()->withDefaults( $collection, $data, $viewer );
		if ( $spec['drafts'] ?? false ) {
			// Db::draftRules: an absent status is published, and a published row without a date gets now.
			$data['status'] ??= 'published';
			if ( 'published' === $data['status'] && ( $data['publishedAt'] ?? null ) === null ) {
				$data['publishedAt'] = Js::iso( Js::now() );
			}
		}

		return $data;
	}

	/** @param list<HttpError> $missing */
	private static function raise_missing( array $missing ): void {
		if ( array() !== $missing ) {
			throw $missing[0];
		}
	}

	private static function digest_of( ?array $current ): string {
		return null === $current ? 'absent' : ( $current['digest'] ?? 'refused' );
	}

	private static function expect( array $in ): string {
		$expect = $in['expect'] ?? null;
		if ( 'absent' !== $expect && ! ( is_string( $expect ) && preg_match( '/^sha256:[0-9a-f]{64}$/D', $expect ) ) ) {
			throw HttpError::invalidInput( 'expect must be "absent" or "sha256:<64 hex>"', '/expect' );
		}

		return $expect;
	}

	/**
	 * 409 sync_stale with `current` (the record stored now, or null when absent) for callers who may
	 * pull. $current false = changed after this request's snapshot: unknown here, so it is left out.
	 */
	private static function stale( string $collection, array $spec, ?Viewer $viewer, array|false|null $current, string $detail ): Response {
		$problem = App::problem( new HttpError( 409, 'sync_stale', $detail ) );
		if ( false !== $current && self::may_sync_read( $collection, $spec, $viewer ) ) {
			$problem['current'] = null === $current ? null : array_diff_key(
				$current,
				array(
					'row' => true,
					'uid' => true,
				)
			);
		}

		return Response::raw( Js::jsonStringify( $problem ) ?? '{}', 409, array( 'Content-Type' => 'application/problem+json' ) );
	}

	private static function input( string $collection, string $body ): array {
		return \SpacePress\Seam::sync( $collection, self::decode( $body ) );
	}

	private static function decode( string $body ): mixed {
		try {
			$in = trim( $body ) === '' ? array() : Js::decodeJson( $body );
		} catch ( \JsonException $e ) {
			throw new HttpError( 400, 'invalid_json', 'Request body is not valid JSON: ' . $e->getMessage() );
		}
		if ( ! $in instanceof \SpacePress\JsObject && array() !== $in ) {
			throw HttpError::invalidInput( 'Body must be a JSON object', '' );
		}

		return $in;
	}

	private static function text( array $in, string $key, string $ptr ): string {
		return is_string( $in[ $key ] ?? null ) ? $in[ $key ] : throw HttpError::invalidInput( "$key must be a string", "$ptr/$key" );
	}

	private static function int_param( array $query, string $key, int $min, int $max ): ?int {
		if ( ! isset( $query[ $key ] ) ) {
			return null;
		}
		$v = $query[ $key ];
		if ( ! is_string( $v ) || ! preg_match( '/^\d{1,18}$/D', $v ) || (int) $v < $min || (int) $v > $max ) {
			throw HttpError::invalidQuery( "$key must be an integer from $min to $max", "/$key" );
		}

		return (int) $v;
	}
}
