<?php

declare(strict_types=1);

namespace SpacePress;

/**
 * Field-level access (phase 2 §4.3). Per-column `access: { read, create, update }` rules, on top-level
 * columns and on group/repeater/blocks sub-fields (sub-field rules see the enclosing item as data).
 * An omitted rule inherits the collection rule, which the pipeline already enforced.
 *
 * - read: hidden columns are removed from every row an untrusted viewer receives (lists, items,
 *   `with` rows, revisions, write responses). Shorthand rules are evaluated once per page, function
 *   rules once per row with `ctx.data` = the decoded row (or the enclosing sub-field item).
 * - query: an untrusted `where`/`orderBy` may not name a column that can be hidden from this viewer,
 *   at any depth (relation filters included), and `columns` may not name a hidden one. Filtering would
 *   otherwise reveal values the strip removes.
 * - write: a supplied key whose create/update rule is false is refused with 403 (401 when anonymous,
 *   as phase 1 §1.6) at `/<col>`; a value the viewer can't read is refused whatever it is, so updates
 *   can't probe or overwrite hidden values (a field without its own update rule is
 *   refused outright; one that declares an allowing update rule is write-only). Defaults and hook-written values are trusted. An update may resend a
 *   value it can fully read unchanged, so read-modify-write and revision restore keep working.
 * - structured values: the stored value is resolved first (supplied values; in a group, omitted
 *   sub-fields the viewer can't read or set keep their stored values; defaults, generated once, fill
 *   the rest), then every supplied field is checked against it. List items have no identity: an item
 *   that leaves out such a field must match what the viewer sees and is then kept whole; otherwise it
 *   must supply each field itself. Removing, replacing with null or switching the layout of anything
 *   holding a field the viewer may not set is refused. These decisions use the rules alone (a function
 *   rule counts as possibly denying), never stored values the viewer can't see.
 *
 * Trusted callers (null viewer: hooks, actions' db, CLI) see and write everything. wp-admin and core
 * `/wp/v2` apply these same rules through Wp\CoreAccess (strip on read, checkWrite on a save's diff).
 */
final class FieldAccess {

	private const STRUCTURED = array( 'group', 'repeater', 'blocks' );

	/** @var ?\Closure(array): bool */
	private static ?\Closure $withheld = null;
	/** @var ?\Closure(): HttpError the credential's own refusal for supplying a withheld field */
	private static ?\Closure $withheld_refusal = null;

	/**
	 * Fields this request's credential is not shown, whatever their rules say (a scoped application
	 * password, Wp\AgentScope). Such a field is hidden from the viewer everywhere a hidden field is:
	 * rows, filters, sorts, searches, relations and uniqueness checks.
	 *
	 * A withheld field supplied on create is refused with `$refusal` when given, so the caller learns
	 * which grant is missing.
	 *
	 * @param callable(array $def): bool $fn
	 * @param ?callable(): HttpError $refusal
	 */
	public static function withhold( callable $fn, ?callable $refusal = null ): void { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Preserve the existing PHP parameter name.
		self::$withheld         = $fn( ... );
		self::$withheld_refusal = null === $refusal ? null : $refusal( ... );
	}

	private static function withheld( array $def ): bool {
		return null !== self::$withheld && ( self::$withheld )( $def );
	}

	public static function register(): void {
		Extensions::beforeRead( self::checkQuery( ... ), constraintSafe: true );
		// Reads only the fields it strips (a function rule makes Db select every column itself).
		Extensions::onRead( self::strip( ... ), constraintSafe: true, reads: static fn (): array => array() );
		Extensions::onWrite( self::checkWrite( ... ) );
		Extensions::schemaDescribe( self::describe( ... ) );
		if ( function_exists( 'add_filter' ) && class_exists( Wp\Scf::class ) ) { // the WordPress target only
			Wp\Scf\ConditionalLogic::register();
		}
	}

	// ================================================================ read

	/** @param list<array> $rows */
	public static function strip( array $rows, string $collection, ?Viewer $viewer ): array {
		$columns = self::columns( $collection );
		if ( null === $viewer || ! self::has_rule( $columns, 'read' ) ) {
			return $rows;
		}
		$page = array();
		foreach ( $rows as &$row ) {
			$row = self::strip_item( $columns, $row, $viewer, $page );
		}
		unset( $row );

		return $rows;
	}

	/** @param array<string, bool> $page shorthand results for this page */
	private static function strip_item( array $fields, array $item, Viewer $viewer, array &$page ): array {
		$data = $item; // every rule sees the full decoded row, not one already stripped
		foreach ( $fields as $name => $def ) {
			if ( ! array_key_exists( $name, $item ) ) {
				continue;
			}
			if ( ! self::readable( $def, $data, $viewer, $page, $fields ) ) {
				unset( $item[ $name ] );
			} elseif ( null !== $item[ $name ] && in_array( $def['type'], self::STRUCTURED, true ) && self::has_rule( self::nested( $def ), 'read' ) ) {
				$item[ $name ] = self::map_items( $def, $item[ $name ], static fn ( array $sub, array $value ) => self::strip_item( $sub, $value, $viewer, $page ) );
			}
		}

		return $item;
	}

	private static function readable( array $def, array $enclosing, Viewer $viewer, array &$page, array $shape ): bool {
		if ( self::withheld( $def ) ) {
			return false;
		}
		$rule = $def['access']['read'] ?? null;
		if ( null === $rule ) {
			return true;
		}
		if ( Access::isShorthand( $rule ) ) {
			return $page[ \SpacePress\Json::encode( $rule ) ] ??= self::allows( $rule, $viewer, 'read', null );
		}

		return self::allows( $rule, $viewer, 'read', $enclosing, $shape );
	}

	// ================================================================ query

	public static function checkQuery( string $collection, array &$opts, ?Viewer $viewer, string $pointer ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( null === $viewer ) {
			return;
		}
		$schema = db()->schema();
		if ( ! $schema->hasCollection( $collection ) ) {
			return; // Db reports the unknown collection
		}
		$columns = $schema->collection( $collection )['columns'];
		if ( isset( $opts['where'] ) ) {
			self::check_filter( $collection, $opts['where'], $viewer, $pointer . '/where' );
		}
		if ( is_array( $opts['orderBy'] ?? null ) ) {
			foreach ( $opts['orderBy'] as $name => $_ ) {
				if ( isset( $columns[ $name ] ) && self::mayHide( $columns[ $name ], $viewer ) ) {
					throw self::hidden( (string) $name, $pointer . '/orderBy' . HttpError::seg( $name ) );
				}
			}
		}
		$relations = $schema->collection( $collection )['relations'] ?? array();
		foreach ( is_array( $opts['with'] ?? null ) ? $opts['with'] : array() as $name => $on ) {
			if ( isset( $relations[ $name ] ) && false !== $on && null !== $on ) {
				self::check_link( $collection, $relations[ $name ], $viewer, $pointer . '/with' . HttpError::seg( $name ) );
			}
		}
		if ( is_array( $opts['columns'] ?? null ) ) {
			foreach ( $opts['columns'] as $name => $on ) {
				if ( true !== $on ) {
					continue; // excluding a column reveals nothing
				}
				if ( isset( $columns[ $name ]['access']['read'] ) && self::mayHide( array( 'type' => '' ) + $columns[ $name ], $viewer ) ) {
					throw self::hidden( (string) $name, $pointer . '/columns' . HttpError::seg( $name ) );
				}
			}
		}
	}

	/** Walk a filter like Sql does; malformed parts are left for Sql to report. */
	private static function check_filter( string $collection, mixed $where, Viewer $viewer, string $ptr ): void {
		if ( ! is_array( $where ) ) {
			return;
		}
		$spec = db()->schema()->collection( $collection );
		foreach ( $where as $key => $value ) {
			$key  = (string) $key;
			$kptr = $ptr . HttpError::seg( $key );
			if ( 'AND' === $key || 'OR' === $key ) {
				foreach ( is_array( $value ) ? $value : array() as $i => $f ) {
					self::check_filter( $collection, $f, $viewer, $kptr . '/' . $i );
				}
			} elseif ( 'NOT' === $key ) {
				self::check_filter( $collection, $value, $viewer, $kptr );
			} elseif ( \SpacePress\Schema::filtersRelation( $spec, $key, $value ) ) {
				self::check_link( $collection, $spec['relations'][ $key ], $viewer, $kptr );
				self::check_filter( $spec['relations'][ $key ]['collection'], $value, $viewer, $kptr );
			} elseif ( isset( $spec['columns'][ $key ] ) ) {
				if ( self::mayHide( $spec['columns'][ $key ], $viewer ) ) {
					throw self::hidden( $key, $kptr );
				}
			}
		}
	}

	/** Joining on a hidden column, from either end, would reveal its value. */
	private static function check_link( string $collection, array $rel, Viewer $viewer, string $ptr ): void {
		$schema = db()->schema();
		foreach ( array( array( $collection, $rel['from'] ), array( $rel['collection'], $rel['to'] ) ) as [$c, $col] ) {
			if ( self::mayHide( $schema->collection( $c )['columns'][ $col ] ?? array( 'type' => '' ), $viewer ) ) {
				throw self::hidden( $col, $ptr );
			}
		}
	}

	/** True when some row could hide this column itself from $viewer (sub-fields not counted). */
	private static function may_hide_self( array $def, Viewer $viewer ): bool {
		if ( self::withheld( $def ) ) {
			return true;
		}
		$rule = $def['access']['read'] ?? null;

		return null !== $rule && ( ! Access::isShorthand( $rule ) || ! self::allows( $rule, $viewer, 'read', null ) );
	}

	/** True when some row could hide this column (or a sub-field inside it) from $viewer. */
	public static function mayHide( array $def, Viewer $viewer ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( self::withheld( $def ) ) {
			return true;
		}
		$rule = $def['access']['read'] ?? null;
		if ( null !== $rule && ( ! Access::isShorthand( $rule ) || ! self::allows( $rule, $viewer, 'read', null ) ) ) {
			return true;
		}
		foreach ( in_array( $def['type'] ?? '', self::STRUCTURED, true ) ? self::nested( $def ) : array() as $sub ) {
			if ( self::mayHide( $sub, $viewer ) ) {
				return true;
			}
		}

		return false;
	}

	// ================================================================ write

	/** $stored: an editor save supplies its persisted data separately from the input it must authorize. */
	public static function checkWrite( string $op, string $collection, array &$data, ?array $existing, ?Viewer $viewer, array $provided, bool $stored = false ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( null === $viewer || 'delete' === $op ) {
			return;
		}
		$create = Access::collectionRules( db()->schema()->collection( $collection ) )['create'];
		if ( 'create' === $op && Access::isShorthand( $create ) && Access::evaluate( $create, $viewer, 'create' ) === false ) {
			return; // the collection/identity guards own this denial; no uniqueness lookup is reached
		}
		db()->requireUniqueVisibility( $collection, array_intersect_key( $data, $provided ), $viewer, 'create' === $op && ! $stored, $existing );
		$columns = self::columns( $collection );
		if ( ! self::has_rule( $columns, $op ) && ! self::has_rule( $columns, 'read' ) ) {
			return;
		}
		$page     = array();
		$incoming = $data; // every top-level rule sees the same incoming data, whatever the key order
		foreach ( $provided as $name => $_ ) {
			$def = $columns[ $name ] ?? null;
			if ( null === $def || ! array_key_exists( $name, $incoming ) ) {
				continue; // consumed virtual input; unknown keys are rejected by the pipeline
			}
			$data[ $name ] = self::guard( $op, $def, (string) $name, $stored ? $provided[ $name ] : $incoming[ $name ], $incoming, $existing, $viewer, $page, HttpError::seg( $name ), resolved: $stored ? $incoming[ $name ] : null, shape: $columns );
		}
	}

	/**
	 * One supplied value at any depth. $ctx is what its rule sees as data (the patch at the top level,
	 * the resolved effective item for sub-fields); $storedIn is the stored enclosing row or item.
	 */
	private static function guard( string $op, array $def, string $name, mixed $value, array $ctx, ?array $stored_in, Viewer $viewer, array &$page, string $ptr, bool $merge = true, mixed $resolved = null, array $shape = array() ): mixed {
		$before = null !== $stored_in && array_key_exists( $name, $stored_in ) ? $stored_in[ $name ] : null;
		// Credential-withheld fields cannot be supplied on create, including nested fields.
		if ( 'create' === $op && self::withheld( $def ) ) {
			throw null !== self::$withheld_refusal ? ( self::$withheld_refusal )() : self::denied( $viewer, $name, $ptr );
		}
		// An allowing update rule explicitly opts into write-only input, at every nesting depth.
		if ( 'update' === $op && ! isset( $def['access']['update'] )
			&& ( null === $stored_in ? self::may_hide_self( $def, $viewer ) : ! self::readable( $def, $stored_in, $viewer, $page, $shape ) ) ) {
			throw self::denied( $viewer, $name, $ptr );
		}
		$rule = $def['access'][ $op ] ?? null;
		if ( null !== $rule && ! self::allows( $rule, $viewer, $op, $ctx, $shape ) && ! self::unchanged_visible( $def, $name, $value, $stored_in, $viewer, $page, $shape ) ) {
			throw self::denied( $viewer, $name, $ptr );
		}

		if ( ! in_array( $def['type'], self::STRUCTURED, true ) ) {
			return $value;
		}
		// A container the viewer may not see, holding something it may not read or set: whatever
		// happens inside it (preserved children, unchanged items, list length, layouts) would be decided
		// by hidden data, so any write to it is refused outright, decided by the rules alone.
		if ( null !== $stored_in && self::may_hide_self( $def, $viewer )
			&& ( self::unwritable( $op, array( 'access' => array() ) + $def, $viewer ) || self::mayHide( array( 'access' => array() ) + $def, $viewer ) ) ) {
			throw self::denied( $viewer, $name, $ptr );
		}
		$resolved ??= self::resolve_value( $op, $def, $value, $before, $merge, $viewer, $page );
		if ( 'group' === $def['type'] && self::is_object( $value ) ) {
			return self::guard_item( $op, $def['fields'] ?? array(), $value, is_array( $before ) ? $before : null, $merge, $viewer, $page, $ptr, $resolved );
		}
		if ( 'group' !== $def['type'] && is_array( $value ) && array_is_list( $value ) ) {
			$old = is_array( $before ) && array_is_list( $before ) ? $before : array();
			foreach ( $value as $i => $item ) {
				if ( ! is_array( $item ) ) {
					continue; // the pipeline reports the shape
				}
				$iptr = $ptr . '/' . $i;
				$prev = self::previous_item( $def, $old, $i, $item );
				if ( null === $prev && is_array( $old[ $i ] ?? null ) && self::unwritable(
					$op,
					array(
						'type'   => 'group',
						'fields' => self::item_fields( $def, $old[ $i ] ),
					),
					$viewer
				) ) {
					throw self::denied( $viewer, $name, $iptr ); // another layout would replace a protected item
				}
				$fields = self::item_fields( $def, $item );
				if ( null !== $prev && self::omits_sensitive( $op, $fields, $item, $viewer ) ) {
					if ( self::canon( $item ) !== self::canon( self::strip_item( $fields, $prev, $viewer, $page ) ) ) {
						throw self::denied( $viewer, $name, $iptr );
					}
					$value[ $i ] = $prev; // resent as seen: the stored item stays whole
					continue;
				}
				$value[ $i ] = self::guard_item( $op, $fields, $item, $prev, false, $viewer, $page, $iptr, $resolved[ $i ] );
			}
			foreach ( array_slice( $old, count( $value ) ) as $k => $prev ) {
				if ( is_array( $prev ) && self::unwritable(
					$op,
					array(
						'type'   => 'group',
						'fields' => self::item_fields( $def, $prev ),
					),
					$viewer
				) ) {
					throw self::denied( $viewer, $name, $ptr . '/' . ( count( $value ) + $k ) );
				}
			}

			return $value;
		}
		// null (or a malformed value the pipeline rejects) would erase whatever the viewer may not set.
		if ( null !== $stored_in && self::unwritable( $op, array( 'access' => array() ) + $def, $viewer ) ) {
			throw self::denied( $viewer, $name, $ptr );
		}

		return $value;
	}

	/** Supplied sub-fields are checked against the fully resolved item; the resolved item is stored. */
	private static function guard_item( string $op, array $fields, array $supplied, ?array $before, bool $merge, Viewer $viewer, array &$page, string $ptr, array $resolved ): array {
		foreach ( $fields as $sub => $sdef ) {
			$sub = (string) $sub;
			if ( array_key_exists( $sub, $supplied ) ) {
				$resolved[ $sub ] = self::guard( $op, $sdef, $sub, $supplied[ $sub ], $resolved, $before, $viewer, $page, $ptr . HttpError::seg( $sub ), $merge, $resolved[ $sub ], $fields );
			}
		}

		return $resolved;
	}

	/**
	 * What a write of $value to a group column stores for $viewer, as SpacePress's write pipeline stores it: omitted
	 * sub-fields the viewer can't read or can't set keep their stored values ($before), defaults
	 * fill the rest. Other types are returned as given. For writes that bypass {@see checkWrite()}'s
	 * resolution (core REST `meta`).
	 */
	public static function effectiveGroup( string $op, array $def, mixed $value, mixed $before, Viewer $viewer ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( 'group' !== $def['type'] ) {
			return $value;
		}
		$page = array();

		return self::resolve_value( $op, $def, $value, $before, true, $viewer, $page );
	}

	/**
	 * The value that will be stored, before any check: supplied values; in a group ($merge), omitted
	 * sub-fields the viewer can't read or can't set keep their stored values; defaults (generated once)
	 * fill the rest. A list item that leaves out such a field and matches what the viewer sees is the
	 * stored item, whole. Decisions use the rules, never the stored values the viewer can't see.
	 */
	private static function resolve_value( string $op, array $def, mixed $value, mixed $before, bool $merge, Viewer $viewer, array &$page ): mixed {
		if ( 'group' === $def['type'] ) {
			return self::is_object( $value ) ? self::resolve_item( $op, $def['fields'] ?? array(), $value, is_array( $before ) ? $before : null, $merge, $viewer, $page ) : $value;
		}
		if ( ! is_array( $value ) || ! array_is_list( $value ) ) {
			return $value;
		}
		$old = is_array( $before ) && array_is_list( $before ) ? $before : array();
		foreach ( $value as $i => $item ) {
			if ( ! is_array( $item ) ) {
				continue;
			}
			$fields      = self::item_fields( $def, $item );
			$prev        = self::previous_item( $def, $old, $i, $item );
			$value[ $i ] = null !== $prev && self::omits_sensitive( $op, $fields, $item, $viewer )
				&& self::canon( $item ) === self::canon( self::strip_item( $fields, $prev, $viewer, $page ) )
				? $prev
				: self::resolve_item( $op, $fields, $item, $prev, false, $viewer, $page );
		}

		return $value;
	}

	private static function resolve_item( string $op, array $fields, array $supplied, ?array $before, bool $merge, Viewer $viewer, array &$page ): array {
		$out = $supplied;
		foreach ( $fields as $sub => $sdef ) {
			$sub = (string) $sub;
			if ( array_key_exists( $sub, $supplied ) ) {
				if ( in_array( $sdef['type'], self::STRUCTURED, true ) ) {
					$out[ $sub ] = self::resolve_value( $op, $sdef, $supplied[ $sub ], $before[ $sub ] ?? null, $merge, $viewer, $page );
				}
			} elseif ( $merge && null !== $before && array_key_exists( $sub, $before )
				&& ( self::mayHide( $sdef, $viewer ) || self::unwritable( $op, $sdef, $viewer ) ) ) {
				$out[ $sub ] = $before[ $sub ]; // kept, not written: the response is stripped like any read
			} elseif ( isset( $sdef['default'] ) ) {
				$out[ $sub ] = Schema::generate( $sdef['default'], $sdef );
			}
		}

		return $out;
	}

	/** The stored item at the same position, unless another blocks layout replaces it. */
	private static function previous_item( array $def, array $old, int $i, array $item ): ?array {
		$prev = is_array( $old[ $i ] ?? null ) ? $old[ $i ] : null;

		return null !== $prev && 'blocks' === $def['type'] && ( $prev['layout'] ?? null ) !== ( $item['layout'] ?? null ) ? null : $prev;
	}

	/**
	 * True when the viewer may not be able to set this field or something nested in it: a function rule
	 * (it could deny) or a shorthand that denies. From the rules alone, so it reveals no stored data.
	 */
	public static function unwritable( string $op, array $def, Viewer $viewer ): bool {
		$rule = $def['access'][ $op ] ?? null;
		if ( 'update' === $op && null === $rule && self::may_hide_self( $def, $viewer ) ) {
			return true;
		}
		if ( null !== $rule && ( ! Access::isShorthand( $rule ) || ! self::allows( $rule, $viewer, $op, null ) ) ) {
			return true;
		}
		foreach ( in_array( $def['type'] ?? '', self::STRUCTURED, true ) ? self::nested( $def ) : array() as $sub ) {
			if ( self::unwritable( $op, $sub, $viewer ) ) {
				return true;
			}
		}

		return false;
	}

	/** True when the item leaves out, at any depth, a field the viewer can't read or can't set. */
	private static function omits_sensitive( string $op, array $fields, array $item, Viewer $viewer ): bool {
		foreach ( $fields as $sub => $sdef ) {
			if ( ! array_key_exists( $sub, $item ) ) {
				if ( self::mayHide( $sdef, $viewer ) || self::unwritable( $op, $sdef, $viewer ) ) {
					return true;
				}
				continue;
			}
			$value = $item[ $sub ];
			if ( 'group' === $sdef['type'] && self::is_object( $value ) ) {
				if ( self::omits_sensitive( $op, $sdef['fields'] ?? array(), $value, $viewer ) ) {
					return true;
				}
			} elseif ( in_array( $sdef['type'], array( 'repeater', 'blocks' ), true ) && is_array( $value ) ) {
				foreach ( $value as $nested ) {
					if ( is_array( $nested ) && self::omits_sensitive( $op, self::item_fields( $sdef, $nested ), $nested, $viewer ) ) {
						return true;
					}
				}
			}
		}

		return false;
	}

	/**
	 * An update may resend a stored value unchanged when the viewer saw all of it: the field is
	 * readable and stripping removes nothing inside it.
	 */
	private static function unchanged_visible( array $def, string $name, mixed $value, ?array $stored_in, Viewer $viewer, array &$page, array $shape ): bool {
		if ( null === $stored_in || ! array_key_exists( $name, $stored_in ) || ! self::same( $value, $stored_in[ $name ] ) ) {
			return false;
		}
		$seen = self::strip_item( $shape, $stored_in, $viewer, $page );

		return array_key_exists( $name, $seen ) && self::same( $seen[ $name ], $stored_in[ $name ] );
	}

	private static function is_object( mixed $v ): bool {
		return is_array( $v ) && ( array() === $v || ! array_is_list( $v ) );
	}

	/** Order-independent comparison form; null and absent compare equal. */
	private static function canon( mixed $v ): string {
		$norm = static function ( mixed $v ) use ( &$norm ): mixed {
			if ( $v instanceof JsArray ) {
				return new JsArray( array_map( $norm, $v->a ) ); }
			if ( $v instanceof JsObject ) {
				$props = array_filter( array_map( $norm, $v->p ), static fn ( $x ) => null !== $x );
				ksort( $props, SORT_STRING );
				return new JsObject( $props );
			}
			if ( ! is_array( $v ) ) {
				return $v;
			}
			if ( array_is_list( $v ) ) {
				return array_map( $norm, $v );
			}
			$v = array_filter( array_map( $norm, $v ), static fn ( $x ) => null !== $x );
			ksort( $v );

			return $v;
		};

		return (string) Js::jsonStringify( $norm( $v ) );
	}

	private static function item_fields( array $def, array $item ): array {
		return match ( $def['type'] ) {
			'group', 'repeater' => $def['fields'] ?? array(),
			'blocks' => $def['layouts'][ self::layout( $item ) ] ?? array(),
		};
	}

	/** A malformed layout matches no fields here; the pipeline's validator reports it. */
	private static function layout( array $item ): string {
		return is_string( $item['layout'] ?? null ) ? $item['layout'] : '';
	}

	private static function denied( Viewer $viewer, string $name, string $ptr ): HttpError {
		return null === $viewer->user
			? new HttpError( 401, 'unauthenticated', "Sign in to set $name", $ptr )
			: new HttpError( 403, 'forbidden', "You can't set $name", $ptr );
	}

	// ================================================================ /_schema

	public static function describe( array $describe ): array {
		foreach ( $describe['collections'] ?? array() as $name => $c ) {
			$fields = array();
			foreach ( $c['columns'] ?? array() as $col => $def ) {
				if ( isset( $def['access'] ) ) {
					$fields[ $col ] = $def['access'];
				}
			}
			if ( array() !== $fields ) {
				$describe['collections'][ $name ]['access']['fields'] = $fields;
			}
		}

		return $describe;
	}

	// ================================================================ helpers

	/** The active app's columns; a store outside the booted app (no such collection) has no field rules here. */
	private static function columns( string $collection ): array {
		$schema = db()->schema();

		return $schema->hasCollection( $collection ) ? $schema->collection( $collection )['columns'] : array();
	}

	private static function allows( array $rule, Viewer $viewer, string $op, ?array $data, ?array $data_shape = null ): bool {
		$r = Access::evaluate( $rule, $viewer, $op, $data, $data_shape );
		if ( is_array( $r ) ) {
			throw new \LogicException( "A field $op rule returned a filter; field rules return a boolean" );
		}

		return $r;
	}

	private static function hidden( string $name, string $ptr ): HttpError {
		return new HttpError( 403, 'forbidden', "You can't filter, sort or select by $name", $ptr );
	}

	/** True when any field (at any depth) carries a rule for $op. */
	private static function has_rule( array $fields, string $op ): bool {
		foreach ( $fields as $def ) {
			if ( isset( $def['access'][ $op ] ) || ( 'read' === $op && self::withheld( $def ) )
				|| ( in_array( $def['type'] ?? '', self::STRUCTURED, true ) && self::has_rule( self::nested( $def ), $op ) ) ) {
				return true;
			}
		}

		return false;
	}

	/** Sub-field definitions of a structured column; blocks merge every layout's fields. */
	private static function nested( array $def ): array {
		if ( 'blocks' !== $def['type'] ) {
			return $def['fields'] ?? array();
		}
		$out = array();
		foreach ( $def['layouts'] ?? array() as $fields ) {
			foreach ( $fields as $name => $f ) {
				$out[ $name . "\0" . count( $out ) ] = $f;
			}
		}

		return $out;
	}

	/** Apply $fn(fields, item) to each object of a group/repeater/blocks value. */
	private static function map_items( array $def, mixed $value, callable $fn ): mixed { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Preserve the existing PHP parameter name.
		if ( 'group' === $def['type'] ) {
			return is_array( $value ) ? $fn( $def['fields'] ?? array(), $value ) : $value;
		}
		if ( ! is_array( $value ) ) {
			return $value;
		}
		foreach ( $value as $i => $item ) {
			if ( is_array( $item ) ) {
				$fields      = 'repeater' === $def['type'] ? ( $def['fields'] ?? array() ) : ( $def['layouts'][ self::layout( $item ) ] ?? array() );
				$value[ $i ] = $fn( $fields, $item );
			}
		}

		return $value;
	}

	/**
	 * Structural equality: object keys in any order; list order, list-vs-object, types and
	 * null-vs-absent preserved. Objects are tagged so key sorting can never turn one into a list.
	 */
	private static function same( mixed $a, mixed $b ): bool {
		$form = static function ( mixed $v ) use ( &$form ): mixed {
			if ( $v instanceof JsArray ) {
				return array( 'l' => array_map( $form, $v->a ) ); }
			if ( $v instanceof JsObject ) {
				$o = array_map( $form, $v->p );
				ksort( $o, SORT_STRING );
				return array( 'o' => array_map( null, array_map( 'strval', array_keys( $o ) ), array_values( $o ) ) );
			}
			if ( ! is_array( $v ) ) {
				return $v;
			}
			if ( array() !== $v && array_is_list( $v ) ) {
				return array( 'l' => array_map( $form, $v ) );
			}
			$o = array_map( $form, $v );
			ksort( $o, SORT_STRING );

			return array( 'o' => array_map( null, array_map( 'strval', array_keys( $o ) ), array_values( $o ) ) );
		};

		return Js::jsonStringify( $form( $a ) ) === Js::jsonStringify( $form( $b ) );
	}
}
