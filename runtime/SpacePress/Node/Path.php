<?php
declare(strict_types=1);
namespace SpacePress\Node;

use SpacePress\Js;
use SpacePress\JsArray;
use SpacePress\JsError;
use SpacePress\JsObject;
use SpacePress\JsUndefined;

/** POSIX path manipulation with a virtual working directory of "/". */
final class Path {
	public static function exports(): array {
		return array(
			'join'             => self::join( ... ),
			'resolve'          => self::resolve( ... ),
			'normalize'        => self::normalize( ... ),
			'relative'         => self::relative( ... ),
			'dirname'          => self::dirname( ... ),
			'basename'         => self::basename( ... ),
			'extname'          => self::extname( ... ),
			'isAbsolute'       => static fn ( mixed $path = JsUndefined::Value ): bool => str_starts_with( self::string( $path ), '/' ),
			'parse'            => self::parse( ... ),
			'format'           => self::format( ... ),
			'sep'              => '/',
			'delimiter'        => ':',
			'posix'            => Module::get( 'path' ),
			'toNamespacedPath' => static fn ( mixed $path = JsUndefined::Value ): mixed => $path,
		);
	}

	private static function string( mixed $path, string $name = 'path' ): string {
		if ( ! is_string( $path ) ) {
			throw JsError::node( 'The "' . $name . '" argument must be of type string', 'TypeError', 'ERR_INVALID_ARG_TYPE' );
		}
		return $path;
	}

	/** @return list<string> */
	private static function components( string $path, bool $absolute ): array {
		$segments = array();
		foreach ( explode( '/', $path ) as $part ) {
			if ( '' === $part || '.' === $part ) {
				continue;
			}
			if ( '..' === $part ) {
				if ( $segments && '..' !== end( $segments ) ) {
					array_pop( $segments );
					continue;
				}
				if ( $absolute ) {
					continue;
				}
			}
			$segments[] = $part;
		}
		return $segments;
	}

	private static function normalize( mixed $path = JsUndefined::Value ): string {
		$path       = self::string( $path );
		$absolute   = str_starts_with( $path, '/' );
		$normalized = implode( '/', self::components( $path, $absolute ) );
		if ( $absolute && '' === $normalized ) {
			return '/';
		}
		if ( '' === $normalized ) {
			$normalized = '.';
		}
		return ( $absolute ? '/' : '' ) . $normalized . ( str_ends_with( $path, '/' ) ? '/' : '' );
	}

	private static function join( mixed ...$paths ): string {
		$paths = array_map( self::string( ... ), $paths );
		return self::normalize( implode( '/', array_filter( $paths, static fn ( string $path ): bool => '' !== $path ) ) );
	}

	private static function resolve( mixed ...$paths ): string {
		$parts = array();
		for ( $i = count( $paths ) - 1; $i >= 0; --$i ) {
			$path    = self::string( $paths[ $i ], "paths[$i]" );
			$parts[] = $path;
			if ( str_starts_with( $path, '/' ) ) {
				break;
			}
		}
		return '/' . implode( '/', self::components( implode( '/', array_reverse( $parts ) ), true ) );
	}

	private static function relative( mixed $from = JsUndefined::Value, mixed $to = JsUndefined::Value ): string {
		$from   = self::components( self::string( $from, 'from' ), true );
		$to     = self::components( self::string( $to, 'to' ), true );
		$common = 0;
		while ( isset( $from[ $common ], $to[ $common ] ) && $from[ $common ] === $to[ $common ] ) {
			++$common;
		}
		return implode( '/', array_merge( array_fill( 0, count( $from ) - $common, '..' ), array_slice( $to, $common ) ) );
	}

	private static function dirname( mixed $path = JsUndefined::Value ): string {
		$path = self::string( $path );
		$end  = strrpos( rtrim( $path, '/' ), '/' );
		if ( false === $end || 0 === $end ) {
			return str_starts_with( $path, '/' ) ? '/' : '.';
		}
		return 1 === $end && str_starts_with( $path, '/' ) ? '//' : substr( $path, 0, $end );
	}

	private static function basename( mixed $path = JsUndefined::Value, mixed $suffix = JsUndefined::Value ): string {
		$suffix    = JsUndefined::Value === $suffix ? '' : self::string( $suffix, 'suffix' );
		$path      = self::string( $path );
		$trimmed   = rtrim( $path, '/' );
		$separator = strrpos( $trimmed, '/' );
		$base      = false === $separator ? $trimmed : substr( $trimmed, $separator + 1 );
		if ( '' === $suffix || Js::length( $suffix ) > Js::length( $path ) ) {
			return $base;
		}
		if ( $suffix === $path ) {
			return '';
		}
		if ( strlen( $suffix ) < strlen( $base ) && str_ends_with( $base, $suffix ) ) {
			return substr( $base, 0, -strlen( $suffix ) );
		}
		// Node keeps the trailing separators if the suffix matches the whole name but is longer than it.
		return str_ends_with( $suffix, $base ) && strlen( $suffix ) > strlen( $base )
			? substr( $path, false === $separator ? 0 : $separator + 1 )
			: $base;
	}

	private static function extension( string $base ): string {
		$dot = strrpos( $base, '.' );
		return false === $dot || 0 === $dot || '..' === $base ? '' : substr( $base, $dot );
	}

	private static function extname( mixed $path = JsUndefined::Value ): string {
		return self::extension( self::basename( $path ) );
	}

	private static function parse( mixed $path = JsUndefined::Value ): JsObject {
		$path = self::string( $path );
		$root = str_starts_with( $path, '/' ) ? '/' : '';
		$end  = strrpos( rtrim( $path, '/' ), '/' );
		$base = self::basename( $path );
		// parse('/..') recognizes the final dot as an extension, whereas extname('/..') does not.
		$ext = '/' === $root && 0 === $end && '..' === $base ? '.' : self::extension( $base );
		return new JsObject(
			array(
				'root' => $root,
				'dir'  => false === $end || 0 === $end ? $root : substr( $path, 0, $end ),
				'base' => $base,
				'ext'  => $ext,
				'name' => '' === $ext ? $base : substr( $base, 0, -strlen( $ext ) ),
			)
		);
	}

	private static function format( mixed $path = JsUndefined::Value ): mixed {
		if ( ! is_object( $path ) || $path instanceof JsArray || 'object' !== Js::typeOf( $path ) ) {
			throw JsError::node( 'The "pathObject" argument must be of type object', 'TypeError', 'ERR_INVALID_ARG_TYPE' );
		}
		$root      = Js::dynamicGet( $path, 'root' );
		$directory = Js::dynamicGet( $path, 'dir' );
		$directory = Js::truthy( $directory ) ? $directory : $root;
		$base      = Js::dynamicGet( $path, 'base' );
		if ( ! Js::truthy( $base ) ) {
			$name      = Js::dynamicGet( $path, 'name' );
			$ext       = Js::dynamicGet( $path, 'ext' );
			$extension = Js::truthy( $ext ) ? Js::str( $ext ) : '';
			if ( '' !== $extension && ! str_starts_with( $extension, '.' ) ) {
				$extension = '.' . $extension;
			}
			$base = ( Js::truthy( $name ) ? Js::str( $name ) : '' ) . $extension;
		}
		if ( ! Js::truthy( $directory ) ) {
			return $base;
		}
		return Js::str( $directory ) . ( $directory === $root ? '' : '/' ) . Js::str( $base );
	}
}
