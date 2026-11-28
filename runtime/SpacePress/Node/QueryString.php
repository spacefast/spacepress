<?php
declare(strict_types=1);
namespace SpacePress\Node;

use SpacePress\Js;
use SpacePress\JsArray;
use SpacePress\JsBigInt;
use SpacePress\JsObject;
use SpacePress\JsText;
use SpacePress\JsUndefined;

/** The legacy Node querystring module uses a null-prototype object and keeps repeated keys. */
final class QueryString {
	public static function exports(): array {
		$parse     = self::parse( ... );
		$stringify = self::stringify( ... );
		return array(
			'parse'     => $parse,
			'decode'    => $parse,
			'stringify' => $stringify,
			'encode'    => $stringify,
			'escape'    => self::escape( ... ),
			'unescape'  => self::unescape( ... ),
		);
	}

	private static function delimiter( mixed $value, string $fallback ): string {
		return Js::truthy( $value ) ? Js::str( $value ) : $fallback;
	}

	private static function parse( mixed $query = JsUndefined::Value, mixed $sep = JsUndefined::Value, mixed $eq = JsUndefined::Value, mixed $options = JsUndefined::Value ): JsObject {
		$pairs = new JsObject( array(), null, true );
		if ( ! is_string( $query ) || '' === $query ) {
			return $pairs;
		}
		$separator   = str_split( self::utf16( self::delimiter( $sep, '&' ) ), 2 );
		$assignment  = str_split( self::utf16( self::delimiter( $eq, '=' ) ), 2 );
		$sep_length  = count( $separator );
		$eq_length   = count( $assignment );
		$max         = Js::isNullish( $options ) ? JsUndefined::Value : Js::dynamicGet( $options, 'maxKeys' );
		$remaining   = is_int( $max ) || is_float( $max ) ? ( $max > 0 ? $max : -1 ) : 1000;
		$query       = self::utf16( $query );
		$length      = strlen( $query );
		$start       = 0;
		$sep_match   = 0;
		$eq_match    = 0;
		$percent_run = 0;
		$fields      = array( '', '' );
		$encoded     = array( false, false );

		for ( $i = 0; $i < $length; $i += 2 ) {
			$unit = substr( $query, $i, 2 );
			if ( ( $separator[ $sep_match ] ?? null ) === $unit ) {
				++$sep_match;
				if ( $sep_match === $sep_length ) {
					$end   = $i + 2 - $sep_match * 2;
					$field = (int) ( $eq_match === $eq_length );
					if ( $start < $end ) {
						$fields[ $field ] .= substr( $query, $start, $end - $start );
					}
					if ( 1 === $field || '' !== $fields[0] ) {
						self::put_pair( $pairs, $fields, $encoded );
					}
					--$remaining;
					if ( 0.0 === (float) $remaining ) {
						return $pairs;
					}
					$start       = $i + 2;
					$sep_match   = 0;
					$eq_match    = 0;
					$percent_run = 0;
					$fields      = array( '', '' );
					$encoded     = array( false, false );
				}
				continue;
			}
			// Pair separators take precedence. A failed partial match discards progress instead of
			// reconsidering the preceding character as the start of another separator.
			$sep_match = 0;
			$field     = (int) ( $eq_match === $eq_length );
			if ( 0 === $field ) {
				if ( ( $assignment[ $eq_match ] ?? null ) === $unit ) {
					++$eq_match;
					if ( $eq_match === $eq_length ) {
						$end = $i + 2 - $eq_match * 2;
						if ( $start < $end ) {
							$fields[0] .= substr( $query, $start, $end - $start );
						}
						$start       = $i + 2;
						$percent_run = 0;
					}
					continue;
				}
				$eq_match = 0;
			}
			if ( "+\0" === $unit ) {
				$fields[ $field ] .= substr( $query, $start, $i - $start ) . " \0";
				$start             = $i + 2;
			}
			if ( ! $encoded[ $field ] ) {
				$percent_run = match ( true ) {
					"%\0" === $unit => 1,
					$percent_run > 0 && "\0" === $unit[1] && ctype_xdigit( $unit[0] ) => $percent_run + 1,
					default => 0,
				};
				$encoded[ $field ] = 3 === $percent_run;
			}
		}
		if ( $start < $length ) {
			$field = (int) ( $eq_match === $eq_length );
			if ( 0 === $field || $sep_match < $sep_length ) {
				$fields[ $field ] .= substr( $query, $start );
			}
		} elseif ( 0 === $eq_match && '' === $fields[0] ) {
			return $pairs;
		}
		self::put_pair( $pairs, $fields, $encoded );
		return $pairs;
	}

	private static function utf16( string $value ): string {
		return mb_convert_encoding( $value, 'UTF-16LE', 'UTF-8' );
	}

	private static function put_pair( JsObject $pairs, array $fields, array $encoded ): void {
		$key      = mb_convert_encoding( $fields[0], 'UTF-8', 'UTF-16LE' );
		$value    = mb_convert_encoding( $fields[1], 'UTF-8', 'UTF-16LE' );
		$key      = $encoded[0] ? self::unescape( $key ) : $key;
		$value    = $encoded[1] ? self::unescape( $value ) : $value;
		$previous = $pairs->p[ $key ] ?? null;
		if ( $previous instanceof JsArray ) {
			$previous->a[] = $value;
		} else {
			$pairs->p[ $key ] = null === $previous ? $value : new JsArray( array( $previous, $value ) );
		}
	}

	private static function stringify( mixed $value = JsUndefined::Value, mixed $sep = JsUndefined::Value, mixed $eq = JsUndefined::Value ): string {
		if ( ! $value instanceof JsObject && ! $value instanceof JsArray ) {
			return '';
		}
		$sep   = self::delimiter( $sep, '&' );
		$eq    = self::delimiter( $eq, '=' );
		$pairs = array();
		foreach ( Js::dynamicKeys( $value )->a as $key ) {
			$item   = Js::dynamicGet( $value, $key );
			$prefix = self::escape( $key ) . $eq;
			foreach ( $item instanceof JsArray ? $item->a : array( $item ) as $element ) {
				$pairs[] = $prefix . self::escape( self::primitive( $element ) );
			}
		}
		return implode( $sep, $pairs );
	}

	private static function primitive( mixed $value ): string {
		return match ( true ) {
			is_string( $value ), is_bool( $value ), $value instanceof JsBigInt => Js::str( $value ),
			is_int( $value ), is_float( $value ) => is_finite( (float) $value ) ? Js::str( $value ) : '',
			default => '',
		};
	}

	private static function escape( mixed $value = JsUndefined::Value ): string {
		return strtr(
			rawurlencode( Js::str( $value ) ),
			array(
				'%21' => '!',
				'%27' => "'",
				'%28' => '(',
				'%29' => ')',
				'%2A' => '*',
			)
		);
	}

	private static function unescape( mixed $value = JsUndefined::Value ): string {
		return JsText::decode( rawurldecode( Js::str( $value ) ), false, true );
	}
}
