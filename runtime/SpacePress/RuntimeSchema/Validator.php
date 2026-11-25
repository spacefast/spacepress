<?php

declare(strict_types=1);

namespace SpacePress\RuntimeSchema;

use SpacePress\Js;
use SpacePress\Schema;

/**
 * Checks one field added at runtime (spec §2.10) and returns it in the stored form: the column
 * array `schema.php` would hold for it, keys in the compiler's order.
 *
 * The rules are the compiler's, for the part of a schema that is data. The compiler checks a field
 * in two steps and so does this: the builder call and its modifiers (`src/eval.rs`, code F2001),
 * then the schema rules (`src/extract.rs`, F3001, and F3101 for `ui`). A refusal carries the code
 * the compiler gives the same field in `sp/_generated/runtime-schema.json`
 * (`src/runtime_schema.rs`). `tests/runtime-schema/corpus.json` runs against both; a rule changed
 * on one side fails there until the other follows. A definition with several faults gets one of
 * their codes, not necessarily the compiler's first.
 *
 * What only a running site refuses (a name the build already declares, a required field without a
 * default) is in {@see Changes}.
 */
final class Validator {

	/** Keys of a stored field, in the order `schema.php` writes them. */
	private const KEYS  = array( 'type', 'multiple', 'multiline', 'accept', 'notNull', 'enum', 'default', 'rules', 'fields', 'layouts', 'ui' );
	private const TYPES = array( 'text', 'select', 'integer', 'real', 'boolean', 'date', 'timestamp', 'json', 'email', 'url', 'richText', 'media', 'mediaList', 'group', 'repeater', 'blocks' );
	/** Types `.min()`/`.max()` don't apply to (`modifier_invalid`). */
	private const UNBOUNDED   = array( 'boolean', 'date', 'timestamp', 'json', 'media', 'group' );
	private const MAX_NESTING = 3;
	private const IDENT       = '/\A[A-Za-z][A-Za-z0-9_]*\z/';

	/**
	 * @param array $kind the compiled collection the field joins
	 * @return array the stored definition
	 * @throws Refused
	 */
	public static function field( string $kindName, ?array $kind, string $name, mixed $definition ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$at = "$kindName.$name"; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.InterpolatedVariableNotSnakeCase -- Preserve the existing PHP variable name.
		if ( null === $kind ) {
			throw Refused::rule( 'F3001', $kindName, 'this app declares no collection with that name' ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		}
		if ( ! ( $kind['editor'] ?? false ) || ( $kind['wp'] ?? null ) === null ) {
			throw Refused::rule( 'F3001', $kindName, 'runtime fields belong to collection() kinds; this one stores its rows elsewhere. Add the field in source and deploy a build' ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		}
		if ( in_array( $name, array( 'title', 'content', 'slug' ), true ) ) {
			throw Refused::rule( 'F3001', $at, "`$name` names a designated field; declare it in source" );
		}

		return self::definition( $at, $name, $definition, self::COLLECTION );
	}

	public const COLLECTION = 'collection';
	public const GLOBAL     = 'global';

	/** One field of a collection or a global, whatever kind it joins. Returns the stored definition. */
	public static function definition( string $at, string $name, mixed $definition, string $place ): array {
		$stored = self::build( $definition, $at );
		if ( self::GLOBAL === $place && 'blocks' === $stored['type'] ) {
			throw Refused::rule( 'F3001', $at, "blocks() isn't allowed on a global field (`$name`)" );
		}
		self::check( $name, $stored, $at, 1 );
		if ( self::GLOBAL === $place && ( $stored['notNull'] ?? false ) && ! isset( $stored['default'] ) ) {
			throw Refused::rule( 'F3001', $at, "a global field is required unless it has a default (`$name`)" );
		}

		return $stored;
	}

	/** `.ui()` on its own, for a presentation override. */
	public static function presentation( mixed $ui, string $at ): array {
		return self::ui( $ui, $at );
	}

	/** The builder call and its modifiers: shape, then the evaluator's rules. Returns the stored form. */
	private static function build( mixed $def, string $at ): array {
		if ( ! is_array( $def ) || ( array() !== $def && array_is_list( $def ) ) ) {
			throw Refused::rule( 'F3001', $at, 'a field definition must be an object' );
		}
		foreach ( $def as $key => $_ ) {
			if ( ! in_array( $key, self::KEYS, true ) ) {
				throw Refused::rule( 'F3001', $at, "a stored field has no key `$key`" );
			}
		}
		$type = $def['type'] ?? null;
		if ( ! is_string( $type ) ) {
			throw Refused::rule( 'F3001', $at, 'a field definition needs a `type`' );
		}
		$flag = static function ( string $key ) use ( $def, $at ): bool {
			if ( ! array_key_exists( $key, $def ) ) {
				return false;
			}

			return is_bool( $def[ $key ] ) ? $def[ $key ] : throw Refused::rule( 'F3001', $at, "`$key` must be true or false" );
		};
		foreach ( array(
			'multiline' => array( 'text' ),
			'accept'    => array( 'media', 'mediaList' ),
			'enum'      => array( 'text', 'select' ),
			'fields'    => array( 'group', 'repeater' ),
			'layouts'   => array( 'blocks' ),
		) as $key => $types ) {
			if ( array_key_exists( $key, $def ) && ! in_array( $type, $types, true ) ) {
				throw Refused::rule( 'F3001', $at, "`$key` doesn't apply to a `$type` field" );
			}
		}
		if ( $flag( 'multiple' ) !== ( 'select' === $type ) ) {
			throw Refused::rule( 'F3001', $at, '`multiple` is true on a `select` field and absent elsewhere' );
		}
		$enum = null;
		if ( array_key_exists( 'enum', $def ) ) {
			$enum = $def['enum'];
			if ( ! is_array( $enum ) || ! array_is_list( $enum ) || array_filter( $enum, static fn ( mixed $v ): bool => ! is_string( $v ) ) !== array() ) {
				throw Refused::rule( 'F3001', $at, '`enum` must be a list of strings' );
			}
			if ( array_key_exists( 'multiline', $def ) ) {
				throw Refused::rule( 'F3001', $at, "`multiline` doesn't apply to a field with `enum`" );
			}
		} elseif ( 'select' === $type ) {
			throw Refused::rule( 'F3001', $at, 'a `select` field needs `enum`' );
		}
		if ( ! in_array( $type, self::TYPES, true ) ) {
			throw Refused::rule( 'F3001', $at, "`$type` fields can't be added at runtime; declare it in source" );
		}
		$multiline = $flag( 'multiline' );
		$notNull   = $flag( 'notNull' ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$fields    = static function ( mixed $fields, string $at ): array {
			if ( ! is_array( $fields ) || array() === $fields || array_is_list( $fields ) ) {
				throw Refused::rule( 'F3001', $at, 'needs at least one field' );
			}
			$out = array();
			foreach ( $fields as $name => $sub ) {
				$out[ (string) $name ] = self::build( $sub, "$at.$name" );
			}

			return $out;
		};

		// The builder call.
		$out = array( 'type' => $type );
		if ( null !== $enum && array() === $enum ) {
			throw Refused::rule( 'F2001', $at, 'select() needs at least one option' );
		}
		if ( 'select' === $type ) {
			$out += array(
				'multiple' => true,
				'enum'     => $enum,
			);
		}
		if ( $multiline ) {
			$out['multiline'] = true;
		}
		if ( 'media' === $type || 'mediaList' === $type ) {
			$accept = $def['accept'] ?? 'any';
			if ( ! is_string( $accept ) ) {
				throw Refused::rule( 'F3001', $at, '`accept` is "image" or "any"' );
			}
			if ( 'image' !== $accept && 'any' !== $accept ) {
				throw Refused::rule( 'F2001', $at, "`accept` can't be \"$accept\"; use \"image\" or \"any\"" );
			}
			$out['accept'] = $accept;
		}
		$sub_fields = $layouts = null; // phpcs:ignore Squiz.PHP.DisallowMultipleAssignments.Found -- Keep the assignment and its test together.
		if ( 'group' === $type || 'repeater' === $type ) {
			$sub_fields = $fields( $def['fields'] ?? null, $at );
		}
		if ( 'blocks' === $type ) {
			$given = $def['layouts'] ?? null;
			if ( ! is_array( $given ) || array() === $given || array_is_list( $given ) ) {
				throw Refused::rule( 'F3001', $at, 'a `blocks` field needs at least one layout in `layouts`' );
			}
			$layouts = array();
			foreach ( $given as $layout => $sub ) {
				$layouts[ (string) $layout ] = $fields( $sub, "$at.$layout" );
			}
		}

		// The modifiers, in the order the compiler applies them: optional, min, max, default, ui.
		if ( $notNull ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$out['notNull'] = true;
		}
		if ( null !== $enum && 'select' !== $type ) {
			$out['enum'] = $enum;
		}
		$rules = array();
		if ( array_key_exists( 'rules', $def ) ) {
			$given = $def['rules'];
			if ( ! is_array( $given ) || array() === $given || array_is_list( $given ) || array_diff( array_keys( $given ), array( 'min', 'max' ) ) !== array() ) {
				throw Refused::rule( 'F3001', $at, '`rules` holds `min` and `max` only' );
			}
			foreach ( array( 'min', 'max' ) as $key ) {
				if ( ! array_key_exists( $key, $given ) ) {
					continue;
				}
				$n = $given[ $key ];
				if ( ! is_int( $n ) && ! is_float( $n ) ) {
					throw Refused::rule( 'F3001', $at, "`rules.$key` must be a number" );
				}
				if ( in_array( $type, self::UNBOUNDED, true ) ) {
					throw Refused::rule( 'F2001', $at, "`.$key()` isn't valid on a $type field" );
				}
				if ( ! in_array( $type, array( 'integer', 'real' ), true ) && ( $n < 0 || (float) $n !== floor( (float) $n ) ) ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
					throw Refused::rule( 'F2001', $at, "`.$key()` here is a length or count, so it needs a whole number ≥ 0" );
				}
				$rules[ $key ] = self::number( $n );
			}
		}
		$default = null;
		if ( array_key_exists( 'default', $def ) ) {
			$given = $def['default'];
			$value = is_array( $given ) && count( $given ) === 1 && array_key_exists( 'value', $given ) ? $given['value'] : null;
			if ( is_bool( $value ) || is_int( $value ) || is_float( $value ) || is_string( $value ) ) {
				if ( 'media' === $type ) {
					throw Refused::rule( 'F2001', $at, "`.default()` isn't valid on a media field; media fields start empty" );
				}
				$default = array( 'value' => is_float( $value ) ? self::number( $value ) : $value );
			} elseif ( is_array( $given ) && $given === array( 'now' => true ) ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
				if ( 'timestamp' !== $type && 'date' !== $type ) {
					throw Refused::rule( 'F2001', $at, "`.defaultNow()` only works on timestamp and date fields, not $type" );
				}
				$default = array( 'now' => true );
			} else {
				throw Refused::rule( 'F3001', $at, '`default` is `{ "value": ... }` with one string, number or boolean, or `{ "now": true }`' );
			}
			$out['default'] = $default;
		}
		if ( array() !== $rules ) {
			$out['rules'] = $rules;
		}
		if ( null !== $sub_fields ) {
			$out['fields'] = $sub_fields;
		}
		if ( null !== $layouts ) {
			$out['layouts'] = $layouts;
		}
		if ( array_key_exists( 'ui', $def ) && array() !== $def['ui'] ) {
			// Checked with the schema rules; kept as given until then.
			$out['ui'] = $def['ui'];
		}

		return $out;
	}

	/** The schema rules on a built field; `$depth` counts the kind's own field as 1. */
	private static function check( string $name, array &$field, string $at, int $depth ): void {
		$type = $field['type'];
		if ( preg_match( self::IDENT, $name ) !== 1 ) {
			throw Refused::rule( 'F3001', $at, "\"$name\" isn't a valid field name; use letters, digits, and underscores, starting with a letter" );
		}
		if ( $depth > 1 && 'blocks' === $type ) {
			throw Refused::rule( 'F3001', $at, "blocks() isn't allowed inside a group, repeater, or blocks field (`$name`)" );
		}
		if ( in_array( $type, array( 'group', 'repeater', 'blocks' ), true ) && $depth > self::MAX_NESTING ) {
			throw Refused::rule( 'F3001', $at, "`$name` nests too deep: group and repeater fields go at most " . self::MAX_NESTING . ' levels deep' );
		}
		$rules = $field['rules'] ?? array();
		if ( isset( $rules['min'], $rules['max'] ) && $rules['min'] > $rules['max'] ) {
			throw Refused::rule( 'F3001', $at, "`$name` has `.min({$rules['min']})` larger than `.max({$rules['max']})`" );
		}
		if ( isset( $field['default'] ) && array_key_exists( 'value', $field['default'] ) ) {
			self::check_default( $name, $field, $at );
		}
		foreach ( $field['fields'] ?? array() as $sub => &$def ) {
			self::check( (string) $sub, $def, "$at.$sub", $depth + 1 );
		}
		unset( $def );
		foreach ( $field['layouts'] ?? array() as $layout => &$subs ) {
			if ( preg_match( self::IDENT, (string) $layout ) !== 1 ) {
				throw Refused::rule( 'F3001', $at, "\"$layout\" isn't a valid layout name" );
			}
			foreach ( $subs as $sub => &$def ) {
				if ( 'layout' === $sub ) {
					throw Refused::rule( 'F3001', "$at.$layout", "`layout` is reserved in blocks items (layout `$layout`)" );
				}
				self::check( (string) $sub, $def, "$at.$layout.$sub", $depth + 1 );
			}
			unset( $def );
		}
		unset( $subs );
		if ( array_key_exists( 'ui', $field ) ) {
			$field['ui'] = self::ui( $field['ui'], $at );
		}
	}

	/** `check_value` in `src/extract.rs`, for the single values a stored default holds. */
	private static function check_default( string $name, array $field, string $at ): void {
		$value = $field['default']['value'];
		$shown = is_string( $value ) ? '"' . $value . '"' : Js::str( $value );
		$bad   = static fn ( string $what ): Refused => Refused::rule( 'F3001', $at, "`$name` defaults to $shown, but it's $what" );
		match ( $field['type'] ) {
			'integer' => is_int( $value ) || ( is_float( $value ) && is_finite( $value ) && $value === floor( $value ) ) ? true : throw $bad( 'an integer field' ), // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
			'real' => is_int( $value ) || ( is_float( $value ) && is_finite( $value ) ) ? true : throw $bad( 'a number field' ),
			'boolean' => is_bool( $value ) ? true : throw $bad( 'a boolean field' ),
			'text' => match ( true ) {
				! is_string( $value ) => throw $bad( 'a text field' ),
				isset( $field['enum'] ) && ! in_array( $value, $field['enum'], true ) => throw Refused::rule( 'F3001', $at, "`$name` defaults to \"$value\", which isn't one of " . implode( ', ', $field['enum'] ) ),
				default => true,
			},
			'email', 'url', 'richText' => is_string( $value ) ? true : throw $bad( "a {$field['type']} field" ),
			'date', 'timestamp' => is_string( $value ) && self::dated( $field['type'], $value ) ? true
				: throw $bad( 'date' === $field['type'] ? 'a date field (use "YYYY-MM-DD")' : 'a timestamp field (use an ISO string like "2026-01-31T09:00:00Z")' ),
			'json' => true,
			'group' => throw $bad( 'a group field' ),
			default => throw $bad( 'a list field' ),
		};
	}

	/** The runtime's own codec decides what a date or timestamp is; the compiler follows it. */
	private static function dated( string $type, string $value ): bool {
		try {
			Schema::normalize( array( 'type' => $type ), $value, 'default', '' );

			return true;
		} catch ( \SpacePress\HttpError ) {
			return false;
		}
	}

	/** `.ui()`: presentation only. Returns it with keys in the compiler's order. */
	private static function ui( mixed $ui, string $at ): array {
		if ( ! is_array( $ui ) || array_is_list( $ui ) ) {
			throw Refused::rule( 'F3101', $at, '`ui` is an object with label, help, placeholder and width' );
		}
		$out = array();
		foreach ( $ui as $key => $_ ) {
			if ( ! in_array( $key, array( 'label', 'help', 'placeholder', 'width' ), true ) ) {
				throw Refused::rule( 'F3101', $at, "ui has no option `$key`; use label, help, placeholder, width" );
			}
		}
		foreach ( array( 'label', 'help', 'placeholder' ) as $key ) {
			if ( array_key_exists( $key, $ui ) ) {
				$out[ $key ] = is_string( $ui[ $key ] ) ? $ui[ $key ] : throw Refused::rule( 'F3101', $at, "ui `$key` must be a string" );
			}
		}
		if ( array_key_exists( 'width', $ui ) ) {
			$width = $ui['width'];
			if ( ! ( is_int( $width ) || ( is_float( $width ) && $width === floor( $width ) ) ) || $width < 1 || $width > 100 ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
				throw Refused::rule( 'F3101', $at, 'ui width must be an integer from 1 to 100' );
			}
			$out['width'] = (int) $width;
		}

		return $out;
	}

	/** A number as the compiler stores it: an integer when it is one. */
	private static function number( int|float $n ): int|float {
		return is_float( $n ) && $n === floor( $n ) && abs( $n ) <= 9007199254740991 && ! ( 0.0 === $n && fdiv( 1, $n ) < 0 ) ? (int) $n : $n; // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
	}
}
