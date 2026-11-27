<?php

declare(strict_types=1);

namespace SpacePress\Wp;

use SpacePress\Schema;

/**
 * The schema lock (spec.md §6): `spacepress.config.ts` is the only way to change what SpacePress generates from
 * it. SpacePress registers its post types, meta, field groups and options pages in code on every request,
 * so the database holds nothing of theirs to edit. What a site could still do is store something that
 * takes their place, attaches to them or writes their values around SpacePress, and that is refused to
 * every user, administrators included:
 *
 * - Saving a Secure Custom Fields object (field group, field, post type, taxonomy, options page) under
 *   one of SpacePress's names, or attached to one of SpacePress's kinds or global options pages. SCF keeps these
 *   as posts, so the refusal sits where WordPress saves a post ({@see saving()}), and judges what is
 *   stored and every SCF form the request carries. SCF's abilities are refused before they run.
 * - Writing a value through a field SpacePress didn't register: onto a SpacePress kind's post, a global's
 *   options page, or the user meta and options SpacePress's own fields write ({@see value()}).
 * - Changing a role SpacePress creates, or a capability of a SpacePress kind on any role ({@see roles()}), or
 *   one of SpacePress's own options from wp-admin's all-options screen ({@see option()}).
 *
 * Objects already in the database (stored by WP-CLI, or while the app was inactive) are left as they
 * are and do nothing: SCF never loads one that is SpacePress's ({@see load()}), and a stored field group
 * never applies to a SpacePress kind ({@see matchRule()}).
 *
 * Names are compared the way WordPress stores them and MariaDB matches them: without accents, letter
 * case or the characters WordPress strips. Content, media, users, other plugins' settings and SCF
 * objects of the site's own stay open. WP-CLI is the operator's trusted channel, as it is for
 * `wp spacepress insert`, and is not refused. Like every other switch, these are hooks that exist while the
 * app is active; nothing is written.
 */
final class SchemaLock {

	/** WordPress object names SpacePress generates (post types, meta, options, roles) start with this. */
	private const PREFIX       = 'sp_';
	private const GROUP_PREFIX = 'group_sp_';
	private const FIELD_PREFIX = 'field_sp_';
	/** Roles SpacePress creates, as it creates them ({@see IdentityBridge::provision}). */
	private const ROLES = array(
		'sp_guest' => array(
			'name'         => 'Guest',
			'capabilities' => array( 'read' => true ),
		),
	);
	/** SCF's own forms, each holding the object its edit screen saves. */
	private const FORMS = array( 'acf_field_group', 'acf_post_type', 'acf_taxonomy', 'acf_ui_options_page' );

	/** @var array<string, true> */
	private static array $post_types = array();
	/** @var array<string, true> SCF options pages SpacePress registers: menu slugs and post ids */
	private static array $options_pages = array();
	/** @var array<string, true> the user meta and option names SpacePress's fields write */
	private static array $user_meta = array();
	/** @var array<string, true> */
	private static array $options = array();
	/** Set while an SCF ability runs: a refusal from its save becomes the ability's own error. */
	private static ?string $ability_refused = null;
	private static int $abilities           = 0;

	public static function apply( Schema $schema ): void {
		foreach ( $schema->collections() as $spec ) {
			// WordPress's own posts aren't the app's to lock: other plugins' fields on posts keep working.
			if ( isset( $spec['wp']['postType'] ) && ! ( $spec['native'] ?? false ) ) {
				self::$post_types[ self::norm( $spec['wp']['postType'] ) ] = true;
			}
		}
		self::$options_pages = array( 'spacepress-' . $schema->name() => true );
		foreach ( $schema->globals() as $global ) {
			self::$options_pages[ self::norm( $global['wp']['menuSlug'] ) ] = true;
			self::$options_pages[ self::norm( $global['wp']['postId'] ) ]   = true;
			foreach ( array_keys( $global['fields'] ) as $field ) {
				// SCF keeps a value as `<postId>_<field>` and its field key as `_<postId>_<field>`.
				self::$options[ self::norm( $global['wp']['postId'] . '_' . $field ) ] = true;
			}
		}
		$users = $schema->auth()['collection'] ?? null;
		foreach ( null === $users ? array() : array_keys( $schema->collection( $users )['columns'] ) as $col ) {
			self::$user_meta[ self::norm( WpUserStore::META . $col ) ] = true;
		}
		add_filter( 'wp_insert_post_empty_content', array( self::class, 'saving' ), PHP_INT_MAX, 2 );
		add_filter( 'wp_pre_execute_ability', array( self::class, 'ability' ), 10, 3 );
		add_action(
			'wp_before_execute_ability',
			static function ( string $name ): void {
				self::$abilities += str_starts_with( $name, 'scf/' ) ? 1 : 0;
			}
		);
		add_filter( 'wp_ability_execute_result', array( self::class, 'abilityResult' ), PHP_INT_MAX, 2 );
		add_action( 'admin_init', array( self::class, 'admin' ), 0 );
		foreach ( array( 'field_groups', 'post_types', 'taxonomies', 'ui_options_pages' ) as $plural ) {
			add_filter( "acf/load_$plural", array( self::class, 'load' ), 10 );
		}
		add_filter( 'acf/location/rule_match', array( self::class, 'matchRule' ), PHP_INT_MAX, 4 );
		add_filter( 'acf/pre_update_value', array( self::class, 'value' ), 0, 4 );
		add_filter( 'pre_update_option', array( self::class, 'option' ), PHP_INT_MAX, 3 );
	}

	public static function message( string $what ): string {
		return "Refused: $what belongs to the app's schema, which SpacePress builds from spacepress.config.ts. Change it there and deploy the app; it can't be changed on the site.";
	}

	// ================================================================ Secure Custom Fields objects

	/**
	 * wp_insert_post_empty_content: every save of an SCF object, before WordPress writes it. Judged:
	 * the object as it will be stored (SCF keeps the key as the post name and its settings serialized
	 * in the content), and every SCF form the request carries. Moving an object to the trash or turning
	 * it off is how a site removes one, and stays open.
	 *
	 * @param array<string, mixed> $post slashed, as wp_insert_post received it
	 */
	public static function saving( mixed $empty, mixed $post ): mixed { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.emptyFound -- Preserve the existing PHP parameter name.
		$type = is_array( $post ) ? (string) ( $post['post_type'] ?? '' ) : '';
		if ( ! str_starts_with( $type, 'acf-' ) || in_array( $post['post_status'] ?? '', array( 'trash', 'acf-disabled' ), true ) || self::trusted() ) {
			return $empty;
		}
		$problem = self::problem(
			self::object(
				wp_unslash( (string) ( $post['post_name'] ?? '' ) ),
				wp_unslash( (string) ( $post['post_content'] ?? '' ) ),
				(int) ( $post['post_parent'] ?? 0 ),
			)
		) ?? self::forms();
		if ( null === $problem ) {
			return $empty;
		}
		if ( self::$abilities > 0 ) {
			// Inside an SCF ability: the save fails, and the ability answers with the refusal.
			self::$ability_refused ??= $problem;

			return true;
		}
		self::refuse( $problem );
	}

	/** The first problem in any SCF form of this request (wp-admin's edit screens post them). */
	private static function forms(): ?string {
		foreach ( self::FORMS as $form ) {
			if ( is_array( $_POST[ $form ] ?? null ) && ( $problem = self::problem( wp_unslash( $_POST[ $form ] ) ) ) !== null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
				return $problem;
			}
		}

		return is_array( $_POST['acf_fields'] ?? null ) ? self::problem( array( 'fields' => wp_unslash( $_POST['acf_fields'] ) ) ) : null;
	}

	/**
	 * An SCF object as it is stored: its key is the post name, its settings the serialized content, and
	 * a field's parent is the group or field post above it. Content is decoded as data only.
	 *
	 * @return array<string, mixed>
	 */
	private static function object( string $key, string $content, int $parent ): array { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.parentFound -- Preserve the existing PHP parameter name.
		$settings = is_serialized( $content ) ? @unserialize( trim( $content ), array( 'allowed_classes' => false ) ) : null;

		return array(
			'key'    => $key,
			'parent' => $parent > 0 ? get_post( $parent )?->post_name : null,
		) + ( is_array( $settings ) ? $settings : array() );
	}

	/**
	 * admin_init, before SCF acts on a wp-admin request: its import tool (which saves a group's fields
	 * before the group), and its list screen's duplicate (which copies fields before the group).
	 */
	public static function admin(): void {
		if ( self::trusted() || ! current_user_can( (string) ( function_exists( 'acf_get_setting' ) ? acf_get_setting( 'capability' ) : 'manage_options' ) ) ) {
			return;
		}
		$file = $_FILES['acf_import_file']['tmp_name'] ?? null;
		if ( ( $_GET['page'] ?? null ) === 'acf-tools' && is_string( $file ) && is_uploaded_file( $file ) && wp_verify_nonce( (string) ( $_POST['_acf_nonce'] ?? '' ), 'import' ) ) {
			$json = json_decode( (string) file_get_contents( $file ), true );
			if ( is_array( $json ) ) {
				self::refuse( self::problem( isset( $json['key'] ) ? $json : array( 'fields' => $json ) ) );
			}
		}
		$ids = isset( $_GET['acfduplicate'] ) ? array( $_GET['acfduplicate'] )
			: ( in_array( 'acfduplicate', array( $_GET['action'] ?? null, $_GET['action2'] ?? null ), true ) ? (array) ( $_GET['post'] ?? array() ) : array() );
		foreach ( $ids as $id ) {
			$stored = is_numeric( $id ) ? get_post( (int) $id ) : null;
			if ( $stored instanceof \WP_Post && str_starts_with( $stored->post_type, 'acf-' ) ) {
				self::refuse( self::problem( self::object( $stored->post_name, $stored->post_content, (int) $stored->post_parent ) ) );
			}
		}
	}

	/**
	 * wp_pre_execute_ability: an SCF ability that would store something of SpacePress's gets the refusal as
	 * its own error, before SCF writes anything. Judged: the input, and the stored object the input
	 * names by id or key (an update merges into it, a duplicate copies it). Reading, exporting, removing
	 * and turning off a stored object stay open.
	 */
	public static function ability( mixed $pre, mixed $name, mixed $input ): mixed {
		if ( ! is_string( $name ) || ! preg_match( '#^scf/(?!get-|list-|export-|delete-|trash-)#', $name ) || ! is_array( $input ) || self::trusted() ) {
			return $pre;
		}
		$problem = self::problem( $input + array( 'key' => $input['identifier'] ?? null ) );
		$id      = $input['ID'] ?? $input['identifier'] ?? null;
		if ( null === $problem && ( is_int( $id ) || is_string( $id ) ) && '' !== $id ) {
			$types = array_values( array_filter( get_post_types(), static fn ( string $type ): bool => str_starts_with( $type, 'acf-' ) ) );
			$post  = is_numeric( $id ) ? get_post( (int) $id ) : ( get_posts(
				array(
					'name'        => $id,
					'post_type'   => $types,
					'post_status' => 'any',
					'numberposts' => 1,
				)
			)[0] ?? null );
			if ( $post instanceof \WP_Post && in_array( $post->post_type, $types, true ) ) {
				// An update replaces the settings it sends: only the ones it leaves are the stored ones.
				$problem = self::problem( array_diff_key( self::object( $post->post_name, $post->post_content, (int) $post->post_parent ), $input ) );
			}
		}

		return null === $problem ? $pre : self::error( $problem );
	}

	/** wp_ability_execute_result: an SCF ability whose save was refused answers with the refusal. */
	public static function abilityResult( mixed $result, mixed $name ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( ! is_string( $name ) || ! str_starts_with( $name, 'scf/' ) ) {
			return $result;
		}
		self::$abilities       = max( 0, self::$abilities - 1 );
		$refused               = self::$ability_refused;
		self::$ability_refused = null;

		return null === $refused ? $result : self::error( $refused );
	}

	private static function error( string $problem ): \WP_Error {
		return new \WP_Error( 'sp_schema_locked', self::message( $problem ), array( 'status' => 403 ) );
	}

	/**
	 * What makes an SCF object SpacePress's: its key or its parent's, the post type or taxonomy it declares,
	 * the SpacePress kind or options page it attaches to; the same for every object nested in it (a group's
	 * fields, their sub-fields and layouts). Null for an object of the site's own.
	 *
	 * @param array<string, mixed> $object an SCF field group, field, post type, taxonomy or options page
	 */
	private static function problem( array $object ): ?string { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.objectFound -- Preserve the existing PHP parameter name.
		foreach ( array( 'key', 'parent' ) as $key ) {
			$name = self::norm( $object[ $key ] ?? null );
			if ( str_starts_with( $name, self::GROUP_PREFIX ) || str_starts_with( $name, self::FIELD_PREFIX ) ) {
				return "the field or field group $name";
			}
		}
		foreach ( array(
			'post_type' => 'post type',
			'taxonomy'  => 'taxonomy',
		) as $key => $label ) {
			if ( str_starts_with( $name = self::norm( $object[ $key ] ?? null ), self::PREFIX ) ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
				return "the $label $name";
			}
		}
		foreach ( (array) ( $object['object_type'] ?? array() ) as $type ) {
			if ( self::sp_type( $type ) ) {
				return 'the list of taxonomies of ' . self::norm( $type );
			}
		}
		foreach ( array( 'menu_slug', 'post_id' ) as $key ) {
			if ( isset( self::$options_pages[ $name = self::norm( $object[ $key ] ?? null ) ] ) ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
				return "the options page $name";
			}
		}
		foreach ( is_array( $object['location'] ?? null ) ? $object['location'] : array() as $rules ) {
			foreach ( is_array( $rules ) ? $rules : array() as $rule ) {
				$param = is_array( $rule ) ? (string) ( $rule['param'] ?? '' ) : '';
				$value = is_array( $rule ) ? ( $rule['value'] ?? null ) : null;
				if ( ( 'post_type' === $param && self::sp_type( $value ) ) || ( 'options_page' === $param && isset( self::$options_pages[ self::norm( $value ) ] ) ) ) {
					return 'the field list of ' . self::norm( $value );
				}
			}
		}
		foreach ( array( 'fields', 'sub_fields', 'layouts' ) as $nested ) {
			foreach ( is_array( $object[ $nested ] ?? null ) ? $object[ $nested ] : array() as $child ) {
				if ( is_array( $child ) && ( $problem = self::problem( $child ) ) !== null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
					return $problem;
				}
			}
		}

		return null;
	}

	/**
	 * acf/load_<plural>, before SCF adds the objects registered in code: a stored object that is
	 * SpacePress's (stored by WP-CLI, or before the app was active) is never loaded, so it can't register a
	 * post type or taxonomy over SpacePress's, change one of SpacePress's field groups or show on an options page.
	 *
	 * @param list<array> $posts
	 */
	public static function load( mixed $posts ): mixed {
		return is_array( $posts )
			? array_values( array_filter( $posts, static fn ( mixed $post ): bool => ! is_array( $post ) || empty( $post['ID'] ) || self::problem( $post ) === null ) )
			: $posts;
	}

	/**
	 * A field group kept in the database never applies to one of SpacePress's kinds or options pages,
	 * whatever its rules say (`!=`, a post id, a status). Groups registered in code are not this rule's.
	 */
	public static function matchRule( mixed $match, mixed $rule, mixed $screen, mixed $group ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, Universal.NamingConventions.NoReservedKeywordParameterNames.matchFound -- Preserve the existing PHP method name. Preserve the existing PHP parameter name.
		if ( ! $match || ! is_array( $group ) || empty( $group['ID'] ) || ! is_array( $screen ) ) {
			return $match;
		}
		$type = $screen['post_type'] ?? ( is_numeric( $screen['post_id'] ?? null ) ? get_post_type( (int) $screen['post_id'] ) : null );

		return self::sp_type( $type ) || isset( self::$options_pages[ self::norm( $screen['options_page'] ?? null ) ] ) ? false : $match;
	}

	/**
	 * acf/pre_update_value: SCF saves every field a form or call posts, wherever its group applies. A
	 * value written through a field SpacePress didn't register is skipped when it lands on a SpacePress kind's
	 * post, a global's options page, or one of the user meta and option names SpacePress's own fields write;
	 * the rest of the save goes on. SpacePress's own fields are SCF's local fields.
	 */
	public static function value( mixed $check, mixed $value, mixed $postId, mixed $field ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		if ( null !== $check || ! is_array( $field ) || self::trusted() || ( isset( $field['key'] ) && acf_is_local_field( (string) $field['key'] ) ) ) {
			return $check;
		}
		$target = acf_decode_post_id( $postId ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$first  = match ( $target['type'] ) {
			'post' => self::sp_type( get_post_type( (int) $target['id'] ) ),
			'user' => self::protected_user_meta( $field['name'] ?? null ),
			'option' => isset( self::$options_pages[ self::norm( $target['id'] ) ] ) || isset( self::$options[ self::norm( $target['id'] . '_' . ( $field['name'] ?? '' ) ) ] ),
			default => false,
		};

		return $first ? false : $check;
	}

	private static function protected_user_meta( mixed $name ): bool {
		$name = self::norm( $name );

		return isset( self::$user_meta[ $name ] ) || $name === self::norm( WpUserStore::ROLE_META ); // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
	}

	// ================================================================ options and roles

	/**
	 * pre_update_option: one of SpacePress's own options written from wp-admin's all-options screen keeps
	 * its value; and a write to the role definitions, from any screen, plugin or option form, is saved
	 * without its changes to a role SpacePress creates and without a capability of a SpacePress kind added to or
	 * taken from any role ({@see CoreAccess::mapMetaCap} answers those from the kind's rules).
	 */
	public static function option( mixed $value, mixed $option, mixed $old ): mixed {
		if ( ! is_string( $option ) || self::trusted() ) {
			return $value;
		}
		if ( $option === $GLOBALS['wpdb']->get_blog_prefix() . 'user_roles' ) {
			return self::roles( $value, $old );
		}
		if ( ( $GLOBALS['pagenow'] ?? null ) === 'options.php' && ( $_POST['option_page'] ?? 'options' ) === 'options' && str_starts_with( self::norm( $option ), self::PREFIX ) ) {
			self::notify( self::message( "the option $option" ) );

			return $old;
		}

		return $value;
	}

	private static function roles( mixed $roles, mixed $old ): mixed {
		if ( ! is_array( $old ) ) {
			return $roles;
		}
		if ( ! is_array( $roles ) ) {
			// Not a set of roles at all (an emptied option): the roles stay as they are.
			self::notify( self::message( 'the roles of this site' ) );

			return $old;
		}
		$corrected = array();
		foreach ( self::ROLES as $name => $definition ) {
			$keep = $old[ $name ] ?? ( isset( $roles[ $name ] ) ? $definition : null );
			// phpcs:ignore Universal.Operators.StrictComparisons.LooseNotEqual -- The order of role settings is immaterial.
			if ( ( $roles[ $name ] ?? null ) != $keep ) {
				$corrected[ $name ] = $keep;
			}
		}
		foreach ( $roles as $name => $role ) {
			$before = (array) ( $old[ $name ]['capabilities'] ?? array() );
			$caps   = is_array( $role ) ? (array) ( $role['capabilities'] ?? array() ) : array();
			$kept   = array_filter( $caps, static fn ( $granted, $cap ): bool => ! self::sp_capability( (string) $cap ) || ( $before[ $cap ] ?? null ) === $granted, ARRAY_FILTER_USE_BOTH )
				+ array_filter( $before, static fn ( $cap ): bool => self::sp_capability( (string) $cap ), ARRAY_FILTER_USE_KEY );
			// phpcs:ignore Universal.Operators.StrictComparisons.LooseNotEqual -- Capability order is immaterial.
			if ( ! array_key_exists( $name, $corrected ) && is_array( $role ) && $kept != $caps ) {
				$corrected[ $name ] = array( 'capabilities' => $kept ) + $role;
			}
		}
		if ( array() === $corrected ) {
			return $roles;
		}
		self::notify( self::message( 'the role ' . preg_replace( '/[^A-Za-z0-9_ ,-]/', '', implode( ', ', array_keys( $corrected ) ) ) ) );
		$wp = wp_roles();
		foreach ( $corrected as $name => $role ) {
			// What is saved, and what WordPress holds in memory for the rest of this request, in place.
			if ( null === $role ) {
				unset( $roles[ $name ], $wp->roles[ $name ], $wp->role_names[ $name ], $wp->role_objects[ $name ] );
				continue;
			}
			$roles[ $name ]            = $wp->roles[ $name ] = $role; // phpcs:ignore Squiz.PHP.DisallowMultipleAssignments.Found -- Keep the assignment and its test together.
			$wp->role_names[ $name ]   = (string) ( $role['name'] ?? $name );
			$wp->role_objects[ $name ] = new \WP_Role( (string) $name, (array) ( $role['capabilities'] ?? array() ) );
		}

		return $roles;
	}

	/** A capability of one of SpacePress's post types (`edit_others_sp_notes`, `edit_sp_notes_item`). */
	private static function sp_capability( string $cap ): bool {
		$cap = self::norm( $cap );
		foreach ( self::$post_types as $type => $_ ) {
			if ( str_ends_with( $cap, "_$type" ) || str_ends_with( $cap, "_{$type}_item" ) ) {
				return true;
			}
		}

		return false;
	}

	/** A kept write is told where it still can be: a response header, and a settings notice in wp-admin. */
	private static function notify( string $message ): void {
		if ( ! headers_sent() ) {
			header( 'SpacePress-Schema-Lock: ' . $message );
		}
		if ( function_exists( 'add_settings_error' ) ) {
			add_settings_error( 'general', 'sp_schema_locked', $message );
		}
	}

	// ================================================================ helpers

	/** WP-CLI is the operator's channel, as it is for SpacePress's own trusted commands. */
	private static function trusted(): bool {
		return defined( 'WP_CLI' ) && WP_CLI;
	}

	/** A REST or MCP request gets the refusal as JSON, in core's error shape; a screen gets a page. */
	private static function refuse( ?string $problem ): void {
		if ( null === $problem ) {
			return;
		}
		if ( wp_is_serving_rest_request() ) {
			wp_send_json(
				array(
					'code'    => 'sp_schema_locked',
					'message' => self::message( $problem ),
					'data'    => array( 'status' => 403 ),
				),
				403
			);
		}
		wp_die(
			esc_html( self::message( $problem ) ),
			'SpacePress',
			array(
				'response'  => 403,
				'back_link' => true,
			)
		);
	}

	private static function sp_type( mixed $type ): bool {
		$type = self::norm( $type );

		return '' !== $type && ( isset( self::$post_types[ $type ] ) || str_starts_with( $type, self::PREFIX ) );
	}

	/**
	 * A name as WordPress stores it and MariaDB matches it: `sanitize_key` (post types, meta and option
	 * lookups lower-case and strip), after `remove_accents` (`sanitize_title` on keys, and the
	 * database's accent-insensitive collation).
	 */
	private static function norm( mixed $name ): string {
		return is_scalar( $name ) ? sanitize_key( remove_accents( (string) $name ) ) : '';
	}
}
