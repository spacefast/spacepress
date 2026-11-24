<?php

declare(strict_types=1);

namespace SpacePress\Wp;

use SpacePress\Access;
use SpacePress\FieldAccess;
use SpacePress\HttpError;
use SpacePress\Schema;
use SpacePress\Viewer;

/**
 * Core `/wp/v2/sp_*` and wp-admin under SpacePress's access rules. Core REST stays enabled for the block
 * editor, but it is never a second API around SpacePress's rules:
 *
 * - capabilities: `map_meta_cap` answers every capability of a SpacePress post type from the collection's
 *   rules, for the user being asked about (role caps no longer decide). Per post: `read_post` = the
 *   read rule (+ draft visibility), `edit_post`/`publish_post` = update, `delete_post` = delete; an
 *   auto-draft (not a row yet) is its author's under the create rule; a trashed post (not a row)
 *   needs a rule that covers every row. Type-wide caps (menus, create buttons) ask whether the rule
 *   could allow anything. A function rule that depends on the incoming data counts as possibly
 *   allowing here: {@see EditorSave} decides each save on its data before it commits.
 * - reads ({@see PostsController}): lists hold only rows the read rule covers, a rule that denies is
 *   401/403, a filtered-out item is 404, and every response (revisions and autosaves against their
 *   own snapshot) drops the fields the viewer can't read, with their links; a search or slug query
 *   can't probe a hidden column.
 * - wp-admin: list screens hold only readable rows; the edit form doesn't render a field holding
 *   anything the viewer can't read.
 */
final class CoreAccess {

	private const META       = array( 'read_post', 'edit_post', 'publish_post', 'delete_post' );
	private const STRUCTURED = array( 'group', 'repeater', 'blocks' );

	/** @var ?array<string, array{string, string}> primitive cap => [collection, kind] */
	private static ?array $primitives = null;
	/** @var array<string, ?list<int|string>|false> "collection op user" => keys (null = all, false = denied) */
	private static array $keys = array();
	/** @var array<string, array{int, \Closure(): array}> first candidate checked and its full-list query */
	private static array $single = array();
	/** @var array<string, \Closure> evaluated filters awaiting their first item or list read */
	private static array $pending = array();
	/** @var array<string, array<int, true>> membership when individual checks use a full list */
	private static array $members = array();
	/** @var array<string, array<int, true>> rows a read as the viewer returned ({@see readable()}) */
	private static array $readable = array();
	private static int $generation = 0;

	public static function register(): void {
		add_filter( 'map_meta_cap', array( self::class, 'mapMetaCap' ), 10, 4 );
		// Core lets `assign_terms` create a term in a flat taxonomy; SpacePress's create rule decides (ruling 29).
		add_filter( 'pre_insert_term', array( self::class, 'termCreate' ), PHP_INT_MAX, 2 );
		// Last: SCF adds its field links on the same filters at 10, registered later in the request.
		add_filter( 'rest_prepare_revision', array( self::class, 'prepareChild' ), PHP_INT_MAX, 3 );
		add_filter( 'rest_prepare_autosave', array( self::class, 'prepareChild' ), PHP_INT_MAX, 3 );
		add_action( 'pre_get_posts', array( self::class, 'adminList' ) );
		add_filter( 'acf/prepare_field', array( self::class, 'formField' ), 20 );
		// SpacePress's columns are written through SpacePress, SCF or core REST's `acf`, never wp-admin's generic
		// Custom Fields box or its AJAX: protected meta is refused on every one of those paths.
		add_filter( 'is_protected_meta', array( self::class, 'protectedMeta' ), 10, 3 );
		add_filter( 'edit_post_content', array( self::class, 'adminContent' ), 10, 2 );
		add_filter( 'editable_slug', array( self::class, 'adminSlug' ), 10, 2 );
		// wp-admin's revision screen and its AJAX diffs: each side is judged by its own snapshot.
		add_filter( 'wp_get_revision_ui_diff', array( self::class, 'revisionDiff' ), PHP_INT_MAX, 3 );
		// Anything that can change what a rule covers or who is asking drops the cached answers: a post
		// or First row written, a user switched, a role or user meta changed.
		foreach ( array(
			'clean_post_cache',
			'set_current_user',
			'set_user_role',
			'add_user_role',
			'remove_user_role',
			'added_user_meta',
			'updated_user_meta',
			'deleted_user_meta',
			'profile_update',
			'added_post_meta',
			'updated_post_meta',
			'deleted_post_meta',
			'set_object_terms',
		) as $hook ) {
			add_action( $hook, array( self::class, 'flush' ) );
		}
		\SpacePress\Extensions::onWritten(
			static function (): void {
				self::flush();
			}
		);
	}

	public static function flush(): void {
		self::$keys     = array();
		self::$single   = array();
		self::$pending  = array();
		self::$members  = array();
		self::$readable = array();
		++self::$generation;
		Access::clearCache();
	}

	/**
	 * Rows of a post kind that a read as $viewer just returned. The read pipeline applied the read
	 * rule, draft visibility and the store's own guards to them, which is the question covers()
	 * asks, so it answers for these rows without another statement: a page that read its item, or a
	 * list that selected its rows, has already asked. Dropped with every other cached answer.
	 *
	 * @param list<int> $ids
	 */
	public static function readable( string $collection, array $ids, Viewer $viewer ): void {
		$key = self::key( $collection, 'read', $viewer );
		foreach ( $ids as $id ) {
			self::$readable[ $key ][ (int) $id ] = true;
		}
	}

	private static function key( string $collection, string $op, Viewer $viewer ): string {
		return serialize( array( $collection, $op, $viewer->user, $_COOKIE[ 'wp-postpass_' . COOKIEHASH ] ?? null ) );
	}

	public static function generation(): int {
		return self::$generation;
	}

	// ================================================================ capabilities

	/** @param list<string> $caps */
	public static function mapMetaCap( array $caps, string $cap, int $userId, array $args ): array {
		$plugin = Plugin::instance();
		if ( null === $plugin ) {
			return $caps;
		}
		if ( in_array( $cap, self::META, true ) ) {
			$post = isset( $args[0] ) ? get_post( (int) $args[0] ) : null;
			if ( $post instanceof \WP_Post && 'revision' === $post->post_type ) {
				if ( 'delete_post' === $cap ) {
					return $caps; // core never deletes a revision through delete_post
				}
				$post = get_post( $post->post_parent );
			}
			$collection = $post instanceof \WP_Post ? self::collection( $post->post_type ) : null;
			if ( null === $collection ) {
				return $caps;
			}
			$allowed = self::post_allowed( $collection, $cap, $post, $userId );
			// The store already checked the post's visibility, including password proof. WordPress
			// maps a published post's read to `read`, which anonymous visitors lack.
			if ( self::schema()->collection( $collection )['native'] ?? false ) {
				if ( ! $allowed ) {
					return array( 'do_not_allow' );
				}
				return 'read_post' === $cap && 'publish' === $post->post_status && $caps === array( 'read' ) ? array( 'exist' ) : $caps;
			}

			return self::grant( $allowed );
		}
		if ( in_array( $cap, array( 'edit_term', 'delete_term', 'assign_term' ), true ) ) {
			$term     = isset( $args[0] ) ? get_term( (int) $args[0] ) : null;
			$taxonomy = $term instanceof \WP_Term ? self::taxonomyKind( $term->taxonomy ) : null;
			if ( null !== $taxonomy ) {
				return self::grant( self::term_allowed( $taxonomy, $cap, $term, $userId ) );
			}

			return $caps;
		}
		[$collection, $kind] = self::primitives()[ $cap ] ?? array( null, null );
		if ( null === $collection ) {
			return $caps;
		}

		return self::grant( self::type_allowed( $collection, $kind, $userId ) );
	}

	/** One term: its taxonomy's update or delete rule covers it; assigning is a write to an item. */
	private static function term_allowed( string $taxonomy, string $cap, \WP_Term $term, int $userId ): bool {
		$viewer = self::viewer_for( $userId );
		if ( null === $viewer || null === $viewer->user ) {
			return false;
		}

		return match ( $cap ) {
			'edit_term' => self::covers( $taxonomy, 'update', $term->term_id, $viewer ),
			'delete_term' => self::covers( $taxonomy, 'delete', $term->term_id, $viewer ),
			'assign_term' => self::type_allowed( $taxonomy, 'assign', $userId ) && self::covers( $taxonomy, 'read', $term->term_id, $viewer ),
		};
	}

	/**
	 * pre_insert_term: a signed-in user creating a term of a SpacePress taxonomy outside SpacePress's pipeline
	 * (wp-admin, core's terms route, a post save naming a new tag) needs the taxonomy's create rule.
	 */
	public static function termCreate( mixed $term, mixed $taxonomy ): mixed {
		$plugin = Plugin::instance();
		if ( $term instanceof \WP_Error || ! is_string( $taxonomy ) || null === $plugin || $plugin->connection()->busy()
			|| get_current_user_id() === 0 || ( $kind = self::taxonomyKind( $taxonomy ) ) === null ) {
			return $term;
		}
		$viewer = self::viewer();
		$rule   = Access::collectionRules( self::schema()->collection( $kind ) )['create'];
		if ( null === $viewer || Access::evaluate( $rule, $viewer, 'create', array( 'name' => (string) $term ) ) === false ) {
			return new \WP_Error( 'rest_cannot_create', __( 'Sorry, you are not allowed to create terms in this taxonomy.' ), array( 'status' => rest_authorization_required_code() ) );
		}

		return $term;
	}

	private static function post_allowed( string $collection, string $cap, \WP_Post $post, int $userId ): bool {
		$viewer = self::viewer_for( $userId );
		if ( null === $viewer || ( 'read_post' !== $cap && null === $viewer->user ) ) {
			return false;
		}
		if ( 'auto-draft' === $post->post_status ) {
			// "Add New" makes an auto-draft the editor loads and saves: its author's, under the create rule.
			return null !== $viewer->user && (int) $post->post_author === $viewer->user['id'] && self::rule_may_allow( $collection, 'create', $viewer );
		}
		$op = array(
			'read_post'    => 'read',
			'edit_post'    => 'update',
			'publish_post' => 'update',
			'delete_post'  => 'delete',
		)[ $cap ];
		if ( 'trash' === $post->post_status ) {
			$spec = self::schema()->collection( $collection );
			if ( 'delete' === $op && ( $spec['softDelete'] ?? false ) ) {
				return self::keys( $collection, 'restore', $viewer ) === null || self::keys( $collection, 'purge', $viewer ) === null;
			}

			return self::keys( $collection, $op, $viewer ) === null;
		}

		return self::covers( $collection, $op, $post->ID, $viewer );
	}

	private static function type_allowed( string $collection, string $kind, int $userId ): bool {
		$viewer = self::viewer_for( $userId );
		if ( null === $viewer ) {
			return false;
		}
		if ( 'readAll' === $kind ) {
			return self::keys( $collection, 'read', $viewer ) === null;
		}
		if ( null === $viewer->user ) {
			return false;
		}

		// `edit_`, `create_`, `delete_`: the rule may allow some row. The `others`/`published`/`private`
		// variants speak for any row, so they need a rule that covers every row as stored.
		return match ( $kind ) {
			// A taxonomy's terms are assigned by writing an item of an attached kind (ruling 29).
			'assign' => array_filter(
				self::schema()->collection( $collection )['wp']['on'] ?? array(),
				static fn ( string $kind ): bool => self::rule_may_allow( $kind, 'create', $viewer ) || self::rule_may_allow( $kind, 'update', $viewer )
			) !== array(),
			'manage' => self::rule_may_allow( $collection, 'create', $viewer ) || self::rule_may_allow( $collection, 'update', $viewer ) || self::rule_may_allow( $collection, 'delete', $viewer ),
			'create' => self::rule_may_allow( $collection, 'create', $viewer ),
			'edit' => self::rule_may_allow( $collection, 'update', $viewer ) || self::rule_may_allow( $collection, 'create', $viewer ),
			'delete' => self::rule_may_allow( $collection, 'delete', $viewer ),
			'updateAll' => self::keys( $collection, 'update', $viewer ) === null,
			'deleteAll' => self::keys( $collection, 'delete', $viewer ) === null,
		};
	}

	/** @return array<string, array{string, string}> */
	private static function primitives(): array {
		if ( null === self::$primitives ) {
			self::$primitives = array();
			foreach ( self::post_backed() as $name => $spec ) {
				if ( $spec['native'] ?? false ) {
					continue; // core's posts keep core's type-wide capabilities (edit_posts, publish_posts)
				}
				$t                 = $spec['wp']['postType'];
				self::$primitives += array(
					"create_$t"           => array( $name, 'create' ),
					"edit_$t"             => array( $name, 'edit' ),
					"publish_$t"          => array( $name, 'edit' ),
					"edit_others_$t"      => array( $name, 'updateAll' ),
					"edit_published_$t"   => array( $name, 'updateAll' ),
					"edit_private_$t"     => array( $name, 'updateAll' ),
					"delete_$t"           => array( $name, 'delete' ),
					"delete_others_$t"    => array( $name, 'deleteAll' ),
					"delete_published_$t" => array( $name, 'deleteAll' ),
					"delete_private_$t"   => array( $name, 'deleteAll' ),
					"read_private_$t"     => array( $name, 'readAll' ),
				);
			}
			foreach ( self::schema()->taxonomies() as $name => $spec ) {
				$t                 = $spec['wp']['taxonomy'];
				self::$primitives += array(
					"manage_$t" => array( $name, 'manage' ),
					"edit_$t"   => array( $name, 'edit' ),
					"delete_$t" => array( $name, 'delete' ),
					"assign_$t" => array( $name, 'assign' ),
				);
			}
		}

		return self::$primitives;
	}

	/** @param list<string> $caps */
	private static function grant( bool $allowed ): array {
		return array( $allowed ? 'exist' : 'do_not_allow' );
	}

	/**
	 * True unless the rule denies this viewer outright. A filter may allow some rows, and a function
	 * rule may allow given the save's data, which EditorSave checks before commit.
	 */
	private static function rule_may_allow( string $collection, string $op, Viewer $viewer ): bool {
		$rule = Access::collectionRules( self::schema()->collection( $collection ) )[ $op ];

		return isset( $rule['fn'] ) || Access::evaluate( $rule, $viewer, $op, null ) !== false;
	}

	/** Does the viewer's $op rule cover row $pk (as stored, without a write's data)? */
	public static function covers( string $collection, string $op, int|string $pk, Viewer $viewer ): bool {
		if ( 'read' === $op && isset( self::$readable[ self::key( $collection, $op, $viewer ) ][ (int) $pk ] ) ) {
			return true;
		}
		$key  = self::cache_keys( $collection, $op, $viewer, (int) $pk );
		$keys = self::$keys[ $key ];
		if ( null === $keys || false === $keys || array() === $keys ) {
			return null === $keys;
		}
		if ( isset( self::$single[ $key ] ) || count( $keys ) === 1 ) {
			return (int) $keys[0] === (int) $pk;
		}
		if ( ! isset( self::$members[ $key ] ) ) {
			foreach ( $keys as $id ) {
				self::$members[ $key ][ (int) $id ] = true;
			}
		}
		return isset( self::$members[ $key ][ (int) $pk ] );
	}

	/**
	 * Rows the viewer's read, update or delete rule covers: null = every row, false = the rule denies,
	 * else their primary keys. Cached until something that could change the answer happens.
	 *
	 * @return ?list<int|string>|false
	 */
	public static function keys( string $collection, string $op, Viewer $viewer ): array|null|false {
		$key = self::cache_keys( $collection, $op, $viewer, null );
		return self::$keys[ $key ];
	}

	/** One item asks only for its own key. A collection request or a second distinct item materializes the full set once. */
	private static function cache_keys( string $collection, string $op, Viewer $viewer, ?int $candidate, bool $scope_only = false ): string {
		$key = self::key( $collection, $op, $viewer );
		try {
			if ( ! $scope_only && isset( self::$single[ $key ] ) && self::$single[ $key ][0] !== $candidate ) {
				[, $all]            = self::$single[ $key ];
				self::$keys[ $key ] = $all();
				unset( self::$single[ $key ] );
			} elseif ( ! array_key_exists( $key, self::$keys ) ) {
				$read = self::$pending[ $key ] ?? Plugin::instance()?->db()->preparePermittedKeys( $collection, $op, $viewer, validate: $scope_only );
				if ( $scope_only && null !== $read ) {
					self::$pending[ $key ] = $read;
				} else {
					$remaining          = null;
					self::$keys[ $key ] = null === $read ? null : $read( $candidate, $remaining );
					unset( self::$pending[ $key ] );
					if ( null !== $remaining ) {
						self::$single[ $key ] = array( $candidate, $remaining );
					}
				}
			}
		} catch ( HttpError ) {
			unset( self::$single[ $key ], self::$pending[ $key ] );
			self::$keys[ $key ] = false;
		}

		return $key;
	}

	// ================================================================ viewers

	/** The viewer of this request (null when the account is suspended). */
	public static function viewer(): ?Viewer {
		return self::viewer_for( get_current_user_id() );
	}

	private static function viewer_for( int $userId ): ?Viewer {
		if ( IdentityBridge::available() && ( \SpacePress\Identity\Plugin::authenticationError() !== null || \SpacePress\Identity\Bearer::failure() !== null ) ) {
			return null;
		}
		$user = $userId > 0 ? get_userdata( $userId ) : false;
		if ( ! $user instanceof \WP_User ) {
			return new Viewer( null );
		}
		if ( IdentityBridge::suspended( $userId ) ) {
			return null;
		}

		return new Viewer( WpAuth::map( $user ) );
	}

	// ================================================================ reads

	/** The read rule's own refusal for this viewer (401/403), or null when it may allow rows. */
	public static function readDenial( string $collection, ?Viewer $viewer ): ?\WP_Error {
		if ( null === $viewer ) {
			return self::error( new HttpError( 403, 'suspended', 'This account is suspended' ) );
		}
		$key = self::cache_keys( $collection, 'read', $viewer, null, scope_only: true );
		if ( ( self::$keys[ $key ] ?? null ) === false ) {
			return self::error( Access::deny( $viewer->user, "read $collection" ) );
		}

		return null;
	}

	/**
	 * Drop from a core response every field the viewer can't read: judged on $stored (the row, or the
	 * snapshot a revision holds). Without one (a trashed post) every field that could be hidden from
	 * this viewer goes, decided by the rules alone.
	 */
	public static function strip( mixed $response, string $collection, ?array $stored, ?Viewer $viewer ): mixed {
		if ( ! $response instanceof \WP_REST_Response || ! is_array( $data = $response->get_data() ) ) {
			return $response;
		}
		$spec = self::schema()->collection( $collection );
		if ( is_array( $data['meta'] ?? null ) && ! Coediting::readable( $collection, (int) ( $data['id'] ?? 0 ) ) ) {
			unset( $data['meta'][ Coediting::DOCUMENT ] );
		}
		if ( is_array( $data['meta'] ?? null ) && null !== $stored ) {
			// SpacePress values, judged on the same row: a revision's `meta` is its own snapshot, not the
			// raw postmeta core's revisions controller would read.
			$fields       = array_keys( PostMeta::fields( $spec ) );
			$data['meta'] = PostMeta::values( $collection, $stored, $fields ) + array_fill_keys( $fields, null ) + $data['meta'];
		}
		$visible = null === $viewer || null === $stored ? null : ( self::visible_fields( $stored, $collection, $viewer ) );
		$dropped = false;
		foreach ( $spec['columns'] as $col => $def ) {
			$col = (string) $col;
			if ( $col === $spec['primaryKey'] || ( $def['system'] ?? false ) || $col === ( $spec['title'] ?? null ) ) {
				continue; // the title is always readable (§4.4)
			}
			$hidden = null === $visible
				? null === $viewer || FieldAccess::mayHide( $def, $viewer )
				// A structured value with a hidden sub-field is dropped whole: core shows SCF's own shape.
				: array_key_exists( $col, $stored ) && ( ! array_key_exists( $col, $visible ) || $visible[ $col ] !== $stored[ $col ] );
			if ( ! $hidden ) {
				continue;
			}
			$dropped = true;
			if ( PostMeta::terms( $def ) ) {
				// Core's own taxonomy field on the post.
				unset( $data[ (string) ( self::schema()->collection( $def['references']['collection'] )['wp']['taxonomy'] ?? '' ) ] );
			}
			match ( $col ) {
				$spec['content'] ?? null => self::unset( $data, ( $spec['excerpt'] ?? null ) === null ? array( 'content', 'excerpt' ) : array( 'content' ) ),
				$spec['excerpt'] ?? null => self::unset( $data, array( 'excerpt' ) ),
				$spec['slug'] ?? null => self::unset( $data, array( 'slug', 'generated_slug', 'permalink_template', 'link' ) ),
				default => is_array( $data['acf'] ?? null ) ? self::unset( $data['acf'], array( $spec['wp']['metaPrefix'] . $col, $spec['wp']['metaPrefix'] . $col . '_source' ) ) : null,
			};
			if ( is_array( $data['meta'] ?? null ) ) {
				unset( $data['meta'][ $col ] );
			}
		}
		$response->set_data( $data );
		if ( $dropped ) {
			// SCF links every referenced post (embeddable): a hidden reference must not survive as one.
			foreach ( array_keys( $response->get_links() ) as $rel ) {
				if ( str_starts_with( (string) $rel, 'acf:' ) ) {
					$response->remove_link( $rel );
				}
			}
		}

		return $response;
	}

	/** Revisions and autosaves of a SpacePress post are stripped against their own snapshot. */
	public static function prepareChild( mixed $response, mixed $post, mixed $request ): mixed {
		if ( ! $post instanceof \WP_Post ) {
			return $response;
		}
		if ( $post->post_parent <= 0 ) {
			// Autosaving one's own draft updates the post itself, which core then prepares here.
			$collection = self::collection( $post->post_type );

			return null === $collection ? $response
				: self::strip( $response, $collection, Plugin::instance()?->db()->editorRow( $collection, $post->ID ), self::viewer() );
		}
		$collection = self::collection( (string) get_post_type( $post->post_parent ) );
		if ( null === $collection ) {
			return $response;
		}
		try {
			$snapshot = Plugin::instance()?->db()->revisionRow( $collection, $post->post_parent, $post->ID );
		} catch ( HttpError ) {
			$snapshot = null;
		}

		return self::strip( $response, $collection, $snapshot, self::viewer() );
	}

	/**
	 * A list query naming a column the viewer may not read (slug) is refused. `search` isn't: it
	 * matches only the fields the viewer may read ({@see \SpacePress\Search\Index::predicate()}).
	 */
	public static function queryDenial( string $collection, \WP_REST_Request $request, ?Viewer $viewer ): ?\WP_Error {
		if ( null === $viewer ) {
			return null;
		}
		$spec   = self::schema()->collection( $collection );
		$hidden = static fn ( ?string $col ): bool => null !== $col && FieldAccess::mayHide( $spec['columns'][ $col ], $viewer );
		$probes = array(
			'slug'    => self::given( $request['slug'] ) && $hidden( $spec['slug'] ?? null ),
			'orderby' => 'slug' === $request['orderby'] && $hidden( $spec['slug'] ?? null ),
		);
		foreach ( $probes as $param => $probe ) {
			if ( $probe ) {
				return self::error( new HttpError( 403, 'forbidden', "You can't filter, sort or search by a field hidden from you", '/' . $param ) );
			}
		}

		return null;
	}

	/** A query value that was supplied ("0" counts; PHP's empty() would drop it). */
	private static function given( mixed $v ): bool {
		return is_array( $v ) ? array() !== $v : null !== $v && '' !== $v && false !== $v;
	}

	private static function unset( array &$data, array $keys ): void {
		foreach ( $keys as $k ) {
			unset( $data[ $k ] );
		}
	}

	/**
	 * wp-admin lists of a SpacePress post type hold only the rows the viewer's read rule covers, and a
	 * search there only reads the title when the content may be hidden from the viewer.
	 */
	public static function adminList( \WP_Query $query ): void {
		if ( ! is_admin() || wp_doing_ajax() || ! $query->is_main_query() || ! is_string( $type = $query->get( 'post_type' ) )
			|| ( $collection = self::collection( $type ) ) === null ) {
			return;
		}
		$viewer = self::viewer();
		$keys   = null === $viewer ? false : self::keys( $collection, 'read', $viewer );
		if ( is_array( $keys ) || false === $keys ) {
			$query->set( 'post__in', false === $keys || array() === $keys ? array( 0 ) : array_map( 'intval', $keys ) );
		}
		$content = self::schema()->collection( $collection )['content'] ?? null;
		if ( $query->get( 's' ) !== '' && null !== $content && ( null === $viewer || FieldAccess::mayHide( self::schema()->collection( $collection )['columns'][ $content ], $viewer ) ) ) {
			$query->set( 'search_columns', array( 'post_title' ) );
		}
	}

	/**
	 * Drop from a revision diff every row that compares a field hidden from the viewer on either side
	 * (SCF adds one per field; core adds content and the rest). A side's visibility comes from the
	 * snapshot it shows; without one, from the rules alone.
	 */
	public static function revisionDiff( mixed $diff, mixed $from, mixed $to ): mixed {
		if ( ! is_array( $diff ) || ! $to instanceof \WP_Post ) {
			return $diff;
		}
		$parent_id  = 'revision' === $to->post_type ? $to->post_parent : $to->ID;
		$collection = self::collection( (string) get_post_type( $parent_id ) );
		if ( null === $collection ) {
			return $diff;
		}
		$spec   = self::schema()->collection( $collection );
		$viewer = self::viewer();
		$hidden = array();
		foreach ( array( $from, $to ) as $side ) {
			if ( ! $side instanceof \WP_Post ) {
				continue;
			}
			$row = null;
			try {
				$row = $side->ID === $parent_id ? Plugin::instance()?->db()->editorRow( $collection, $parent_id )
					: Plugin::instance()?->db()->revisionRow( $collection, $parent_id, $side->ID );
			} catch ( HttpError ) {
			}
			foreach ( $spec['columns'] as $col => $def ) {
				$col = (string) $col;
				if ( $col === $spec['primaryKey'] || $col === ( $spec['title'] ?? null ) || ( $def['system'] ?? false ) ) {
					continue;
				}
				if ( null === $viewer || null === $row
					? null === $viewer || FieldAccess::mayHide( $def, $viewer )
					: ! self::fully_visible( $collection, $col, $row, $viewer ) ) {
					$hidden[ $col ] = true;
				}
			}
		}
		$ids = array();
		foreach ( array_keys( $hidden ) as $col ) {
			$ids[] = $spec['wp']['metaPrefix'] . $col;
			if ( $col === ( $spec['content'] ?? null ) ) {
				array_push( $ids, 'post_content', 'post_excerpt' );
			}
			if ( $col === ( $spec['slug'] ?? null ) ) {
				$ids[] = 'post_name';
			}
		}
		$prefixes = array_map( static fn ( string $id ): string => $id . '_', $ids ); // nested SCF sub-field rows

		return array_values(
			array_filter(
				$diff,
				static function ( $entry ) use ( $ids, $prefixes ): bool {
					$id = is_array( $entry ) ? (string) ( $entry['id'] ?? '' ) : '';
					foreach ( $prefixes as $p ) {
						if ( str_starts_with( $id, $p ) ) {
							return false;
						}
					}

					return ! in_array( $id, $ids, true );
				}
			)
		);
	}

	/** WordPress fields always belong to the plugin, even inside a secondary Db operation. */
	private static function visible_fields( array $row, string $collection, Viewer $viewer ): array {
		return Plugin::instance()->db()->current( static fn () => FieldAccess::strip( array( $row ), $collection, $viewer )[0] ?? array() );
	}

	/** Is $col of $row readable in full (a structured value with a hidden sub-field is not)? */
	private static function fully_visible( string $collection, string $col, array $row, Viewer $viewer ): bool {
		$visible = self::visible_fields( $row, $collection, $viewer );

		return ! array_key_exists( $col, $row ) || ( array_key_exists( $col, $visible ) && $visible[ $col ] === $row[ $col ] );
	}

	/** @param mixed $type the meta type (post, user, ...) */
	public static function protectedMeta( mixed $protected, mixed $key, mixed $type ): mixed {
		if ( $protected || 'post' !== $type || ! is_string( $key ) ) {
			return $protected;
		}
		// Compared as the database matches keys: its collation ignores letter case and accents.
		$key = strtolower( remove_accents( $key ) );
		foreach ( self::post_backed() as $spec ) {
			if ( str_starts_with( $key, $spec['wp']['metaPrefix'] ) || str_starts_with( $key, '_' . $spec['wp']['metaPrefix'] ) ) {
				return true;
			}
		}

		return $protected;
	}

	/** The classic editor's textarea: empty when the designated content is hidden from the viewer. */
	public static function adminContent( mixed $content, mixed $postId ): mixed {
		return self::native_hidden( (int) $postId, 'content' ) ? '' : $content;
	}

	/** The slug box and quick edit: empty when the designated slug is hidden from the viewer. */
	public static function adminSlug( mixed $slug, mixed $post ): mixed {
		return $post instanceof \WP_Post && self::native_hidden( $post->ID, 'slug' ) ? '' : $slug;
	}

	/** Is a core-column designation ('content', 'slug') of a SpacePress post hidden from this viewer? */
	/**
	 * A wp-admin save of a post whose content or slug is hidden from the viewer: the blank control the
	 * form posted doesn't overwrite the stored value (a forged non-blank one still reaches EditorSave,
	 * which refuses it as a write to a hidden column).
	 */
	public static function keepHidden( string $collection, array $stored, array $data ): array {
		if ( ! is_admin() || get_current_user_id() === 0 ) {
			return $data;
		}
		$spec = self::schema()->collection( $collection );
		foreach ( array(
			'content' => 'post_content',
			'slug'    => 'post_name',
		) as $designation => $field ) {
			$col = $spec[ $designation ] ?? null;
			if ( null !== $col && self::nativeHiddenFor( $collection, $col, $stored ) && ( $data[ $field ] ?? '' ) === '' ) {
				$data[ $field ] = wp_slash( (string) ( $stored[ $col ] ?? '' ) ); // core unslashes wp_insert_post_data's result
			}
		}

		return $data;
	}

	/** Is column $col of a First row hidden from this viewer (judged on $stored, or the rules alone)? */
	public static function nativeHiddenFor( string $collection, string $col, ?array $stored = null ): bool {
		$viewer = self::viewer();
		if ( null === $viewer || null === $stored ) {
			return null === $viewer || FieldAccess::mayHide( self::schema()->collection( $collection )['columns'][ $col ], $viewer );
		}

		return ! array_key_exists( $col, self::visible_fields( $stored, $collection, $viewer ) );
	}

	private static function native_hidden( int $postId, string $designation ): bool {
		$collection = $postId > 0 ? self::collection( (string) get_post_type( $postId ) ) : null;
		$col        = null === $collection ? null : ( self::schema()->collection( $collection )[ $designation ] ?? null );
		if ( null === $col ) {
			return false;
		}
		return self::nativeHiddenFor( $collection, $col, Plugin::instance()?->db()->editorRow( $collection, $postId ) );
	}

	// ================================================================ wp-admin form

	/**
	 * The edit screen doesn't render a top-level field holding anything the viewer can't read on this
	 * post (a structured field with a hidden sub-field goes whole). Saves are EditorSave's to decide.
	 */
	public static function formField( mixed $field ): mixed {
		if ( ! is_array( $field ) || empty( $field['sp_top'] ) || ! is_admin() ) {
			return $field;
		}
		$post_id    = (int) ( acf_get_form_data( 'post_id' ) ?: 0 );
		$collection = $post_id > 0 ? self::collection( (string) get_post_type( $post_id ) ) : null;
		$col        = $field['spacepress']['name'] ?? null;
		if ( null === $collection || ! is_string( $col ) ) {
			return $field;
		}
		$viewer = self::viewer();
		$spec   = self::schema()->collection( $collection );
		$def    = $spec['columns'][ $col ] ?? null;
		if ( null === $def || null === $viewer ) {
			return null === $viewer ? false : $field;
		}
		$stored = Plugin::instance()?->db()->editorRow( $collection, $post_id );
		if ( null === $stored ) {
			// A new post holds nothing to hide; a trashed one is judged by the rules alone.
			return ! FieldAccess::mayHide( $def, $viewer ) ? $field : false;
		}
		$visible = self::visible_fields( $stored, $collection, $viewer );
		// A structured field renders inputs for every sub-field, empty ones included: any sub-field
		// that may be hidden from this viewer hides the whole field.
		$nested = in_array( $def['type'], self::STRUCTURED, true ) && FieldAccess::mayHide( array( 'access' => array() ) + $def, $viewer );

		return ! $nested && array_key_exists( $col, $visible ) && $visible[ $col ] === $stored[ $col ] ? $field : false;
	}

	// ================================================================ writes

	/** Does the update rule, given $data, cover row $pk as it is now? (Admission only; EditorSave decides.) */
	public static function mayUpdateWith( string $collection, int $pk, array $data, Viewer $viewer ): bool {
		if ( ! isset( Access::collectionRules( self::schema()->collection( $collection ) )['update']['fn'] ) ) {
			return false;
		}

		return Plugin::instance()?->db()->permits( $collection, 'update', $pk, $viewer, $data ) ?? false;
	}

	/**
	 * What a core REST create/update declares: [row data (JS form), supplied columns]. Every selector
	 * SCF honours counts (meta name, field key, `_acf_field_key_map`), so no alias escapes the
	 * authorization of the saved value (EditorSave).
	 *
	 * @return array{array<string, mixed>, list<string>}
	 */
	public static function incoming( string $collection, \WP_REST_Request $request, bool $singleSelector = false ): array {
		$spec = self::schema()->collection( $collection );
		$data = array();
		foreach ( array(
			'title'   => $spec['title'] ?? null,
			'content' => $spec['content'] ?? null,
			'slug'    => $spec['slug'] ?? null,
			'excerpt' => $spec['excerpt'] ?? null,
		) as $param => $col ) {
			if ( null !== $col && $request->has_param( $param ) ) {
				$v            = $request->get_param( $param );
				$data[ $col ] = is_array( $v ) ? ( $v['raw'] ?? null ) : $v;
			}
		}
		if ( ( $spec['drafts'] ?? false ) && is_string( $status = $request->get_param( 'status' ) ) ) {
			$data['status'] = array(
				'publish' => 'published',
				'future'  => 'scheduled',
			)[ $status ] ?? 'draft';
		}
		// Core `meta` (PostMeta): each field under its own name, in SpacePress's value form.
		$meta = PostMeta::input( $request );
		if ( is_array( $meta ) ) {
			foreach ( PostMeta::fields( $spec ) as $col => $def ) {
				if ( array_key_exists( $col, $meta ) ) {
					if ( $singleSelector && array_key_exists( $col, $data ) ) {
						throw new HttpError( 403, 'forbidden', "Submit $col only once", HttpError::seg( (string) $col ) );
					}
					// The value as it will be saved (PostMeta::update_value normalizes the same way),
					// so a data-dependent rule sees the same data before and after the save. A group
					// declares only the sub-fields the request sent: the ones it leaves out are kept or
					// defaulted by the save, not written by this request. A value that doesn't
					// normalize is kept raw: the save refuses it with SpacePress's 422.
					$raw = \SpacePress\Seam::toPhp( $meta[ $col ], $def );
					try {
						$data[ $col ] = self::sent( $def, \SpacePress\Schema::normalize( $def, $raw, (string) $col, HttpError::seg( (string) $col ) ), $raw );
					} catch ( HttpError ) {
						$data[ $col ] = $raw;
					}
				}
			}
		}
		$acf = $request->get_param( 'acf' );
		if ( is_array( $acf ) ) {
			$map = is_array( $acf['_acf_field_key_map'] ?? null ) ? $acf['_acf_field_key_map'] : array();
			foreach ( $acf as $name => $value ) {
				$name = (string) ( $map[ $name ] ?? $name );
				foreach ( $spec['columns'] as $col => $def ) {
					$key = $spec['wp']['fieldKeyPrefix'] . $col;
					if ( $name === $key || $name === $spec['wp']['metaPrefix'] . $col ) {
						if ( $singleSelector && array_key_exists( $col, $data ) ) {
							throw new HttpError( 403, 'forbidden', "Submit $col only once", HttpError::seg( (string) $col ) );
						}
						$data[ (string) $col ] = Scf::fromScf( $def, $value, $key );
					}
				}
			}
		}

		return array( $data, array_map( 'strval', array_keys( $data ) ) );
	}

	/** A normalized group value narrowed to the sub-fields $raw (the request's value) names, at any depth. */
	private static function sent( array $def, mixed $norm, mixed $raw ): mixed {
		if ( 'group' !== $def['type'] || ! is_array( $norm ) || ! is_array( $raw ) || ( array() !== $raw && array_is_list( $raw ) ) ) {
			return $norm;
		}
		$out = array();
		foreach ( $raw as $key => $value ) {
			if ( array_key_exists( $key, $norm ) && isset( $def['fields'][ $key ] ) ) {
				$out[ $key ] = self::sent( $def['fields'][ $key ], $norm[ $key ], $value );
			}
		}

		return $out;
	}

	// ================================================================ helpers

	public static function error( HttpError $e ): \WP_Error {
		return new \WP_Error( $e->errorCode, $e->getMessage(), array( 'status' => $e->status ) + ( null === $e->pointer ? array() : array( 'pointer' => $e->pointer ) ) );
	}

	public static function collection( string $postType ): ?string {
		foreach ( self::post_backed() as $name => $spec ) {
			if ( $spec['wp']['postType'] === $postType ) {
				return (string) $name;
			}
		}

		return null;
	}

	/** The taxonomy kind a WordPress taxonomy (`sp_<name>`) is, or null when it isn't SpacePress's. */
	public static function taxonomyKind( string $taxonomy ): ?string {
		foreach ( Plugin::instance()?->schema->taxonomies() ?? array() as $name => $spec ) {
			if ( $spec['wp']['taxonomy'] === $taxonomy ) {
				return (string) $name;
			}
		}

		return null;
	}

	/** @return array<string, array> */
	private static function post_backed(): array {
		$schema = Plugin::instance()?->schema;

		return null === $schema ? array() : array_filter( $schema->collections(), static fn ( array $c ) => ( $c['editor'] ?? true ) && ( $c['wp'] ?? null ) !== null );
	}

	private static function schema(): Schema {
		return Plugin::instance()?->schema ?? throw new \LogicException( 'No SpacePress app' );
	}
}
