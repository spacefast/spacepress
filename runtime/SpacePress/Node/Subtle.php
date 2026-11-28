<?php

declare(strict_types=1);

namespace SpacePress\Node;

use SpacePress\Crypto as Limits;
use SpacePress\JsArray;
use SpacePress\JsArrayBuffer;
use SpacePress\JsError;
use SpacePress\JsObject;
use SpacePress\JsPromise;
use SpacePress\JsUndefined;

final class Subtle implements Dispatch {
	private const METHODS = array(
		'digest'      => 'digest',
		'importKey'   => 'import_key',
		'exportKey'   => 'export_key',
		'generateKey' => 'generate_key',
		'sign'        => 'sign',
		'verify'      => 'verify',
		'encrypt'     => 'encrypt',
		'decrypt'     => 'decrypt',
		'deriveBits'  => 'derive_bits',
		'deriveKey'   => 'derive_key',
	);

	private const HASHES     = array(
		'SHA-1'   => 'sha1',
		'SHA-256' => 'sha256',
		'SHA-384' => 'sha384',
		'SHA-512' => 'sha512',
	);
	private const ALGORITHMS = array(
		'HMAC'              => 'HMAC',
		'AES-CBC'           => 'AES-CBC',
		'AES-GCM'           => 'AES-GCM',
		'PBKDF2'            => 'PBKDF2',
		'HKDF'              => 'HKDF',
		'RSASSA-PKCS1-V1_5' => 'RSASSA-PKCS1-v1_5',
		'RSA-PSS'           => 'RSA-PSS',
		'RSA-OAEP'          => 'RSA-OAEP',
		'ECDSA'             => 'ECDSA',
		'ED25519'           => 'Ed25519',
	);
	private const CURVES     = array(
		'P-256' => 'prime256v1',
		'P-384' => 'secp384r1',
	);

	/** The global crypto object and node:crypto's webcrypto member share these values. */
	public static function exports(): array {
		return array(
			'subtle'          => new self(),
			'getRandomValues' => Crypto::get_random_values( ... ),
			'randomUUID'      => Crypto::random_uuid( ... ),
		);
	}

	public static function key_constructor(): Ctor {
		static $constructor;
		return $constructor ??= new Ctor( 'CryptoKey', array(), static fn ( $value ) => $value instanceof CryptoKey );
	}

	public function read( string $key ): mixed {
		if ( ! isset( self::METHODS[ $key ] ) ) {
			return JsUndefined::Value;
		}
		return Module::method(
			'SubtleCrypto:' . $key,
			static function ( mixed $receiver, array $args ) use ( $key ): mixed {
				if ( ! $receiver instanceof self ) {
					return JsPromise::rejected( new JsError( 'Illegal invocation', 'TypeError' ) );
				}
				return $receiver->invoke( $key, $args );
			}
		);
	}

	public function invoke( string $name, array $args ): mixed {
		$method = self::METHODS[ $name ] ?? null;
		if ( null === $method ) {
			return Module::inherited( $this, $name );
		}
		try {
			return JsPromise::from( self::$method( ...$args ) );
		} catch ( JsError $error ) {
			// Input conversion and permissions use Web Crypto's errors. Lower-level Node
			// operations carry a Node code and become a rejected OperationError.
			return JsPromise::rejected( null === $error->node_code ? $error : new JsError( $error->getMessage(), 'OperationError' ) );
		} catch ( \ArgumentCountError | \ValueError $error ) {
			return JsPromise::rejected( new JsError( 'Invalid arguments to SubtleCrypto.' . $name, 'TypeError' ) );
		}
	}

	private static function digest( mixed $algorithm, mixed $data ): JsArrayBuffer {
		return new JsArrayBuffer( hash( self::hash_name( $algorithm ), self::bytes( $data ), true ) );
	}

	private static function import_key( mixed $format, mixed $data, mixed $algorithm, mixed $extractable, mixed $usages ): CryptoKey {
		[$name, $options] = self::algorithm( $algorithm );
		$extractable      = \SpacePress\Js::truthy( $extractable );
		$usages           = self::usages( $usages );
		if ( $extractable && in_array( $name, array( 'PBKDF2', 'HKDF' ), true ) ) {
			throw new JsError( $name . ' keys are not extractable', 'SyntaxError' );
		}
		$type = self::key_type( $name, $format, $data );
		self::validate_usages( $name, $type, $usages );
		$metadata = self::metadata( $name, $options );
		if ( 'jwk' === $format ) {
			self::validate_jwk( $data, $metadata, $type, $extractable, $usages );
		}
		try {
			$key = match ( $type ) {
				'secret' => KeyObject::createSecretKey(
					Buffer::wrap( 'jwk' === $format ? self::jwk_secret( $data ) : self::bytes( $data ) )
				),
				'private' => KeyObject::createPrivateKey( self::key_input( $format, $data, $metadata ) ),
				'public' => KeyObject::createPublicKey( self::key_input( $format, $data, $metadata ) ),
			};
		} catch ( JsError $error ) {
			if ( null === $error->node_code ) {
				throw $error;
			}
			throw new JsError( 'Invalid key data', 'DataError' );
		}
		$metadata = self::with_key_details( $metadata, $options, $key, $type );
		if ( 'jwk' === $format && isset( $data->p['alg'] ) ) {
			$identifier = self::jwk_identifier( $metadata );
			if ( null !== $identifier && $identifier !== $data->p['alg'] ) {
				throw new JsError( 'JWK alg does not match the requested algorithm', 'DataError' );
			}
		}
		return new CryptoKey( $key, $type, $extractable, $metadata, $usages );
	}

	private static function export_key( mixed $format, mixed $key ): mixed {
		$key = self::require_key( $key );
		if ( ! $key->extractable ) {
			// Node's Web Crypto uses this DOMException name for non-extractable exports.
			throw new JsError( 'Key is not extractable', 'InvalidAccessException' );
		}
		$encoding = match ( $format ) {
			'raw' => array(),
			'jwk' => array( 'format' => 'jwk' ),
			'pkcs8', 'spki' => array(
				'format' => 'der',
				'type'   => $format,
			),
			default => throw new JsError( 'Invalid key format', 'TypeError' ),
		};
		if ( 'raw' === $format && 'secret' === $key->type ) {
			return new JsArrayBuffer( $key->key->secretBytes() );
		}
		if ( 'raw' === $format && 'public' === $key->type && in_array( $key->algorithm['name'], array( 'ECDSA', 'Ed25519' ), true ) ) {
			$jwk = $key->key->export( new JsObject( array( 'format' => 'jwk' ) ) );
			$x   = Buffer::decode( $jwk->p['x'], 'base64url' );
			return new JsArrayBuffer(
				'ECDSA' === $key->algorithm['name'] ? "\x04" . $x . Buffer::decode( $jwk->p['y'], 'base64url' ) : $x
			);
		}
		if ( ! in_array(
			$format,
			array(
				'jwk',
				match ( $key->type ) {
				'public' => 'spki', 'private' => 'pkcs8', default => null,
				},
			),
			true
		) ) {
			throw new JsError( 'Key type does not match the requested export format', 'InvalidAccessError' );
		}
		if ( 'jwk' !== $format ) {
			return new JsArrayBuffer( Buffer::bytes( $key->key->export( new JsObject( $encoding ) ), 'key' ) );
		}
		$jwk        = $key->key->export( new JsObject( $encoding ) );
		$identifier = 'ECDSA' === $key->algorithm['name'] ? null : self::jwk_identifier( $key->algorithm );
		if ( null !== $identifier ) {
			$jwk->p['alg'] = $identifier;
		}
		$jwk->p['key_ops'] = new JsArray( $key->usages );
		$jwk->p['ext']     = true;
		return $jwk;
	}

	private static function generate_key( mixed $algorithm, mixed $extractable, mixed $usages ): mixed {
		[$name, $options] = self::algorithm( $algorithm );
		$extractable      = \SpacePress\Js::truthy( $extractable );
		$usages           = self::usages( $usages );
		$metadata         = self::metadata( $name, $options );
		if ( in_array( $name, array( 'AES-CBC', 'AES-GCM', 'HMAC' ), true ) ) {
			self::validate_usages( $name, 'secret', $usages );
			$length = self::key_length( $metadata, $options );
			$key    = KeyObject::createSecretKey( Buffer::wrap( random_bytes( intdiv( $length, 8 ) ) ) );
			return new CryptoKey( $key, 'secret', $extractable, $metadata + array( 'length' => $length ), $usages );
		}
		if ( in_array( $name, array( 'PBKDF2', 'HKDF' ), true ) ) {
			throw new JsError( 'Unrecognized algorithm name for generateKey', 'NotSupportedError' );
		}
		$private_usages = array_values( array_intersect( $usages, self::allowed_usages( $name, 'private' ) ) );
		$public_usages  = array_values( array_intersect( $usages, self::allowed_usages( $name, 'public' ) ) );
		if ( array_diff( $usages, $private_usages, $public_usages ) ) {
			throw new JsError( 'Unsupported key usage for algorithm', 'SyntaxError' );
		}
		self::validate_usages( $name, 'private', $private_usages );
		$type = match ( $name ) {
			'ECDSA' => 'ec', 'Ed25519' => 'ed25519', default => 'rsa',
		};
		if ( 'rsa' === $type ) {
			$exponent = self::bytes( $options['publicExponent'] ?? JsUndefined::Value );
			// OpenSSL exposes the common F4 exponent through PHP's key-generation API.
			if ( "\x01\x00\x01" !== ltrim( $exponent, "\0" ) ) {
				throw new JsError( 'Only RSA public exponent 65537 is supported', 'OperationError' );
			}
			$options['publicExponent'] = 65537;
		}
		$key_options = array_intersect_key( $options, array_flip( array( 'namedCurve', 'modulusLength', 'publicExponent' ) ) );
		$pair        = KeyObject::generateKeyPairSync( $type, new JsObject( $key_options ) );
		return new JsObject(
			array(
				'publicKey'  => new CryptoKey( $pair->p['publicKey'], 'public', true, self::with_key_details( $metadata, $options, $pair->p['publicKey'], 'public' ), $public_usages ),
				'privateKey' => new CryptoKey( $pair->p['privateKey'], 'private', $extractable, self::with_key_details( $metadata, $options, $pair->p['privateKey'], 'private' ), $private_usages ),
			)
		);
	}

	private static function sign( mixed $algorithm, mixed $key, mixed $data ): JsArrayBuffer {
		[$name, $options] = self::algorithm( $algorithm );
		$key              = self::require_key( $key, $name, 'sign' );
		$bytes            = self::bytes( $data );
		if ( 'HMAC' === $name ) {
			return new JsArrayBuffer( self::hmac( $key, $bytes ) );
		}
		[$digest, $parameters] = self::signature_parameters( $key, $options );
		return new JsArrayBuffer( Sign::sign( $digest, Buffer::wrap( $bytes ), $parameters )->bytes() );
	}

	private static function verify( mixed $algorithm, mixed $key, mixed $signature, mixed $data ): bool {
		[$name, $options] = self::algorithm( $algorithm );
		$key              = self::require_key( $key, $name, 'verify' );
		$signature        = self::bytes( $signature );
		$bytes            = self::bytes( $data );
		if ( 'HMAC' === $name ) {
			return hash_equals( self::hmac( $key, $bytes ), $signature );
		}
		[$digest, $parameters] = self::signature_parameters( $key, $options );
		return Sign::verify( $digest, Buffer::wrap( $bytes ), $parameters, Buffer::wrap( $signature ) );
	}

	private static function hmac( CryptoKey $key, string $bytes ): string {
		if ( strlen( $bytes ) > Limits::MAX_DATA ) {
			throw new JsError( 'The crypto input is too large', 'OperationError' );
		}
		return hash_hmac( self::hash_name( $key->algorithm['hash']['name'] ), $bytes, $key->key->secretBytes(), true );
	}

	private static function signature_parameters( CryptoKey $key, array $options ): array {
		$name = $key->algorithm['name'];
		return match ( $name ) {
			'Ed25519' => array( null, $key->key ),
			'ECDSA' => array(
				self::hash_name( $options['hash'] ?? JsUndefined::Value ),
				new JsObject(
					array(
						'key'         => $key->key,
						'dsaEncoding' => 'ieee-p1363',
					)
				),
			),
			'RSA-PSS' => array(
				self::hash_name( $key->algorithm['hash']['name'] ),
				new JsObject(
					array(
						'key'        => $key->key,
						'padding'    => 6,
						'saltLength' => self::unsigned( $options['saltLength'] ?? JsUndefined::Value, 'saltLength' ),
					)
				),
			),
			'RSASSA-PKCS1-v1_5' => array( self::hash_name( $key->algorithm['hash']['name'] ), $key->key ),
			default => throw new JsError( 'Unrecognized signature algorithm', 'NotSupportedError' ),
		};
	}

	private static function encrypt( mixed $algorithm, mixed $key, mixed $data ): JsArrayBuffer {
		return self::crypt( $algorithm, $key, $data, true );
	}

	private static function decrypt( mixed $algorithm, mixed $key, mixed $data ): JsArrayBuffer {
		return self::crypt( $algorithm, $key, $data, false );
	}

	private static function crypt( mixed $algorithm, mixed $key, mixed $data, bool $encrypt ): JsArrayBuffer {
		[$name, $options] = self::algorithm( $algorithm );
		$key              = self::require_key( $key, $name, $encrypt ? 'encrypt' : 'decrypt' );
		$bytes            = self::bytes( $data );
		if ( 'RSA-OAEP' === $name ) {
			if ( isset( $options['label'] ) && '' !== self::bytes( $options['label'] ) ) {
				throw new JsError( 'Nonempty RSA-OAEP labels are unavailable', 'NotSupportedError' );
			}
			$params = new JsObject(
				array(
					'key'      => $key->key,
					'padding'  => 4,
					'oaepHash' => self::hash_name( $key->algorithm['hash']['name'] ),
				)
			);
			$result = $encrypt ? Sign::publicEncrypt( $params, Buffer::wrap( $bytes ) ) : Sign::privateDecrypt( $params, Buffer::wrap( $bytes ) );
			return new JsArrayBuffer( $result->bytes() );
		}
		if ( ! in_array( $name, array( 'AES-CBC', 'AES-GCM' ), true ) ) {
			throw new JsError( 'Unrecognized encryption algorithm', 'NotSupportedError' );
		}
		$iv             = self::bytes( $options['iv'] ?? JsUndefined::Value );
		$tag_size       = 0;
		$cipher_options = JsUndefined::Value;
		if ( 'AES-GCM' === $name ) {
			$tag_length = self::unsigned( $options['tagLength'] ?? 128, 'tagLength' );
			if ( ! in_array( $tag_length, array( 32, 64, 96, 104, 112, 120, 128 ), true ) ) {
				throw new JsError( 'Invalid AES-GCM tag length', 'OperationError' );
			}
			$tag_size       = intdiv( $tag_length, 8 );
			$cipher_options = new JsObject( array( 'authTagLength' => $tag_size ) );
		}
		$cipher_name = 'aes-' . $key->algorithm['length'] . '-' . strtolower( substr( $name, 4 ) );
		$cipher      = Cipher::create( $cipher_name, $key->key, Buffer::wrap( $iv ), $cipher_options, $encrypt );
		if ( $tag_size > 0 ) {
			if ( isset( $options['additionalData'] ) ) {
				$cipher->setAAD( Buffer::wrap( self::bytes( $options['additionalData'] ) ) );
			}
			if ( ! $encrypt ) {
				if ( strlen( $bytes ) < $tag_size ) {
					throw new JsError( 'Ciphertext is shorter than the authentication tag', 'OperationError' );
				}
				$cipher->setAuthTag( Buffer::wrap( substr( $bytes, -$tag_size ) ) );
				$bytes = substr( $bytes, 0, -$tag_size );
			}
		}
		try {
			$out = $cipher->update( Buffer::wrap( $bytes ) )->bytes() . $cipher->final()->bytes();
		} catch ( JsError $error ) {
			throw new JsError( $error->getMessage(), 'OperationError' );
		}
		if ( $encrypt && $tag_size > 0 ) {
			$out .= $cipher->getAuthTag()->bytes();
		}
		return new JsArrayBuffer( $out );
	}

	private static function derive_bits( mixed $algorithm, mixed $key, mixed $length ): JsArrayBuffer {
		[$name, $options] = self::algorithm( $algorithm );
		return new JsArrayBuffer( self::derive( $name, $options, self::require_key( $key, $name, 'deriveBits' ), $length ) );
	}

	private static function derive_key( mixed $algorithm, mixed $key, mixed $derived, mixed $extractable, mixed $usages ): CryptoKey {
		[$name, $options]          = self::algorithm( $algorithm );
		$key                       = self::require_key( $key, $name, 'deriveKey' );
		[$target, $target_options] = self::algorithm( $derived );
		$metadata                  = self::metadata( $target, $target_options );
		$length                    = self::key_length( $metadata, $target_options );
		$bytes                     = self::derive( $name, $options, $key, $length );
		return self::import_key( 'raw', new JsArrayBuffer( $bytes ), $derived, $extractable, $usages );
	}

	private static function derive( string $name, array $options, CryptoKey $key, mixed $length ): string {
		$bits = self::unsigned( $length, 'length' );
		if ( 0 === $bits || 0 !== $bits % 8 ) {
			throw new JsError( 'Length must be a positive multiple of 8', 'OperationError' );
		}
		$digest = self::hash_name( $options['hash'] ?? JsUndefined::Value );
		$salt   = self::bytes( $options['salt'] ?? JsUndefined::Value );
		$secret = Buffer::wrap( $key->key->secretBytes() );
		return match ( $name ) {
			'PBKDF2' => Crypto::pbkdf2( $secret, Buffer::wrap( $salt ), $options['iterations'] ?? JsUndefined::Value, intdiv( $bits, 8 ), $digest )->bytes(),
			'HKDF' => Crypto::hkdf( $digest, $secret, Buffer::wrap( $salt ), Buffer::wrap( self::bytes( $options['info'] ?? JsUndefined::Value ) ), intdiv( $bits, 8 ) )->bytes,
			default => throw new JsError( 'Unrecognized derivation algorithm', 'NotSupportedError' ),
		};
	}

	private static function algorithm( mixed $algorithm ): array {
		$options = $algorithm instanceof JsObject ? $algorithm->p : array();
		$name    = $algorithm instanceof JsObject ? ( $options['name'] ?? null ) : $algorithm;
		if ( ! is_string( $name ) ) {
			throw new JsError( 'Algorithm name must be a string', 'TypeError' );
		}
		return array( self::ALGORITHMS[ strtoupper( $name ) ] ?? throw new JsError( 'Unrecognized algorithm name', 'NotSupportedError' ), $options );
	}

	private static function hash_name( mixed $algorithm ): string {
		$name = $algorithm instanceof JsObject ? ( $algorithm->p['name'] ?? null ) : $algorithm;
		if ( ! is_string( $name ) ) {
			throw new JsError( 'Algorithm name must be a string', 'TypeError' );
		}
		return self::HASHES[ strtoupper( $name ) ] ?? throw new JsError( 'Unrecognized algorithm name', 'NotSupportedError' );
	}

	private static function metadata( string $name, array $options ): array {
		$out = array( 'name' => $name );
		if ( 'HMAC' === $name || str_starts_with( $name, 'RSA' ) ) {
			$digest      = self::hash_name( $options['hash'] ?? JsUndefined::Value );
			$out['hash'] = array( 'name' => array_search( $digest, self::HASHES, true ) );
		}
		if ( 'ECDSA' === $name ) {
			$curve = $options['namedCurve'] ?? null;
			if ( ! is_string( $curve ) || ! isset( self::CURVES[ $curve ] ) ) {
				throw new JsError( 'Unrecognized named curve', 'NotSupportedError' );
			}
			$out['namedCurve'] = $curve;
		}
		return $out;
	}

	private static function with_key_details( array $metadata, array $options, KeyObject $key, string $type ): array {
		$name = $metadata['name'];
		if ( 'secret' === $type ) {
			$length = strlen( $key->secretBytes() ) * 8;
			if ( str_starts_with( $name, 'AES-' ) ) {
				if ( ! in_array( $length, array( 128, 256 ), true ) ) {
					throw new JsError( 'Invalid AES key length', 'DataError' );
				}
				$metadata['length'] = $length;
			} elseif ( 'HMAC' === $name ) {
				$bits = isset( $options['length'] ) ? self::unsigned( $options['length'], 'length' ) : $length;
				self::validate_hmac_length( $bits );
				if ( $bits !== $length ) {
					throw new JsError( 'Invalid HMAC key length', 'DataError' );
				}
				$metadata['length'] = $bits;
			}
			return $metadata;
		}
		$kind    = $key->read( 'asymmetricKeyType' );
		$details = $key->read( 'asymmetricKeyDetails' );
		if ( 'ECDSA' === $name && 'ec' === $kind && ( $details->p['namedCurve'] ?? null ) === self::CURVES[ $metadata['namedCurve'] ] ) {
			return $metadata;
		}
		if ( 'Ed25519' === $name && 'ed25519' === $kind ) {
			return $metadata;
		}
		if ( str_starts_with( $name, 'RSA' ) && 'rsa' === $kind ) {
			$metadata['modulusLength']  = $details->p['modulusLength'];
			$exponent                   = $key->export( new JsObject( array( 'format' => 'jwk' ) ) )->p['e'];
			$metadata['publicExponent'] = Buffer::decode( $exponent, 'base64url' );
			return $metadata;
		}
		throw new JsError( 'Key material does not match the requested algorithm', 'DataError' );
	}

	private static function key_type( string $name, mixed $format, mixed $data ): string {
		$secret = in_array( $name, array( 'AES-CBC', 'AES-GCM', 'HMAC', 'HKDF', 'PBKDF2' ), true );
		return match ( $format ) {
			'raw' => $secret ? 'secret' : ( in_array( $name, array( 'ECDSA', 'Ed25519' ), true ) ? 'public' : throw new JsError( 'Unsupported key format', 'NotSupportedError' ) ),
			'pkcs8', 'spki' => $secret ? throw new JsError( 'Unsupported key format', 'NotSupportedError' ) : ( 'pkcs8' === $format ? 'private' : 'public' ),
			'jwk' => ! $data instanceof JsObject ? throw new JsError( 'JWK must be an object', 'TypeError' ) : (
				in_array( $name, array( 'HKDF', 'PBKDF2' ), true )
					? throw new JsError( 'Unsupported key format', 'NotSupportedError' )
					: ( $secret ? 'secret' : ( isset( $data->p['d'] ) ? 'private' : 'public' ) )
			),
			default => throw new JsError( 'Invalid key format', 'TypeError' ),
		};
	}

	private static function key_input( string $format, mixed $data, array $metadata ): JsObject {
		if ( 'jwk' === $format ) {
			return new JsObject(
				array(
					'format' => 'jwk',
					'key'    => $data,
				)
			);
		}
		$bytes = self::bytes( $data );
		$name  = $metadata['name'];
		if ( 'Ed25519' === $name && 'raw' === $format ) {
			if ( 32 !== strlen( $bytes ) ) {
				throw new JsError( 'Ed25519 public keys must be 32 bytes', 'DataError' );
			}
			return new JsObject(
				array(
					'format' => 'jwk',
					'key'    => new JsObject(
						array(
							'kty' => 'OKP',
							'crv' => 'Ed25519',
							'x'   => Buffer::encode( $bytes, 'base64url' ),
						)
					),
				)
			);
		}
		if ( 'ECDSA' === $name && 'raw' === $format ) {
			$curve  = $metadata['namedCurve'];
			$size   = 'P-256' === $curve ? 32 : 48;
			$prefix = $bytes[0] ?? '';
			$valid  = match ( $prefix ) {
				"\x04" => strlen( $bytes ) === 2 * $size + 1,
				"\x02", "\x03" => strlen( $bytes ) === $size + 1,
				default => false,
			};
			if ( ! $valid ) {
				throw new JsError( 'Invalid EC point', 'DataError' );
			}
			$bytes  = Asn1::ec_point_spki( self::CURVES[ $curve ], $bytes );
			$format = 'spki';
		}

		return new JsObject(
			array(
				'format' => 'der',
				'type'   => $format,
				'key'    => Buffer::wrap( $bytes ),
			)
		);
	}

	private static function key_length( array $algorithm, array $options ): int {
		$name   = $algorithm['name'];
		$length = $options['length'] ?? null;
		if ( 'HMAC' === $name ) {
			$hash   = $algorithm['hash']['name'];
			$length = $length ?? ( in_array( $hash, array( 'SHA-384', 'SHA-512' ), true ) ? 1024 : 512 );
			$length = self::unsigned( $length, 'length' );
			self::validate_hmac_length( $length );
			return $length;
		}
		if ( ! in_array( $name, array( 'AES-CBC', 'AES-GCM' ), true ) ) {
			throw new JsError( 'Unsupported derived key algorithm', 'NotSupportedError' );
		}
		$length = self::unsigned( $length, 'length' );
		if ( ! in_array( $length, array( 128, 256 ), true ) ) {
			throw new JsError( 'Invalid AES key length', 'OperationError' );
		}
		return $length;
	}

	private static function validate_hmac_length( int $bits ): void {
		if ( 0 !== $bits % 8 ) {
			throw new JsError( 'HMAC key length must be a multiple of eight', 'NotSupportedError' );
		}
		if ( 0 === $bits || $bits > Limits::MAX_DATA * 8 ) {
			throw new JsError( 'Invalid HMAC key length', 'DataError' );
		}
	}

	private static function allowed_usages( string $name, string $type ): array {
		return match ( $name ) {
			'HMAC' => array( 'sign', 'verify' ),
			'AES-CBC', 'AES-GCM' => array( 'encrypt', 'decrypt', 'wrapKey', 'unwrapKey' ),
			'PBKDF2', 'HKDF' => array( 'deriveBits', 'deriveKey' ),
			'RSA-OAEP' => 'private' === $type ? array( 'decrypt', 'unwrapKey' ) : array( 'encrypt', 'wrapKey' ),
			default => array( 'private' === $type ? 'sign' : 'verify' ),
		};
	}

	private static function validate_usages( string $name, string $type, array $usages ): void {
		if ( array_diff( $usages, self::allowed_usages( $name, $type ) ) || ( 'public' !== $type && array() === $usages ) ) {
			throw new JsError( 'Unsupported key usage for algorithm', 'SyntaxError' );
		}
	}

	private static function usages( mixed $usages ): array {
		if ( ! $usages instanceof JsArray ) {
			throw new JsError( 'Key usages must be an array', 'TypeError' );
		}
		foreach ( $usages->a as $usage ) {
			if ( ! is_string( $usage ) ) {
				throw new JsError( 'Invalid key usage', 'TypeError' );
			}
		}
		return array_values( array_unique( $usages->a ) );
	}

	private static function require_key( mixed $key, ?string $name = null, ?string $usage = null ): CryptoKey {
		if ( ! $key instanceof CryptoKey ) {
			throw new JsError( 'Expected a CryptoKey', 'TypeError' );
		}
		if ( null !== $name && ( $key->algorithm['name'] !== $name || ! in_array( $usage, $key->usages, true ) ) ) {
			throw new JsError( 'The key is not permitted for this operation', 'InvalidAccessError' );
		}
		return $key;
	}

	private static function validate_jwk( JsObject $jwk, array $algorithm, string $type, bool $extractable, array $usages ): void {
		$name     = $algorithm['name'];
		$expected = match ( true ) {
			'secret' === $type => 'oct', 'ECDSA' === $name => 'EC', 'Ed25519' === $name => 'OKP', default => 'RSA',
		};
		$use     = str_starts_with( $name, 'AES-' ) || 'RSA-OAEP' === $name ? 'enc' : 'sig';
		$key_ops = $jwk->p['key_ops'] ?? null;
		if ( ( $jwk->p['kty'] ?? null ) !== $expected
			|| ( $extractable && false === ( $jwk->p['ext'] ?? true ) )
			|| ( isset( $jwk->p['use'] ) && $use !== $jwk->p['use'] && array() !== $usages )
			|| ( null !== $key_ops && ( ! $key_ops instanceof JsArray || array_diff( $usages, self::usages( $key_ops ) ) ) )
		) {
			throw new JsError( 'JWK parameters do not permit the requested usage', 'DataError' );
		}
	}

	private static function jwk_secret( JsObject $jwk ): string {
		$encoded = $jwk->p['k'] ?? null;
		if ( ! is_string( $encoded ) || ! preg_match( '/^[A-Za-z0-9_-]+$/D', $encoded ) || 1 === strlen( $encoded ) % 4 ) {
			throw new JsError( 'Invalid JWK key data', 'DataError' );
		}
		return Buffer::decode( $encoded, 'base64url' );
	}

	private static function jwk_identifier( array $algorithm ): ?string {
		$hash = substr( $algorithm['hash']['name'] ?? '', 4 );
		return match ( $algorithm['name'] ) {
			'HMAC' => 'HS' . $hash,
			'RSASSA-PKCS1-v1_5' => 'RS' . $hash,
			'RSA-PSS' => 'PS' . $hash,
			'RSA-OAEP' => '1' === $hash ? 'RSA-OAEP' : 'RSA-OAEP-' . $hash,
			'AES-GCM', 'AES-CBC' => 'A' . $algorithm['length'] . substr( $algorithm['name'], 4 ),
			'ECDSA' => 'ES' . substr( $algorithm['namedCurve'], 2 ),
			'Ed25519' => 'Ed25519',
			default => null,
		};
	}

	private static function bytes( mixed $data ): string {
		if ( ! $data instanceof JsArrayBuffer && ! Buffer::isView( $data ) ) {
			throw new JsError( 'Expected an ArrayBuffer, TypedArray, or DataView', 'TypeError' );
		}
		return Buffer::bytes( $data, 'data' );
	}

	private static function unsigned( mixed $value, string $name ): int {
		if ( ( ! is_int( $value ) && ! is_float( $value ) ) || ! is_finite( (float) $value ) || $value < 0 || $value > 4294967295 ) {
			throw new JsError( 'Invalid value for ' . $name, 'TypeError' );
		}
		return (int) $value;
	}
}
