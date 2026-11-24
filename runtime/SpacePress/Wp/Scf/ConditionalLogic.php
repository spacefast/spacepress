<?php

declare(strict_types=1);

namespace SpacePress\Wp\Scf;

use SpacePress\Js;
use SpacePress\Wp\Plugin;
use SpacePress\Wp\Scf;

/**
 * `.showIf(filter)` → SCF `conditional_logic` (phase 2 §4.3). SCF's form is an OR of AND groups:
 * `[[rule, rule], [rule]]` with `rule = ['field' => <sibling key>, 'operator' => '==' | '!=' |
 * '==empty' | '!=empty', 'value' => string]`. The sibling filter becomes that disjunctive form: keys
 * are ANDed, `OR` and `in` contribute alternatives. Booleans compare as '1'/'0' (SCF's true_false
 * value) and null as an emptiness test. Editor UI only: nothing in the pipeline reads it.
 *
 * SCF's browser-side evaluation can only watch SCF fields with a matching condition type. A top-level
 * rule on a sibling it can't watch (a core post column such as `status`, or an equality on a date,
 * timestamp, rich-text or media field) is evaluated when the form renders (`acf/prepare_field`) against
 * the saved row: a group it fails is dropped, a rule it passes is removed, and a field with no group
 * left is not rendered (so its stored value is untouched). Such rules settle at page load, not live.
 */
final class ConditionalLogic {

	/** SCF field types without a `==`/`!=` condition type (SCF 6.9.7 `acf-input.js`). */
	private const NO_EQUALITY = array( 'date', 'timestamp', 'richText', 'media', 'mediaList' );

	public static function register(): void {
		Scf::fieldFilter( self::apply( ... ) );
		add_filter( 'acf/prepare_field', array( self::class, 'prepare' ), 20 );
	}

	public static function apply( array $field, array $def, string $col, array $spec ): array {
		if ( ! isset( $def['showIf'] ) ) {
			return $field;
		}
		$prefix = substr( $field['key'], 0, -strlen( $col ) );
		// Only top-level fields can be settled from the saved row; sub-field items are dynamic.
		$top           = isset( $spec['columns'] );
		$siblings      = $top ? $spec['columns'] : ( $spec['fields'] ?? array() );
		$editor_fields = $top ? self::editor_fields( $spec ) : array();
		$groups        = self::groups( $def['showIf'] );
		if ( in_array( array(), $groups, true ) ) {
			return $field; // an empty AND group always holds: no condition (SCF ignores an empty group)
		}
		foreach ( $groups as &$group ) {
			foreach ( $group as &$rule ) {
				$rule['static'] = $top && ( ! in_array( $rule['col'], $editor_fields, true )
					|| ( null !== $rule['arg'] && in_array( $siblings[ $rule['col'] ]['type'] ?? '', self::NO_EQUALITY, true ) ) );
				$rule['scf']    = self::is_post_object( $siblings[ $rule['col'] ] ?? array() ) ? 'post_object' : null;
			}
		}
		unset( $group, $rule );
		$field['conditional_logic'] = self::scf( $groups, $prefix );
		if ( array_filter( array_merge( ...$groups ), static fn ( array $r ) => $r['static'] ) !== array() ) {
			$field['sp_logic'] = array(
				'prefix' => $prefix,
				'groups' => $groups,
			);
		}

		return $field;
	}

	/** acf/prepare_field: settle the rules SCF can't watch against the row being edited. */
	public static function prepare( mixed $field ): mixed {
		if ( ! is_array( $field ) || ! isset( $field['sp_logic'] ) ) {
			return $field;
		}
		$row  = self::edited_row();
		$kept = array();
		foreach ( $field['sp_logic']['groups'] as $group ) {
			$live = array();
			foreach ( $group as $rule ) {
				if ( ! $rule['static'] ) {
					$live[] = $rule;
				} elseif ( ! self::holds( $rule, $row[ $rule['col'] ] ?? null ) ) {
					continue 2;
				}
			}
			if ( array() === $live ) {
				$field['conditional_logic'] = 0;
				unset( $field['sp_logic'] );

				return $field; // a group holds outright: always shown
			}
			$kept[] = $live;
		}
		if ( array() === $kept ) {
			return false;
		}
		$field['conditional_logic'] = self::scf( $kept, $field['sp_logic']['prefix'] );
		unset( $field['sp_logic'] );

		return $field;
	}

	/** The decoded saved row of the post (or member, `user_<id>`) whose form is rendering, or [] for a new one. */
	private static function edited_row(): array {
		$form_id = function_exists( 'acf_get_form_data' ) ? acf_get_form_data( 'post_id' ) : null;
		if ( is_string( $form_id ) && preg_match( '/^user_(\d+)$/D', $form_id, $m ) ) {
			$plugin  = Plugin::instance();
			$members = $plugin?->schema->auth()['collection'] ?? null;

			return null === $members ? array() : ( $plugin->db()->editorRow( $members, (int) $m[1] ) ?? array() );
		}
		$post_id = $form_id;
		$post_id = is_numeric( $post_id ) ? (int) $post_id : (int) get_the_ID();
		$plugin  = Plugin::instance();
		if ( $post_id <= 0 || null === $plugin ) {
			return array();
		}
		$type = get_post_type( $post_id );
		foreach ( $plugin->schema->collections() as $name => $spec ) {
			if ( ( $spec['wp']['postType'] ?? null ) === $type ) {
				return $plugin->db()->editorRow( (string) $name, $post_id ) ?? array();
			}
		}

		return array();
	}

	private static function holds( array $rule, mixed $value ): bool {
		if ( null === $rule['arg'] ) {
			return ( null === $value || '' === $value || array() === $value ) === $rule['eq'];
		}

		return Js::strictEq( $value, $rule['arg'] ) === $rule['eq'];
	}

	/** Scf renders a reference to an editor collection as a post_object field. */
	private static function is_post_object( array $def ): bool {
		$ref    = $def['references']['collection'] ?? null;
		$plugin = null === $ref ? null : Plugin::instance();
		if ( null === $plugin || ! $plugin->schema->hasCollection( $ref ) ) {
			return false;
		}
		$target = $plugin->schema->collection( $ref );

		return ( $target['editor'] ?? true ) && ( $target['wp'] ?? null ) !== null;
	}

	/** Columns rendered as SCF fields (Scf::register skips the core post columns; user forms skip the core user columns). */
	private static function editor_fields( array $spec ): array {
		if ( $spec['auth'] ?? false ) {
			return array_keys( array_filter( $spec['columns'], static fn ( array $def, string|int $col ) => \SpacePress\Wp\WpUserStore::onProfile( (string) $col, $def ), ARRAY_FILTER_USE_BOTH ) );
		}
		$core = array( $spec['primaryKey'] ?? null, $spec['title'] ?? null, $spec['content'] ?? null, $spec['slug'] ?? null, $spec['excerpt'] ?? null );

		return array_keys( array_filter( $spec['columns'], static fn ( array $def, string|int $col ) => ! in_array( $col, $core, true ) && ! ( $def['system'] ?? false ), ARRAY_FILTER_USE_BOTH ) );
	}

	private static function scf( array $groups, string $prefix ): array {
		return array_map(
			static fn ( array $group ) => array_map(
				static function ( array $rule ) use ( $prefix ): array {
				if ( null === $rule['arg'] ) {
					return array(
						'field'    => $prefix . $rule['col'],
						'operator' => $rule['eq'] ? '==empty' : '!=empty',
					);
					}

				// SCF registers post_object inequality as '!=='; '!=' would match no condition type.
				$ne = ( $rule['scf'] ?? null ) === 'post_object' ? '!==' : '!=';

				return array(
					'field'    => $prefix . $rule['col'],
					'operator' => $rule['eq'] ? '==' : $ne,
					'value'    => match ( true ) {
								is_bool( $rule['arg'] ) => $rule['arg'] ? '1' : '0',
								is_float( $rule['arg'] ) => Js::numStr( $rule['arg'] ),
								default => (string) $rule['arg'],
								},
				);
				},
				$group
			),
			$groups
		);
	}

	/** @return list<list<array{col: string, eq: bool, arg: mixed}>> disjunctive normal form; arg null = emptiness test */
	private static function groups( array $filter ): array {
		$groups = array( array() );
		foreach ( $filter as $key => $test ) {
			$key = (string) $key;
			if ( 'OR' === $key ) {
				$alternatives = array();
				foreach ( $test as $f ) {
					array_push( $alternatives, ...self::groups( $f ) );
				}
				$groups = self::and( $groups, $alternatives );
			} else {
				$groups = self::and( $groups, self::column( $key, $test ) );
			}
		}

		return $groups;
	}

	/** One column's test as alternatives (each a list of rules that must all hold). */
	private static function column( string $col, mixed $test ): array {
		$rule = static fn ( bool $eq, mixed $arg ) => array(
			'col' => $col,
			'eq'  => $eq,
			'arg' => $arg,
		);
		if ( ! is_array( $test ) ) {
			return array( array( $rule( true, $test ) ) );
		}
		$groups = array( array() );
		foreach ( $test as $op => $arg ) {
			$groups = self::and(
				$groups,
				match ( (string) $op ) {
				'eq' => array( array( $rule( true, $arg ) ) ),
				'ne' => array( array( $rule( false, $arg ) ) ),
				'in' => array_map( static fn ( $v ) => array( $rule( true, $v ) ), $arg ),
				'isNull' => array( array( $rule( true, null ) ) ),
				'isNotNull' => array( array( $rule( false, null ) ) ),
				}
			);
		}

		return $groups;
	}

	/** Distribute: (a ∨ b) ∧ (c ∨ d) = ac ∨ ad ∨ bc ∨ bd. */
	private static function and( array $left, array $right ): array {
		$out = array();
		foreach ( $left as $l ) {
			foreach ( $right as $r ) {
				$out[] = array( ...$l, ...$r );
			}
		}

		return $out;
	}
}
