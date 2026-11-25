<?php

declare(strict_types=1);

namespace SpacePress\Wp\Abilities;

use SpacePress\Schema;

/**
 * JSON Schemas for abilities, derived from schema.php columns (§7.1). Every node carries a `type`
 * (core's validator requires one) and uses only keywords core prepares for clients. Input schemas
 * describe what the pipeline accepts; SpacePress's pipeline is the validator (Register::validate). They
 * never say `additionalProperties: false`: core's run endpoint sanitizes input by its schema and
 * would silently drop unknown keys that REST rejects with a 422.
 */
final class JsonSchema {

	private const ANY     = array( 'object', 'array', 'string', 'number', 'integer', 'boolean', 'null' );
	private const STRINGS = array( 'text', 'richText', 'email', 'url', 'slug', 'timestamp', 'date' );
	private const NUMBERS = array( 'integer', 'real', 'media', 'file' );
	/** A filter region whose values core leaves untyped in a query string. */
	public const UNTYPED = array( 'type' => 'object' );

	/** A value of one column. $output widens media references, which `with` may populate. */
	public static function column( array $col, bool $output = false ): array {
		$type = $col['type'];
		$s    = match ( $type ) {
			// A `ref()` column: `with` loads the related row in its place.
			'integer' => $output && isset( $col['references'] ) ? array( 'type' => array( 'integer', 'string', 'object' ) ) : array( 'type' => 'integer' ),
			'real' => array( 'type' => 'number' ),
			'text', 'richText' => array( 'type' => 'string' ),
			// Input carries no `format`: core's run endpoint sanitizes by format (sanitize_url on
			// `uri`), which would rewrite the value SpacePress then stores; SpacePress validates instead.
			'email' => array( 'type' => 'string' ),
			'url' => $output ? array(
				'type'   => 'string',
				'format' => 'uri',
			) : array( 'type' => 'string' ),
			'slug' => array(
				'type'      => 'string',
				'pattern'   => '^[a-z0-9]+(?:-[a-z0-9]+)*$',
				'maxLength' => 200,
			),
			'boolean' => array( 'type' => 'boolean' ),
			// REST also accepts epoch milliseconds and any date string SpacePress parses.
			'timestamp' => $output ? array(
				'type'   => 'string',
				'format' => 'date-time',
			) : array( 'type' => array( 'string', 'integer' ) ),
			// No `format: date`: `@wordpress/abilities` validates with ajv, which knows date-time, email,
			// hostname, ipv4, ipv6, uri and uuid only, and refuses a schema naming any other format.
			'date' => array( 'type' => 'string' ),
			'json' => $col['shape'] ?? array( 'type' => self::ANY ),
			'media', 'file' => $output ? array( 'type' => array( 'integer', 'object' ) ) : array( 'type' => 'integer' ),
			'mediaList' => array(
				'type'  => 'array',
				'items' => $output ? array( 'type' => array( 'integer', 'object' ) ) : array( 'type' => 'integer' ),
			),
			'select' => array(
				'type'        => 'array',
				'items'       => array(
					'type' => 'string',
					'enum' => array_values( $col['enum'] ?? array() ),
				),
				'uniqueItems' => true,
			),
			// A many-ref's ids; `with` loads the rows in their place.
			'refList' => array(
				'type'        => 'array',
				'items'       => $output ? array( 'type' => array( 'integer', 'object' ) ) : array( 'type' => 'integer' ),
				'uniqueItems' => true,
			),
			'group' => self::object( $col['fields'] ?? array(), $output, false ),
			'repeater' => array(
				'type'  => 'array',
				'items' => self::object( $col['fields'] ?? array(), $output, ! $output ),
			),
			'blocks' => array(
				'type'  => 'array',
				'items' => self::blocks( $col['layouts'] ?? array(), $output ),
			),
			default => throw new \LogicException( "Unknown column type '$type'" ),
		};
		if ( isset( $col['enum'] ) && 'select' !== $type ) {
			$s['enum'] = array_values( $col['enum'] );
		}
		$rules  = $col['rules'] ?? array();
		$bounds = match ( true ) {
			in_array( $type, array( 'text', 'richText', 'email', 'url', 'slug' ), true ) => array( 'minLength', 'maxLength' ),
			in_array( $type, array( 'mediaList', 'select', 'refList', 'repeater', 'blocks' ), true ) => array( 'minItems', 'maxItems' ),
			in_array( $type, array( 'integer', 'real' ), true ) => array( 'minimum', 'maximum' ),
			default => null,
		};
		if ( null !== $bounds ) {
			foreach ( array(
				'min' => $bounds[0],
				'max' => $bounds[1],
			) as $rule => $keyword ) {
				if ( is_int( $rules[ $rule ] ?? null ) || is_float( $rules[ $rule ] ?? null ) ) {
					$s[ $keyword ] = $rules[ $rule ];
				}
			}
		}
		// `pattern` rules are JS regular expressions; core would run them as PCRE, so they stay SpacePress's.

		return ( $col['notNull'] ?? false ) ? $s : self::nullable( $s );
	}

	/** A collection row as responses return it (hidden columns never leave the runtime). */
	public static function row( array $spec ): array {
		$props = array();
		foreach ( $spec['columns'] as $name => $col ) {
			if ( ! ( $col['hidden'] ?? false ) ) {
				$props[ (string) $name ] = self::column( $col, true );
				if ( ! empty( $spec['editor'] ) && ( $spec['slug'] ?? null ) === $name ) {
					// WordPress stores its own post name, including an empty slug on drafts.
					unset( $props[ (string) $name ]['pattern'], $props[ (string) $name ]['minLength'] );
				}
			}
		}

		return array(
			'type'       => 'object',
			'properties' => $props,
		);
	}

	/** Create input: writable columns plus virtual inputs; required = what the pipeline requires before hooks. */
	public static function insert( array $spec, array $virtual = array() ): array {
		$props    = array();
		$required = array();
		$fills    = $spec['beforeCreateFills'] ?? array();
		foreach ( self::writable( $spec, true ) as $name => $col ) {
			$props[ $name ] = self::column( $col );
			if ( Schema::isRequired( $col ) && ! in_array( $name, $fills, true ) && ( $spec['slug'] ?? null ) !== $name ) {
				$required[] = $name;
			}
		}

		return self::input( $props + $virtual, $required );
	}

	/** Update patch: every writable column, all optional; a users kind's also takes a new `password` (Auth\Module::password). */
	public static function patch( array $spec ): array {
		$props = array();
		foreach ( self::writable( $spec, false ) as $name => $col ) {
			$props[ $name ] = self::column( $col );
		}
		if ( ( $spec['auth'] ?? false ) && ! isset( $props['password'] ) ) {
			$props['password'] = array( 'type' => 'string' );
		}

		return array(
			'type'       => 'object',
			'properties' => $props,
		);
	}

	/** Field objects: action input, global values, group/repeater sub-fields. */
	public static function fields( array $fields, bool $output = false ): array {
		return self::object( $fields, $output, ! $output );
	}

	/** A top-level input object; `default` lets core and the MCP adapter accept an omitted input. */
	public static function input( array $props, array $required = array() ): array {
		// An empty `properties` is left out: core indexes it as an array, and [] would publish as a list.
		$s = array(
			'type'    => 'object',
			'default' => array(),
		);
		if ( array() !== $props ) {
			$s['properties'] = $props;
		}
		if ( array() !== $required ) {
			$s['required'] = $required;
		}

		return $s;
	}

	/**
	 * `where`: per column a value or an operator object (§1.3 grammar), AND/OR/NOT one level down,
	 * so core types GET query-string values there. Relation filters and deeper groups are untyped
	 * (`{type: object}`): exact as JSON (POST, MCP, or `where` as a JSON string like REST's
	 * `?where=`), refused over a GET query string (Invoke::untyped), where core leaves strings.
	 */
	public static function where( array $spec ): array {
		return self::filter_object( $spec['columns'], 1, array_keys( $spec['relations'] ?? array() ) );
	}

	/** The media library's filterable columns (§4.6). */
	public static function mediaWhere(): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return self::filter_object(
			array(
				'id'        => array( 'type' => 'integer' ),
				'filename'  => array( 'type' => 'text' ),
				'mime'      => array( 'type' => 'text' ),
				'alt'       => array( 'type' => 'text' ),
				'createdAt' => array( 'type' => 'timestamp' ),
			),
			1
		);
	}

	private static function filter_object( array $columns, int $depth, array $relations = array() ): array {
		$props = array();
		foreach ( $columns as $name => $col ) {
			if ( ! ( $col['hidden'] ?? false ) && ( $f = self::filter( $col ) ) !== null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
				$props[ (string) $name ] = $f;
			}
		}
		// A `ref()` field is its column and its relation: the column's operators describe it, and an
		// object of the target's fields still validates against them (no additionalProperties).
		foreach ( $relations as $name ) {
			$props[ (string) $name ] ??= self::UNTYPED;
		}
		$nested       = $depth > 0 ? self::filter_object( $columns, $depth - 1, $relations ) : self::UNTYPED;
		$props['AND'] = array(
			'type'  => 'array',
			'items' => $nested,
		);
		$props['OR']  = array(
			'type'  => 'array',
			'items' => $nested,
		);
		$props['NOT'] = $nested;

		return array(
			'type'       => $depth > 0 ? array( 'object', 'string' ) : 'object',
			'properties' => $props,
		);
	}

	/** `orderBy`: `{ column: "asc" | "desc" }` in priority order, or REST's `"title,-id"`. */
	public static function orderBy( array $columns ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$props = array();
		foreach ( $columns as $name ) {
			$props[ $name ] = array(
				'type' => 'string',
				'enum' => array( 'asc', 'desc' ),
			);
		}

		return array(
			'type'       => array( 'object', 'string' ),
			'properties' => $props,
		);
	}

	/** `with`: relations (true, or nested query options) and media columns to include; may be a JSON string. */
	public static function with( array $spec ): array {
		$props = array();
		foreach ( array_keys( $spec['relations'] ?? array() ) as $name ) {
			$props[ (string) $name ] = array( 'type' => array( 'boolean', 'object' ) );
		}
		foreach ( $spec['columns'] as $name => $col ) {
			if ( in_array( $col['type'], array( 'media', 'mediaList' ), true ) ) {
				$props[ (string) $name ] = array(
					'type' => 'boolean',
					'enum' => array( true ),
				);
			}
		}

		return array(
			'type'       => array( 'object', 'string' ),
			'properties' => $props,
		);
	}

	/** The built-in media row (§4.6); feature lanes may add keys. */
	public static function media(): array {
		return array(
			'type'       => 'object',
			'properties' => array(
				'id'        => array( 'type' => 'integer' ),
				'url'       => array( 'type' => 'string' ),
				'mime'      => array( 'type' => 'string' ),
				'size'      => array( 'type' => 'integer' ),
				'width'     => array( 'type' => array( 'integer', 'null' ) ),
				'height'    => array( 'type' => array( 'integer', 'null' ) ),
				'alt'       => array( 'type' => array( 'string', 'null' ) ),
				'filename'  => array( 'type' => 'string' ),
				'createdAt' => array(
					'type'   => 'string',
					'format' => 'date-time',
				),
				'author'    => array( 'type' => array( 'integer', 'null' ) ),
				'caption'   => array( 'type' => 'string' ),
			),
		);
	}

	public static function nullable( array $s ): array {
		$types = (array) $s['type'];
		if ( ! in_array( 'null', $types, true ) ) {
			$types[] = 'null';
		}
		$s['type'] = $types;
		if ( isset( $s['enum'] ) ) {
			$s['enum'][] = null;
		}

		return $s;
	}

	/** @return array<string, array> */
	private static function writable( array $spec, bool $create ): array {
		$out = array();
		foreach ( $spec['columns'] as $name => $col ) {
			$name = (string) $name;
			if ( ( $col['hidden'] ?? false ) || ( $col['derived'] ?? false ) || ( $col['readOnly'] ?? false ) || ( $col['autoIncrement'] ?? false )
				|| ( ! $create && ( $name === $spec['primaryKey'] || 'uid' === $name && ( $col['system'] ?? false ) ) ) ) {
				continue;
			}
			$out[ $name ] = $col;
		}

		return $out;
	}

	private static function object( array $fields, bool $output, bool $required ): array {
		$props = array();
		$req   = array();
		foreach ( $fields as $name => $col ) {
			$props[ (string) $name ] = self::column( $col, $output );
			if ( $required && Schema::isRequired( $col ) ) {
				$req[] = (string) $name;
			}
		}
		$s = array( 'type' => 'object' );
		if ( array() !== $props ) {
			$s['properties'] = $props;
		}
		if ( array() !== $req ) {
			$s['required'] = $req;
		}

		return $s;
	}

	private static function blocks( array $layouts, bool $output ): array {
		$variants = array();
		foreach ( $layouts as $layout => $fields ) {
			$v               = self::object( $fields, $output, ! $output );
			$v['properties'] = array(
				'layout' => array(
					'type' => 'string',
					'enum' => array( (string) $layout ),
				),
			) + ( $v['properties'] ?? array() );
			$v['required']   = array_values( array_unique( array( 'layout', ...( $v['required'] ?? array() ) ) ) );
			$variants[]      = $v;
		}

		return array() === $variants ? array( 'type' => 'object' ) : array(
			'type'  => 'object',
			'oneOf' => $variants,
		);
	}

	/** Column-level NOT/OR/AND (`{ id: { NOT: { in: [1] } } }`): untyped regions. */
	private static function logic(): array {
		return array(
			'NOT' => self::UNTYPED,
			'OR'  => array(
				'type'  => 'array',
				'items' => self::UNTYPED,
			),
			'AND' => array(
				'type'  => 'array',
				'items' => self::UNTYPED,
			),
		);
	}

	/** Value-or-operators for one column; null for kinds that only compare whole values. */
	private static function filter( array $col ): ?array {
		$type = $col['type'];
		if ( 'refList' === $type ) {
			// `{ has: id }`, `[]` / `{ eq: [] }` for no links, true/false, or a filter on the linked
			// rows (validated against the target's fields at query time).
			return array(
				'type'       => array( 'array', 'object', 'boolean' ),
				'items'      => array( 'type' => 'integer' ),
				'properties' => array(
					'has' => array( 'type' => 'integer' ),
					'eq'  => array(
						'type'     => 'array',
						'items'    => array( 'type' => 'integer' ),
						'maxItems' => 0,
					),
				) + self::logic(),
			);
		}
		if ( in_array( $type, array( 'mediaList', 'select' ), true ) ) {
			$item = 'select' === $type ? array( 'type' => 'string' ) : array( 'type' => 'integer' );

			return array(
				'type'       => array( 'array', 'object', 'null' ),
				'items'      => $item,
				'properties' => array(
					'has'       => $item,
					'eq'        => array(
						'type'  => array( 'array', 'null' ),
						'items' => $item,
					),
					'ne'        => array(
						'type'  => array( 'array', 'null' ),
						'items' => $item,
					),
					'isNull'    => array( 'type' => 'boolean' ),
					'isNotNull' => array( 'type' => 'boolean' ),
				) + self::logic(),
			);
		}
		$scalar = match ( true ) {
			in_array( $type, self::STRINGS, true ) => 'string',
			'real' === $type => 'number',
			in_array( $type, self::NUMBERS, true ) => 'integer',
			'boolean' === $type => 'boolean',
			default => null,
		};
		if ( null === $scalar ) {
			return null;
		}
		$value = array( 'type' => array( $scalar, 'null' ) );
		$ops   = array(
			'eq'        => $value,
			'ne'        => $value,
			'isNull'    => array( 'type' => 'boolean' ),
			'isNotNull' => array( 'type' => 'boolean' ),
		) + self::logic();
		if ( 'boolean' !== $scalar ) {
			foreach ( array( 'gt', 'gte', 'lt', 'lte' ) as $op ) {
				$ops[ $op ] = array( 'type' => $scalar );
			}
			$ops['in']    = array(
				'type'  => 'array',
				'items' => array( 'type' => $scalar ),
			);
			$ops['notIn'] = array(
				'type'  => 'array',
				'items' => array( 'type' => $scalar ),
			);
		}
		if ( 'string' === $scalar ) {
			foreach ( array( 'like', 'notLike', 'ilike', 'notIlike' ) as $op ) {
				$ops[ $op ] = array( 'type' => 'string' );
			}
		}

		return array(
			'type'       => array( $scalar, 'object', 'null' ),
			'properties' => $ops,
		);
	}
}
