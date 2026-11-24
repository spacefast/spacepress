<?php

declare(strict_types=1);

namespace SpacePress\RuntimeSchema;

/**
 * Where a field's values are stored, as patterns, so two fields of one kind can be checked for a
 * shared storage key (spec §2.10). The same rule is in `src/runtime_schema.rs` (`storage_keys`);
 * the corpus holds the two to one answer.
 *
 * Secure Custom Fields stores a field named `seo` under the key `seo` and a group's sub-field
 * `title` under `seo_title`. A repeater or blocks field `links` keeps its row count under `links`
 * and each row's sub-field `href` under `links_<n>_href` for every row number n. Every key also has a
 * reference copy under the same key with a leading `_`, which collides exactly when the plain key
 * does, so it needs no pattern of its own. A blocks field `page` also keeps a record of its layouts
 * under `_page_layout_meta` alone, so `page_layout_meta` is one of its keys. A collection's keys
 * carry the post type's meta prefix and a global's its option prefix; both are the same for every
 * field of one kind, so the check works on the field names alone.
 *
 * Keys are compared without regard to case: MySQL compares meta keys and option names with
 * WordPress's case-insensitive collation, so `Rating` and `rating` are one row.
 *
 * A pattern is a list of parts: a string is literal text, null stands for one row number (one or
 * more digits), and true, always last, for any text at all.
 */
final class StorageKeys {

	/** @return list<list<?string>> */
	public static function of( string $name, array $definition ): array {
		$out = array( array( $name ) );
		if ( 'blocks' === $definition['type'] ) {
			$out[] = array( $name . '_layout_meta' );
		}
		foreach ( self::nested( $definition ) as $sub => $sub_definition ) {
			foreach ( self::of( (string) $sub, $sub_definition ) as $pattern ) {
				$out[] = in_array( $definition['type'], array( 'repeater', 'blocks' ), true )
					? array( $name . '_', null, '_' . $pattern[0], ...array_slice( $pattern, 1 ) )
					: array( $name . '_' . $pattern[0], ...array_slice( $pattern, 1 ) );
			}
		}

		return array_map( self::joined( ... ), $out );
	}

	/**
	 * The keys of a field known only by name and type: one a version removed, or one a build that
	 * ran on the site declared. A group, repeater or blocks field's sub-fields aren't recorded, so
	 * every key that starts with its name and `_` counts as its.
	 *
	 * @return list<list<?string|true>>
	 */
	public static function ofType( string $name, string $type ): array {
		return in_array( $type, array( 'group', 'repeater', 'blocks' ), true ) ? array( array( $name ), array( $name . '_', true ) ) : array( array( $name ) );
	}

	/** The sub-fields a field stores under its own key: a group's or repeater's fields, every layout's for blocks. */
	private static function nested( array $definition ): array {
		$out = $definition['fields'] ?? array();
		foreach ( $definition['layouts'] ?? array() as $fields ) {
			$out += $fields;
		}

		return $out;
	}

	/** Adjacent literal parts as one, so two patterns compare part by part. */
	private static function joined( array $pattern ): array {
		$out = array();
		foreach ( $pattern as $part ) {
			if ( null !== $part && array() !== $out && end( $out ) !== null ) {
				$out[ count( $out ) - 1 ] .= $part;
			} else {
				$out[] = $part;
			}
		}

		return $out;
	}

	/**
	 * The first key two fields would both store under, as a readable example, or null when none.
	 *
	 * @param list<list<?string>> $a
	 * @param list<list<?string>> $b
	 */
	public static function shared( array $a, array $b ): ?string {
		foreach ( $a as $left ) {
			foreach ( $b as $right ) {
				$key = self::overlap( $left, $right );
				if ( null !== $key ) {
					return $key;
				}
			}
		}

		return null;
	}

	/** One key both patterns match, or null. Row numbers stand for digits; an example uses 0. */
	private static function overlap( array $left, array $right ): ?string {
		return self::match( self::chars( $left ), self::chars( $right ), '' );
	}

	/** A pattern as single lower-case characters, with null for a row number and true for any text. */
	private static function chars( array $pattern ): array {
		$out = array();
		foreach ( $pattern as $part ) {
			if ( null === $part || true === $part ) {
				$out[] = $part;
			} else {
				array_push( $out, ...str_split( strtolower( $part ) ) );
			}
		}

		return $out;
	}

	/** Both character patterns can produce one string: a row number matches one or more digits. */
	private static function match( array $a, array $b, string $so ): ?string {
		if ( array() === $a && array() === $b ) {
			return $so;
		}
		if ( array() === $a || array() === $b ) {
			return null;
		}
		[$x, $y] = array( $a[0], $b[0] );
		if ( true === $x || true === $y ) {
			// Any text: the other pattern's rest, with 0 for a row number.
			return $so . implode( '', array_map( static fn ( mixed $c ): string => is_string( $c ) ? $c : '0', true === $x ? $b : $a ) );
		}
		if ( null === $x && null === $y ) {
			return self::match( array_slice( $a, 1 ), array_slice( $b, 1 ), $so . '0' );
		}
		if ( null === $x || null === $y ) {
			// A row number against literal text: it takes one or more of the text's digits.
			[$number, $text, $number_first] = null === $x ? array( $a, $b, true ) : array( $b, $a, false );
			for ( $i = 0; $i < count( $text ) && is_string( $text[ $i ] ) && ctype_digit( $text[ $i ] ); $i++ ) {
				$rest  = array_slice( $text, $i + 1 );
				$found = $number_first ? self::match( array_slice( $number, 1 ), $rest, $so . implode( '', array_slice( $text, 0, $i + 1 ) ) )
					: self::match( $rest, array_slice( $number, 1 ), $so . implode( '', array_slice( $text, 0, $i + 1 ) ) );
				if ( null !== $found ) {
					return $found;
				}
			}

			return null;
		}

		return $x === $y ? self::match( array_slice( $a, 1 ), array_slice( $b, 1 ), $so . $x ) : null;
	}
}
