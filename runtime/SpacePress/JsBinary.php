<?php
declare(strict_types=1);
namespace SpacePress;

/** Checked-JavaScript dispatch for byte values: buffers, views, text codecs, Blob and File. */
final class JsBinary {

	public const GLOBALS = array(
		'ArrayBuffer',
		'SharedArrayBuffer',
		'DataView',
		'TextEncoder',
		'TextDecoder',
		'Blob',
		'File',
		'FileReader',
		'Int8Array',
		'Uint8Array',
		'Uint8ClampedArray',
		'Int16Array',
		'Uint16Array',
		'Int32Array',
		'Uint32Array',
		'Float32Array',
		'Float64Array',
		'BigInt64Array',
		'BigUint64Array',
	);

	private const TYPED_METHODS = array( 'subarray', 'slice', 'set', 'fill', 'indexOf', 'lastIndexOf', 'includes', 'at', 'join', 'toString', 'keys', 'values', 'entries', 'reverse', 'forEach', 'map', 'filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'reduce' );

	private static array $methods = array();

	public static function is( mixed $value ): bool {
		return $value instanceof JsArrayBuffer || $value instanceof JsTypedArray || $value instanceof JsDataView || $value instanceof JsText || $value instanceof JsBlob;
	}

	public static function construct( string $name, array $a ): object {
		if ( JsTypedArray::isKind( $name ) ) {
			return JsTypedArray::construct( $name, $a ); }
		return match ( $name ) {
			'ArrayBuffer' => ( function () use ( $a ) {
				$options = $a[1] ?? JsUndefined::Value;
				if ( ! Js::isNullish( $options ) && is_object( $options ) && Js::dynamicGet( $options, 'maxByteLength' ) !== JsUndefined::Value ) {
					throw new JsError( 'Resizable ArrayBuffer is not supported', 'TypeError' );
				}
				return JsArrayBuffer::allocate( $a[0] ?? JsUndefined::Value );
			} )(),
			'DataView' => JsDataView::construct( $a ),
			'TextEncoder' => JsText::encoder( $a ),
			'TextDecoder' => JsText::decoder( $a ),
			'Blob', 'File' => JsBlob::construct( $name, $a ),
			'SharedArrayBuffer' => throw new JsError( 'SharedArrayBuffer is not supported', 'TypeError' ),
			'BigInt64Array', 'BigUint64Array' => throw new JsError( $name . ' is not supported', 'TypeError' ),
			// Node defines no FileReader; libraries reach it only when Blob.arrayBuffer is missing.
			'FileReader' => throw new JsError( 'FileReader is not defined', 'ReferenceError' ),
			default => throw new JsError( 'Value is not a supported constructor', 'TypeError' ),
		};
	}

	public static function staticCall( string $owner, string $method, array $a ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( 'ArrayBuffer' === $owner && 'isView' === $method ) {
			$value = $a[0] ?? JsUndefined::Value;
			return $value instanceof JsTypedArray || $value instanceof JsDataView;
		}
		if ( JsTypedArray::isKind( $owner ) && 'from' === $method ) {
			return JsTypedArray::from( $owner, $a ); }
		if ( JsTypedArray::isKind( $owner ) && 'of' === $method ) {
			return JsTypedArray::of( $owner, $a ); }
		throw new JsError( $owner . '.' . $method . ' is not supported', 'TypeError' );
	}

	/** `value instanceof constructor` when the right side is a runtime value. */
	public static function instanceOfValue( mixed $value, mixed $constructor ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( $constructor instanceof JsConstructor ) {
			return self::instanceOf( $value, $constructor->name ); }
		if ( $constructor instanceof JsClass ) {
			return JsClass::isInstance( $value, $constructor ); }
		throw new JsError( "Right-hand side of 'instanceof' is not a supported constructor", 'TypeError' );
	}

	public static function constructorGet( JsConstructor $constructor, string $key ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$name = $constructor->name;
		if ( 'name' === $key ) {
			return $name; }
		if ( 'BYTES_PER_ELEMENT' === $key && JsTypedArray::isKind( $name ) ) {
			return JsTypedArray::KINDS[ $name ][0]; }
		$static = 'ArrayBuffer' === $name ? 'isView' === $key : JsTypedArray::isKind( $name ) && ( 'from' === $key || 'of' === $key );
		if ( ! $static ) {
			return JsUndefined::Value; }
		$method = $name . '.' . $key;
		if ( ! isset( self::$methods[ $method ] ) ) {
			$invoke                   = static fn ( mixed $thisArg, JsArray $args ): mixed => self::staticCall( $name, $key, $args->a ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			self::$methods[ $method ] = Js::dynamicMethodFunction( static fn ( ...$args ) => $invoke( JsUndefined::Value, new JsArray( $args ) ), $invoke );
		}
		return self::$methods[ $method ];
	}

	// phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the method name used by compiled PHP.
	public static function instanceOf( mixed $value, string $name ): bool {
		return match ( $name ) {
			'ArrayBuffer' => $value instanceof JsArrayBuffer,
			'DataView' => $value instanceof JsDataView,
			'TextEncoder' => $value instanceof JsText && ! $value->decoder,
			'TextDecoder' => $value instanceof JsText && $value->decoder,
			'Blob' => $value instanceof JsBlob,
			'File' => $value instanceof JsBlob && null !== $value->name,
			default => $value instanceof JsTypedArray && $value->kind === $name,
		};
	}

	public static function tag( object $value ): string {
		return match ( true ) {
			$value instanceof JsTypedArray => $value->kind,
			$value instanceof JsArrayBuffer => 'ArrayBuffer',
			$value instanceof JsDataView => 'DataView',
			$value instanceof JsText => $value->decoder ? 'TextDecoder' : 'TextEncoder',
			$value instanceof JsBlob => null === $value->name ? 'Blob' : 'File',
		};
	}

	private static function has_method( object $value, string $name ): bool {
		return match ( true ) {
			$value instanceof JsTypedArray => in_array( $name, self::TYPED_METHODS, true ),
			$value instanceof JsArrayBuffer => 'slice' === $name,
			$value instanceof JsDataView => JsDataView::method( $name ),
			$value instanceof JsText => $name === ( $value->decoder ? 'decode' : 'encode' ) || ! $value->decoder && 'encodeInto' === $name, // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
			$value instanceof JsBlob => in_array( $name, array( 'slice', 'text', 'arrayBuffer', 'bytes', 'stream' ), true ),
		};
	}

	public static function get( object $value, string $key ): mixed {
		$own = match ( true ) {
			$value instanceof JsArrayBuffer => match ( $key ) {
				'byteLength', 'maxByteLength' => $value->byteLength(), 'resizable', 'detached' => false, default => null,
			},
			default => $value->get( $key ),
		};
		if ( null !== $own ) {
			return $own; }
		if ( $value instanceof JsBlob && null === $value->name && in_array( $key, array( 'name', 'lastModified' ), true ) ) {
			return JsUndefined::Value; }
		if ( $value instanceof JsTypedArray && $value->node_buffer && Node\Buffer::has( $key ) ) {
			return Node\Module::method(
				'Buffer:' . $key,
				static fn ( mixed $receiver, array $args ): mixed => Node\Buffer::isBuffer( $receiver )
					? Node\Buffer::call( $receiver, $key, $args )
					: throw new JsError( 'Illegal invocation', 'TypeError' )
			);
		}
		if ( self::has_method( $value, $key ) || 'toString' === $key || 'valueOf' === $key ) {
			return self::method( $value, $key ); }
		return JsUndefined::Value;
	}

	/** One function value per family and name, like a prototype method; calls check their receiver. */
	private static function method( object $value, string $name ): \Closure {
		$family = $value instanceof JsTypedArray ? 'TypedArray' : self::tag( $value );
		$key    = $family . ':' . $name;
		if ( ! isset( self::$methods[ $key ] ) ) {
			$invoke                = static function ( mixed $thisArg, JsArray $args ) use ( $family, $name ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$compatible = is_object( $thisArg ) && self::is( $thisArg ) && ( $thisArg instanceof JsTypedArray ? 'TypedArray' : self::tag( $thisArg ) ) === $family; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				if ( 'valueOf' === $name ) {
					return Js::requirePresent( $thisArg ); } // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				if ( 'toString' === $name && ! $thisArg instanceof JsTypedArray ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
					return Js::dynamicObjectTag( $thisArg ); } // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				if ( ! $compatible ) {
					throw new JsError( 'Illegal invocation', 'TypeError' ); }
				return self::call( $thisArg, $name, $args->a ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			};
			self::$methods[ $key ] = Js::dynamicMethodFunction( static fn ( ...$args ) => $invoke( JsUndefined::Value, new JsArray( $args ) ), $invoke );
		}
		return self::$methods[ $key ];
	}

	public static function call( object $value, string $name, array $a ): mixed {
		if ( $value instanceof JsTypedArray && $value->node_buffer && Node\Buffer::has( $name ) ) {
			return Node\Buffer::call( $value, $name, $a );
		}
		if ( 'valueOf' === $name ) {
			return $value; }
		if ( 'toString' === $name && ! $value instanceof JsTypedArray ) {
			return Js::dynamicObjectTag( $value ); }
		if ( $value instanceof JsArrayBuffer ) {
			if ( 'slice' === $name ) {
				return $value->slice( $a[0] ?? JsUndefined::Value, $a[1] ?? JsUndefined::Value ); }
			throw new JsError( $name . ' is not a function', 'TypeError' );
		}
		return $value->call( $name, $a );
	}

	public static function set( object $value, string $key, mixed $item ): mixed {
		if ( $value instanceof JsTypedArray && $value->set( $key, $item ) ) {
			return $item; }
		throw new JsError( 'Cannot add property ' . $key . ' to a ' . self::tag( $value ) . ' in compiled code', 'TypeError' );
	}

	/** Own enumerable keys: a typed array's indexes; the others have none. */
	public static function keys( object $value ): array {
		return $value instanceof JsTypedArray && $value->length > 0 ? array_map( 'strval', range( 0, $value->length - 1 ) ) : array();
	}

	public static function iterate( object $value ): array {
		if ( $value instanceof JsTypedArray ) {
			return $value->values(); }
		throw new JsError( self::tag( $value ) . ' is not iterable', 'TypeError' );
	}

	/** JSON.stringify exposes Buffer data and indexes of other typed arrays. */
	public static function json( object $value ): \stdClass {
		if ( $value instanceof JsTypedArray && $value->node_buffer ) {
			return Node\Buffer::json( $value );
		}
		$out = new \stdClass();
		if ( $value instanceof JsTypedArray ) {
			foreach ( $value->values() as $i => $item ) {
				$out->{ (string) $i} = is_float( $item ) && ! is_finite( $item ) ? null : ( 0.0 === (float) $item ? 0 : $item );
			}
		}
		return $out;
	}

	/** structuredClone: buffers and views copy their bytes; Blob and File are immutable. */
	public static function copy( object $value, \SplObjectStorage $seen ): object {
		if ( $seen->offsetExists( $value ) ) {
			return $seen[ $value ]; }
		$copy = match ( true ) {
			$value instanceof JsArrayBuffer => new JsArrayBuffer( $value->bytes ),
			$value instanceof JsTypedArray => new JsTypedArray( $value->kind, self::copy( $value->buffer, $seen ), $value->offset, $value->length ),
			$value instanceof JsDataView => new JsDataView( self::copy( $value->buffer, $seen ), $value->offset, $value->length ),
			$value instanceof JsBlob => $value,
			$value instanceof JsText => throw new JsError( self::tag( $value ) . ' object could not be cloned', 'DataCloneError' ),
		};
		$seen[ $value ] = $copy;
		return $copy;
	}

	/**
	 * Action and ability results are JSON. JSON has no byte type, and JSON.stringify's object of
	 * indexes is not a wire contract a client can rely on, so byte values are refused there.
	 */
	public static function refuseWire( mixed $value, string $where ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		self::find_bytes( $value, $where, '', new \SplObjectStorage() );
		return $value;
	}

	private static function find_bytes( mixed $value, string $where, string $path, \SplObjectStorage $seen ): void {
		if ( ! is_object( $value ) || $value instanceof \Closure ) {
			return; }
		if ( self::is( $value ) ) {
			throw new JsError( $where . ' returned a ' . self::tag( $value ) . ( '' === $path ? '' : ' at ' . $path ) . '; JSON has no byte type; return text instead, such as new TextDecoder().decode(bytes) or a base64 string', 'TypeError' );
		}
		if ( $seen->offsetExists( $value ) ) {
			return; }
		$seen->offsetSet( $value );
		$items = match ( true ) {
			$value instanceof JsArray => $value->a + $value->p,
			$value instanceof JsObject, $value instanceof JsArguments => $value->p,
			default => array(),
		};
		foreach ( $items as $key => $item ) {
			self::find_bytes( $item, $where, $path . '.' . $key, $seen ); }
	}

	public static function btoa( mixed $value ): string {
		$text = Js::str( $value );
		if ( preg_match( '/[^\x00-\x7F]/', $text ) ) {
			$latin = mb_convert_encoding( $text, 'ISO-8859-1', 'UTF-8' );
			if ( mb_convert_encoding( $latin, 'UTF-8', 'ISO-8859-1' ) !== $text ) {
				throw new JsError( 'Invalid character', 'InvalidCharacterError' );
			}
			$text = $latin;
		}
		return base64_encode( $text );
	}

	/** WHATWG forgiving-base64 decode; the result is a Latin-1 string. */
	public static function atob( mixed $value ): string {
		$text = preg_replace( '/[\t\n\f\r ]+/', '', Js::str( $value ) );
		if ( 0 === strlen( $text ) % 4 && preg_match( '/==?$/', $text ) ) {
			$text = preg_replace( '/==?$/', '', $text ); }
		if ( 1 === strlen( $text ) % 4 || ! preg_match( '/^[A-Za-z0-9+\/]*$/D', $text ) ) {
			throw new JsError( 'The string to be decoded is not correctly encoded.', 'InvalidCharacterError' );
		}
		$bytes = base64_decode( $text . str_repeat( '=', ( 4 - strlen( $text ) % 4 ) % 4 ) );
		return mb_convert_encoding( $bytes, 'UTF-8', 'ISO-8859-1' );
	}
}
