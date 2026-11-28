<?php

declare(strict_types=1);

namespace SpacePress\Node;

use SpacePress\Js;
use SpacePress\JsArray;
use SpacePress\JsError;
use SpacePress\JsObject;
use SpacePress\JsTypedArray;
use SpacePress\JsUndefined;

/** AES ciphers over OpenSSL. GCM data is released in final() after the tag is verified. */
final class Cipher implements Dispatch {

	private const BLOCK_SIZE  = 16;
	private const CIPHERS     = array(
		'aes-128-cbc' => 16,
		'aes-128-gcm' => 16,
		'aes-256-cbc' => 32,
		'aes-256-gcm' => 32,
	);
	private const TAG_LENGTHS = array( 4, 8, 12, 13, 14, 15, 16 );

	private bool $done               = false;
	private bool $padding            = true;
	private string $pending          = '';
	private string $aad              = '';
	private ?string $tag             = null;
	private ?StringDecoder $decoder  = null;
	private ?string $output_encoding = null;

	private function __construct(
		private readonly string $algorithm,
		private readonly string $key,
		private string $iv,
		private readonly bool $gcm,
		private readonly ?int $tag_length,
		private readonly bool $encrypt,
	) {}

	public static function exports(): array {
		return array(
			'createCipheriv'   => static fn (
				mixed $algorithm = JsUndefined::Value,
				mixed $key = JsUndefined::Value,
				mixed $iv = JsUndefined::Value,
				mixed $options = JsUndefined::Value
			): self => self::create( $algorithm, $key, $iv, $options ),
			'createDecipheriv' => static fn (
				mixed $algorithm = JsUndefined::Value,
				mixed $key = JsUndefined::Value,
				mixed $iv = JsUndefined::Value,
				mixed $options = JsUndefined::Value
			): self => self::create( $algorithm, $key, $iv, $options, false ),
			'getCiphers'       => static fn (): JsArray => new JsArray( array_keys( self::CIPHERS ) ),
		);
	}

	public static function create(
		mixed $algorithm = JsUndefined::Value,
		mixed $key = JsUndefined::Value,
		mixed $iv = JsUndefined::Value,
		mixed $options = JsUndefined::Value,
		bool $encrypt = true,
	): self {
		if ( ! \is_string( $algorithm ) ) {
			throw JsError::node( 'The "cipher" argument must be of type string', 'TypeError', 'ERR_INVALID_ARG_TYPE' );
		}
		if ( ! \extension_loaded( 'openssl' ) ) {
			throw JsError::node( 'Ciphers require the PHP openssl extension', 'Error', 'ERR_OSSL_UNSUPPORTED' );
		}
		$encoding = self::option_encoding( $options );
		if ( $key instanceof CryptoKey ) {
			$key = $key->key;
		}
		$key        = $key instanceof KeyObject ? $key->secretBytes() : self::bytes( $key, 'key', $encoding );
		$iv         = null === $iv ? '' : Buffer::bytes( $iv, 'iv' );
		$tag_length = self::uint_option( $options, 'authTagLength' );
		$algorithm  = \strtolower( $algorithm );
		$algorithm  = match ( $algorithm ) {
			'aes128' => 'aes-128-cbc',
			'aes256' => 'aes-256-cbc',
			default => $algorithm,
		};
		$key_length = self::CIPHERS[ $algorithm ] ?? throw JsError::node( 'Unknown cipher', 'Error', 'ERR_CRYPTO_UNKNOWN_CIPHER' );
		$gcm        = \str_ends_with( $algorithm, '-gcm' );
		$iv_length  = \strlen( $iv );
		if ( $gcm ? 0 === $iv_length || $iv_length > 128 : self::BLOCK_SIZE !== $iv_length ) {
			throw JsError::node( 'Invalid initialization vector', 'TypeError', 'ERR_CRYPTO_INVALID_IV' );
		}
		if ( $gcm && null !== $tag_length && ! \in_array( $tag_length, self::TAG_LENGTHS, true ) ) {
			throw self::invalid_tag_length( $tag_length );
		}
		if ( $key_length !== \strlen( $key ) ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Both sides are computed values.
			throw JsError::node( 'Invalid key length', 'RangeError', 'ERR_CRYPTO_INVALID_KEYLEN' );
		}
		return new self( $algorithm, $key, $iv, $gcm, $tag_length, $encrypt );
	}

	public function read( string $key ): mixed {
		$available = match ( $key ) {
			'update', 'final', 'setAutoPadding', 'setAAD' => true,
			'getAuthTag' => $this->encrypt,
			'setAuthTag' => ! $this->encrypt,
			default => false,
		};
		if ( ! $available ) {
			return JsUndefined::Value;
		}
		return Module::method(
			'Cipher:' . $key,
			static function ( mixed $receiver, array $args ) use ( $key ): mixed {
				if ( ! $receiver instanceof self ) {
					throw new JsError( 'Illegal invocation', 'TypeError' );
				}
				return $receiver->invoke( $key, $args );
			}
		);
	}

	public function invoke( string $name, array $args ): mixed {
		$arg = static fn ( int $index ): mixed => \array_key_exists( $index, $args ) ? $args[ $index ] : JsUndefined::Value;
		return match ( $name ) {
			'update' => $this->update( $arg( 0 ), $arg( 1 ), $arg( 2 ) ),
			'final' => $this->final( $arg( 0 ) ),
			'setAutoPadding' => $this->setAutoPadding( $arg( 0 ) ),
			'setAAD' => $this->setAAD( $arg( 0 ), $arg( 1 ) ),
			'getAuthTag' => $this->getAuthTag(),
			'setAuthTag' => $this->setAuthTag( $arg( 0 ), $arg( 1 ) ),
			default => Module::inherited( $this, $name ),
		};
	}

	public function update( mixed $data, mixed $input_encoding = JsUndefined::Value, mixed $output_encoding = JsUndefined::Value ): JsTypedArray|string {
		if ( \is_string( $data ) ) {
			$encoding = Buffer::encoding( $input_encoding ) ?? 'utf8';
			if ( 'hex' === $encoding && 0 !== Js::length( $data ) % 2 ) {
				throw JsError::node( 'Hex input must contain an even number of characters', 'TypeError', 'ERR_INVALID_ARG_VALUE' );
			}
			$bytes = Buffer::decode( $data, $encoding );
		} elseif ( Buffer::isView( $data ) ) {
			$bytes = Buffer::bytes( $data, 'data' );
		} else {
			throw JsError::node( 'The "data" argument must be a string or a Buffer, TypedArray, or DataView', 'TypeError', 'ERR_INVALID_ARG_TYPE' );
		}
		if ( $this->done ) {
			throw new JsError( 'Trying to add data in unsupported state' );
		}

		$this->pending .= $bytes;
		$result         = '';
		if ( ! $this->gcm && '' !== $bytes ) {
			$length = \strlen( $this->pending );
			// When decrypting with padding, hold the last complete block until final can check it.
			$hold  = ! $this->encrypt && $this->padding ? 1 : 0;
			$ready = \intdiv( $length - $hold, self::BLOCK_SIZE ) * self::BLOCK_SIZE;
			if ( $ready > 0 ) {
				$blocks        = \substr( $this->pending, 0, $ready );
				$result        = $this->cbc( $blocks, false );
				$this->iv      = \substr( $this->encrypt ? $result : $blocks, -self::BLOCK_SIZE );
				$this->pending = \substr( $this->pending, $ready );
			}
		}
		return $this->output( $result, $output_encoding, false );
	}

	public function final( mixed $output_encoding = JsUndefined::Value ): JsTypedArray|string {
		if ( $this->done ) {
			throw self::invalid_state();
		}
		$this->done    = true;
		$bytes         = $this->pending;
		$this->pending = '';
		$result        = $this->gcm ? $this->gcm_final( $bytes ) : $this->cbc_final( $bytes );
		return $this->output( $result, $output_encoding, true );
	}

	public function setAutoPadding( mixed $enabled = JsUndefined::Value ): self { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Node API name.
		if ( $this->done ) {
			throw self::invalid_state( 'setAutoPadding' );
		}
		$this->padding = Js::truthy( $enabled );
		return $this;
	}

	public function setAAD( mixed $aad, mixed $options = JsUndefined::Value ): self { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Node API name.
		$encoding = self::option_encoding( $options );
		self::uint_option( $options, 'plaintextLength' );
		$bytes = self::bytes( $aad, 'aadbuf', $encoding );
		if ( ! $this->gcm || $this->done || '' !== $this->pending ) {
			throw self::invalid_state( 'setAAD' );
		}
		$this->aad .= $bytes;
		return $this;
	}

	public function getAuthTag(): JsTypedArray { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Node API name.
		if ( ! $this->encrypt ) {
			throw new JsError( 'getAuthTag is not a function', 'TypeError' );
		}
		if ( null === $this->tag ) {
			throw self::invalid_state( 'getAuthTag' );
		}
		return Buffer::wrap( $this->tag );
	}

	public function setAuthTag( mixed $tag, mixed $encoding = JsUndefined::Value ): self { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Node API name.
		if ( $this->encrypt ) {
			throw new JsError( 'setAuthTag is not a function', 'TypeError' );
		}
		$bytes = self::bytes( $tag, 'buffer', $encoding );
		if ( ! $this->gcm || $this->done || null !== $this->tag ) {
			throw self::invalid_state( 'setAuthTag' );
		}
		$length = \strlen( $bytes );
		if ( ! \in_array( $length, self::TAG_LENGTHS, true ) || ( null !== $this->tag_length && $this->tag_length !== $length ) ) {
			throw self::invalid_tag_length( $length );
		}
		$this->tag = $bytes;
		return $this;
	}

	private function cbc_final( string $bytes ): string {
		$length = \strlen( $bytes );
		if ( ! $this->padding && 0 !== $length % self::BLOCK_SIZE ) {
			throw JsError::node( 'Wrong final block length', 'Error', 'ERR_OSSL_WRONG_FINAL_BLOCK_LENGTH' );
		}
		if ( $this->padding && ! $this->encrypt && self::BLOCK_SIZE !== $length ) {
			throw JsError::node( 'Wrong final block length', 'Error', 'ERR_OSSL_WRONG_FINAL_BLOCK_LENGTH' );
		}
		return $this->cbc( $bytes, $this->padding );
	}

	private function cbc( string $bytes, bool $padding ): string {
		$flags  = OPENSSL_RAW_DATA | ( $padding ? 0 : OPENSSL_ZERO_PADDING );
		$result = $this->encrypt
			? \openssl_encrypt( $bytes, $this->algorithm, $this->key, $flags, $this->iv )
			: \openssl_decrypt( $bytes, $this->algorithm, $this->key, $flags, $this->iv );
		if ( false === $result ) {
			throw JsError::node( 'Bad decrypt', 'Error', 'ERR_OSSL_BAD_DECRYPT' );
		}
		return $result;
	}

	private function gcm_final( string $bytes ): string {
		if ( $this->encrypt ) {
			$tag    = '';
			$result = \openssl_encrypt( $bytes, $this->algorithm, $this->key, OPENSSL_RAW_DATA, $this->iv, $tag, $this->aad, $this->tag_length ?? 16 );
			if ( false !== $result ) {
				$this->tag = $tag;
				return $result;
			}
		} elseif ( null !== $this->tag ) {
			$result = \openssl_decrypt( $bytes, $this->algorithm, $this->key, OPENSSL_RAW_DATA, $this->iv, $this->tag, $this->aad );
			if ( false !== $result ) {
				return $result;
			}
		}
		throw new JsError( 'Unsupported state or unable to authenticate data' );
	}

	private function output( string $bytes, mixed $encoding, bool $done ): JsTypedArray|string {
		if ( ! Js::truthy( $encoding ) || 'buffer' === $encoding ) {
			return Buffer::wrap( $bytes );
		}
		$name = Buffer::knownEncoding( $encoding );
		if ( null !== $this->output_encoding && $this->output_encoding !== $name ) {
			throw JsError::node( 'Cannot change encoding', 'Error', 'ERR_INTERNAL_ASSERTION' );
		}
		$this->output_encoding = $name;
		$this->decoder       ??= new StringDecoder( $name );
		return $done ? $this->decoder->end_bytes( $bytes ) : $this->decoder->write_bytes( $bytes );
	}

	private static function bytes( mixed $value, string $name, mixed $encoding ): string {
		if ( \is_string( $value ) && \is_string( $encoding ) && '' !== $encoding ) {
			return Buffer::decode( $value, Buffer::knownEncoding( $encoding ) );
		}
		return Buffer::bytes( $value, $name );
	}

	private static function option_encoding( mixed $options ): mixed {
		$encoding = $options instanceof JsObject ? $options->p['encoding'] ?? null : null;
		if ( null !== $encoding && JsUndefined::Value !== $encoding && ! \is_string( $encoding ) ) {
			throw JsError::node( 'The "options.encoding" property must be of type string', 'TypeError', 'ERR_INVALID_ARG_TYPE' );
		}
		return $encoding;
	}

	private static function uint_option( mixed $options, string $name ): ?int {
		$value = $options instanceof JsObject ? $options->p[ $name ] ?? null : null;
		if ( null === $value || JsUndefined::Value === $value ) {
			return null;
		}
		if ( ( ! \is_int( $value ) && ! \is_float( $value ) ) || $value < 0 || $value > 4294967295 || (float) (int) $value !== (float) $value ) {
			throw JsError::node( "The property 'options.$name' is invalid", 'TypeError', 'ERR_INVALID_ARG_VALUE' );
		}
		return (int) $value;
	}

	private static function invalid_state( string $operation = '' ): JsError {
		return JsError::node( 'Invalid state' . ( '' === $operation ? '' : ' for operation ' . $operation ), 'Error', 'ERR_CRYPTO_INVALID_STATE' );
	}

	private static function invalid_tag_length( int $length ): JsError {
		return JsError::node( "Invalid authentication tag length: $length", 'TypeError', 'ERR_CRYPTO_INVALID_AUTH_TAG' );
	}
}
