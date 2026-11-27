<?php

declare(strict_types=1);

namespace SpacePress\Wp;

use SpacePress\HttpError;
use SpacePress\Js;
use SpacePress\Viewer;

/**
 * Revision tokens and edit locks for post kinds with staged versions (docs/staged.md).
 *
 * `_rev` is an opaque token of the item as a read saw it. An item read carries the **live** token:
 * the post row and its SpacePress meta, the same for every reader, so it never says whether anything is
 * staged. A staged version read carries the **staged** token: the live state plus the staged
 * revision. With nothing staged the two are the same, so the item's own `_rev` starts a stage.
 *
 * A write that names a token the item no longer has is refused with `409 stale_revision`: the item's
 * PATCH and DELETE take the live token, stage, promote, discard and a scheduled promote the staged
 * one. The problem says what changed since (the fields, as the caller may read them, and whether
 * the staged version changed) and carries the current token. Leaving `_rev` out is an
 * unconditional write, as on core's own routes.
 *
 * The edit lock is core's: `_edit_lock` and `wp_check_post_lock()`, which the block editor and the
 * classic editor set and refresh. While another user holds it, the item's writes are refused with
 * `409 locked` naming the holder, on the API, through abilities, and on core REST's item routes for
 * the kind. `takeover: true` (`?takeover=1` on a DELETE) takes the lock first, as the editor's "Take
 * over" button does; it needs the item's update rule like every write. Both checks run only for a
 * caller the item's update rule covers, so nobody else learns of a lock, a token or its holder.
 */
final class Rev {

	public const FIELD    = '_rev';
	public const TAKEOVER = 'takeover';

	/** True when this collection supports `_rev` optimistic concurrency (post kinds with staged versions, or SQL table kinds with revisions). */
	public static function enabled( array $spec ): bool {
		return Staged::enabled( $spec ) || ( isset( $spec['table'] ) && ( $spec['revisions'] ?? false ) );
	}

	/** The item's live token (what an item read carries), or null for a kind without `_rev`. */
	public static function live( string $collection, int|string $id ): ?string {
		$state = self::state( $collection, $id );

		return null === $state ? null : self::encode( $state, false );
	}

	/** The token a staged version read carries: the live state and the staged revision. */
	public static function staged( string $collection, int $id ): ?string {
		$state = self::state( $collection, $id );

		return null === $state ? null : self::encode( $state, true );
	}

	/** $row with its live `_rev`, for a kind with `_rev`; any other row as it is. */
	public static function attach( string $collection, mixed $row ): mixed {
		return self::attachAll( $collection, array( $row ) )[0];
	}

	/**
	 * {@see attach()} for a page of rows: the tokens of every row are read together, so a list costs
	 * the same statements whatever its length. Keys and order are the caller's.
	 *
	 * @param array<array-key, mixed> $rows
	 * @return array<array-key, mixed>
	 */
	public static function attachAll( string $collection, array $rows ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$spec = Plugin::instance()?->schema->hasCollection( $collection ) ? Plugin::instance()->schema->collection( $collection ) : null;
		if ( null === $spec || ! self::enabled( $spec ) ) {
			return $rows;
		}
		$pk    = $spec['primaryKey'];
		$intPk = ( $spec['columns'][ $pk ]['type'] ?? '' ) === 'integer'; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$ids   = array();
		foreach ( $rows as $row ) {
			if ( is_array( $row ) && isset( $row[ $pk ] ) ) {
				$ids[] = $intPk ? (int) $row[ $pk ] : (string) $row[ $pk ]; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			}
		}
		$states = self::states( $collection, $ids );
		foreach ( $rows as $i => $row ) {
			$key   = is_array( $row ) && isset( $row[ $pk ] ) ? ( $intPk ? (int) $row[ $pk ] : (string) $row[ $pk ] ) : null; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$state = null !== $key ? ( $states[ $key ] ?? null ) : null;
			if ( null !== $state ) {
				$rows[ $i ] = $row + array( self::FIELD => self::encode( $state, false ) );
			}
		}

		return $rows;
	}

	/**
	 * Take `_rev` and `takeover` out of a request body: they are the write's conditions, not fields.
	 *
	 * @return array{array, mixed, bool} [the body without them, `_rev` (null when not sent), takeover]
	 */
	public static function split( array $body ): array {
		$rev      = $body[ self::FIELD ] ?? null;
		$takeover = $body[ self::TAKEOVER ] ?? false;
		if ( false !== $takeover && true !== $takeover ) {
			throw HttpError::invalidInput( 'takeover must be true or false', '/' . self::TAKEOVER );
		}
		unset( $body[ self::FIELD ], $body[ self::TAKEOVER ] );

		return array( $body, $rev, $takeover );
	}

	/**
	 * Refuse a write to item $id when another user holds its edit lock (unless $takeover), or when
	 * $expected (null: not sent) is not its current token. $staged: the token covers the staged
	 * version too. Call it inside the write's transaction, after the item's row lock
	 * ({@see WpPostStore::stagedLock()}), so nothing changes between this check and the write.
	 * A caller the item's update rule doesn't cover is left to the write, which refuses it as it
	 * refuses anyone: neither the lock nor the token is theirs to learn about.
	 */
	public static function require( string $collection, int|string $id, mixed $expected, bool $takeover, ?Viewer $viewer, bool $staged = false, ?array $data = null ): void {
		$state = self::state( $collection, $id );
		if ( null === $state ) {
			return;
		}
		$plugin = Plugin::instance();
		$spec   = null !== $plugin && $plugin->schema->hasCollection( $collection ) ? $plugin->schema->collection( $collection ) : null;
		$isPost = null !== $spec && Staged::enabled( $spec ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		if ( null !== $viewer ) {
			$allowed = ( $isPost && CoreAccess::covers( $collection, 'update', (int) $id, $viewer ) ) // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				|| ( $plugin?->db()->permits( $collection, 'update', $id, $viewer, $data ) ?? false );
			if ( ! $allowed ) {
				return; // the write refuses them as it refuses anyone the rule doesn't cover
			}
		}
		if ( $isPost ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			self::lock( (int) $id, $takeover );
		}
		if ( null === $expected ) {
			return;
		}
		if ( ! is_string( $expected ) || '' === $expected ) {
			throw HttpError::invalidInput( '_rev must be the token a read returned', '/' . self::FIELD );
		}
		if ( self::current( $state, $expected, $staged ) ) {
			return;
		}
		throw new StaleRevision( self::encode( $state, $staged ), self::changed( $collection, $id, self::decode( $expected ), $state, $staged, $viewer ) );
	}

	/**
	 * Run $write (an update or delete of item $id) under the item's row lock, after {@see require()}.
	 * The write's own transaction joins this one, so nothing changes between the check and it.
	 */
	public static function guarded( string $collection, int|string $id, mixed $expected, bool $takeover, ?Viewer $viewer, callable $write, ?array $data = null ): mixed {
		$plugin = Plugin::instance();
		if ( null === $plugin ) {
			return $write();
		}
		$spec  = $plugin->schema->hasCollection( $collection ) ? $plugin->schema->collection( $collection ) : null;
		$store = $plugin->db()->store();
		if ( null === $spec || ! self::enabled( $spec ) || ! $store instanceof CompositeStore ) {
			return $write();
		}
		if ( Staged::enabled( $spec ) ) {
			if ( ! preg_match( '/^\d{1,18}$/D', (string) $id ) ) {
				return $write();
			}

			return $plugin->db()->transaction(
				static function () use ( $store, $collection, $id, $expected, $takeover, $viewer, $write, $data ): mixed {
					$store->posts->stagedLock( (int) $id );
					self::require( $collection, (int) $id, $expected, $takeover, $viewer, data: $data );

					return $write();
				}
			);
		}

		// SQL table kind: lock the row inside the transaction before checking `_rev`.
		return $plugin->db()->transaction(
			static function () use ( $plugin, $spec, $collection, $id, $expected, $takeover, $viewer, $write, $data ): mixed {
				$conn      = $plugin->connection();
				$table     = '`' . str_replace( '`', '``', $spec['existingTable'] ?? ( $conn->prefix() . $spec['table'] ) ) . '`';
				$pkCol     = '`' . str_replace( '`', '``', (string) ( $spec['columns'][ $spec['primaryKey'] ]['column'] ?? $spec['primaryKey'] ) ) . '`'; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$forUpdate = $conn->sqlite() ? '' : ' FOR UPDATE'; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$conn->run( "SELECT 1 FROM $table WHERE $pkCol = ?$forUpdate", array( $id ) ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.InterpolatedVariableNotSnakeCase -- Preserve the existing PHP variable name.
				self::require( $collection, $id, $expected, $takeover, $viewer, data: $data );

				return $write();
			}
		);
	}

	/**
	 * Core's edit lock: refused while another user holds it, unless $takeover, which takes it for the
	 * caller as the editor's "Take over" does. The trusted CLI and cron never hold or meet a lock.
	 */
	public static function lock( int $id, bool $takeover ): void {
		if ( get_current_user_id() === 0 ) {
			return;
		}
		if ( ! function_exists( 'wp_check_post_lock' ) ) {
			require_once ABSPATH . 'wp-admin/includes/post.php';
		}
		$holder = wp_check_post_lock( $id );
		if ( false === $holder ) {
			return;
		}
		if ( $takeover ) {
			Plugin::instance()?->connection()->touchPost( $id );
			wp_set_post_lock( $id );

			return;
		}
		$user = get_userdata( (int) $holder );
		throw new Locked( (int) $holder, $user instanceof \WP_User ? (string) $user->display_name : '' );
	}

	/**
	 * `rest_pre_dispatch`: a core REST write to an item of a SpacePress kind that another user has locked
	 * (its update, delete, or a revision restore) is a 409, for a caller who may edit the item.
	 * Core's own block-editor autosave already stores a per-user autosave while a post is locked.
	 */
	public static function restLock( mixed $result, mixed $server, mixed $request ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( null !== $result || ! $request instanceof \WP_REST_Request || in_array( $request->get_method(), array( 'GET', 'HEAD', 'OPTIONS' ), true )
			|| Facade::dispatching() || get_current_user_id() === 0 ) {
			return $result;
		}
		foreach ( Plugin::instance()?->schema->collections() ?? array() as $spec ) {
			if ( ! Staged::enabled( $spec ) ) {
				continue;
			}
			$type = (string) $spec['wp']['postType'];
			$base = preg_quote( (string) ( get_post_type_object( $type )?->rest_base ?: $type ), '#' ); // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
			if ( ! preg_match( '#^/wp/v2/' . $base . '/(\d+)(/revisions/\d+/restore)?/?$#i', $request->get_route(), $m ) ) {
				continue;
			}
			$id = (int) $m[1];
			if ( get_post_type( $id ) !== $type || ! current_user_can( 'edit_post', $id ) ) {
				return $result; // core's own answer (404, 403) for a caller who may not edit it
			}
			try {
				self::lock( $id, (bool) $request->get_param( self::TAKEOVER ) );
			} catch ( Locked $e ) {
				return new \WP_Error( 'sp_locked', $e->getMessage(), array( 'status' => 409 ) + $e->details() );
			}
		}

		return $result;
	}

	// ================================================================ internals

	/**
	 * The item as tokens describe it: `live`, a digest of the post row + meta (or SQL table row),
	 * `revision`, the id of its newest revision, and `staged` (post kinds only).
	 *
	 * @return ?array{id: int|string, live: string, revision: int, staged: ?string}
	 */
	private static function state( string $collection, int|string $id ): ?array {
		return self::states( $collection, array( $id ) )[ $id ] ?? null;
	}

	/**
	 * {@see state()} of each of $ids that exists, read from the database as it is now (never from a
	 * cache: a write is checked against it). Three statements however many items there are (the
	 * posts, their SpacePress meta, their newest and staged revisions), and two more when one of them
	 * has a staged version.
	 *
	 * @param list<int> $ids
	 * @return array<int, array{id: int, live: string, revision: int, staged: ?string}>
	 */
	private static function states( string $collection, array $ids ): array {
		$plugin = Plugin::instance();
		$spec   = null !== $plugin && $plugin->schema->hasCollection( $collection ) ? $plugin->schema->collection( $collection ) : null;
		$ids    = array_values( array_unique( $ids ) );
		if ( null === $spec || ! self::enabled( $spec ) || array() === $ids ) {
			return array();
		}
		$db = $plugin->connection();
		$in = static fn ( array $values ): string => implode( ', ', array_fill( 0, count( $values ), '?' ) );
		if ( ! Staged::enabled( $spec ) ) {
			$table  = '`' . str_replace( '`', '``', $spec['existingTable'] ?? ( $db->prefix() . $spec['table'] ) ) . '`';
			$pkName = (string) $spec['primaryKey']; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$physPk = (string) ( $spec['columns'][ $pkName ]['column'] ?? $pkName ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$pkCol  = '`' . str_replace( '`', '``', $physPk ) . '`'; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$intPk  = ( $spec['columns'][ $pkName ]['type'] ?? '' ) === 'integer'; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$rows   = array();
			foreach ( $db->run( "SELECT * FROM $table WHERE $pkCol IN ({$in($ids)})", $ids ) as $row ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.InterpolatedVariableNotSnakeCase -- Preserve the existing PHP variable name.
				$k          = $intPk ? (int) $row[ $physPk ] : (string) $row[ $physPk ]; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$rows[ $k ] = $row;
			}
			if ( array() === $rows ) {
				return array();
			}
			$revs     = array();
			$revTable = $db->prefix() . 'sp__revisions'; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			if ( $db->run( 'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', array( $revTable ) ) !== array() ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$strIds = array_map( 'strval', array_keys( $rows ) ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				foreach ( $db->run( "SELECT `pk`, MAX(`id`) AS id FROM `$revTable` WHERE `collection` = ? AND `pk` IN ({$in($strIds)}) GROUP BY `pk`", array( $collection, ...$strIds ) ) as $r ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.InterpolatedVariableNotSnakeCase, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
					$k          = $intPk ? (int) $r['pk'] : (string) $r['pk']; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
					$revs[ $k ] = (int) $r['id'];
				}
			}
			$out = array();
			foreach ( $rows as $k => $row ) {
				$out[ $k ] = array(
					'id'       => $k,
					'live'     => self::digest( $row ),
					'revision' => $revs[ $k ] ?? 0,
					'staged'   => null,
				);
			}

			return $out;
		}
		$ids   = array_map( 'intval', $ids );
		$wpdb  = $db->wpdb();
		$posts = array();
		foreach ( $db->run( "SELECT ID, post_modified_gmt, post_status, post_name, post_title, post_content, post_excerpt, post_date_gmt, post_password, post_author FROM `{$wpdb->posts}` WHERE ID IN ({$in($ids)})", $ids ) as $post ) {
			$posts[ (int) $post['ID'] ] = $post;
		}
		if ( array() === $posts ) {
			return array();
		}
		$ids = array_keys( $posts );
		// Each item's rows keep the order its own read gave them: by key, then by meta id.
		$prefix = $wpdb->esc_like( (string) $spec['wp']['metaPrefix'] );
		$meta   = array_fill_keys( $ids, array() );
		foreach ( $db->run(
			"SELECT post_id, meta_key, meta_value FROM `{$wpdb->postmeta}` WHERE post_id IN ({$in($ids)}) AND (meta_key LIKE ? OR meta_key LIKE ?) ORDER BY post_id, meta_key, meta_id",
			array( ...$ids, $prefix . '%', '\\_' . $prefix . '%' ),
		) as $row ) {
			$meta[ (int) $row['post_id'] ][] = array(
				'meta_key'   => $row['meta_key'],
				'meta_value' => $row['meta_value'],
			);
		}
		// The newest revision of each item, and whether it has a staged one: both are revisions of
		// the item, told apart by the name they are stored under. Nothing is staged for most items.
		// The names are listed too, so the database can find the rows by `post_name`'s index, as
		// each item's own read did, whatever number of revisions an item has.
		$names     = static fn ( array $of ): array => array( ...array_map( static fn ( int $id ): string => $id . '-revision-v1', $of ), ...array_map( array( WpPostStore::class, 'stagedName' ), $of ) );
		$revisions = $holding = array(); // phpcs:ignore Squiz.PHP.DisallowMultipleAssignments.Found -- Keep the assignment and its test together.
		foreach ( $db->run(
			"SELECT post_parent, MAX(CASE WHEN post_name = CONCAT(post_parent, '-revision-v1') THEN ID ELSE 0 END) AS revision,"
			. ' MAX(CASE WHEN post_name = CONCAT(post_parent, ?) THEN ID ELSE 0 END) AS staged'
			. " FROM `{$wpdb->posts}` WHERE post_parent IN ({$in($ids)}) AND post_type = 'revision' AND post_name IN ({$in($names($ids))}) GROUP BY post_parent",
			array( WpPostStore::STAGED_SUFFIX, ...$ids, ...$names( $ids ) ),
		) as $row ) {
			$revisions[ (int) $row['post_parent'] ] = (int) $row['revision'];
			if ( (int) $row['staged'] > 0 ) {
				$holding[] = (int) $row['post_parent'];
			}
		}
		$staged = $stagedMeta = array(); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase, Squiz.PHP.DisallowMultipleAssignments.Found -- Preserve the existing PHP variable name. Keep the assignment and its test together.
		if ( array() !== $holding ) {
			foreach ( $db->run(
				"SELECT r.post_parent, r.ID, r.post_modified_gmt, r.post_title, r.post_content, m.meta_value FROM `{$wpdb->posts}` r LEFT JOIN `{$wpdb->postmeta}` m ON m.post_id = r.ID AND m.meta_key = ?"
				. " WHERE r.post_parent IN ({$in($holding)}) AND r.post_type = 'revision' AND r.post_name IN ({$in($holding)}) AND r.post_name = CONCAT(r.post_parent, ?) ORDER BY r.ID",
				array( Staged::META, ...$holding, ...array_map( array( WpPostStore::class, 'stagedName' ), $holding ), WpPostStore::STAGED_SUFFIX ),
			) as $row ) {
				$parent = (int) $row['post_parent'];
				unset( $row['post_parent'] );
				$staged[ $parent ][] = $row;
			}
			// A staged revision's fields change through its meta; its id, record and copy of the post cover a re-stage.
			$first = array_values( array_map( static fn ( array $rows ): int => (int) $rows[0]['ID'], $staged ) );
			foreach ( array() === $first ? array() : $db->run( "SELECT post_id, meta_key, meta_value FROM `{$wpdb->postmeta}` WHERE post_id IN ({$in($first)}) ORDER BY post_id, meta_key, meta_id", $first ) as $row ) {
				$stagedMeta[ (int) $row['post_id'] ][] = array( // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
					'meta_key'   => $row['meta_key'],
					'meta_value' => $row['meta_value'],
				);
			}
		}
		$out = array();
		foreach ( $posts as $id => $post ) {
			$out[ $id ] = array(
				'id'       => $id,
				'live'     => self::digest( array( $post, $meta[ $id ] ) ),
				'revision' => $revisions[ $id ] ?? 0,
				'staged'   => isset( $staged[ $id ] ) ? self::digest( array( $staged[ $id ], $stagedMeta[ (int) $staged[ $id ][0]['ID'] ] ?? array() ) ) : null, // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			);
		}

		return $out;
	}

	private static function digest( mixed $value ): string {
		return substr( hash_hmac( 'sha256', (string) Js::jsonStringify( $value ), wp_salt( 'nonce' ) ), 0, 22 );
	}

	/**
	 * An item token is `i`, the item, its newest revision and the live digest. A staged token is `s`
	 * and adds the staged digest (`-` when nothing is staged): with nothing staged, an item token is
	 * accepted where a staged one is expected, so the item's own `_rev` starts a stage.
	 */
	private static function encode( array $state, bool $staged ): string {
		$claim = array( $staged ? 's' : 'i', $state['id'], $state['revision'], $state['live'] );
		if ( $staged ) {
			$claim[] = $state['staged'] ?? '-';
		}

		return rtrim( strtr( base64_encode( (string) json_encode( $claim ) ), '+/', '-_' ), '=' );
	}

	/** @return ?array{id: int|string, revision: int, live: string, staged: ?string} (`staged` false-y for an item token) */
	private static function decode( string $token ): ?array {
		$claim = json_decode( (string) base64_decode( strtr( $token, '-_', '+/' ), true ), true );
		if ( ! is_array( $claim ) || ! in_array( $claim[0] ?? null, array( 'i', 's' ), true ) || count( $claim ) !== ( 's' === $claim[0] ? 5 : 4 )
			|| ( ! is_int( $claim[1] ) && ! is_string( $claim[1] ) ) || ! is_int( $claim[2] ) || ! is_string( $claim[3] ) || ( isset( $claim[4] ) && ! is_string( $claim[4] ) ) ) {
			return null;
		}

		return array(
			'id'       => $claim[1],
			'revision' => $claim[2],
			'live'     => $claim[3],
			'staged'   => 's' === $claim[0] ? ( '-' === $claim[4] ? null : $claim[4] ) : false,
		);
	}

	/** Is $expected this item's current token: exactly, or an item token where a staged one is expected and nothing is staged? */
	private static function current( array $state, string $expected, bool $staged ): bool {
		if ( hash_equals( self::encode( $state, $staged ), $expected ) ) {
			return true;
		}

		return $staged && null === $state['staged'] && hash_equals( self::encode( $state, false ), $expected );
	}

	/**
	 * What changed since the token was given out: the fields that differ between the item's
	 * revision the token was read at and the item now, as $viewer may read both (a field it may not
	 * read is never named, changed or not); and, for a staged token, whether the staged version
	 * changed. `fields` is null when that revision can't be read (the token isn't this item's, or
	 * its history was pruned).
	 *
	 * @return array{fields: ?list<string>, staged?: bool}
	 */
	private static function changed( string $collection, int|string $id, ?array $then, array $now, bool $staged, ?Viewer $viewer ): array {
		$out = array( 'fields' => null ) + ( $staged ? array( 'staged' => null === $then || ( false === $then['staged'] ? null !== $now['staged'] : $then['staged'] !== $now['staged'] ) ) : array() );
		if ( null === $then || (string) $then['id'] !== (string) $id ) {
			return $out;
		}
		if ( $then['live'] === $now['live'] ) {
			return array( 'fields' => array() ) + $out;
		}
		if ( 0 === $then['revision'] ) {
			return $out;
		}
		$plugin = Plugin::instance() ?? throw new \LogicException( 'No SpacePress app' );
		$db     = $plugin->db();
		try {
			$before = $db->revisionRow( $collection, $id, $then['revision'] );
		} catch ( HttpError ) {
			return $out;
		}
		$spec             = $plugin->schema->collection( $collection );
		$after            = Staged::enabled( $spec )
			? ( $db->editorRow( $collection, (int) $id ) ?? array() )
			: ( $db->findFirst(
				$collection,
				array(
					'where'   => array( $spec['primaryKey'] => $id ),
					'deleted' => 'include',
				)
			) ?? array() );
		$read             = static fn ( array $row ): array => null === $viewer ? $row : ( $db->current( static fn () => \SpacePress\Extensions::read( array( $row ), $collection, $viewer ) )[0] ?? array() );
		[$before, $after] = array( $read( $before ), $read( $after ) );
		$fields           = array();
		foreach ( $spec['columns'] as $name => $def ) {
			$name = (string) $name;
			// Generated on every update, hidden, or unreadable to this caller on either side.
			if ( isset( $def['onUpdate'] ) || ( $def['hidden'] ?? false ) || ! array_key_exists( $name, $before ) || ! array_key_exists( $name, $after ) ) {
				continue;
			}
			if ( ! Js::sameJson( $before[ $name ], $after[ $name ] ) ) {
				$fields[] = $name;
			}
		}

		return array( 'fields' => $fields ) + $out;
	}
}
