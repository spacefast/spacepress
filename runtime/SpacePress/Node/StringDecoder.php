<?php
declare(strict_types=1);
namespace SpacePress\Node;

use SpacePress\Js;
use SpacePress\JsError;
use SpacePress\JsUndefined;

/** Buffers the trailing bytes of an incomplete UTF or base64 group until the next write. */
final class StringDecoder implements Dispatch {
	private string $pending = '';
	private readonly string $encoding;

	public function __construct( mixed $encoding = JsUndefined::Value ) {
		$this->encoding = Buffer::knownEncoding( Js::truthy( $encoding ) ? $encoding : JsUndefined::Value );
	}

	public static function exports(): array {
		static $constructor;
		$constructor ??= new Ctor(
			'StringDecoder',
			array(),
			static fn ( mixed $value ): bool => $value instanceof self,
			static fn ( array $args ): self => new self( ...array_slice( $args, 0, 1 ) )
		);
		return array( 'StringDecoder' => $constructor );
	}

	public function read( string $key ): mixed {
		return match ( $key ) {
			'encoding' => $this->encoding,
			'write', 'end' => Module::method(
				'StringDecoder.' . $key,
				static function ( mixed $receiver, array $args ) use ( $key ): string {
					if ( ! $receiver instanceof self ) {
						throw new JsError( 'Value of "this" must be of type StringDecoder', 'TypeError' );
					}
					return $receiver->invoke( $key, $args );
				}
			),
			default => JsUndefined::Value,
		};
	}

	public function invoke( string $name, array $args ): mixed {
		$input = array_key_exists( 0, $args ) ? $args[0] : JsUndefined::Value;
		return match ( $name ) {
			'write' => $this->write( $input ),
			'end' => $this->end( $input ),
			default => Module::inherited( $this, $name ),
		};
	}

	public function write( mixed $input = JsUndefined::Value ): string {
		return is_string( $input ) ? $input : $this->write_bytes( self::bytes( $input ) );
	}

	public function end( mixed $input = JsUndefined::Value ): string {
		$out = JsUndefined::Value === $input ? '' : $this->write( $input );
		return $out . $this->end_bytes();
	}

	private static function bytes( mixed $input ): string {
		if ( ! Buffer::isView( $input ) ) {
			throw JsError::node( 'The "buf" argument must be an instance of Buffer, TypedArray, or DataView', 'TypeError', 'ERR_INVALID_ARG_TYPE' );
		}
		return $input->bytes();
	}

	public function write_bytes( string $bytes ): string {
		$bytes   = $this->pending . $bytes;
		$length  = strlen( $bytes );
		$pending = match ( $this->encoding ) {
			'utf8' => self::utf8_tail( $bytes ),
			'utf16le' => self::utf16_tail( $bytes ),
			'base64', 'base64url' => $length % 3,
			default => 0,
		};
		$end           = $length - $pending;
		$this->pending = substr( $bytes, $end );
		return Buffer::encode( substr( $bytes, 0, $end ), $this->encoding );
	}

	public function end_bytes( string $bytes = '' ): string {
		$out           = $this->write_bytes( $bytes ) . Buffer::encode( $this->pending, $this->encoding );
		$this->pending = '';
		return $out;
	}

	private static function utf8_tail( string $bytes ): int {
		$size = strlen( $bytes );
		for ( $i = $size - 1; $i >= 0 && $i >= $size - 3; --$i ) {
			$lead = ord( $bytes[ $i ] );
			if ( $lead >= 0x80 && $lead <= 0xBF ) {
				continue;
			}
			$required = match ( true ) {
				$lead >= 0xC0 && $lead <= 0xDF => 2,
				$lead >= 0xE0 && $lead <= 0xEF => 3,
				$lead >= 0xF0 && $lead <= 0xF7 => 4,
				default => 0,
			};
			return $required > $size - $i ? $size - $i : 0;
		}
		return 0;
	}

	private static function utf16_tail( string $bytes ): int {
		$length         = strlen( $bytes );
		$odd            = $length % 2;
		$last_high_byte = $length - $odd - 1;
		if ( $last_high_byte >= 0 && ( ord( $bytes[ $last_high_byte ] ) & 0xFC ) === 0xD8 ) {
			return $odd + 2;
		}
		return $odd;
	}
}
