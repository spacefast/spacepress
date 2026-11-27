<?php

declare(strict_types=1);

namespace SpacePress\Media;

use SpacePress\HttpError;

/**
 * Named image sizes (phase 2 §7.2): WpMedia's renditions use core's image_resize_dimensions() (its
 * rounding, no upscaling and resize filters), with the crop origin moved to the focal point when
 * one is set.
 */
final class Images {

	/** Formats GD and WordPress both resize. SVG, AVIF and animated GIFs get no sizes. */
	public const RESIZABLE = array( 'image/jpeg', 'image/png', 'image/gif', 'image/webp' );

	/**
	 * The resize rectangle in core's shape: [dst_x, dst_y, src_x, src_y, dst_w, dst_h, src_w, src_h],
	 * or null when core would make no file (larger than the original, or within 1px of it): the
	 * size is then the original.
	 *
	 * @param ?array{x: float|int, y: float|int} $focal 0..1 from the top-left; null = core's centre
	 * @return ?list<int>
	 */
	public static function dimensions( int $origW, int $origH, int $w, ?int $h, bool $crop, ?array $focal = null ): ?array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$dims = image_resize_dimensions( $origW, $origH, $w, $h ?? 0, $crop ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		if ( ! is_array( $dims ) ) {
			return null;
		}
		$dims = array_map( 'intval', array_values( $dims ) );
		if ( $crop && null !== $focal ) {
			$dims[2] = self::origin( (float) $focal['x'], $origW, $dims[6] ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$dims[3] = self::origin( (float) $focal['y'], $origH, $dims[7] ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		}

		return $dims;
	}

	/** x0 = clamp(focal * W - w/2, 0, W - w). */
	private static function origin( float $focal, int $full, int $crop ): int {
		return (int) max( 0, min( $full - $crop, round( $focal * $full - $crop / 2 ) ) );
	}

	/** True when $path is a still image in a format WpMedia resizes. */
	public static function resizable( string $path, string $mime ): bool {
		return in_array( $mime, self::RESIZABLE, true ) && ! ( 'image/gif' === $mime && self::animated( $path ) );
	}

	/** More than one image descriptor, walking the GIF block structure. */
	private static function animated( string $path ): bool {
		$b = (string) @file_get_contents( $path );
		$n = strlen( $b );
		if ( $n < 13 || ! str_starts_with( $b, 'GIF' ) ) {
			return false;
		}
		$flags  = ord( $b[10] );
		$i      = 13 + ( ( $flags & 0x80 ) ? 3 << ( ( $flags & 7 ) + 1 ) : 0 );
		$frames = 0;
		$skip   = static function ( int $i ) use ( $b, $n ): int {
			while ( $i < $n && ( $len = ord( $b[ $i ] ) ) !== 0 ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.FoundInWhileCondition -- Keep the assignment and its test together.
				$i += $len + 1;
			}

			return $i + 1;
		};
		while ( $i < $n ) {
			$block = ord( $b[ $i ] );
			if ( 0x2C === $block ) {
				if ( ++$frames > 1 ) {
					return true;
				}
				$local = $i + 9 < $n ? ord( $b[ $i + 9 ] ) : 0;
				$i    += 10 + ( ( $local & 0x80 ) ? 3 << ( ( $local & 7 ) + 1 ) : 0 );
				$i     = $skip( $i + 1 );
			} elseif ( 0x21 === $block ) {
				$i = $skip( $i + 2 );
			} else {
				break;
			}
		}

		return false;
	}

	/** Validate a focal point from request input: {x, y} in 0..1, or null. */
	public static function focal( mixed $v ): ?array {
		if ( null === $v ) {
			return null;
		}
		if ( ! is_array( $v ) || array_is_list( $v ) && array() !== $v ) {
			throw HttpError::invalidInput( 'focal must be an object { x, y } or null', '/focal' );
		}
		foreach ( $v as $key => $_ ) {
			if ( 'x' !== $key && 'y' !== $key ) {
				throw HttpError::invalidInput( "Unknown field '$key'", '/focal/' . $key );
			}
		}
		$out = array();
		foreach ( array( 'x', 'y' ) as $axis ) {
			$n = $v[ $axis ] ?? null;
			if ( ! ( is_int( $n ) || is_float( $n ) ) || ! is_finite( (float) $n ) || $n < 0 || $n > 1 ) {
				throw HttpError::invalidInput( "focal.$axis must be a number from 0 to 1", "/focal/$axis" );
			}
			$out[ $axis ] = is_int( $n ) ? $n : (float) $n;
		}

		return $out;
	}
}
