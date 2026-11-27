<?php

declare(strict_types=1);

namespace SpacePress\Wp;

use SpacePress\Access;
use SpacePress\FieldAccess;
use SpacePress\HttpError;

/**
 * One transaction per editor save (§3.3, §4.9). A save of a SpacePress post through core REST, wp-admin
 * (the edit form, quick edit, a revision restore) or any other `wp_insert_post` caller runs, with its
 * meta, SCF fields and SpacePress's after hooks, in one MySQL transaction opened before core writes the post.
 *
 * Before it commits, a signed-in user's save is authorized on what it actually changed: the row
 * before against the row after, whichever form field, `acf` alias or core column wrote it. SpacePress's
 * field write rules run on that change, then the create rule, or the update rule with that data, as
 * in SpacePress's write pipeline. A refusal rolls the whole save back: core REST answers with SpacePress's 401/403 (code and
 * pointer), wp-admin with an error page. Calls with no signed-in user (WP-CLI, cron, other plugins'
 * code) are WordPress's trusted callers and are not authorized here, as on every core API.
 *
 * Owners: `rest` (PostsController wraps create/update), `restore` (wp-admin's revision restore, whose
 * SCF meta is copied after the post update), `delete` (a permanent delete, from before_delete_post to
 * deleted_post), `core` (everything else, ended at wp_after_insert_post). A SpacePress hook that throws in
 * any of them rolls the whole operation back ({@see fail()}).
 * A save still open at shutdown never completed (a callback threw and was caught, the request died)
 * and rolls back.
 */
final class EditorSave {

	/** @var ?array{owner: string, collection: string, postId: ?int, before: ?array, covers: list<string>, declared: ?array, supplied: list<string>, checked: bool, claimed: bool} */
	private static ?array $open = null;
	/** Inserts of the open save's collection started inside it (hooks): their ids come first. */
	private static int $nested = 0;

	/** Native collision resolution must not reveal competing slugs before save authorization. */
	public static function uniqueSlug( mixed $override, string $slug, ?int $postId, string $status, string $postType ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		$postId ??= 0; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$plugin   = Plugin::instance();
		if ( null === $plugin || self::busy() || get_current_user_id() === 0
			|| ( $collection = CoreAccess::collection( $postType ) ) === null // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Keep the assignment and its test together. Preserve the existing PHP variable name.
			|| ( $column = $plugin->schema->collection( $collection )['slug'] ?? null ) === null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
			return $override;
		}
		try {
			$viewer   = CoreAccess::viewer() ?? throw new HttpError( 403, 'suspended', 'This account is suspended' );
			$before   = $postId > 0 ? $plugin->db()->editorRow( $collection, $postId ) : null; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$wrapped  = null !== self::$open && self::$open['collection'] === $collection && self::$open['postId'] === $postId; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$form     = is_admin() && (int) ( $_POST['post_ID'] ?? 0 ) === $postId // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				&& in_array( $_POST['action'] ?? null, array( 'editpost', 'inline-save' ), true );
			$supplied = $wrapped ? self::$open['supplied'] : self::formData( $collection )[1];
			if ( null !== $before && ( $wrapped || $form ) && ! in_array( $column, $supplied, true )
				&& in_array( get_post_status( $postId ), array( 'publish', 'future', 'private' ), true ) ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				// An omitted native column stays unchanged, including an empty stored value. Never
				// branch on hidden equality or ask WordPress to repair it against competing rows.
				return (string) ( $before[ $column ] ?? '' );
			}
			$publishing = null !== $before && ! in_array( get_post_status( $postId ), array( 'publish', 'future', 'private' ), true ) // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				&& in_array( $status, array( 'publish', 'future', 'private' ), true );
			$plugin->db()->requireUniqueVisibility( $collection, array( $column => $slug ), $viewer, $publishing, $before );
			if ( ! $publishing && $plugin->db()->unchangedReadableUnique( $collection, $column, $slug, $before, $viewer ) ) {
				return $slug; // Preserve the visible value without WordPress querying competing rows.
			}
		} catch ( HttpError $e ) {
			if ( null === self::$open && is_admin() ) {
				wp_die(
					esc_html( $e->getMessage() ),
					'',
					array(
						'response'  => $e->status,
						'code'      => $e->errorCode, // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
						'back_link' => true,
					)
				);
			}
			self::fail( $e );
		}

		return $override;
	}

	/**
	 * Core REST create/update: the controller's save runs as one save, authorized before it commits;
	 * a refusal answers with SpacePress's problem. Inside an already open transaction (a REST call made by
	 * code running in one) the save is still authorized, and a refusal or any core error throws, so
	 * the enclosing transaction rolls back instead of committing a half-done save.
	 */
	public static function rest( string $collection, ?int $postId, \WP_REST_Request $request, callable $save ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$plugin = Plugin::instance() ?? throw new \LogicException( 'No SpacePress app' );
		$before = null === $postId ? null : $plugin->db()->editorRow( $collection, $postId ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		try {
			[$declared, $supplied] = CoreAccess::incoming( $collection, $request, singleSelector: true );
			$viewer                = CoreAccess::viewer() ?? throw new HttpError( 403, 'suspended', 'This account is suspended' );
			$plugin->db()->requireUniqueVisibility( $collection, $declared, $viewer, null === $before, $before );
			$plugin->db()->validateWriteReferences( $collection, $declared, $viewer );
			self::check_core_fields( $collection, $request, $declared, $before );
		} catch ( HttpError $e ) {
			if ( $plugin->connection()->inTransaction() ) {
				throw $e;
			}

			return CoreAccess::error( $e );
		}
		if ( $plugin->connection()->inTransaction() ) {
			$outer      = self::$open;
			self::$open = self::scope( 'rest', $collection, $postId, $before, $declared, $supplied ) + array( 'nested' => true ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			try {
				$result = $save();
				if ( is_wp_error( $result ) ) {
					// Core may fail after writing the post or some fields: the enclosing transaction is
					// the only rollback point, so its work is abandoned rather than half-committed.
					throw new HttpError( (int) ( $result->get_error_data()['status'] ?? 500 ), (string) $result->get_error_code(), $result->get_error_message() );
				}
				if ( ! self::$open['checked'] ) {
					self::authorize();
				}

				return $result;
			} catch ( Refused $e ) {
				throw $e->error;
			} finally {
				self::$open = $outer;
			}
		}
		self::open( 'rest', $collection, $postId, $before, $declared, $supplied ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		try {
			$result = $save();
			if ( ! is_wp_error( $result ) && ! self::$open['checked'] ) {
				self::authorize();
			}
		} catch ( Refused $e ) {
			self::rollback();

			return CoreAccess::error( $e->error );
		} catch ( HttpError | \SpacePress\JsError $e ) {
			// A SpacePress hook refused the save (§1.7): the editor sees its status and message, as the API answers.
			self::rollback();
			$problem = \SpacePress\App::problem( $e );

			return CoreAccess::error( new HttpError( $problem['status'], $problem['code'], $problem['detail'], $problem['pointer'] ?? null ) );
		} catch ( \Throwable $e ) {
			self::rollback();
			throw $e;
		}
		is_wp_error( $result ) ? self::rollback() : self::commit();

		return $result;
	}

	/**
	 * The columns core stores itself (title, content, slug) under their SpacePress rules (min, max,
	 * pattern, validate), as every other write path checks them; fields in `meta` and `acf` are
	 * checked where they're stored (PostMeta, Scf). A core-shaped name the request doesn't use (an
	 * unknown body key) is core's to ignore, as on any other core route.
	 */
	private static function check_core_fields( string $collection, \WP_REST_Request $request, array $declared, ?array $before ): void {
		self::check_columns( $collection, $declared, $before );
	}

	/** SpacePress's rules (min, max, pattern, validate) on the core columns (title, content, slug) in $values. */
	private static function check_columns( string $collection, array $values, ?array $before ): void {
		$spec   = Plugin::instance()?->schema->collection( $collection ) ?? array();
		$core   = array_filter( array( $spec['title'] ?? null, $spec['content'] ?? null, $spec['slug'] ?? null, $spec['excerpt'] ?? null ) );
		$values = array_intersect_key( $values, array_flip( $core ) );
		if ( array() === $values ) {
			return;
		}
		$ctx = array(
			'data' => $values + ( $before ?? array() ),
			'user' => WpAuth::current(),
		);
		foreach ( $values as $col => $value ) {
			$def  = $spec['columns'][ $col ];
			$norm = \SpacePress\Schema::normalize( $def, $value, (string) $col, HttpError::seg( (string) $col ) );
			\SpacePress\Schema::checkRules( $def, $norm, (string) $col, HttpError::seg( (string) $col ), $ctx, $spec['columns'] );
		}
	}

	/** wp_insert_post_data: open the save of a SpacePress post before core writes it. */
	public static function begin( mixed $data, mixed $postarr, mixed $unsanitized = null, mixed $update = false ): mixed {
		$plugin = Plugin::instance();
		if ( ! is_array( $data ) || null === $plugin || $plugin->connection()->busy()
			|| ( $collection = CoreAccess::collection( (string) ( $data['post_type'] ?? '' ) ) ) === null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
			return $data;
		}
		if ( $plugin->connection()->inTransaction() ) {
			// A REST create's own insert is the save's post; any other insert of the collection inside
			// the open save (another plugin's save_post) is not, and learns its id first.
			if ( null !== self::$open && ! $update && null === self::$open['postId'] && $collection === self::$open['collection'] ) {
				self::$open['claimed'] ? self::$nested++ : self::$open['claimed'] = true;
			}

			return $data;
		}
		$id     = $update && is_array( $postarr ) ? (int) ( $postarr['ID'] ?? 0 ) : 0;
		$before = $id > 0 ? $plugin->db()->editorRow( $collection, $id ) : null;
		if ( null !== $before ) {
			$data = CoreAccess::keepHidden( $collection, $before, $data ); // controls the form left blank
		}
		[$declared, $supplied] = self::formData( $collection );
		self::open( 'core', $collection, $id > 0 ? $id : null, $before, $declared, $supplied );
		if ( $id > 0 && get_post_status( $id ) === 'trash' ) {
			self::$open['checked'] = true; // untrash: delete_post on the trashed post decided it
		}

		return $data;
	}

	/** wp_insert_post: an insert learns its post id here. */
	public static function inserted( mixed $postId ): void { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		if ( null === self::$open || null !== self::$open['postId'] || self::busy()
			|| CoreAccess::collection( (string) get_post_type( (int) $postId ) ) !== self::$open['collection'] ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			return;
		}
		if ( self::$nested > 0 ) {
			--self::$nested;

			return;
		}
		self::$open['postId'] = (int) $postId; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	}

	public static function check( mixed $post ): void {
		if ( null !== self::$open && 'restore' !== self::$open['owner'] && ! self::$open['checked'] && self::owns( $post ) ) {
			self::authorize_or_die();
		}
	}

	public static function end( mixed $post ): void {
		if ( null !== self::$open && 'core' === self::$open['owner'] && self::owns( $post ) ) {
			if ( ! self::$open['checked'] ) {
				self::authorize_or_die();
			}
			// The post's URLs join this transaction's purge announcement, sent after the commit.
			Purges::collect( (int) ( $post instanceof \WP_Post ? $post->ID : $post ) );
			self::commit();
		}
	}

	public static function beginDelete( mixed $postId ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		$plugin = Plugin::instance();
		if ( null !== self::$open && 'delete' === self::$open['owner'] && self::$open['postId'] === (int) $postId ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			self::$open['prepared'] = false; // prepared at pre_delete_post: core started it, it goes on in it
			return;
		}
		if ( null === $plugin || self::busy() || $plugin->connection()->inTransaction()
			|| ( $collection = CoreAccess::collection( (string) get_post_type( (int) $postId ) ) ) === null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Keep the assignment and its test together. Preserve the existing PHP variable name.
			return;
		}
		self::open( 'delete', $collection, (int) $postId, null, null, array() ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		self::$open['checked'] = true; // delete_post (the delete rule) decided it
	}

	/**
	 * Open a delete's transaction before core starts it (`pre_delete_post`), for a delete whose
	 * before half must be able to decline it; false when another save is open.
	 */
	public static function prepareDelete( string $collection, int $postId ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		$plugin = Plugin::instance();
		if ( null !== self::$open && 'delete' === self::$open['owner'] && ( self::$open['prepared'] ?? false ) ) {
			self::rollback(); // a prepared delete that never started: a later pre_delete_post declined it
		}
		if ( null === $plugin || self::busy() || $plugin->connection()->inTransaction() ) {
			return false;
		}
		self::open( 'delete', $collection, $postId, null, null, array() ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		self::$open['checked']  = true;
		self::$open['prepared'] = true;

		return true;
	}

	/** The prepared delete was refused by its before half: nothing of it commits. */
	public static function abandonDelete(): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( null !== self::$open && 'delete' === self::$open['owner'] ) {
			self::rollback();
		}
	}

	/** A prepared delete core never started (a later pre_delete_post declined it) rolls back. */
	public static function abandonPrepared(): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( null !== self::$open && 'delete' === self::$open['owner'] && ( self::$open['prepared'] ?? false ) ) {
			self::rollback();
		}
	}

	public static function endDelete( mixed $postId ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		if ( null !== self::$open && 'delete' === self::$open['owner'] && self::$open['postId'] === (int) $postId ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			self::commit();
		}
	}

	/** wp-admin's revision.php checks its nonce, then restores: the save opens here. */
	public static function beginRestore( mixed $action, mixed $result ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$plugin = Plugin::instance();
		if ( null === $plugin || false === $result || ! is_string( $action ) || ! str_starts_with( $action, 'restore-post_' )
			|| $plugin->connection()->inTransaction() ) {
			return;
		}
		$revision_id = (int) substr( $action, strlen( 'restore-post_' ) );
		$revision    = wp_get_post_revision( $revision_id );
		$collection  = $revision instanceof \WP_Post ? CoreAccess::collection( (string) get_post_type( $revision->post_parent ) ) : null;
		if ( null !== $collection ) {
			self::open( 'restore', $collection, $revision->post_parent, $plugin->db()->editorRow( $collection, $revision->post_parent ), null, array() );
		}
	}

	public static function endRestore( mixed $postId ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		if ( null !== self::$open && 'restore' === self::$open['owner'] && self::$open['postId'] === (int) $postId ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			self::authorize_or_die();
			self::commit();
		}
	}

	/**
	 * A save still open at shutdown never reached its explicit end (wp_after_insert_post's last callback,
	 * deleted_post, a restore's action, the REST controller's return): a callback threw and its caller
	 * caught it, or the request died. SpacePress's after hooks may not have run, so it rolls back.
	 */
	public static function shutdown(): void {
		if ( null !== self::$open ) {
			self::rollback();
		}
	}

	/**
	 * A SpacePress after hook threw inside an open save (§1.7: throwing rolls back every write): nothing of
	 * the save commits. Core REST answers the problem itself (rest()); wp-admin and other callers get
	 * an error page with the hook's status and message, never a critical error.
	 */
	public static function fail( \Throwable $e ): never {
		if ( null === self::$open || 'rest' === self::$open['owner'] || ( self::$open['nested'] ?? false ) ) {
			throw $e;
		}
		if ( 'delete' === self::$open['owner'] && defined( 'REST_REQUEST' ) && REST_REQUEST ) {
			self::rollback();
			throw $e; // the controller answers it
		}
		self::rollback();
		$problem = \SpacePress\App::problem( $e );
		wp_die(
			esc_html( $problem['detail'] ),
			'',
			array(
				'response'  => $problem['status'],
				'code'      => $problem['code'],
				'back_link' => true,
			)
		);
		throw $e; // a wp_die handler that returns
	}

	// ================================================================ authorization

	private static function authorize_or_die(): void {
		try {
			self::authorize();
		} catch ( Refused $e ) {
			if ( 'rest' === self::$open['owner'] ) {
				throw $e;
			}
			if ( self::$open['nested'] ?? false ) {
				throw $e->error;
			}
			self::rollback();
			wp_die(
				esc_html( $e->error->getMessage() ),
				'',
				array(
					'response'  => $e->error->status,
					'code'      => $e->error->errorCode,
					'back_link' => true,
				)
			);
		}
	}

	/**
	 * The save as the signed-in user wrote it: the columns it supplied (form fields, `acf` selectors and
	 * aliases, core columns) and every column it changed, with their saved values. Field write rules
	 * run on those, as on the API (an unchanged hidden value is still refused, so no value can be
	 * probed), then the create rule, or the update rule with that data: a filter must match the row
	 * as it was before the save, as the API's update selector does.
	 */
	private static function authorize(): void {
		Plugin::instance()?->db()->current( self::authorize_in_context( ... ) );
	}

	private static function authorize_in_context(): void {
		$open                  = self::$open;
		self::$open['checked'] = true;
		$plugin                = Plugin::instance();
		if ( null === $open['postId'] || null === $plugin || get_current_user_id() === 0 ) {
			return;
		}
		['collection' => $collection, 'postId' => $id, 'before' => $before] = $open;
		$viewer = CoreAccess::viewer() ?? throw new Refused( new HttpError( 403, 'suspended', 'This account is suspended' ) );
		$after  = $plugin->db()->editorRow( $collection, $id );
		if ( null === $after ) {
			return; // not a row (an auto-draft, the trash): its capability decided
		}
		$spec      = $plugin->schema->collection( $collection );
		$generated = array_flip( array( ...$plugin->editorFilled( $id ), $spec['primaryKey'] ) ); // trusted, not input
		$rules     = Access::collectionRules( $spec );
		try {
			if ( null === $before ) {
				// A form posts every field: supplied = named by the request, or not the column's default.
				$cols = array_filter(
					array_diff_key( $after, $generated ),
					static fn ( $v, $col ) => in_array( $col, $open['supplied'], true )
					|| ( null !== $v && ! ( isset( $spec['columns'][ $col ]['default']['value'] ) && $v === $spec['columns'][ $col ]['default']['value'] ) ),
					ARRAY_FILTER_USE_BOTH
				);
				$data = $after;
				FieldAccess::checkWrite( 'create', $collection, $data, null, $viewer, $cols );
				$plugin->db()->validateWriteReferences( $collection, $after, $viewer );
				Access::require( $rules['create'], $viewer, 'create', $after, "create $collection rows", $spec['columns'] );

				return;
			}
			$changed = array_keys( array_filter( array_diff_key( $after, $generated ), static fn ( $v, $col ) => ! \SpacePress\Js::sameJson( $v, $before[ $col ] ?? null ), ARRAY_FILTER_USE_BOTH ) );
			$patch   = array_intersect_key( $after, array_flip( array( ...$changed, ...$open['supplied'] ) ) );
			// Title, content and slug a save changed (an autosave of one's own draft, a quick edit, any
			// wp_update_post) follow SpacePress's rules on those columns, as a REST save's do.
			self::check_columns( $collection, array_intersect_key( $patch, array_flip( $changed ) ), $before );
			$supplied = 'restore' === $open['owner'] ? $patch : self::group_patch( $spec['columns'], $patch, $before, $open['declared'] ?? array() );
			$data     = $patch;
			FieldAccess::checkWrite( 'update', $collection, $data, $before, $viewer, $supplied, stored: true );
			$plugin->db()->validateWriteReferences( $collection, $patch, $viewer );
			$r = Access::evaluate( $rules['update'], $viewer, 'update', $patch, $spec['columns'], $collection );
			if ( false === $r || ( is_array( $r ) && ! in_array( serialize( $r ), $open['covers'], true ) ) ) {
				throw Access::deny( $viewer->user, "update $collection rows" );
			}
		} catch ( HttpError $e ) {
			throw new Refused( $e );
		}
	}

	/** Keep stored group siblings outside the save's input; changed or explicitly sent keys are checked. */
	private static function group_patch( array $fields, array $patch, array $before, array $declared ): array {
		foreach ( $patch as $name => $value ) {
			if ( ( $fields[ $name ]['type'] ?? null ) !== 'group' || ! is_array( $value ) ) {
				continue;
			}
			if ( array_key_exists( $name, $declared ) && ! is_array( $declared[ $name ] ) ) {
				$patch[ $name ] = $declared[ $name ]; // an explicit container replacement stays input
				continue;
			}
			$old            = is_array( $before[ $name ] ?? null ) ? $before[ $name ] : array();
			$sent           = is_array( $declared[ $name ] ?? null ) ? $declared[ $name ] : array();
			$children       = array_filter(
				$value,
				static fn ( $v, $key ) => array_key_exists( $key, $sent )
				|| ! \SpacePress\Js::sameJson( $v, $old[ $key ] ?? null ),
				ARRAY_FILTER_USE_BOTH
			);
			$patch[ $name ] = self::group_patch( $fields[ $name ]['fields'] ?? array(), $children, $old, $sent );
		}

		return $patch;
	}

	/**
	 * What a wp-admin form or quick edit posts: [declared data (JS form), columns it names]. SCF field
	 * keys and core columns; a core column hidden from the viewer is never counted (its control is
	 * blank and its stored value kept, CoreAccess::keepHidden).
	 *
	 * @return array{?array<string, mixed>, list<string>}
	 */
	private static function formData( string $collection ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( ( ! is_admin() && ! wp_doing_ajax() ) || get_current_user_id() === 0 ) {
			return array( null, array() );
		}
		$spec = Plugin::instance()?->schema->collection( $collection ) ?? array();
		$data = array();
		foreach ( is_array( $_POST['acf'] ?? null ) ? wp_unslash( $_POST['acf'] ) : array() as $key => $value ) {
			foreach ( $spec['columns'] ?? array() as $col => $def ) {
				if ( $key === $spec['wp']['fieldKeyPrefix'] . $col ) {
					$data[ (string) $col ] = Scf::fromScf( $def, $value, (string) $key );
				}
			}
		}
		foreach ( array(
			'post_title' => 'title',
			'content'    => 'content',
			'post_name'  => 'slug',
		) as $param => $designation ) {
			$col = $spec[ $designation ] ?? null;
			// A hidden column's control is rendered blank and kept (CoreAccess::keepHidden); anything else
			// posted for it is a write, refused like any other whatever its value.
			if ( null !== $col && isset( $_POST[ $param ] ) && ! ( '' === $_POST[ $param ] && CoreAccess::nativeHiddenFor( $collection, $col ) ) ) {
				$data[ $col ] = wp_unslash( $_POST[ $param ] );
			}
		}

		return array( array() === $data ? null : $data, array_map( 'strval', array_keys( $data ) ) );
	}

	// ================================================================ transaction

	private static function open( string $owner, string $collection, ?int $postId, ?array $before, ?array $declared, array $supplied ): void { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$scope = self::scope( $owner, $collection, $postId, $before, $declared, $supplied ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		Plugin::instance()?->connection()->begin();
		self::$nested = 0;
		self::$open   = $scope;
	}

	/**
	 * A save's state. `covers`: the update-rule filters (serialized) that match the row as it is
	 * before the save, for the rule evaluated without data and with the request's declared data.
	 */
	private static function scope( string $owner, string $collection, ?int $postId, ?array $before, ?array $declared, array $supplied ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$plugin = Plugin::instance() ?? throw new \LogicException( 'No SpacePress app' );
		return $plugin->db()->current( fn (): array => self::scope_in_context( $owner, $collection, $postId, $before, $declared, $supplied ) ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	}

	private static function scope_in_context( string $owner, string $collection, ?int $postId, ?array $before, ?array $declared, array $supplied ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$plugin = Plugin::instance() ?? throw new \LogicException( 'No SpacePress app' );
		$covers = array();
		$viewer = null === $before || get_current_user_id() === 0 ? null : CoreAccess::viewer();
		if ( null !== $viewer && null !== $postId ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$plugin->app();
			$rule = Access::collectionRules( $plugin->schema->collection( $collection ) )['update'];
			foreach ( null === $declared ? array( null ) : array( null, $declared ) as $data ) {
				$r = Access::evaluate( $rule, $viewer, 'update', $data, $plugin->schema->collection( $collection )['columns'], $collection );
				if ( is_array( $r ) && $plugin->db()->permits( $collection, 'update', $postId, $viewer, $data ) ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
					$covers[] = serialize( $r );
				}
			}
		}

		// A save opened by its own insert has claimed it; a REST create claims the first one it makes.
		return array(
			'owner'      => $owner,
			'collection' => $collection,
			'postId'     => $postId, // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			'before'     => $before,
			'covers'     => $covers,
			'declared'   => $declared,
			'supplied'   => 'restore' === $owner ? array_keys( $plugin->schema->collection( $collection )['columns'] ) : array_values( array_unique( $supplied ) ),
			'checked'    => false,
			'claimed'    => 'core' === $owner,
		);
	}

	/** Commit the save; a COMMIT that fails rolls back (Connection) and cleans the post's caches too. */
	private static function commit(): void {
		$postId     = self::$open['postId'] ?? null; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		self::$open = null;
		try {
			Plugin::instance()?->connection()->commit();
		} catch ( \Throwable $e ) {
			self::forget( $postId ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			throw $e;
		}
	}

	private static function rollback(): void {
		$postId     = self::$open['postId'] ?? null; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		self::$open = null;
		try {
			Plugin::instance()?->connection()->rollback();
		} finally {
			self::forget( $postId ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		}
	}

	/** Core wrote the post outside SpacePress's store: no cache may keep a ghost of a rolled-back save. */
	private static function forget( ?int $postId ): void { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		if ( null !== $postId ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			clean_post_cache( $postId ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		}
		CoreAccess::flush();
	}

	private static function owns( mixed $post ): bool {
		$id = $post instanceof \WP_Post ? $post->ID : (int) $post;

		return ! self::busy() && self::$open['postId'] === $id;
	}

	private static function busy(): bool {
		return Plugin::instance()?->connection()->busy() ?? false;
	}
}
