<?php

declare(strict_types=1);

namespace SpacePress\Wp;

use SpacePress\HttpError;
use SpacePress\Js;
use SpacePress\Schema;

/**
 * Secure Custom Fields wiring (§4.3, §4.5): one local field group per post-backed collection and per
 * global (options page), plus the validate/update/load filter trio that keeps wp-admin and core
 * REST saves on SpacePress's rules and storage forms.
 *
 * Keys are fixed by the compiler (schema.php `wp`): group `group_sp_<table>`, field
 * `field_sp_<table>_<col>`, sub-field `<field key>_<sub>`, blocks layout sub-field
 * `<field key>_<layout>_<sub>`. Every SpacePress field carries its column definition under `spacepress` so the
 * filters know what they are looking at; top-level fields also carry `sp_top`.
 *
 * Value forms: SpacePress's storage form (§3.4) ⇄ SCF's unformatted form (what update_field takes and
 * get_field(..., false) returns): booleans 1/0, dates `Ymd`, timestamps `Y-m-d H:i:s` UTC, lists as
 * arrays, group/repeater/blocks as arrays keyed by sub-field key (blocks rows carry acf_fc_layout).
 */
final class Scf {

	/**
	 * > 0 while SpacePress itself reads or writes SCF values: the timestamp filters then pass values
	 * through (SpacePress already speaks UTC); otherwise they convert for the site-timezone picker.
	 */
	public static int $io = 0;

	private const SCF_TYPES = array(
		'text',
		'textarea',
		'select',
		'number',
		'true_false',
		'date_picker',
		'date_time_picker',
		'email',
		'url',
		'wysiwyg',
		'image',
		'file',
		'gallery',
		'post_object',
		'group',
		'repeater',
		'flexible_content',
	);

	/** @var list<callable> */
	private static array $field_filters = array();

	/** @param callable(array $field, array $def, string $col, array $spec): array $fn */
	public static function fieldFilter( callable $fn ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Preserve the existing PHP method name. Preserve the existing PHP parameter name.
		self::$field_filters[] = $fn;
	}

	// ================================================================ registration (acf/init, priority 5)

	public static function register( Schema $schema ): void {
		if ( ! function_exists( 'acf_add_local_field_group' ) ) {
			return;
		}
		foreach ( $schema->collections() as $name => $spec ) {
			if ( ! ( $spec['editor'] ?? true ) || ( $spec['wp'] ?? null ) === null ) {
				continue;
			}
			$fields = array();
			foreach ( PostMeta::fields( $spec ) as $col => $def ) {
				$fields[] = array( 'sp_top' => true ) + self::field( $schema, $spec['wp']['fieldKeyPrefix'] . $col, $spec['wp']['metaPrefix'] . $col, $col, $def, $spec );
			}
			acf_add_local_field_group(
				array(
					'key'          => $spec['wp']['groupKey'],
					'title'        => $spec['label'] ?? $name,
					'fields'       => $fields,
					'location'     => array(
						array(
							array(
								'param'    => 'post_type',
								'operator' => '==',
								'value'    => $spec['wp']['postType'],
							),
						),
					),
					'show_in_rest' => 1,
					'active'       => true,
				)
			);
		}
		// A taxonomy's term fields (ruling 25): `group_sp_<name>` on its term screens.
		foreach ( $schema->taxonomies() as $name => $spec ) {
			if ( isset( $spec['commerce'] ) ) {
				continue; }
			$fields = array();
			foreach ( TermMeta::fields( $spec ) as $col => $def ) {
				$fields[] = array( 'sp_top' => true ) + self::field( $schema, $spec['wp']['fieldKeyPrefix'] . $col, $spec['wp']['metaPrefix'] . $col, (string) $col, $def, $spec );
			}
			if ( array() === $fields ) {
				continue;
			}
			acf_add_local_field_group(
				array(
					'key'          => $spec['wp']['groupKey'],
					'title'        => $spec['label'] ?? $name,
					'fields'       => $fields,
					'location'     => array(
						array(
							array(
								'param'    => 'taxonomy',
								'operator' => '==',
								'value'    => $spec['wp']['taxonomy'],
							),
						),
					),
					'show_in_rest' => 1,
					'active'       => true,
				)
			);
		}
		$menu = 'spacepress-' . $schema->name();
		foreach ( $schema->globals() as $name => $g ) {
			$wp = $g['wp'];
			acf_add_options_page(
				array(
					'page_title'   => $g['label'] ?? $name,
					'menu_title'   => $g['label'] ?? $name,
					'menu_slug'    => $wp['menuSlug'],
					'post_id'      => $wp['postId'],
					'capability'   => 'edit_others_posts',
					'parent_slug'  => $menu,
					'redirect'     => false,
					'show_in_rest' => true,
				)
			);
			$fields = array();
			foreach ( $g['fields'] as $field => $def ) {
				// Option names are `<postId>_<name>` (SCF's convention), so the field name is the bare field.
				$fields[] = array( 'sp_top' => true ) + self::field( $schema, $wp['fieldKeyPrefix'] . $field, (string) $field, (string) $field, $def, $g );
			}
			acf_add_local_field_group(
				array(
					'key'          => $wp['groupKey'],
					'title'        => $g['label'] ?? $name,
					'fields'       => $fields,
					'location'     => array(
						array(
							array(
								'param'    => 'options_page',
								'operator' => '==',
								'value'    => $wp['menuSlug'],
							),
						),
					),
					'show_in_rest' => 1,
					'active'       => true,
				)
			);
		}
	}

	public static function registerFilters(): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		add_filter( 'acf/validate_value', array( self::class, 'validateValue' ), 20, 4 );
		foreach ( self::SCF_TYPES as $type ) {
			add_filter( "acf/validate_rest_value/type=$type", array( self::class, 'validateRestValue' ), 20, 3 );
		}
		add_filter( 'acf/update_value', array( self::class, 'prepareValue' ), 5, 3 );
		add_filter( 'acf/update_value', array( self::class, 'updateValue' ), 20, 3 );
		add_filter( 'acf/load_value', array( self::class, 'loadValue' ), 20, 3 );
		// A `ref().many()` field on a post reads and writes SpacePress's join table, never postmeta.
		add_filter( 'acf/pre_load_value', array( self::class, 'loadLinks' ), 10, 3 );
		add_filter( 'acf/pre_update_value', array( self::class, 'updateLinks' ), 10, 4 );
		// SpacePress's validator is the one authority on core REST: drop the schema's own bounds so a too-long
		// value reports SpacePress's message (the same one the API returns), not core's.
		add_filter( 'acf/rest/get_field_schema', array( self::class, 'restSchema' ), 20, 2 );
	}

	/** One generated SCF field (rules, validation metadata, field filters), for other field groups (user forms, §6.2). */
	public static function fieldFor( Schema $schema, string $key, string $name, string $col, array $def, array $spec ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return array( 'sp_top' => true ) + self::field( $schema, $key, $name, $col, $def, $spec );
	}

	private static function field( Schema $schema, string $key, string $name, string $col, array $def, array $spec ): array {
		$rules   = $def['rules'] ?? array();
		$type    = $def['type'];
		$field   = array(
			'key'               => $key,
			'label'             => $def['ui']['label'] ?? self::label( $col ),
			'name'              => $name,
			'required'          => Schema::isRequired( $def ) ? 1 : 0,
			'conditional_logic' => 0,
			'wrapper'           => array(
				'width' => $def['ui']['width'] ?? '',
				'class' => '',
				'id'    => '',
			),
			'spacepress'        => $def + array( 'name' => $col ),
		);
		$choices = static fn ( array $values ) => array_combine( $values, $values );
		$sub     = static function ( array $fields, string $prefix ) use ( $schema ): array {
			$out = array();
			foreach ( $fields as $s => $sdef ) {
				$out[] = self::field( $schema, $prefix . $s, (string) $s, (string) $s, $sdef, array( 'fields' => $fields ) );
			}

			return $out;
		};

		$field += match ( true ) {
			'text' === $type && isset( $def['enum'] ) => array(
				'type'          => 'select',
				'choices'       => $choices( $def['enum'] ),
				'allow_null'    => ( $def['notNull'] ?? false ) ? 0 : 1,
				'multiple'      => 0,
				'return_format' => 'value',
				'ui'            => 1,
			),
			'text' === $type && ( $def['multiline'] ?? false ) => array(
				'type'      => 'textarea',
				'maxlength' => $rules['max'] ?? '',
				'rows'      => 4,
				'new_lines' => '',
			),
			'text' === $type => array(
				'type'      => 'text',
				'maxlength' => $rules['max'] ?? '',
			),
			'select' === $type => array(
				'type'          => 'select',
				'choices'       => $choices( $def['enum'] ?? array() ),
				'allow_null'    => 1,
				'multiple'      => 1,
				'return_format' => 'value',
				'ui'            => 1,
			),
			'integer' === $type && isset( $def['references'] ) => self::reference( $schema, $def['references'] ),
			'refList' === $type => self::reference( $schema, $def['references'], true ),
			'integer' === $type => array(
				'type' => 'number',
				'step' => 1,
				'min'  => $rules['min'] ?? '',
				'max'  => $rules['max'] ?? '',
			),
			'file' === $type => array(
				'type'         => 'number',
				'step'         => 1,
				'min'          => 1,
				'instructions' => 'A private file id (bucket ' . ( $def['bucket'] ?? '' ) . ').',
			),
			'real' === $type => array(
				'type' => 'number',
				'step' => 'any',
				'min'  => $rules['min'] ?? '',
				'max'  => $rules['max'] ?? '',
			),
			'boolean' === $type => array(
				'type'          => 'true_false',
				'ui'            => 1,
				'default_value' => ( $def['default']['value'] ?? false ) ? 1 : 0,
			),
			'date' === $type => array(
				'type'           => 'date_picker',
				'display_format' => 'Y-m-d',
				'return_format'  => 'Y-m-d',
				'first_day'      => 1,
			),
			'timestamp' === $type => array(
				'type'           => 'date_time_picker',
				'display_format' => 'Y-m-d H:i',
				'return_format'  => 'Y-m-d\TH:i:s',
				'first_day'      => 1,
			),
			'email' === $type => array( 'type' => 'email' ),
			'url' === $type => array( 'type' => 'url' ),
			'slug' === $type => array(
				'type'      => 'text',
				'maxlength' => 200,
			),
			'richText' === $type => array(
				'type'         => 'wysiwyg',
				'toolbar'      => 'full',
				'media_upload' => 1,
				'tabs'         => 'all',
			),
			'media' === $type && ( $def['accept'] ?? 'any' ) === 'image' => array(
				'type'          => 'image',
				'return_format' => 'id',
				'library'       => 'all',
				'preview_size'  => 'medium',
			),
			'media' === $type => array(
				'type'          => 'file',
				'return_format' => 'id',
				'library'       => 'all',
			),
			'mediaList' === $type => array(
				'type'          => 'gallery',
				'return_format' => 'id',
				'library'       => 'all',
				'preview_size'  => 'medium',
			),
			'json' === $type => array(
				'type'         => 'textarea',
				'rows'         => 8,
				'new_lines'    => '',
				'instructions' => 'Enter valid JSON.',
			),
			'group' === $type => array(
				'type'       => 'group',
				'layout'     => 'block',
				'sub_fields' => $sub( $def['fields'] ?? array(), $key . '_' ),
			),
			'repeater' === $type => array(
				'type'         => 'repeater',
				'layout'       => 'table',
				'min'          => $rules['min'] ?? 0,
				'max'          => $rules['max'] ?? 0,
				'button_label' => 'Add row',
				'sub_fields'   => $sub( $def['fields'] ?? array(), $key . '_' ),
			),
			'blocks' === $type => array(
				'type'         => 'flexible_content',
				'button_label' => 'Add block',
				'min'          => $rules['min'] ?? '',
				'max'          => $rules['max'] ?? '',
				'layouts'      => self::layouts( $key, $def['layouts'] ?? array(), $sub ),
			),
			default => throw new \LogicException( "No SCF field for column type '$type'" ),
		};
		if ( isset( $def['ui']['help'] ) ) {
			$field['instructions'] = htmlspecialchars( $def['ui']['help'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
		}
		$field['instructions'] ??= '';
		if ( isset( $def['ui']['placeholder'] ) && in_array( $field['type'], array( 'text', 'textarea', 'email', 'url', 'number', 'select' ), true ) ) {
			$field['placeholder'] = $def['ui']['placeholder'];
		}
		foreach ( self::$field_filters as $fn ) {
			$field = $fn( $field, $def, $col, $spec );
		}

		return $field;
	}

	private static function reference( Schema $schema, array $ref, bool $many = false ): array {
		$target = $schema->collection( $ref['collection'] );
		if ( ( $target['editor'] ?? true ) && ( $target['wp'] ?? null ) !== null ) {
			return array(
				'type'          => 'post_object',
				'post_type'     => array( $target['wp']['postType'] ),
				'taxonomy'      => array(),
				'allow_null'    => 1,
				'multiple'      => $many ? 1 : 0,
				'return_format' => 'id',
				'ui'            => 1,
			);
		}
		if ( $many ) {
			return array(
				'type'         => 'text',
				'instructions' => 'IDs of ' . ( $target['label'] ?? $ref['collection'] ) . ', comma-separated, in order',
			);
		}

		return array(
			'type'         => 'number',
			'step'         => 1,
			'instructions' => 'ID of a ' . ( $target['label'] ?? $ref['collection'] ),
		);
	}

	private static function layouts( string $key, array $layouts, callable $sub ): array {
		$out = array();
		foreach ( $layouts as $layout => $fields ) {
			$lkey         = 'layout_' . substr( $key, strlen( 'field_' ) ) . '_' . $layout;
			$out[ $lkey ] = array(
				'key'        => $lkey,
				'name'       => (string) $layout,
				'label'      => self::label( (string) $layout ),
				'display'    => 'block',
				'sub_fields' => $sub( $fields, $key . '_' . $layout . '_' ),
				'min'        => '',
				'max'        => '',
			);
		}

		return $out;
	}

	private static function label( string $col ): string {
		return ucfirst( strtolower( (string) preg_replace( '/(?<=[a-z0-9])([A-Z])/', ' $1', str_replace( '_', ' ', $col ) ) ) );
	}

	// ================================================================ filters

	/** wp-admin form saves: run SpacePress's codec + rules; a string return is SCF's error message. */
	public static function validateValue( mixed $valid, mixed $value, mixed $field, mixed $input ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( ! is_array( $field ) || empty( $field['sp_top'] ) || false === $valid ) {
			return $valid;
		}

		// SpacePress's message wins over SCF's own wording for the same rule (e.g. maxlength).
		return self::check( $field, $value ) ?? $valid;
	}

	/** Core REST saves (`acf` in /wp/v2/<type>): same check, reported as a WP_Error (400). */
	public static function validateRestValue( mixed $valid, mixed $value, mixed $field ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( ! is_array( $field ) || ! isset( $field['spacepress'] ) ) {
			return $valid;
		}
		// SCF's post-object check distinguishes missing IDs before the controller can apply the
		// target's read policy. SpacePress validates the scalar here and resolves existence/visibility
		// together in the write pipeline, with the same response for an absent or hidden target.
		if ( isset( $field['spacepress']['references'] ) ) {
			$valid = true;
		} elseif ( true !== $valid ) {
			return $valid;
		}
		if ( empty( $field['sp_top'] ) ) {
			$field = acf_get_field( $field['key'] ) ?: $field; // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
			if ( empty( $field['sp_top'] ) ) {
				return $valid;
			}
		}
		$message = self::check( $field, $value );

		return null === $message ? true : new \WP_Error( 'rest_invalid_param', $message, array( 'status' => 400 ) );
	}

	/** SpacePress's message for an invalid editor value, or null when it is valid. */
	private static function check( array $field, mixed $raw ): ?string {
		$def  = $field['spacepress'];
		$name = $def['name'];
		try {
			$js   = ! empty( $field['sp_member'] )
				? ProfileForm::validationValue( $raw, $field )
				: self::fromScf( $def, $raw, $field['key'], true );
			$norm = Schema::normalize( $def, $js, $name, HttpError::seg( $name ) );
			Schema::checkRules(
				$def,
				$norm,
				$name,
				HttpError::seg( $name ),
				array(
					'data' => array( $name => $norm ),
					'user' => WpAuth::current(),
				)
			);
		} catch ( HttpError $e ) {
			return $e->getMessage();
		} catch ( \JsonException ) {
			return 'Enter valid JSON.';
		}

		return null;
	}

	/** SCF's structured writers use isset(), so explicit nullable toggles need a stored empty value. */
	public static function prepareValue( mixed $value, mixed $postId, mixed $field ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		$def = is_array( $field ) ? ( $field['spacepress'] ?? null ) : null;
		if ( ! is_array( $def ) || ! is_array( $value ) ) {
			return $value;
		}
		$key = $field['key'];
		if ( 'group' === $def['type'] ) {
			return self::nullable_toggles( $def['fields'] ?? array(), $value, $key . '_' );
		}
		if ( 'repeater' === $def['type'] || 'blocks' === $def['type'] ) {
			foreach ( $value as &$row ) {
				if ( ! is_array( $row ) ) {
					continue;
				}
				$layout = (string) ( $row['acf_fc_layout'] ?? $row['layout'] ?? '' );
				$row    = 'blocks' === $def['type']
					? self::nullable_toggles( $def['layouts'][ $layout ] ?? array(), $row, $key . '_' . $layout . '_' )
					: self::nullable_toggles( $def['fields'] ?? array(), $row, $key . '_' );
			}
			unset( $row );
		}

		return $value;
	}

	private static function nullable_toggles( array $fields, array $row, string $prefix ): array {
		foreach ( $fields as $name => $def ) {
			if ( 'boolean' !== $def['type'] || ( $def['notNull'] ?? false ) ) {
				continue;
			}
			foreach ( array( $prefix . $name, $name ) as $key ) {
				if ( array_key_exists( $key, $row ) && null === $row[ $key ] ) {
					$row[ $key ] = '';
				}
			}
		}

		return $row;
	}

	public static function updateValue( mixed $value, mixed $postId, mixed $field ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		$def = is_array( $field ) ? ( $field['spacepress'] ?? null ) : null;
		// WordPress serializes PHP false as '', which is also SCF's nullable
		// sub-field representation. Keep booleans in SCF's numeric storage form.
		if ( is_array( $def ) && 'boolean' === $def['type'] && is_bool( $value ) ) {
			return $value ? 1 : 0;
		}
		if ( ! is_array( $def ) || null === $value || '' === $value || false === $value ) {
			return $value;
		}
		if ( 'json' === $def['type'] && is_string( $value ) ) {
			try {
				return wp_slash( (string) Js::jsonStringify( Js::decodeJson( wp_unslash( $value ) ) ) );
			} catch ( \JsonException ) {
				return $value;
			}
		}
		if ( 'timestamp' === $def['type'] && is_string( $value ) && 0 === self::$io ) {
			return get_gmt_from_date( $value, 'Y-m-d H:i:s' ); // the picker posts site time; meta keeps UTC
		}

		return $value;
	}

	public static function loadValue( mixed $value, mixed $postId, mixed $field ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		$def = is_array( $field ) ? ( $field['spacepress'] ?? null ) : null;
		if ( is_array( $def ) && 'timestamp' === $def['type'] && is_string( $value ) && '' !== $value && 0 === self::$io ) {
			return get_date_from_gmt( $value, 'Y-m-d H:i:s' );
		}

		return $value;
	}

	/** The post and many-ref column an SCF value is for, or null. @return ?array{string, int, array, string} */
	private static function links_field( mixed $postId, mixed $field ): ?array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$def = is_array( $field ) ? ( $field['spacepress'] ?? null ) : null;
		if ( ! is_array( $def ) || ( $def['type'] ?? null ) !== 'refList' || empty( $field['sp_top'] ) || ! is_numeric( $postId ) // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			|| ( $collection = CoreAccess::collection( (string) get_post_type( (int) $postId ) ) ) === null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Keep the assignment and its test together. Preserve the existing PHP variable name.
			return null;
		}

		return array( $collection, (int) $postId, $def, (string) $def['name'] ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	}

	/** acf/pre_load_value: the editor shows the post's links, in position order. */
	public static function loadLinks( mixed $value, mixed $postId, mixed $field ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		if ( null !== $value || ( $at = self::links_field( $postId, $field ) ) === null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Keep the assignment and its test together. Preserve the existing PHP variable name.
			return $value;
		}
		[$collection, $id, $def] = $at;
		$ids                     = array_column(
			\SpacePress\Db::instance()->store() instanceof \SpacePress\Links
			? \SpacePress\Db::instance()->store()->links( $def['references']['join'], 'owner_id', array( $id ) ) : array(),
			'target_id'
		);

		return self::ref_list_scf( $def, $ids );
	}

	/**
	 * acf/pre_update_value: an editor save of a many-ref replaces the post's links. The ids are checked
	 * as every write checks them (existence, and visibility to a signed-in editor); SCF writes no meta.
	 */
	public static function updateLinks( mixed $check, mixed $value, mixed $postId, mixed $field ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		if ( null !== $check || self::$io > 0 || ( $at = self::links_field( $postId, $field ) ) === null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Keep the assignment and its test together. Preserve the existing PHP variable name.
			return $check;
		}
		[$collection, $id, $def, $col] = $at;
		$db                            = \SpacePress\Db::instance();
		try {
			$norm   = Schema::normalize( $def, self::fromScf( $def, wp_unslash( $value ), (string) $field['key'] ), $col, HttpError::seg( $col ) );
			$viewer = get_current_user_id() === 0 ? null : ( CoreAccess::viewer() ?? throw new HttpError( 403, 'suspended', 'This account is suspended' ) );
			$db->validateWriteReferences( $collection, array( $col => $norm ), $viewer );
			$db->writeLinks( array( $col => $def ), $id, array( $col => $norm ?? array() ) );
		} catch ( HttpError $e ) {
			EditorSave::fail( $e );
		}

		return true;
	}

	public static function restSchema( mixed $schema, mixed $field ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( ! is_array( $schema ) || ! is_array( $field ) || ! isset( $field['spacepress'] ) ) {
			return $schema;
		}

		return self::loose_schema( $schema );
	}

	private static function loose_schema( array $schema ): array {
		unset( $schema['maxLength'], $schema['minLength'], $schema['minimum'], $schema['maximum'], $schema['maxItems'], $schema['minItems'], $schema['required'] );
		foreach ( array( 'properties', 'items' ) as $k ) {
			if ( isset( $schema[ $k ] ) && is_array( $schema[ $k ] ) ) {
				$schema[ $k ] = isset( $schema[ $k ]['type'] ) ? self::loose_schema( $schema[ $k ] ) : array_map( static fn ( $s ) => is_array( $s ) ? self::loose_schema( $s ) : $s, $schema[ $k ] );
			}
		}

		return $schema;
	}

	// ================================================================ value forms

	/** Storage form (§3.4) → SCF unformatted form, for update_field. */
	public static function toScf( array $def, int|float|string|null $stored, string $key ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return null === $stored ? null : self::scf_value( $def, Schema::decode( $def, $stored ), $key );
	}

	/** SCF unformatted value → storage form. */
	public static function toStorage( array $def, mixed $raw, string $key ): int|float|string|null { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return Schema::store( $def, self::fromScf( $def, $raw, $key ) );
	}

	/** Storage form → the string SCF keeps in a scalar meta row (unique checks compare against it). */
	public static function metaScalar( array $def, int|float|string $stored ): string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$v = self::scf_value( $def, Schema::decode( $def, $stored ), '' );

		return is_float( $v ) ? Js::numStr( $v ) : (string) $v;
	}

	private static function scf_value( array $def, mixed $v, string $key ): mixed {
		if ( null === $v ) {
			return null;
		}

		return match ( $def['type'] ) {
			'boolean' => $v ? 1 : 0,
			'date' => str_replace( '-', '', (string) $v ),
			'timestamp' => substr( (string) $v, 0, 10 ) . ' ' . substr( (string) $v, 11, 8 ),
			'json' => Js::jsonStringify( $v ),
			'mediaList' => array_map( 'intval', $v ),
			'refList' => self::ref_list_scf( $def, $v ),
			'group' => self::scf_fields( $def['fields'] ?? array(), $v, $key . '_' ),
			'repeater' => array_map( static fn ( $row ) => self::scf_fields( $def['fields'] ?? array(), $row, $key . '_' ), $v ),
			'blocks' => array_map(
				static fn ( $row ) => array( 'acf_fc_layout' => $row['layout'] ) + self::scf_fields( $def['layouts'][ $row['layout'] ] ?? array(), $row, $key . '_' . $row['layout'] . '_' ),
				$v,
			),
			default => $v,
		};
	}

	/** A many-ref as its editor field shows it: a list for post_object, comma-separated text otherwise. */
	private static function ref_list_scf( array $def, array $ids ): array|string {
		$db     = \SpacePress\Db::instance();
		$target = $db->schema()->collection( $def['references']['collection'] );

		return ( $target['editor'] ?? true ) && ( $target['wp'] ?? null ) !== null ? array_map( 'intval', $ids ) : implode( ',', $ids );
	}

	private static function scf_fields( array $fields, array $obj, string $prefix ): array {
		$out = array();
		foreach ( $fields as $name => $f ) {
			$out[ $prefix . $name ] = self::scf_value( $f, $obj[ $name ] ?? null, $prefix . $name ) ?? '';
		}

		return $out;
	}

	/**
	 * SCF value (unformatted meta, or editor input) → SpacePress's JS form. Empty ('' / false / no row)
	 * reads as null. Shapes SpacePress can't interpret are passed through so Schema::normalize reports them.
	 * $strictJson: throw JsonException on an unparsable json field (validation) instead of passing it.
	 */
	public static function fromScf( array $def, mixed $v, string $key, bool $strictJson = false ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		$type = $def['type'];
		if ( null === $v || '' === $v || ( false === $v && 'boolean' !== $type ) ) {
			return in_array( $type, array( 'select', 'mediaList', 'refList' ), true ) && ( $def['notNull'] ?? false ) || 'refList' === $type ? array() : null;
		}

		return match ( $type ) {
			'integer', 'media', 'file' => is_numeric( $v ) && (float) $v === (float) (int) $v ? (int) $v : $v, // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
			'real' => is_numeric( $v ) ? (float) $v : $v,
			'boolean' => match ( true ) {
				is_bool( $v ) => $v,
				1 === $v, '1' === $v => true,
				0 === $v, '0' === $v => false,
				default => $v,
			},
			'date' => is_string( $v ) && preg_match( '/^(\d{4})(\d{2})(\d{2})$/D', $v, $m ) ? "$m[1]-$m[2]-$m[3]" : $v,
			'timestamp' => is_string( $v ) && preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/D', $v ) ? str_replace( ' ', 'T', $v ) . '.000Z' : $v,
			'json' => is_string( $v ) ? self::json( $v, $strictJson ) : $v, // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			'select' => is_array( $v ) ? array_values( array_map( 'strval', $v ) ) : ( is_string( $v ) && is_serialized( $v ) ? array_values( (array) unserialize( $v, array( 'allowed_classes' => false ) ) ) : array( $v ) ),
			'mediaList' => is_array( $v ) ? array_values( array_map( 'intval', $v ) ) : $v,
			// post_object (multiple) posts a list of ids; the text field a comma-separated one.
			'refList' => match ( true ) {
				is_array( $v ) => array_values( array_map( static fn ( $id ) => is_numeric( $id ) ? (int) $id : $id, array_filter( $v, static fn ( $id ) => '' !== $id ) ) ),
				is_string( $v ) && preg_match( '/^\s*\d+(\s*,\s*\d+)*\s*$/D', $v ) === 1 => array_map( 'intval', explode( ',', $v ) ),
				default => $v,
			},
			'group' => is_array( $v ) ? self::js_fields( $def['fields'] ?? array(), $v, $key . '_' ) : $v,
			'repeater' => is_array( $v ) ? array_values(
				array_map(
					static fn ( $row ) => is_array( $row ) ? self::js_fields( $def['fields'] ?? array(), $row, $key . '_' ) : $row,
					array_filter( $v, static fn ( $k ) => 'acfcloneindex' !== $k, ARRAY_FILTER_USE_KEY ),
				)
			) : $v,
			'blocks' => is_array( $v ) ? array_values(
				array_map(
					static function ( $row ) use ( $def, $key ) {
						if ( ! is_array( $row ) ) {
							return $row;
						}
						$layout = (string) ( $row['acf_fc_layout'] ?? $row['layout'] ?? '' );

						return array( 'layout' => $layout ) + self::js_fields( $def['layouts'][ $layout ] ?? array(), $row, $key . '_' . $layout . '_' );
					},
					array_filter( $v, static fn ( $k ) => 'acfcloneindex' !== $k, ARRAY_FILTER_USE_KEY )
				)
			) : $v,
			default => is_scalar( $v ) ? (string) $v : $v,
		};
	}

	/**
	 * Rows keyed by sub-field key (SCF), meta name (core REST input) or bare name → keyed by name.
	 * Absent sub-fields stay absent so Schema::normalize applies their defaults.
	 */
	private static function js_fields( array $fields, array $row, string $prefix ): array {
		$out = array();
		foreach ( $fields as $name => $f ) {
			$key = null;
			foreach ( array( $prefix . $name, $name ) as $k ) {
				if ( array_key_exists( $k, $row ) ) {
					$key = $k;
					break;
				}
			}
			if ( null === $key ) {
				foreach ( $row as $k => $v ) {
					if ( is_string( $k ) && str_ends_with( $k, '_' . $name ) && ! str_starts_with( $k, 'field_' ) ) {
						$key = $k;
						break;
					}
				}
			}
			if ( null === $key ) {
				continue;   // absent: Schema::normalize applies the default
			}
			// SCF keeps an unchecked true_false as ''. For a notNull boolean that can only mean false
			// (a nullable one keeps '' as null, which is how a null is written).
			$out[ $name ] = ( $f['type'] ?? null ) === 'boolean' && ( $f['notNull'] ?? false ) && '' === $row[ $key ]
				? false
				: self::fromScf( $f, $row[ $key ], $prefix . $name );
		}

		return $out;
	}

	private static function json( string $s, bool $strict ): mixed {
		try {
			return Js::decodeJson( $s );
		} catch ( \JsonException $e ) {
			if ( $strict ) {
				throw $e;
			}

			return $s;
		}
	}
}
