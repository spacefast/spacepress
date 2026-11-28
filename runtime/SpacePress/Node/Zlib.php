<?php

declare(strict_types=1);

namespace SpacePress\Node;

use SpacePress\Js;
use SpacePress\JsError;
use SpacePress\JsJobs;
use SpacePress\JsObject;
use SpacePress\JsTypedArray;
use SpacePress\JsUndefined;

/** The Buffer-to-Buffer compression and decompression exports of node:zlib. */
final class Zlib {

	private const MAX_OUTPUT = 16 * 1024 * 1024;
	// Bound the temporary output of inflate_add, which has no max-length parameter.
	private const INPUT_CHUNK = 4 * 1024;

	/** @return array<string, mixed> */
	public static function exports(): array {
		$exports = array(
			'constants' => new JsObject(
				array(
					'Z_NO_COMPRESSION'      => 0,
					'Z_BEST_SPEED'          => 1,
					'Z_BEST_COMPRESSION'    => 9,
					'Z_DEFAULT_COMPRESSION' => -1,
					'Z_DEFAULT_STRATEGY'    => 0,
					'Z_FILTERED'            => 1,
					'Z_HUFFMAN_ONLY'        => 2,
					'Z_RLE'                 => 3,
					'Z_FIXED'               => 4,
				)
			),
		);
		foreach ( array( 'gzip', 'gunzip', 'deflate', 'inflate', 'deflateRaw', 'inflateRaw', 'unzip' ) as $mode ) {
			$exports[ $mode . 'Sync' ] = static fn ( mixed $input = JsUndefined::Value, mixed $options = JsUndefined::Value ): JsTypedArray
				=> self::run( $mode, self::options( $mode, $options ), Buffer::bytes( $input, 'buffer' ) );
			$exports[ $mode ]          = static fn ( mixed $input = JsUndefined::Value, mixed $options = JsUndefined::Value, mixed $callback = JsUndefined::Value ): JsUndefined
				=> self::callback( $mode, $input, $options, $callback );
		}
		return $exports;
	}

	private static function callback( string $mode, mixed $input, mixed $options, mixed $callback ): JsUndefined {
		if ( $options instanceof \Closure ) {
			$callback = $options;
			$options  = JsUndefined::Value;
		}
		$config = self::options( $mode, $options );
		if ( ! $callback instanceof \Closure ) {
			throw JsError::node( 'The "callback" argument must be of type function', 'TypeError', 'ERR_INVALID_ARG_TYPE' );
		}
		$bytes = Buffer::bytes( $input, 'buffer' );
		JsJobs::enqueue(
			static function () use ( $mode, $bytes, $config, $callback ): void {
				try {
					$result = self::run( $mode, $config, $bytes );
				} catch ( JsError $error ) {
					$callback( Js::thrownValue( $error ) );
					return;
				}
				$callback( null, $result );
			}
		);
		return JsUndefined::Value;
	}

	/** @return array{window: int, level: int, memory: int, strategy: int, limit: int} */
	private static function options( string $mode, mixed $options ): array {
		$props  = $options instanceof JsObject ? $options->p : array();
		$window = $props['windowBits'] ?? null;
		if ( ( 0 === $window || 0.0 === $window ) && \in_array( $mode, array( 'inflate', 'gunzip', 'unzip' ), true ) ) {
			$window = null;
		}
		$min_window  = 'gzip' === $mode ? 9 : 8;
		$window_bits = self::number_option( 'windowBits', $window, $min_window, 15, 15 );
		if ( 'deflateRaw' === $mode && ( 8 === $window || 8.0 === $window ) ) {
			// Node lifts an exact 8 to 9 so the zlib window is valid for raw deflation.
			$window_bits = 9;
		}
		return array(
			'window'   => $window_bits,
			'level'    => self::number_option( 'level', $props['level'] ?? null, -1, 9, -1 ),
			'memory'   => self::number_option( 'memLevel', $props['memLevel'] ?? null, 1, 9, 8 ),
			'strategy' => self::number_option( 'strategy', $props['strategy'] ?? null, 0, 4, 0 ),
			'limit'    => \min( self::MAX_OUTPUT, self::number_option( 'maxOutputLength', $props['maxOutputLength'] ?? null, 1, Buffer::MAX_LENGTH, self::MAX_OUTPUT ) ),
		);
	}

	private static function number_option( string $name, mixed $value, int $min, int $max, int $fallback ): int {
		if ( null === $value || JsUndefined::Value === $value ) {
			return $fallback;
		}
		if ( ! \is_int( $value ) && ! \is_float( $value ) ) {
			throw JsError::node( "The \"options.$name\" property must be of type number", 'TypeError', 'ERR_INVALID_ARG_TYPE' );
		}
		if ( ! \is_finite( $value ) ) {
			return $fallback;
		}
		if ( $value < $min || $value > $max ) {
			throw JsError::node( "The value of \"options.$name\" must be between $min and $max", 'RangeError', 'ERR_OUT_OF_RANGE' );
		}
		return (int) $value;
	}

	private static function run( string $mode, array $options, string $bytes ): JsTypedArray {
		if ( ! \extension_loaded( 'zlib' ) ) {
			throw JsError::node( 'node:zlib requires the PHP zlib extension', 'Error', 'Z_STREAM_ERROR' );
		}
		$format = match ( $mode ) {
			'gzip', 'gunzip' => ZLIB_ENCODING_GZIP,
			'deflateRaw', 'inflateRaw' => ZLIB_ENCODING_RAW,
			'unzip' => \str_starts_with( $bytes, "\x1f\x8b" ) ? ZLIB_ENCODING_GZIP : ZLIB_ENCODING_DEFLATE,
			default => ZLIB_ENCODING_DEFLATE,
		};
		$limit = $options['limit'];
		unset( $options['limit'] );
		$result = \in_array( $mode, array( 'gzip', 'deflate', 'deflateRaw' ), true )
			? self::deflate( $bytes, $format, $options, $limit )
			: self::inflate( $bytes, $format, $options['window'], $limit );
		return Buffer::wrap( $result );
	}

	private static function deflate( string $bytes, int $format, array $options, int $limit ): string {
		$context = @\deflate_init( $format, $options ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- Return zlib errors to JavaScript.
		if ( false === $context ) {
			throw JsError::node( 'Could not initialize compression', 'Error', 'Z_STREAM_ERROR' );
		}
		$result = '';
		$length = \strlen( $bytes );
		for ( $offset = 0; ; $offset += self::INPUT_CHUNK ) {
			$last  = $offset + self::INPUT_CHUNK >= $length;
			$chunk = @\deflate_add( $context, \substr( $bytes, $offset, self::INPUT_CHUNK ), $last ? ZLIB_FINISH : ZLIB_NO_FLUSH ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- Return zlib errors to JavaScript.
			if ( false === $chunk ) {
				throw JsError::node( 'Could not compress data', 'Error', 'Z_STREAM_ERROR' );
			}
			self::append( $result, $chunk, $limit );
			if ( $last ) {
				break;
			}
		}
		if ( ZLIB_ENCODING_GZIP === $format ) {
			// The gzip OS field depends on the zlib build. Node's gzip writes Unix (3).
			$result[9] = "\x03";
		}
		return $result;
	}

	private static function inflate( string $bytes, int $format, int $window, int $limit ): string {
		$result  = '';
		$offset  = 0;
		$length  = \strlen( $bytes );
		$context = self::inflate_context( $format, $window );
		while ( true ) {
			$read_before = \inflate_get_read_len( $context );
			$last        = $offset + self::INPUT_CHUNK >= $length;
			$chunk       = @\inflate_add( $context, \substr( $bytes, $offset, self::INPUT_CHUNK ), $last ? ZLIB_FINISH : ZLIB_SYNC_FLUSH ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- Return zlib errors to JavaScript.
			$status      = \inflate_get_status( $context );
			if ( false === $chunk ) {
				throw match ( $status ) {
					ZLIB_BUF_ERROR => self::unexpected_end(),
					ZLIB_NEED_DICT => JsError::node( 'Missing dictionary', 'Error', 'Z_NEED_DICT' ),
					default => JsError::node( 'Invalid compressed data', 'Error', 'Z_DATA_ERROR' ),
				};
			}
			self::append( $result, $chunk, $limit );
			$read    = \inflate_get_read_len( $context ) - $read_before;
			$offset += $read;
			if ( ZLIB_STREAM_END === $status ) {
				// gzip accepts multiple members and ignores anything after a zero byte.
				if ( ZLIB_ENCODING_GZIP !== $format || $offset >= $length || "\0" === $bytes[ $offset ] ) {
					return $result;
				}
				$context = self::inflate_context( $format, $window );
			} elseif ( $last || 0 === $read ) {
				throw self::unexpected_end();
			}
		}
	}

	private static function inflate_context( int $format, int $window ): \InflateContext {
		$context = @\inflate_init( $format, array( 'window' => $window ) ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- Return zlib errors to JavaScript.
		if ( false === $context ) {
			throw JsError::node( 'Could not initialize decompression', 'Error', 'Z_STREAM_ERROR' );
		}
		return $context;
	}

	private static function append( string &$result, string $chunk, int $limit ): void {
		if ( \strlen( $result ) + \strlen( $chunk ) > $limit ) {
			throw JsError::node( "Cannot create a Buffer larger than $limit bytes", 'RangeError', 'ERR_BUFFER_TOO_LARGE' );
		}
		$result .= $chunk;
	}

	private static function unexpected_end(): JsError {
		return JsError::node( 'unexpected end of file', 'Error', 'Z_BUF_ERROR' );
	}
}
