<?php
declare(strict_types=1);
namespace SpacePress\Node;

// phpcs:disable WordPress.PHP.NoSilencedErrors.Discouraged -- Checked OpenSSL failures are reported as JavaScript errors.

use SpacePress\JsArrayBuffer;
use SpacePress\JsError;
use SpacePress\JsObject;
use SpacePress\JsTypedArray;
use SpacePress\JsUndefined;

/** Node's streaming and one-shot signatures, and its four RSA encryption operations. */
final class Sign implements Dispatch {

	public const PKCS1_PADDING      = 1;
	public const NO_PADDING         = 3;
	public const OAEP_PADDING       = 4;
	public const PSS_PADDING        = 6;
	public const PSS_SALTLEN_DIGEST = -1;
	public const PSS_SALTLEN_AUTO   = -2;

	private ?string $data = '';

	private function __construct( private readonly string $digest, private readonly bool $signing ) {}

	/** @return array<string, mixed> */
	public static function exports(): array {
		return array(
			'createSign'     => static fn ( mixed $algorithm = JsUndefined::Value ): self => new self( self::digest( $algorithm ), true ),
			'createVerify'   => static fn ( mixed $algorithm = JsUndefined::Value ): self => new self( self::digest( $algorithm ), false ),
			'sign'           => self::sign( ... ),
			'verify'         => self::verify( ... ),
			'publicEncrypt'  => self::publicEncrypt( ... ),
			'privateDecrypt' => self::privateDecrypt( ... ),
			'privateEncrypt' => static fn ( mixed $key = JsUndefined::Value, mixed $data = JsUndefined::Value ): JsTypedArray
				=> self::rsaCrypt( 'openssl_private_encrypt', $key, $data, true, false ),
			'publicDecrypt'  => static fn ( mixed $key = JsUndefined::Value, mixed $data = JsUndefined::Value ): JsTypedArray
				=> self::rsaCrypt( 'openssl_public_decrypt', $key, $data, false, false ),
		);
	}

	public function read( string $key ): mixed {
		if ( 'update' !== $key && ( $this->signing ? 'sign' : 'verify' ) !== $key ) {
			return JsUndefined::Value;
		}
		return Module::method(
			'Sign:' . $key,
			static function ( mixed $receiver, array $args ) use ( $key ): mixed {
				if ( ! $receiver instanceof self ) {
					throw new JsError( 'Illegal invocation', 'TypeError' );
				}
				return $receiver->invoke( $key, $args );
			}
		);
	}

	public function invoke( string $name, array $args ): mixed {
		$arg = static fn ( int $index ): mixed => array_key_exists( $index, $args ) ? $args[ $index ] : JsUndefined::Value;
		if ( 'update' === $name ) {
			return $this->update( $arg( 0 ), $arg( 1 ) );
		}
		if ( 'sign' === $name && $this->signing ) {
			$signature = self::signature( $this->digest, $this->take(), $arg( 0 ) );
			$encoding  = $arg( 1 );
			return self::usesRawEncoding( $encoding )
				? Buffer::wrap( $signature )
				: Buffer::encode( $signature, Buffer::knownEncoding( $encoding ) );
		}
		if ( 'verify' === $name && ! $this->signing ) {
			$encoding  = $arg( 2 );
			$signature = is_string( $arg( 1 ) )
				? KeyObject::bounded( Buffer::decode( $arg( 1 ), self::usesRawEncoding( $encoding ) ? 'utf8' : Buffer::knownEncoding( $encoding ) ) )
				: self::byteInput( $arg( 1 ), 'signature' );
			return self::check( $this->digest, $this->take(), $arg( 0 ), $signature );
		}
		return Module::inherited( $this, $name );
	}

	public static function sign( mixed $algorithm = JsUndefined::Value, mixed $data = JsUndefined::Value, mixed $key = JsUndefined::Value ): JsTypedArray {
		return Buffer::wrap( self::signature( self::oneShotDigest( $algorithm ), self::byteInput( $data, 'data' ), $key ) );
	}

	public static function verify(
		mixed $algorithm = JsUndefined::Value,
		mixed $data = JsUndefined::Value,
		mixed $key = JsUndefined::Value,
		mixed $signature = JsUndefined::Value,
	): bool {
		return self::check( self::oneShotDigest( $algorithm ), self::byteInput( $data, 'data' ), $key, self::byteInput( $signature, 'signature' ) );
	}

	public static function publicEncrypt( mixed $key = JsUndefined::Value, mixed $data = JsUndefined::Value ): JsTypedArray {
		return self::rsaCrypt( 'openssl_public_encrypt', $key, $data, false, true );
	}

	public static function privateDecrypt( mixed $key = JsUndefined::Value, mixed $data = JsUndefined::Value ): JsTypedArray {
		return self::rsaCrypt( 'openssl_private_decrypt', $key, $data, true, true );
	}

	private static function usesRawEncoding( mixed $encoding ): bool {
		return in_array( $encoding, array( JsUndefined::Value, null, '', 'buffer' ), true );
	}

	private function update( mixed $data, mixed $encoding ): self {
		if ( null === $this->data ) {
			throw self::invalidState();
		}
		$bytes      = is_string( $data )
			? Buffer::decode( $data, Buffer::encoding( $encoding ) ?? 'utf8' )
			: self::byteInput( $data, 'data' );
		$this->data = KeyObject::bounded( $this->data . $bytes );
		return $this;
	}

	private function take(): string {
		$bytes      = $this->data ?? throw self::invalidState();
		$this->data = null;
		return $bytes;
	}

	private static function invalidState(): JsError {
		return JsError::node( 'Not initialised', 'Error', 'ERR_CRYPTO_INVALID_STATE' );
	}

	private static function signature( ?string $digest, string $data, mixed $input ): string {
		$key                             = self::key( $input, true );
		[$padding, $salt_length, $p1363] = self::signatureOptions( $input );
		if ( 'ed25519' === $key->algorithm ) {
			self::edDigest( $digest );
			$secret = sodium_crypto_sign_secretkey( sodium_crypto_sign_seed_keypair( $key->edBytes() ) );
			try {
				return sodium_crypto_sign_detached( $data, $secret );
			} finally {
				sodium_memzero( $secret );
			}
		}
		$digest           ??= 'sha256';
		[$native, $padding] = self::rsaSignatureOptions( $key, $digest, $padding, $salt_length );
		$ok                 = self::PSS_PADDING === $padding
			? @openssl_sign( $data, $signature, $native, $digest, $padding )
			: @openssl_sign( $data, $signature, $native, $digest );
		if ( ! $ok ) {
			throw KeyObject::unsupported( 'OpenSSL could not sign with the given key and algorithm' );
		}
		return $p1363 && 'ec' === $key->algorithm ? Asn1::derToP1363( $signature, $key->ecSize() ) : $signature;
	}

	private static function check( ?string $digest, string $data, mixed $input, string $signature ): bool {
		$key                             = self::key( $input, false );
		[$padding, $salt_length, $p1363] = self::signatureOptions( $input );
		if ( 'ed25519' === $key->algorithm ) {
			self::edDigest( $digest );
			$public = $key->edBytes();
			return strlen( $signature ) === SODIUM_CRYPTO_SIGN_BYTES && sodium_crypto_sign_verify_detached( $signature, $data, $public );
		}
		if ( $p1363 && 'ec' === $key->algorithm ) {
			$signature = Asn1::p1363ToDer( $signature, $key->ecSize() );
			if ( null === $signature ) {
				return false;
			}
		}
		$digest           ??= 'sha256';
		[$native, $padding] = self::rsaSignatureOptions( $key, $digest, $padding, $salt_length );
		$result             = self::PSS_PADDING === $padding
			? @openssl_verify( $data, $signature, $native, $digest, $padding )
			: @openssl_verify( $data, $signature, $native, $digest );
		return 1 === $result;
	}

	private static function key( mixed $input, bool $is_private ): KeyObject {
		$source = $input instanceof JsObject ? KeyObject::option( $input, 'key' ) : $input;
		if ( ! $source instanceof KeyObject ) {
			return $is_private ? KeyObject::createPrivateKey( $input ) : KeyObject::createPublicKey( $input );
		}
		if ( $is_private ) {
			if ( 'private' !== $source->type ) {
				throw JsError::node( 'Invalid key object type ' . $source->type . ', expected private', 'TypeError', 'ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE' );
			}
			return $source;
		}
		return match ( $source->type ) {
			'public' => $source,
			'private' => $source->publicPart(),
			default => throw KeyObject::unsupported( 'Expected a public or private key' ),
		};
	}

	private static function byteInput( mixed $value, string $name ): string {
		if ( ! Buffer::isView( $value ) && ! $value instanceof JsArrayBuffer ) {
			throw KeyObject::argument( $name, 'an instance of ArrayBuffer, Buffer, TypedArray, or DataView' );
		}
		return KeyObject::bounded( Buffer::bytes( $value, $name ) );
	}

	private static function oneShotDigest( mixed $algorithm ): ?string {
		return null === $algorithm || JsUndefined::Value === $algorithm ? null : self::digest( $algorithm );
	}

	private static function digest( mixed $algorithm ): string {
		if ( ! is_string( $algorithm ) ) {
			throw KeyObject::argument( 'algorithm', 'a string' );
		}
		if ( ! extension_loaded( 'openssl' ) ) {
			throw KeyObject::unsupported( 'This operation requires the PHP openssl extension' );
		}
		$name           = strtolower( $algorithm );
		$name           = preg_replace( '/^(?:rsa-)|(?:withrsaencryption)$/i', '', $name );
		static $digests = null;
		$digests      ??= array_fill_keys( array_map( 'strtolower', openssl_get_md_methods( true ) ), true );
		if ( ! isset( $digests[ $name ] ) ) {
			throw JsError::node( 'Invalid digest: ' . $algorithm, 'TypeError', 'ERR_CRYPTO_INVALID_DIGEST' );
		}
		return $name;
	}

	private static function edDigest( ?string $digest ): void {
		if ( null !== $digest ) {
			throw JsError::node( 'Ed25519 requires an omitted or null digest', 'Error', 'ERR_OSSL_INVALID_DIGEST' );
		}
	}

	/** @return array{?int, ?int, bool} */
	private static function signatureOptions( mixed $input ): array {
		if ( ! $input instanceof JsObject ) {
			return array( null, null, false );
		}
		$encoding = KeyObject::option( $input, 'dsaEncoding' );
		if ( ! in_array( $encoding, array( JsUndefined::Value, 'der', 'ieee-p1363' ), true ) ) {
			throw KeyObject::optionError( 'dsaEncoding' );
		}
		return array( self::integerOption( $input, 'padding' ), self::integerOption( $input, 'saltLength' ), 'ieee-p1363' === $encoding );
	}

	private static function integerOption( JsObject $input, string $name ): ?int {
		$value = KeyObject::option( $input, $name );
		if ( JsUndefined::Value === $value ) {
			return null;
		}
		if ( ! is_int( $value ) && ! is_float( $value ) ) {
			throw KeyObject::argument( 'options.' . $name, 'a number' );
		}
		if ( $value < -2147483648 || $value > 2147483647 || (float) (int) $value !== (float) $value ) {
			throw JsError::node( 'Invalid ' . $name, 'RangeError', 'ERR_OUT_OF_RANGE' );
		}
		return (int) $value;
	}

	/** @return array{\OpenSSLAsymmetricKey, ?int} */
	private static function rsaSignatureOptions( KeyObject $key, string $digest, ?int $padding, ?int $salt_length ): array {
		if ( 'rsa' !== $key->algorithm || null === $padding || self::PKCS1_PADDING === $padding ) {
			return array( $key->nativeKey(), null );
		}
		if ( self::PSS_PADDING !== $padding ) {
			throw KeyObject::unsupported( 'Unsupported RSA signature padding' );
		}
		if ( PHP_VERSION_ID < 80500 ) {
			throw KeyObject::unsupported( 'RSA-PSS signatures require PHP 8.5 or later' );
		}
		if ( null === $salt_length || self::PSS_SALTLEN_AUTO === $salt_length ) {
			return array( $key->nativeKey(), $padding );
		}
		if ( self::PSS_SALTLEN_DIGEST === $salt_length ) {
			if ( ! in_array( $digest, hash_algos(), true ) ) {
				throw KeyObject::unsupported( 'Unsupported RSA-PSS digest' );
			}
			$salt_length = strlen( hash( $digest, '', true ) );
		}
		if ( $salt_length < 0 ) {
			throw KeyObject::unsupported( 'Invalid RSA-PSS salt length' );
		}
		$is_private = 'private' === $key->type;
		$pem        = Asn1::pem( Asn1::rsa_pss( $key->der(), $is_private, $digest, $salt_length ), $is_private ? 'PRIVATE KEY' : 'PUBLIC KEY' );
		$native     = $is_private ? @openssl_pkey_get_private( $pem ) : @openssl_pkey_get_public( $pem );
		if ( false === $native ) {
			throw KeyObject::unsupported( 'OpenSSL could not apply the RSA-PSS key parameters' );
		}
		return array( $native, null );
	}

	private static function rsaCrypt( string $operation, mixed $input, mixed $data, bool $is_private, bool $oaep_default ): JsTypedArray {
		$key = self::key( $input, $is_private );
		if ( 'rsa' !== $key->algorithm ) {
			throw KeyObject::unsupported( 'This operation requires an RSA key' );
		}
		$padding   = $input instanceof JsObject ? self::integerOption( $input, 'padding' ) : null;
		$padding ??= $oaep_default ? self::OAEP_PADDING : self::PKCS1_PADDING;
		$hash      = $input instanceof JsObject ? KeyObject::option( $input, 'oaepHash' ) : JsUndefined::Value;
		if ( JsUndefined::Value !== $hash && ! is_string( $hash ) ) {
			throw KeyObject::argument( 'options.oaepHash', 'a string' );
		}
		$digest = JsUndefined::Value === $hash ? 'sha1' : strtolower( $hash );
		if ( self::OAEP_PADDING === $padding && 'sha1' !== $digest ) {
			if ( PHP_VERSION_ID < 80500 ) {
				throw KeyObject::unsupported( 'RSA-OAEP with a digest other than SHA-1 requires PHP 8.5 or later' );
			}
			if ( ! in_array( $digest, array_map( 'strtolower', openssl_get_md_methods( true ) ), true ) ) {
				throw JsError::node( 'Invalid digest used', 'Error', 'ERR_OSSL_EVP_INVALID_DIGEST' );
			}
		}
		if ( $input instanceof JsObject ) {
			$label = KeyObject::option( $input, 'oaepLabel' );
			if ( JsUndefined::Value !== $label && '' !== self::byteInput( $label, 'oaepLabel' ) ) {
				throw KeyObject::unsupported( 'PHP OpenSSL does not support a custom RSA-OAEP label' );
			}
		}

		// OpenSSL 3.2 added implicit rejection, which prevents a PKCS#1 v1.5 padding oracle.
		if ( 'openssl_private_decrypt' === $operation && self::PKCS1_PADDING === $padding && OPENSSL_VERSION_NUMBER < 0x30200000 ) {
			throw JsError::node( 'RSA_PKCS1_PADDING is no longer supported for private decryption with this OpenSSL version', 'TypeError', 'ERR_INVALID_ARG_VALUE' );
		}
		$bytes = self::byteInput( $data, 'buffer' );
		$ok    = match ( true ) {
			self::OAEP_PADDING === $padding && 'sha1' !== $digest && $oaep_default
				=> @$operation( $bytes, $result, $key->nativeKey(), $padding, $digest ),
			default => @$operation( $bytes, $result, $key->nativeKey(), $padding ),
		};
		if ( ! $ok ) {
			throw KeyObject::unsupported( 'OpenSSL could not perform the RSA operation with the given key and padding' );
		}
		return Buffer::wrap( $result );
	}
}
