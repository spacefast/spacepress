<?php

declare(strict_types=1);

namespace SpacePress\Node;

use SpacePress\Crypto as Limits;
use SpacePress\HttpError;
use SpacePress\Js;
use SpacePress\JsArray;
use SpacePress\JsArrayBuffer;
use SpacePress\JsDataView;
use SpacePress\JsError;
use SpacePress\JsJobs;
use SpacePress\JsObject;
use SpacePress\JsTypedArray;
use SpacePress\JsUndefined;

/** Node crypto exports implemented by PHP's hash and random extensions. */
final class Crypto {
	private const HASHES           = array(
		'md5'        => 'md5',
		'sha1'       => 'sha1',
		'sha224'     => 'sha224',
		'sha256'     => 'sha256',
		'sha384'     => 'sha384',
		'sha512'     => 'sha512',
		'sha512-224' => 'sha512/224',
		'sha512-256' => 'sha512/256',
		'sha3-256'   => 'sha3-256',
		'sha3-384'   => 'sha3-384',
		'sha3-512'   => 'sha3-512',
	);
	private const MAX_KDF_ROUNDS   = 1000000;
	private const MAX_SAFE_INTEGER = 9007199254740991;

	public static function exports(): array {
		$webcrypto = Module::get( 'webcrypto' );
		return array(
			'webcrypto'       => $webcrypto,
			'subtle'          => $webcrypto->member( 'subtle' ),
			'createHash'      => static fn ( mixed $algorithm = JsUndefined::Value ): Hash
				=> new Hash( self::digest_name( $algorithm ) ),
			'createHmac'      => static fn ( mixed $algorithm = JsUndefined::Value, mixed $key = JsUndefined::Value ): Hash
				=> new Hash( self::digest_name( $algorithm, true ), self::key( $key ), true ),
			'hash'            => self::one_shot_hash( ... ),
			'randomBytes'     => self::random_bytes_export( ... ),
			'randomInt'       => self::random_int_export( ... ),
			'randomFillSync'  => self::random_fill( ... ),
			'randomUUID'      => self::random_uuid( ... ),
			'getRandomValues' => self::get_random_values( ... ),
			'timingSafeEqual' => self::timing_safe_equal( ... ),
			'pbkdf2Sync'      => self::pbkdf2( ... ),
			'pbkdf2'          => static function ( mixed $password = JsUndefined::Value, mixed $salt = JsUndefined::Value, mixed $iterations = JsUndefined::Value, mixed $length = JsUndefined::Value, mixed $digest = JsUndefined::Value, mixed $callback = JsUndefined::Value ): JsUndefined {
				self::require_callback( $callback );
				return self::callback( $callback, self::pbkdf2( $password, $salt, $iterations, $length, $digest ) );
			},
			'hkdfSync'        => self::hkdf( ... ),
			'hkdf'            => static function ( mixed $digest = JsUndefined::Value, mixed $key = JsUndefined::Value, mixed $salt = JsUndefined::Value, mixed $info = JsUndefined::Value, mixed $length = JsUndefined::Value, mixed $callback = JsUndefined::Value ): JsUndefined {
				self::require_callback( $callback );
				return self::callback( $callback, self::hkdf( $digest, $key, $salt, $info, $length ) );
			},
			'getHashes'       => static fn (): JsArray => new JsArray( array_keys( self::HASHES ) ),
			'constants'       => new JsObject(
				array(
					'RSA_PKCS1_PADDING'        => Sign::PKCS1_PADDING,
					'RSA_NO_PADDING'           => Sign::NO_PADDING,
					'RSA_PKCS1_OAEP_PADDING'   => Sign::OAEP_PADDING,
					'RSA_PKCS1_PSS_PADDING'    => Sign::PSS_PADDING,
					'RSA_PSS_SALTLEN_DIGEST'   => Sign::PSS_SALTLEN_DIGEST,
					'RSA_PSS_SALTLEN_MAX_SIGN' => Sign::PSS_SALTLEN_AUTO,
					'RSA_PSS_SALTLEN_AUTO'     => Sign::PSS_SALTLEN_AUTO,
				)
			),
		);
	}

	private static function one_shot_hash( mixed $algorithm = JsUndefined::Value, mixed $data = JsUndefined::Value, mixed $encoding = JsUndefined::Value ): mixed {
		if ( JsUndefined::Value === $encoding ) {
			$encoding = 'hex';
		}
		if ( 'buffer' !== $encoding && null === Buffer::encoding( $encoding ) ) {
			throw JsError::node( 'Invalid outputEncoding', 'TypeError', 'ERR_INVALID_ARG_VALUE' );
		}
		return ( new Hash( self::digest_name( $algorithm ) ) )->update( $data )->digest( $encoding );
	}

	private static function digest_name( mixed $algorithm, bool $hmac = false ): string {
		if ( ! is_string( $algorithm ) ) {
			throw self::argument_type( 'algorithm', 'string' );
		}
		$name = strtolower( $algorithm );
		$name = match ( $name ) {
			'sha-1' => 'sha1',
			'sha-224', 'sha2-224' => 'sha224',
			'sha-256', 'sha2-256' => 'sha256',
			'sha-384', 'sha2-384' => 'sha384',
			'sha-512', 'sha2-512' => 'sha512',
			default => $name,
		};
		if ( str_starts_with( $name, 'rsa-' ) ) {
			$name = substr( $name, 4 );
		}
		return self::HASHES[ $name ] ?? throw (
			$hmac
				? JsError::node( 'Invalid digest: ' . $algorithm, 'TypeError', 'ERR_CRYPTO_INVALID_DIGEST' )
				: new JsError( 'Digest method not supported', 'Error' )
		);
	}

	private static function key( mixed $value ): string {
		return self::bounded( $value instanceof KeyObject ? $value->secretBytes() : Buffer::bytes( $value, 'key' ) );
	}

	private static function bounded( string $bytes ): string {
		if ( strlen( $bytes ) > Limits::MAX_DATA ) {
			throw new HttpError( 413, 'crypto_input_too_large', 'The crypto input is too large.' );
		}
		return $bytes;
	}

	private static function random_bytes_export( mixed $size = JsUndefined::Value, mixed $callback = JsUndefined::Value ): mixed {
		// Node truncates fractional sizes before allocating.
		if ( ! is_int( $size ) && ! is_float( $size ) ) {
			throw self::argument_type( 'size', 'number' );
		}
		if ( is_nan( (float) $size ) || $size < 0 || $size > 2147483647 ) {
			throw self::out_of_range( 'size', 'between 0 and 2147483647' );
		}
		if ( $size > 1024 ) {
			throw new JsError( 'randomBytes takes 0 to 1024 bytes in SpacePress code', 'RangeError' );
		}
		if ( JsUndefined::Value !== $callback ) {
			self::require_callback( $callback );
		}
		$size  = (int) $size;
		$value = Buffer::wrap( 0 === $size ? '' : random_bytes( $size ) );
		return JsUndefined::Value === $callback ? $value : self::callback( $callback, $value );
	}

	private static function random_int_export( mixed $min = JsUndefined::Value, mixed $max = JsUndefined::Value, mixed $callback = JsUndefined::Value ): mixed {
		if ( JsUndefined::Value === $max || $max instanceof \Closure ) {
			$callback = $max;
			$max      = $min;
			$min      = 0;
		}
		$min = self::integer( $min, 'min', -self::MAX_SAFE_INTEGER, self::MAX_SAFE_INTEGER );
		$max = self::integer( $max, 'max', -self::MAX_SAFE_INTEGER, self::MAX_SAFE_INTEGER );
		if ( $max <= $min || $max - $min > 281474976710655 ) {
			throw self::out_of_range( 'max', 'greater than min by at most 2^48 - 1' );
		}
		if ( JsUndefined::Value !== $callback ) {
			self::require_callback( $callback );
		}
		$value = random_int( $min, $max - 1 );
		return JsUndefined::Value === $callback ? $value : self::callback( $callback, $value );
	}

	public static function random_uuid( mixed $options = JsUndefined::Value ): string {
		if ( JsUndefined::Value !== $options && ! $options instanceof JsObject ) {
			throw self::argument_type( 'options', 'object' );
		}
		return Limits::randomUUID();
	}

	public static function get_random_values( mixed $view = JsUndefined::Value ): JsTypedArray {
		if ( ! $view instanceof JsTypedArray || str_starts_with( $view->kind, 'Float' ) ) {
			throw new JsError( 'Expected an integer typed array', 'TypeMismatchError' );
		}
		if ( $view->byteLength() > 65536 ) {
			throw new JsError( 'The requested length exceeds 65,536 bytes', 'QuotaExceededError' );
		}
		self::random_fill( $view );
		return $view;
	}

	private static function random_fill( mixed $view = JsUndefined::Value, mixed $offset = 0, mixed $size = JsUndefined::Value ): mixed {
		[$buffer, $start, $length, $width] = match ( true ) {
			$view instanceof JsTypedArray => array( $view->buffer, $view->offset, $view->length, $view->size ),
			$view instanceof JsDataView => array( $view->buffer, $view->offset, $view->length, 1 ),
			$view instanceof JsArrayBuffer => array( $view, 0, $view->byteLength(), 1 ),
			default => throw self::argument_type( 'buf', 'an ArrayBuffer or view' ),
		};
		$offset = self::integer( $offset, 'offset', 0, $length );
		$size   = JsUndefined::Value === $size ? $length - $offset : self::integer( $size, 'size', 0, $length - $offset );
		if ( $size > 0 ) {
			$buffer->bytes = substr_replace( $buffer->bytes, random_bytes( $size * $width ), $start + $offset * $width, $size * $width );
		}
		return $view;
	}

	private static function timing_safe_equal( mixed $a = JsUndefined::Value, mixed $b = JsUndefined::Value ): bool {
		foreach ( array(
			'buf1' => $a,
			'buf2' => $b,
		) as $name => $value ) {
			if ( ! $value instanceof JsArrayBuffer && ! Buffer::isView( $value ) ) {
				throw self::argument_type( $name, 'an ArrayBuffer or view' );
			}
		}
		$a = self::key( $a );
		$b = self::key( $b );
		if ( strlen( $a ) !== strlen( $b ) ) {
			throw JsError::node( 'Input buffers must have the same byte length', 'RangeError', 'ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH' );
		}
		return hash_equals( $a, $b );
	}

	public static function pbkdf2( mixed $password = JsUndefined::Value, mixed $salt = JsUndefined::Value, mixed $iterations = JsUndefined::Value, mixed $length = JsUndefined::Value, mixed $digest = JsUndefined::Value ): JsTypedArray {
		$name       = self::digest_name( $digest, true );
		$iterations = self::integer( $iterations, 'iterations', 1, self::MAX_KDF_ROUNDS );
		$length     = self::integer( $length, 'keylen', 0, Limits::MAX_DATA );
		$blocks     = (int) ceil( $length / strlen( hash( $name, '', true ) ) );
		if ( $iterations * $blocks > self::MAX_KDF_ROUNDS ) {
			throw self::out_of_range( 'iterations * digest blocks', 'at most ' . self::MAX_KDF_ROUNDS );
		}
		$password = self::bounded( Buffer::bytes( $password, 'password' ) );
		$salt     = Buffer::bytes( $salt, 'salt' );
		if ( strlen( $salt ) > 1024 ) {
			throw self::out_of_range( 'salt', 'at most 1024 bytes' );
		}
		return Buffer::wrap( 0 === $length ? '' : hash_pbkdf2( $name, $password, $salt, $iterations, $length, true ) );
	}

	public static function hkdf( mixed $digest = JsUndefined::Value, mixed $key = JsUndefined::Value, mixed $salt = JsUndefined::Value, mixed $info = JsUndefined::Value, mixed $length = JsUndefined::Value ): JsArrayBuffer {
		$name   = self::digest_name( $digest, true );
		$length = self::integer( $length, 'keylen', 0, 255 * strlen( hash( $name, '', true ) ) );
		$key    = self::key( $key );
		$salt   = Buffer::bytes( $salt, 'salt' );
		$info   = Buffer::bytes( $info, 'info' );
		if ( strlen( $info ) > 1024 ) {
			throw self::out_of_range( 'info', 'at most 1024 bytes' );
		}
		// PHP rejects empty IKM. Compute its empty-message extraction step explicitly.
		if ( '' === $key && $length > 0 ) {
			$prk   = hash_hmac( $name, '', $salt, true );
			$out   = '';
			$block = '';
			for ( $i = 1; strlen( $out ) < $length; ++$i ) {
				$block = hash_hmac( $name, $block . $info . chr( $i ), $prk, true );
				$out  .= $block;
			}
			return new JsArrayBuffer( substr( $out, 0, $length ) );
		}
		return new JsArrayBuffer( 0 === $length ? '' : hash_hkdf( $name, $key, $length, $info, $salt ) );
	}

	private static function integer( mixed $value, string $name, int $min, int $max ): int {
		if ( ! is_int( $value ) && ! is_float( $value ) ) {
			throw self::argument_type( $name, 'number' );
		}
		if ( ! is_finite( (float) $value ) || floor( $value ) !== (float) $value || $value < $min || $value > $max ) {
			throw self::out_of_range( $name, "an integer between $min and $max" );
		}
		return (int) $value;
	}

	private static function argument_type( string $name, string $type ): JsError {
		return JsError::node( "The \"$name\" argument must be $type", 'TypeError', 'ERR_INVALID_ARG_TYPE' );
	}

	private static function out_of_range( string $name, string $range ): JsError {
		return JsError::node( "The value of \"$name\" is out of range. It must be $range", 'RangeError', 'ERR_OUT_OF_RANGE' );
	}

	private static function require_callback( mixed $callback ): void {
		if ( ! $callback instanceof \Closure ) {
			throw self::argument_type( 'callback', 'a function' );
		}
	}

	private static function callback( \Closure $callback, mixed $value ): JsUndefined {
		JsJobs::enqueue( static fn () => Js::dynamicCall( $callback, new JsArray( array( null, $value ) ) ) );
		return JsUndefined::Value;
	}
}
