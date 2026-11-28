<?php
declare(strict_types=1);
namespace SpacePress\Node;

// phpcs:disable WordPress.PHP.NoSilencedErrors.Discouraged -- Checked OpenSSL failures are reported as JavaScript errors.

use SpacePress\Crypto as Limits;
use SpacePress\HttpError;
use SpacePress\Js;
use SpacePress\JsArray;
use SpacePress\JsBigInt;
use SpacePress\JsError;
use SpacePress\JsJobs;
use SpacePress\JsObject;
use SpacePress\JsTypedArray;
use SpacePress\JsUndefined;

/** A Node key with a native OpenSSL handle, a Sodium seed or public key, or secret bytes. */
final class KeyObject implements Dispatch, \Stringable {

	private const PRIVATE_LABELS = array(
		'pkcs8' => 'PRIVATE KEY',
		'pkcs1' => 'RSA PRIVATE KEY',
		'sec1'  => 'EC PRIVATE KEY',
	);
	private const PUBLIC_LABELS  = array(
		'spki'  => 'PUBLIC KEY',
		'pkcs1' => 'RSA PUBLIC KEY',
	);
	private const CURVES         = array(
		'prime256v1' => 'P-256',
		'secp384r1'  => 'P-384',
	);

	private function __construct(
		public readonly string $type,
		public readonly ?string $algorithm,
		private readonly \OpenSSLAsymmetricKey|string $material,
	) {}

	/** @return array<string, mixed> */
	public static function exports(): array {
		return array(
			'KeyObject'           => new Ctor( 'KeyObject', array(), static fn ( mixed $value ): bool => $value instanceof self ),
			'generateKeyPairSync' => self::generateKeyPairSync( ... ),
			'generateKeyPair'     => self::generateKeyPair( ... ),
			'createPrivateKey'    => self::createPrivateKey( ... ),
			'createPublicKey'     => self::createPublicKey( ... ),
			'createSecretKey'     => self::createSecretKey( ... ),
		);
	}

	public function read( string $key ): mixed {
		return match ( $key ) {
			'type' => $this->type,
			'asymmetricKeyType' => $this->algorithm ?? JsUndefined::Value,
			'asymmetricKeyDetails' => null === $this->algorithm ? JsUndefined::Value : $this->asymmetricDetails(),
			'symmetricKeySize' => 'secret' === $this->type ? strlen( $this->secretBytes() ) : JsUndefined::Value,
			'export', 'equals', 'toString', 'valueOf' => Module::method(
				'KeyObject:' . $key,
				static function ( mixed $receiver, array $args ) use ( $key ): mixed {
					if ( ! $receiver instanceof self ) {
						throw new JsError( 'Illegal invocation', 'TypeError' );
					}
					return $receiver->invoke( $key, $args );
				}
			),
			default => JsUndefined::Value,
		};
	}

	public function invoke( string $name, array $args ): mixed {
		return match ( $name ) {
			'export' => $this->export( $args[0] ?? JsUndefined::Value ),
			'equals' => $this->equals( $args[0] ?? JsUndefined::Value ),
			'toString' => (string) $this,
			default => Module::inherited( $this, $name ),
		};
	}

	public function __toString(): string {
		return '[object KeyObject]';
	}

	public function inspect(): string {
		return "KeyObject { type: '$this->type' }";
	}

	/** @return array{type: string} */
	public function __debugInfo(): array {
		return array( 'type' => $this->type );
	}

	public static function createSecretKey( mixed $input = JsUndefined::Value, mixed $encoding = JsUndefined::Value ): self {
		$bytes = self::inputBytes( $input, $encoding );
		return new self( 'secret', null, self::bounded( $bytes ) );
	}

	public static function createPrivateKey( mixed $input = JsUndefined::Value ): self {
		return self::import( $input, true );
	}

	public static function createPublicKey( mixed $input = JsUndefined::Value ): self {
		return $input instanceof self ? $input->publicPart() : self::import( $input, false );
	}

	public static function generateKeyPairSync( mixed $type = JsUndefined::Value, mixed $options = JsUndefined::Value ): JsObject {
		$options = self::options( $options );
		if ( 'ed25519' === $type ) {
			self::requireExtension( 'sodium' );
			$private = new self( 'private', 'ed25519', random_bytes( SODIUM_CRYPTO_SIGN_SEEDBYTES ) );
		} else {
			if ( ! in_array( $type, array( 'rsa', 'ec' ), true ) ) {
				throw self::argument( 'type', 'a supported key type (rsa, ec, ed25519)' );
			}
			self::requireExtension( 'openssl' );
			$config = match ( $type ) {
				'rsa' => self::rsaConfig( $options ),
				'ec' => self::ecConfig( $options ),
			};
			$native = @openssl_pkey_new( $config );
			if ( false === $native ) {
				throw self::unsupported( 'OpenSSL could not generate the key pair' );
			}
			$private = new self( 'private', $type, $native );
		}
		$public           = $private->publicPart();
		$public_encoding  = self::option( $options, 'publicKeyEncoding' );
		$private_encoding = self::option( $options, 'privateKeyEncoding' );
		return new JsObject(
			array(
				'publicKey'  => JsUndefined::Value === $public_encoding ? $public : $public->export( $public_encoding ),
				'privateKey' => JsUndefined::Value === $private_encoding ? $private : $private->export( $private_encoding ),
			)
		);
	}

	private static function generateKeyPair( mixed $type = JsUndefined::Value, mixed $options = JsUndefined::Value, mixed $callback = JsUndefined::Value ): JsUndefined {
		if ( $options instanceof \Closure && JsUndefined::Value === $callback ) {
			$callback = $options;
			$options  = JsUndefined::Value;
		}
		if ( ! $callback instanceof \Closure ) {
			throw self::argument( 'callback', 'a function' );
		}
		JsJobs::enqueue(
			static function () use ( $type, $options, $callback ): void {
				try {
					$pair = self::generateKeyPairSync( $type, $options );
				} catch ( JsError $error ) {
					Js::dynamicCall( $callback, new JsArray( array( Js::thrownValue( $error ) ) ) );
					return;
				}
				Js::dynamicCall( $callback, new JsArray( array( null, $pair->p['publicKey'], $pair->p['privateKey'] ) ) );
			}
		);
		return JsUndefined::Value;
	}

	public function export( mixed $input = JsUndefined::Value ): JsTypedArray|string|JsObject {
		if ( 'secret' === $this->type && JsUndefined::Value === $input ) {
			return Buffer::wrap( $this->secretBytes() );
		}
		if ( ! $input instanceof JsObject ) {
			throw self::argument( 'options', 'an object' );
		}
		if ( 'private' === $this->type && JsUndefined::Value !== self::option( $input, 'cipher' ) ) {
			throw self::unsupported( 'Encrypted private key exports are unsupported' );
		}
		$format = self::option( $input, 'format' );
		if ( 'jwk' === $format ) {
			return $this->exportJwk();
		}
		if ( 'secret' === $this->type ) {
			if ( JsUndefined::Value === $format || 'buffer' === $format ) {
				return Buffer::wrap( $this->secretBytes() );
			}
			throw self::optionError( 'format' );
		}
		if ( ! in_array( $format, array( 'pem', 'der' ), true ) ) {
			throw self::optionError( 'format' );
		}
		$type   = self::option( $input, 'type' );
		$labels = 'private' === $this->type ? self::PRIVATE_LABELS : self::PUBLIC_LABELS;
		if ( ! is_string( $type ) || ! isset( $labels[ $type ] ) ) {
			throw self::optionError( 'type' );
		}
		$der = match ( $type ) {
			'pkcs8', 'spki' => $this->der(),
			'pkcs1' => 'rsa' === $this->algorithm
				? Asn1::rsa_pkcs1( $this->der(), 'private' === $this->type )
				: throw JsError::node( 'PKCS#1 only supports RSA keys', 'Error', 'ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS' ),
			'sec1' => 'ec' === $this->algorithm
				? $this->sec1()
				: throw JsError::node( 'SEC1 only supports EC keys', 'Error', 'ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS' ),
		};
		return 'der' === $format ? Buffer::wrap( $der ) : Asn1::pem( $der, $labels[ $type ] );
	}

	public function equals( mixed $other = JsUndefined::Value ): bool {
		if ( ! $other instanceof self ) {
			throw self::argument( 'otherKeyObject', 'a KeyObject' );
		}
		if ( $this->type !== $other->type || $this->algorithm !== $other->algorithm ) {
			return false;
		}
		return 'secret' === $this->type
			? hash_equals( $this->secretBytes(), $other->secretBytes() )
			: hash_equals( $this->der(), $other->der() );
	}

	public function secretBytes(): string {
		if ( 'secret' !== $this->type || ! is_string( $this->material ) ) {
			throw JsError::node( 'Expected a secret key', 'TypeError', 'ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE' );
		}
		return $this->material;
	}

	public function nativeKey(): \OpenSSLAsymmetricKey {
		if ( ! $this->material instanceof \OpenSSLAsymmetricKey ) {
			throw self::unsupported( 'Expected a native OpenSSL key' );
		}
		return $this->material;
	}

	public function edBytes(): string {
		if ( 'ed25519' !== $this->algorithm || ! is_string( $this->material ) ) {
			throw self::unsupported( 'Expected an Ed25519 key' );
		}
		self::requireExtension( 'sodium' );
		return $this->material;
	}

	public function publicPart(): self {
		if ( 'private' !== $this->type ) {
			throw JsError::node( 'Invalid key object type ' . $this->type . ', expected private', 'TypeError', 'ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE' );
		}
		if ( 'ed25519' === $this->algorithm ) {
			return new self( 'public', 'ed25519', sodium_crypto_sign_publickey( sodium_crypto_sign_seed_keypair( $this->edBytes() ) ) );
		}
		$public = @openssl_pkey_get_public( $this->details()['key'] );
		if ( false === $public ) {
			throw self::unsupported( 'OpenSSL could not read the public key' );
		}
		return new self( 'public', $this->algorithm, $public );
	}

	public function der(): string {
		if ( 'ed25519' === $this->algorithm ) {
			return Asn1::ed_der( $this->edBytes(), 'private' === $this->type );
		}
		if ( 'private' === $this->type ) {
			if ( ! @openssl_pkey_export( $this->nativeKey(), $pem ) ) {
				throw self::unsupported( 'OpenSSL could not export the private key' );
			}
		} else {
			$pem = $this->details()['key'];
		}
		return Asn1::unpem( $pem ) ?? throw self::unsupported( 'OpenSSL could not encode the key' );
	}

	public static function option( JsObject $options, string $name ): mixed {
		return Js::dynamicGet( $options, $name );
	}

	public static function bounded( string $bytes ): string {
		if ( strlen( $bytes ) > Limits::MAX_DATA ) {
			throw new HttpError( 413, 'crypto_input_too_large', 'The crypto input is too large.' );
		}
		return $bytes;
	}

	public static function argument( string $name, string $expected ): JsError {
		return JsError::node( 'The "' . $name . '" argument must be ' . $expected, 'TypeError', 'ERR_INVALID_ARG_TYPE' );
	}

	public static function optionError( string $name ): JsError {
		return JsError::node( 'The property "options.' . $name . '" is invalid', 'TypeError', 'ERR_INVALID_ARG_VALUE' );
	}

	public static function unsupported( string $message ): JsError {
		return JsError::node( $message, 'Error', 'ERR_OSSL_UNSUPPORTED' );
	}

	private function asymmetricDetails(): JsObject {
		return new JsObject(
			match ( $this->algorithm ) {
			'rsa' => array(
				'modulusLength'  => $this->details()['bits'],
				'publicExponent' => JsBigInt::fromRadix( bin2hex( $this->details()['rsa']['e'] ), 16 ),
			),
			'ec' => array( 'namedCurve' => $this->details()['ec']['curve_name'] ),
			default => array(),
			}
		);
	}

	public function ecSize(): int {
		return (int) ceil( $this->details()['bits'] / 8 );
	}

	private function sec1(): string {
		$details = $this->details()['ec'];
		$size    = $this->ecSize();
		return Asn1::ec_sec1( $details['curve_name'], self::ecField( $details, 'd', $size ), self::ecField( $details, 'x', $size ), self::ecField( $details, 'y', $size ) );
	}

	private function exportJwk(): JsObject {
		if ( 'secret' === $this->type ) {
			return new JsObject(
				array(
					'kty' => 'oct',
					'k'   => Buffer::encode( $this->secretBytes(), 'base64url' ),
				)
			);
		}
		$private = 'private' === $this->type;
		if ( 'ed25519' === $this->algorithm ) {
			$fields = array( 'crv' => 'Ed25519' );
			if ( $private ) {
				$fields['d'] = Buffer::encode( $this->edBytes(), 'base64url' );
			}
			$fields['x']   = Buffer::encode( ( $private ? $this->publicPart() : $this )->edBytes(), 'base64url' );
			$fields['kty'] = 'OKP';
			return new JsObject( $fields );
		}
		if ( 'rsa' === $this->algorithm ) {
			$details = $this->details()['rsa'];
			$fields  = array( 'kty' => 'RSA' );
			foreach ( $private ? array( 'n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi' ) : array( 'n', 'e' ) as $field ) {
				$fields[ $field ] = Buffer::encode(
					$details[ match ( $field ) {
					'dp' => 'dmp1',
					'dq' => 'dmq1',
					'qi' => 'iqmp',
					default => $field} ],
					'base64url'
				);
			}
			return new JsObject( $fields );
		}
		$details = $this->details()['ec'];
		$size    = $this->ecSize();
		$fields  = array(
			'kty' => 'EC',
			'x'   => Buffer::encode( self::ecField( $details, 'x', $size ), 'base64url' ),
			'y'   => Buffer::encode( self::ecField( $details, 'y', $size ), 'base64url' ),
			'crv' => self::CURVES[ $details['curve_name'] ],
		);
		if ( $private ) {
			$fields['d'] = Buffer::encode( self::ecField( $details, 'd', $size ), 'base64url' );
		}
		return new JsObject( $fields );
	}

	private static function ecField( array $details, string $field, int $size ): string {
		return str_pad( $details[ $field ], $size, "\0", STR_PAD_LEFT );
	}

	private function details(): array {
		$details = openssl_pkey_get_details( $this->nativeKey() );
		if ( false === $details ) {
			throw self::unsupported( 'OpenSSL could not read the key details' );
		}
		return $details;
	}

	private static function import( mixed $input, bool $want_private ): self {
		$type     = JsUndefined::Value;
		$format   = JsUndefined::Value;
		$encoding = JsUndefined::Value;
		if ( $input instanceof JsObject ) {
			if ( JsUndefined::Value !== self::option( $input, 'passphrase' ) ) {
				throw self::unsupported( 'Encrypted private key imports are unsupported' );
			}
			$format   = self::option( $input, 'format' );
			$type     = self::option( $input, 'type' );
			$encoding = self::option( $input, 'encoding' );
			$input    = self::option( $input, 'key' );
		}
		if ( ! $want_private && $input instanceof self ) {
			return $input->publicPart();
		}
		if ( 'jwk' === $format ) {
			return self::importJwk( $input, $want_private );
		}
		$bytes        = self::bounded( self::inputBytes( $input, $encoding ) );
		$implicit_der = JsUndefined::Value === $format && ! is_string( $input ) && str_starts_with( $bytes, "\x30" );
		if ( 'der' === $format || $implicit_der ) {
			$labels = $want_private ? self::PRIVATE_LABELS : self::PUBLIC_LABELS + self::PRIVATE_LABELS;
			if ( ! $implicit_der && ( ! is_string( $type ) || ! isset( $labels[ $type ] ) ) ) {
				throw self::optionError( 'type' );
			}
			$pems = array_map( static fn ( string $label ): string => Asn1::pem( $bytes, $label ), $implicit_der ? $labels : array( $labels[ $type ] ) );
		} elseif ( 'pem' === $format || JsUndefined::Value === $format ) {
			$material = Asn1::parse_pem( $bytes );
			if ( null === $material ) {
				throw self::unsupported( 'Expected an in-memory PEM key' );
			}
			$pems = array( Asn1::pem( $material[1], $material[0] ) );
		} else {
			throw self::optionError( 'format' );
		}

		$ed = null;
		foreach ( $pems as $pem ) {
			$der = Asn1::unpem( $pem );
			$ed  = null === $der ? null : Asn1::ed_raw( $der );
			if ( null !== $ed ) {
				break;
			}
		}
		if ( null !== $ed ) {
			[$bytes, $is_private] = $ed;
			if ( $want_private && ! $is_private ) {
				throw self::unsupported( 'Unsupported private key' );
			}
			$key = new self( $is_private ? 'private' : 'public', 'ed25519', $bytes );
			return ! $want_private && $is_private ? $key->publicPart() : $key;
		}

		self::requireExtension( 'openssl' );
		foreach ( $pems as $pem ) {
			if ( ! $want_private ) {
				$key = @openssl_pkey_get_public( $pem );
				if ( false !== $key ) {
					return self::fromNative( 'public', $key );
				}
			}
			// An explicit empty passphrase keeps OpenSSL from prompting on encrypted PEMs.
			$key = @openssl_pkey_get_private( $pem, '' );
			if ( false !== $key ) {
				$object = self::fromNative( 'private', $key );
				return $want_private ? $object : $object->publicPart();
			}
		}
		throw self::unsupported( $want_private ? 'Unsupported private key' : 'Unsupported public key' );
	}

	private static function inputBytes( mixed $input, mixed $encoding ): string {
		if ( ! is_string( $input ) ) {
			return Buffer::bytes( $input, 'key' );
		}
		$encoding = is_string( $encoding ) && '' !== $encoding && 'buffer' !== $encoding
			? Buffer::knownEncoding( $encoding )
			: 'utf8';
		return Buffer::decode( $input, $encoding );
	}

	private static function importJwk( mixed $input, bool $want_private ): self {
		if ( ! $input instanceof JsObject ) {
			throw self::argument( 'key', 'a JWK object' );
		}
		$type  = self::option( $input, 'kty' );
		$field = static function ( string $name, ?int $size = null ) use ( $input ): string {
			$value = self::option( $input, $name );
			if ( ! is_string( $value ) ) {
				throw self::argument( 'key.' . $name, 'a string' );
			}
			$bytes = self::bounded( Buffer::decode( $value, 'base64url' ) );
			if ( '' === $bytes || ( null !== $size && strlen( $bytes ) !== $size ) ) {
				throw self::optionError( 'key.' . $name );
			}
			return $bytes;
		};
		if ( 'OKP' === $type && 'Ed25519' === self::option( $input, 'crv' ) ) {
			return new self( $want_private ? 'private' : 'public', 'ed25519', $field( $want_private ? 'd' : 'x', 32 ) );
		}
		if ( 'RSA' === $type ) {
			$names = $want_private ? array( 'n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi' ) : array( 'n', 'e' );
			$pem   = Asn1::pem( Asn1::rsa_jwk_der( array_map( $field, $names ), $want_private ), $want_private ? 'RSA PRIVATE KEY' : 'RSA PUBLIC KEY' );
		} elseif ( 'EC' === $type ) {
			$curve = self::curve( self::option( $input, 'crv' ) );
			$size  = 'prime256v1' === $curve ? 32 : 48;
			$x     = $field( 'x', $size );
			$y     = $field( 'y', $size );
			$pem   = $want_private
				? Asn1::pem( Asn1::ec_sec1( $curve, $field( 'd', $size ), $x, $y ), 'EC PRIVATE KEY' )
				: Asn1::pem( Asn1::ec_spki( $curve, $x, $y ), 'PUBLIC KEY' );
		} else {
			throw self::optionError( 'key.kty' );
		}
		return self::import( $pem, $want_private );
	}

	private static function fromNative( string $type, \OpenSSLAsymmetricKey $key ): self {
		$details   = openssl_pkey_get_details( $key );
		$algorithm = match ( $details['type'] ?? null ) {
			OPENSSL_KEYTYPE_RSA => 'rsa',
			OPENSSL_KEYTYPE_EC => isset( self::CURVES[ $details['ec']['curve_name'] ?? '' ] ) ? 'ec' : null,
			default => null,
		};
		if ( null === $algorithm ) {
			throw self::unsupported( 'Unsupported asymmetric key type' );
		}
		return new self( $type, $algorithm, $key );
	}

	private static function options( mixed $options ): JsObject {
		if ( JsUndefined::Value === $options ) {
			return new JsObject();
		}
		if ( ! $options instanceof JsObject ) {
			throw self::argument( 'options', 'an object' );
		}
		return $options;
	}

	private static function curve( mixed $curve ): string {
		return match ( $curve ) {
			'P-256', 'prime256v1' => 'prime256v1',
			'P-384', 'secp384r1' => 'secp384r1',
			default => throw JsError::node( 'Invalid EC curve name', 'TypeError', 'ERR_CRYPTO_INVALID_CURVE' ),
		};
	}

	private static function rsaConfig( JsObject $options ): array {
		$length = self::option( $options, 'modulusLength' );
		if ( ! is_int( $length ) && ! is_float( $length ) ) {
			throw self::argument( 'options.modulusLength', 'a number' );
		}
		if ( $length < 0 || $length > 4096 || (float) (int) $length !== (float) $length ) {
			throw JsError::node( 'SpacePress supports RSA generation up to 4096 bits', 'RangeError', 'ERR_OUT_OF_RANGE' );
		}
		$exponent = self::option( $options, 'publicExponent' );
		if ( JsUndefined::Value !== $exponent && 65537 !== $exponent && 65537.0 !== $exponent ) {
			throw self::unsupported( 'PHP OpenSSL only generates RSA keys with public exponent 65537' );
		}
		return array(
			'private_key_type' => OPENSSL_KEYTYPE_RSA,
			'private_key_bits' => (int) $length,
		);
	}

	private static function ecConfig( JsObject $options ): array {
		return array(
			'private_key_type' => OPENSSL_KEYTYPE_EC,
			'curve_name'       => self::curve( self::option( $options, 'namedCurve' ) ),
		);
	}

	private static function requireExtension( string $extension ): void {
		if ( ! extension_loaded( $extension ) ) {
			throw self::unsupported( 'This operation requires the PHP ' . $extension . ' extension' );
		}
	}
}
