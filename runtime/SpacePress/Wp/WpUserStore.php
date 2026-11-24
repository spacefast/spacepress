<?php

declare(strict_types=1);

namespace SpacePress\Wp;

use SpacePress\ColumnRef;
use SpacePress\Dialect;
use SpacePress\HttpError;
use SpacePress\Schema;
use SpacePress\Source;
use SpacePress\Store;

/**
 * The `auth: true` collection on WordPress (§6.2): its rows ARE WordPress users, so every other
 * plugin sees members as normal users. `id` ↔ `wp_users.ID`, `email` ↔ `user_email`, `name` ↔
 * `display_name` (when the collection has a `name` column), `role` ↔ the WP role
 * (`admin` = administrator, `guest` = sp_guest), `suspendedAt` from spacepress-identity's account
 * status; every other column is usermeta `sp_<col>`. The password never touches this store: it
 * goes through `wp_set_password` (PendingPassword).
 */
final class WpUserStore implements Store {

	public function readGuards( string $collection, \SpacePress\Viewer $viewer, bool $forSelect = false ): array {
		return array();
	}

	/**
	 * WordPress's Users screen shows every user's email to whoever may list users, so for them a
	 * taken email is nothing new. Only `email`: usermeta columns are not on that screen. Not on a
	 * network, where the screen lists one site's users and the email is unique across all of them
	 * (a super admin sees them all). Not for a scoped application password, which can't create
	 * users or change its own email ({@see AgentScope}).
	 */
	public function showsUnique( string $collection, string $column, \SpacePress\Viewer $viewer ): bool {
		$id = (int) ( $viewer->user['id'] ?? 0 );

		return 'email' === $column && $id > 0 && user_can( $id, 'list_users' )
			&& ( ! is_multisite() || is_super_admin( $id ) )
			&& AgentScope::current() === null;
	}

	public const META   = 'sp_';
	private const ROLES = array(
		'guest'      => 'sp_guest',
		'subscriber' => 'subscriber',
		'author'     => 'author',
		'editor'     => 'editor',
		'admin'      => 'administrator',
	);
	/** @var array<string, Source> */
	private array $sources = array();

	public function __construct(
		private readonly Connection $db,
		private readonly Schema $schema,
		private readonly Dialect $dialect,
		private readonly WpTableStore $tables,
	) {
	}

	/**
	 * wp-admin's profile screens edit the usermeta columns through one SCF field group located on
	 * every user form (§6.2). Field names are the usermeta keys, so SCF and SpacePress share the values.
	 */
	public static function registerFields( Schema $schema ): void {
		$collection = $schema->auth()['collection'] ?? null;
		if ( null === $collection || ! function_exists( 'acf_add_local_field_group' ) ) {
			return;
		}
		$spec   = $schema->collection( $collection );
		$fields = array();
		foreach ( $spec['columns'] as $col => $def ) {
			$col = (string) $col;
			// Scalar columns, whose SCF form this store reads and writes, and group/repeater/blocks
			// columns, which ProfileForm reads and writes through SpacePress (json and media lists stay
			// API-only on user forms).
			if ( ! self::onProfile( $col, $def ) ) {
				continue;
			}
			// showIf (§4.3) works as on posts: rules on watched fields live, rules on core user
			// columns or unwatched types settled against the saved member when the profile renders.
			$fields[] = array( 'sp_member' => true ) + Scf::fieldFor( $schema, 'field_sp_member_' . $col, self::META . $col, $col, $def, $spec );
		}
		acf_add_local_field_group(
			array(
				'key'      => 'group_sp_' . $collection,
				'title'    => (string) ( $schema->collection( $collection )['label'] ?? $collection ),
				'fields'   => $fields,
				'location' => array(
					array(
						array(
							'param'    => 'user_form',
							'operator' => '==',
							'value'    => 'all',
						),
					),
				),
				'active'   => true,
			)
		);
	}

	/**
	 * WordPress users created outside SpacePress (hosted sign-up, wp-admin, other plugins) get the member
	 * columns' declared defaults, as a SpacePress create would give them (§6.2: rows are users).
	 */
	public static function fillDefaults( Schema $schema, int $userId ): void {
		\SpacePress\Js::atInstant( static fn () => self::fill_defaults_at( $schema, $userId ) );
	}

	private static function fill_defaults_at( Schema $schema, int $userId ): void {
		$collection = $schema->auth()['collection'] ?? null;
		if ( null === $collection ) {
			return;
		}
		foreach ( $schema->collection( $collection )['columns'] as $col => $def ) {
			$col = (string) $col;
			if ( ( $def['system'] ?? false ) || ! isset( $def['default'] ) || in_array( $col, array( 'id', 'email', 'name' ), true )
				|| metadata_exists( 'user', $userId, self::META . $col ) ) {
				continue;
			}
			$stored = Schema::store( $def, Schema::generate( $def['default'], $def ) );
			if ( null === $stored ) {
				continue;
			}
			$value = self::metaForm( $def, $stored );
			update_user_meta( $userId, self::META . $col, wp_slash( $value ) );
		}
	}

	/** Storage form (§3.4) → the usermeta value SCF's own field would keep. */
	public static function metaForm( array $def, int|float|string $stored ): mixed {
		return match ( $def['type'] ?? '' ) {
			'select' => json_decode( (string) $stored, true ),   // an array; WordPress serializes it
			'boolean' => $stored ? '1' : '0',
			'timestamp' => substr( (string) $stored, 0, 10 ) . ' ' . substr( (string) $stored, 11, 8 ),
			'date' => str_replace( '-', '', (string) $stored ),
			default => is_float( $stored ) ? \SpacePress\Js::numStr( $stored ) : (string) $stored,
		};
	}

	public const ROLE_META = 'sp_role';

	/**
	 * The ladder role every member row, filter and access rule reads: kept in `sp_role` usermeta
	 * and recomputed from WP_User::has_cap (WordPress's own ordered role/capability merge, exactly
	 * what authentication uses) whenever a user's roles or capabilities change.
	 */
	public static function syncRole( int $userId ): void {
		$user = get_userdata( $userId );
		if ( $user instanceof \WP_User ) {
			update_user_meta( $userId, self::ROLE_META, WpAuth::map( $user )['role'] );
		}
	}

	/** Keep `sp_role` current: role changes, capability edits, new users; backfill on activation. */
	public static function trackRoles(): void {
		$sync = static fn ( $userId ) => self::syncRole( (int) $userId );
		add_action( 'set_user_role', $sync );
		add_action( 'add_user_role', $sync );
		add_action( 'remove_user_role', $sync );
		add_action( 'user_register', $sync, 20 );
		add_action( 'profile_update', $sync );
		// Direct capability edits write wp_capabilities; follow that meta key on any write path.
		$onMeta = static function ( $metaId, $userId, $key ) use ( $sync ): void {
			if ( str_ends_with( (string) $key, 'capabilities' ) ) {
				$sync( $userId );
			}
		};
		add_action( 'added_user_meta', $onMeta, 10, 3 );
		add_action( 'updated_user_meta', $onMeta, 10, 3 );
		add_action(
			'deleted_user_meta',
			static function ( $metaIds, $userId, $key ) use ( $sync ): void {
				if ( str_ends_with( (string) $key, 'capabilities' ) ) {
					$sync( $userId ); // remove_all_caps()
				}
			},
			10,
			3
		);
		// A role definition changed (add_cap/remove_cap on a role, add_role/remove_role): every user's
		// ladder role may have moved.
		$roles    = wp_roles()->role_key;
		$everyone = static function () use ( $sync ): void {
			foreach ( get_users(
				array(
					'fields' => 'ID',
					'number' => -1,
				)
			) as $id ) {
				$sync( $id );
			}
		};
		add_action( "update_option_$roles", $everyone );
	}

	/**
	 * Whether a member column is an SCF field on profile forms: scalar usermeta columns this store
	 * reads and writes in SCF's form, and group/repeater/blocks columns (ProfileForm, through SpacePress).
	 * Core user columns, system columns, references, json and media lists stay API-only there
	 * (ConditionalLogic settles rules on them against the saved member).
	 */
	public static function onProfile( string $col, array $def ): bool {
		return ! in_array( $col, array( 'id', 'email', 'name' ), true ) && ! ( $def['system'] ?? false ) && ! isset( $def['references'] )
			&& in_array( $def['type'], array( 'text', 'integer', 'real', 'boolean', 'select', 'email', 'url', 'date', 'timestamp', 'richText', 'group', 'repeater', 'blocks' ), true );
	}

	public static function wpRole( string $role ): string {
		return self::ROLES[ $role ] ?? 'subscriber';
	}

	/** The SpacePress role a WordPress role maps to (contributor is author), or null for any other role. */
	public static function firstRole( string $wpRole ): ?string {
		return 'contributor' === $wpRole ? 'author' : ( array_search( $wpRole, self::ROLES, true ) ?: null );
	}

	/** A member's login, as core's `username` asks (SpacePress generates one otherwise). Validated as core does. */
	public static function setLogin( Connection $db, int $id, string $login ): void {
		$login = sanitize_user( $login, true );
		if ( '' === $login || ! validate_username( $login ) || mb_strlen( $login ) > 60 ) {
			throw \SpacePress\HttpError::invalidInput( 'This username is invalid because it uses illegal characters', '/username' );
		}
		$owner = username_exists( $login );
		if ( false !== $owner && (int) $owner !== $id ) {
			throw new \SpacePress\HttpError( 409, 'unique_violation', 'Sorry, that username already exists!', '/username' );
		}
		$wpdb = $db->wpdb();
		// An author slug unique among users, with core's own `-2` suffixes (wp_insert_user's rule).
		$base     = mb_substr( sanitize_title( $login ), 0, 50 );
		$nicename = $base;
		for ( $n = 2; $db->run( "SELECT ID FROM `{$wpdb->users}` WHERE user_nicename = ? AND ID <> ? LIMIT 1", array( $nicename, $id ) ) !== array(); $n++ ) {
			$nicename = mb_substr( $base, 0, 49 - strlen( (string) $n ) ) . '-' . $n;
		}
		$db->run( "UPDATE `{$wpdb->users}` SET user_login = ?, user_nicename = ? WHERE ID = ?", array( $login, $nicename, $id ) );
		clean_user_cache( $id );
	}

	/** Before a member's delete: their posts go to $to (core's `reassign`), not to no one. */
	public static function reassignPosts( Connection $db, int $from, int $to ): void {
		$wpdb  = $db->wpdb();
		$posts = array_map( 'intval', array_column( $db->run( "SELECT ID FROM `{$wpdb->posts}` WHERE post_author = ?", array( $from ) ), 'ID' ) );
		if ( array() === $posts ) {
			return;
		}
		$db->run( "UPDATE `{$wpdb->posts}` SET post_author = ? WHERE post_author = ?", array( $to, $from ) );
		foreach ( $posts as $post ) {
			$db->touchPost( $post );
			clean_post_cache( $post );
		}
	}

	public function source( string $collection ): Source {
		return $this->sources[ $collection ] ??= $this->build( $collection );
	}

	private function build( string $collection ): Source {
		$spec         = $this->schema->collection( $collection );
		$wpdb         = $this->db->wpdb();
		$meta         = static fn ( string $key ) => "LEFT JOIN `{$wpdb->usermeta}` {j} ON {j}.user_id = {a}.ID AND {j}.meta_key = '" . addslashes( $key ) . "'";
		$v            = "NULLIF({j}.meta_value, '')";
		$capabilities = $wpdb->get_blog_prefix() . 'capabilities';
		// A user without sp_role yet (created before tracking) reads as subscriber until backfilled.
		$role   = "COALESCE({j}.meta_value, 'subscriber')";
		$status = $wpdb->prefix . 'sp_identity_accounts';
		$refs   = array();
		foreach ( $spec['columns'] as $col => $def ) {
			$col          = (string) $col;
			$refs[ $col ] = match ( true ) {
				$col === $spec['primaryKey'] => new ColumnRef( '{a}.ID', '', '', 'scalar' ),
				'email' === $col => new ColumnRef( '{a}.user_email', '', '', 'scalar' ),
				'name' === $col => new ColumnRef( '{a}.display_name', '', '', 'scalar' ),
				'role' === $col => new ColumnRef( $role, $meta( self::ROLE_META ), '', 'scalar' ),
				'guest' === $col => new ColumnRef( "CASE WHEN {j}.meta_value LIKE '%\"sp_guest\"%' THEN 1 ELSE 0 END", $meta( $capabilities ), '', 'scalar' ),
				'passwordHash' === $col => new ColumnRef( 'NULL', '', '', 'scalar' ),
				'suspendedAt' === $col => $this->identity_table( $status )
					? new ColumnRef( "CASE WHEN {j}.status IN ('suspended','deletion_requested','deleted') THEN '1970-01-01T00:00:00.000Z' END", "LEFT JOIN `$status` {j} ON {j}.wp_user_id = {a}.ID", '', 'scalar' )
					: new ColumnRef( 'NULL', '', '', 'scalar' ),
				'integer' === $def['type'], 'media' === $def['type'] => new ColumnRef( $v, $meta( self::META . $col ), "CAST($v AS SIGNED)", 'scalar' ),
				'real' === $def['type'] => new ColumnRef( $v, $meta( self::META . $col ), "CAST($v AS DECIMAL(30,10))", 'scalar' ),
				// SCF's own forms where its user-form fields edit the value (as on posts, §3.5.1):
				// multiple selects are PHP-serialized arrays, booleans '1'/'0', numbers numeric text.
				'select' === $def['type'] => new ColumnRef( $v, $meta( self::META . $col ), '{j}.meta_value', 'serialized-list' ),
				'integer' === $def['type'], 'media' === $def['type'] => new ColumnRef( $v, $meta( self::META . $col ), "CAST($v AS SIGNED)", 'scalar' ),
				'real' === $def['type'] => new ColumnRef( $v, $meta( self::META . $col ), "CAST($v AS DECIMAL(30,10))", 'scalar' ),
				'boolean' === $def['type'] => new ColumnRef( $v, $meta( self::META . $col ), $v, 'scalar' ),
				// SCF's date/time pickers keep 'Y-m-d H:i:s' (UTC) and 'Ymd', as on posts (§3.5.1).
				'timestamp' === $def['type'] => new ColumnRef( "CONCAT(REPLACE($v, ' ', 'T'), '.000Z')", $meta( self::META . $col ), $v, 'scalar' ),
				'date' === $def['type'] => new ColumnRef( $this->dialect->isoDate( $v ), $meta( self::META . $col ), $v, 'scalar' ),
				// Structured columns keep their storage form (§3.4), as custom tables do; no SCF field edits them.
				default => new ColumnRef( $v, $meta( self::META . $col ), ColumnRef::kindFor( $def['type'] ) === 'scalar' ? $v : '', ColumnRef::kindFor( $def['type'] ) ),
			};
		}

		return new Source( '`' . $wpdb->users . '`', '', $refs );
	}

	private function identity_table( string $table ): bool {
		return $this->db->run( 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', array( $table ) ) !== array();
	}

	public function select( string $collection, array $q ): array {
		$rows = $this->db->run( $q['sql'], $q['params'] );
		$spec = $this->schema->collection( $collection );
		\SpacePress\Extensions::lookup( $collection, array_column( $rows, $spec['primaryKey'] ) );
		foreach ( $spec['columns'] as $col => $def ) {
			if ( 'select' !== $def['type'] ) {
				continue;
			}
			foreach ( $rows as &$row ) {
				$v = $row[ $col ] ?? null;
				if ( null !== $v ) {
					$list        = is_serialized( $v ) ? @unserialize( $v, array( 'allowed_classes' => false ) ) : json_decode( (string) $v, true );
					$row[ $col ] = \SpacePress\Js::jsonStringify( array_values( array_map( 'strval', is_array( $list ) ? $list : array( $v ) ) ) );
				}
			}
			unset( $row );
		}

		return $rows;
	}

	public function insert( string $collection, array $values ): int|string {
		$spec  = $this->schema->collection( $collection );
		$email = (string) ( $values['email'] ?? '' );
		if ( ( $values['role'] ?? null ) !== 'guest' ) {
			$this->check_email( $email, 0 );
		}
		$this->check_unique( $spec, $values, 0 );
		$guest = ( $values['role'] ?? null ) === 'guest';
		$user  = array(
			'user_login'   => ( $guest ? 'zg_' : 'zm_' ) . bin2hex( random_bytes( 10 ) ),
			// Guests have no email yet: the generated placeholder is only the row's unique key.
			'user_email'   => $guest ? '' : $email,
			'user_pass'    => wp_generate_password( 32, true, true ),
			'display_name' => (string) ( $values['name'] ?? $email ),
			'role'         => self::wpRole( (string) ( $values['role'] ?? 'subscriber' ) ),
		);
		$id    = $this->db->core( static fn () => wp_insert_user( wp_slash( $user ) ) );
		if ( $id instanceof \WP_Error ) {
			throw new \RuntimeException( 'wp_insert_user failed: ' . $id->get_error_message() );
		}
		$this->forget_on_rollback( (int) $id );
		$this->write_password( (int) $id, $values );
		$this->write_meta( $spec, (int) $id, $values );

		return (int) $id;
	}

	public function update( string $collection, int|string $pk, array $values ): void {
		$spec = $this->schema->collection( $collection );
		$id   = (int) $pk;
		$this->forget_on_rollback( $id );
		$this->check_unique( $spec, $values, $id );
		$core = array();
		if ( array_key_exists( 'email', $values ) ) {
			$this->check_email( (string) $values['email'], $id );
			$core['user_email'] = (string) $values['email'];
		}
		if ( array_key_exists( 'name', $values ) ) {
			$core['display_name'] = (string) ( $values['name'] ?? '' );
		}
		if ( array() !== $core ) {
			$r = $this->db->core( static fn () => wp_update_user( wp_slash( array( 'ID' => $id ) + $core ) ) );
			if ( $r instanceof \WP_Error ) {
				throw new \RuntimeException( 'wp_update_user failed: ' . $r->get_error_message() );
			}
		}
		if ( array_key_exists( 'role', $values ) ) {
			$this->db->core( static fn () => ( new \WP_User( $id ) )->set_role( self::wpRole( (string) $values['role'] ) ) );
		}
		$this->write_password( $id, $values );
		$this->write_meta( $spec, $id, $values );
		clean_user_cache( $id );
	}

	public function delete( string $collection, int|string $pk ): void {
		$this->forget_on_rollback( (int) $pk );
		self::deleteUser( $this->db, (int) $pk );
	}

	/**
	 * Delete a WordPress user inside SpacePress's transaction. Authored posts stay (reassigned to no one,
	 * like wp-admin's "attribute to"): their removal is for SpacePress's declared referential actions, not
	 * core's delete-everything default. spacepress-identity forgets the user through `delete_user`.
	 */
	public static function deleteUser( Connection $db, int $id ): void {
		require_once ABSPATH . 'wp-admin/includes/user.php';
		$posts = array_map( 'intval', array_column( $db->run( 'SELECT ID FROM `' . $db->wpdb()->posts . '` WHERE post_author = ?', array( $id ) ), 'ID' ) );
		if ( array() !== $posts ) {
			$db->run( 'UPDATE `' . $db->wpdb()->posts . '` SET post_author = 0 WHERE post_author = ?', array( $id ) );
			foreach ( $posts as $post ) {
				$db->touchPost( $post );
				clean_post_cache( $post );
			}
		}
		$db->core( static fn () => wp_delete_user( $id ) );
	}

	/**
	 * A write-only password (PendingPassword) goes through wp_set_password, so
	 * WordPress hashes it and its `wp_set_password` hook runs for every plugin; on rollback the
	 * user's cache is cleared with the rest.
	 */
	private function write_password( int $id, array $values ): void {
		$password = PendingPassword::take( $values['passwordHash'] ?? null );
		if ( null === $password ) {
			return;
		}
		$this->db->core( static fn () => wp_set_password( $password, $id ) );
		clean_user_cache( $id );
	}

	/** Columns stored as `sp_<col>` usermeta. */
	private function write_meta( array $spec, int $id, array $values ): void {
		foreach ( $values as $col => $stored ) {
			$col = (string) $col;
			if ( in_array( $col, array( $spec['primaryKey'], 'email', 'name', 'role', 'guest', 'passwordHash', 'suspendedAt' ), true ) ) {
				continue;
			}
			$value = null === $stored ? null : self::metaForm( $spec['columns'][ $col ] ?? array(), $stored );
			$this->db->core(
				static fn () => null === $value
				? delete_user_meta( $id, self::META . $col )
				: update_user_meta( $id, self::META . $col, wp_slash( $value ) )
			);
		}
	}

	/** On rollback, WordPress's caches of this user (row and usermeta) must not outlive the SQL. */
	private function forget_on_rollback( int $id ): void {
		$this->db->onRollback(
			static function () use ( $id ): void {
				clean_user_cache( $id );
				wp_cache_delete( $id, 'user_meta' );
			}
		);
	}

	/** Declared unique usermeta columns hold no duplicate (email is wp_users' own, checked apart). */
	private function check_unique( array $spec, array $values, int $self ): void {
		foreach ( $values as $col => $stored ) {
			$col = (string) $col;
			if ( null === $stored || 'email' === $col || ! ( $spec['columns'][ $col ]['unique'] ?? false ) || in_array( $col, array( $spec['primaryKey'], 'role' ), true ) ) {
				continue;
			}
			$hit = 'name' === $col
				? $this->db->run( 'SELECT ID FROM `' . $this->db->wpdb()->users . '` WHERE display_name = ? AND ID <> ? LIMIT 1 FOR UPDATE', array( (string) $stored, $self ) )
				: $this->db->run(
					'SELECT user_id FROM `' . $this->db->wpdb()->usermeta . '` WHERE meta_key = ? AND meta_value = ? AND user_id <> ? LIMIT 1 FOR UPDATE',
					array( self::META . $col, maybe_serialize( self::metaForm( $spec['columns'][ $col ], $stored ) ), $self ),
				);
			if ( array() !== $hit ) {
				throw new HttpError( 409, 'unique_violation', "A row with this $col already exists", HttpError::seg( $col ) );
			}
		}
	}

	private function check_email( string $email, int $self ): void {
		$hit = $this->db->run( 'SELECT ID FROM `' . $this->db->wpdb()->users . '` WHERE user_email = ? AND ID <> ? LIMIT 1 FOR UPDATE', array( $email, $self ) );
		if ( array() !== $hit ) {
			throw new HttpError( 409, 'unique_violation', 'A row with this email already exists', '/email' );
		}
	}

	// ================================================================ the rest is shared with the custom-table store

	public function transaction( callable $fn ): mixed {
		return $this->db->transaction( $fn );
	}

	public function afterCommit( callable $fn ): void {
		$this->db->afterCommit( $fn );
	}

	public function applySystemStatements( array $statements ): void {
		$this->tables->applySystemStatements( $statements );
	}

	public function dialect(): Dialect {
		return $this->dialect;
	}

	public function globalRead( string $name ): ?array {
		return $this->tables->globalRead( $name );
	}

	public function globalWrite( string $name, array $values ): void {
		$this->tables->globalWrite( $name, $values );
	}

	public function revisions( string $collection, int|string $pk ): array {
		return array();
	}

	public function revisionWrite( string $collection, int|string $pk, array $encodedRow, ?int $userId, array $meta = array() ): void {
	}

	public function revision( string $collection, int|string $pk, int $revisionId, bool $byVersion = false ): ?array {
		return null;
	}

	public function promoteDue( string $collection, string $nowIso ): array {
		return array();
	}

	public function mapError( \Throwable $e ): \Throwable {
		return $this->tables->mapError( $e );
	}
}
