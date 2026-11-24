<?php
declare(strict_types=1);
namespace SpacePress;

/** Checked operations for imported JavaScript; authored TypeScript keeps its static contracts. */
trait JsDynamic {

	private static array $dynamicNamespaces          = array();
	private static array $dynamicMethods             = array();
	private static ?\WeakMap $dynamicMethodReceivers = null;

	public static function dynamicNamespace( string $name ): JsNamespace {
		if ( 'Math' !== $name && 'AbortSignal' !== $name ) {
			throw new JsError( 'Unsupported JavaScript namespace ' . $name, 'TypeError' ); }
		return self::$dynamicNamespaces[ $name ] ??= new JsNamespace( $name );
	}

	private static function dynamicMethodValue( mixed $receiver, string $name ): mixed {
		if ( $receiver instanceof JsPromise || $receiver instanceof JsGenerator || $receiver instanceof JsAsyncGenerator ) {
			$methods = $receiver instanceof JsPromise ? array( 'then', 'catch', 'finally' ) : array( 'next', 'return', 'throw' );
			if ( ! in_array( $name, $methods, true ) ) {
				return JsUndefined::Value; }
			return static fn ( ...$args ) => $receiver->call( $name, $args );
		}
		if ( $receiver instanceof JsObject && ( $receiver->class?->hasMethod( $name ) ?? false ) ) {
			return $receiver->class->methodValue( $name, false );
		}
		if ( $receiver instanceof JsClass && $receiver->hasStaticMethod( $name ) ) {
			return $receiver->methodValue( $name, true );
		}
		if ( $receiver instanceof JsObject && $receiver->nullPrototype ) {
			return JsUndefined::Value; }
		$owner = match ( true ) {
			$receiver instanceof JsNamespace => $receiver->name,
			$receiver instanceof JsArray => 'Array', is_string( $receiver ) => 'String',
			$receiver instanceof RegExp => 'RegExp', $receiver instanceof JsDate => 'Date',
			$receiver instanceof JsError => 'Error',
			$receiver instanceof JsSet => 'Set', $receiver instanceof JsMap => 'Map', $receiver instanceof JsIterator => 'Iterator',
			$receiver instanceof JsAbortSignal => 'AbortSignal', $receiver instanceof JsAbortController => 'AbortController',
			$receiver instanceof JsUrl => 'URL', $receiver instanceof JsUrlSearchParams => 'URLSearchParams',
			$receiver instanceof JsWeakMap => 'WeakMap', $receiver instanceof JsWeakSet => 'WeakSet',
			$receiver instanceof JsSymbol => 'Symbol',
			$receiver instanceof \Closure => 'Function', is_bool( $receiver ) => 'Boolean',
			is_int( $receiver ), is_float( $receiver ) => 'Number', $receiver instanceof JsBigInt => 'BigInt',
			default => 'Object',
		};
		if ( $receiver instanceof \Closure && in_array( $name, array( 'bind', 'length', 'name', 'prototype', 'arguments', 'caller' ), true ) ) {
			throw new JsError( 'Function metadata and binding are not supported', 'TypeError' );
		}
		if ( 'valueOf' === $name && ! in_array( $owner, array( 'Number', 'String', 'Boolean', 'Date', 'BigInt' ), true )
			|| 'toString' === $name && in_array( $owner, array( 'Math', 'AbortSignal', 'Set', 'Map', 'WeakMap', 'WeakSet' ), true ) ) {
			$owner = 'Object'; }
		// Namespaces (Math, AbortSignal) expose static functions; inherited Object methods stay shared.
		$static  = $receiver instanceof JsNamespace && 'Object' !== $owner;
		$surface = $static ? $owner : match ( $owner ) {
			'RegExp' => 'regex', default => strtolower( $owner ) };
		if ( ! Builtins::has( $surface, $name ) && ! in_array( $name, array( 'toString', 'valueOf' ), true ) ) {
			if ( Builtins::has( 'object', $name ) ) {
				throw new JsError( 'Unsupported inherited method ' . $name, 'TypeError' ); }
			return JsUndefined::Value;
		}
		$key = ( $static ? 'static:' : '' ) . $owner . ':' . $name;
		if ( ! isset( self::$dynamicMethods[ $key ] ) ) {
			$invoke = match ( true ) {
				'Array' === $owner && 'slice' === $name => self::dynamicBorrowedSlice( ... ),
				$static && Builtins::has( $owner, $name ) => static fn ( $thisArg, JsArray $args ) => self::dynamicStaticCall( $owner, $name, $args ),
				default => static fn ( $thisArg, JsArray $args ) => self::dynamicBorrowedMethod( $owner, $thisArg, $name, $args ),
			};
			$function                                  = static fn ( ...$args ) => $invoke( JsUndefined::Value, new JsArray( $args ) );
			self::$dynamicMethods[ $key ]              = $function;
			self::$dynamicMethodReceivers            ??= new \WeakMap();
			self::$dynamicMethodReceivers[ $function ] = $invoke;
		}
		return self::$dynamicMethods[ $key ];
	}

	private static function dynamicBorrowedMethod( string $owner, mixed $receiver, string $name, JsArray $args ): mixed {
		if ( 'Object' === $owner && 'toString' === $name ) {
			return self::dynamicObjectTag( $receiver ); }
		if ( 'Object' === $owner && 'valueOf' === $name ) {
			self::requirePresent( $receiver );
			if ( ! is_object( $receiver ) ) {
				throw new JsError( 'Object valueOf boxing is not supported', 'TypeError' ); }
			return $receiver;
		}
		$compatible = match ( $owner ) {
			'Array' => $receiver instanceof JsArray, 'String' => is_string( $receiver ),
			'Number' => is_int( $receiver ) || is_float( $receiver ), 'Boolean' => is_bool( $receiver ),
			'BigInt' => $receiver instanceof JsBigInt,
			'RegExp' => $receiver instanceof RegExp, 'Date' => $receiver instanceof JsDate,
			'Error' => $receiver instanceof JsError,
			'Set' => $receiver instanceof JsSet, 'Map' => $receiver instanceof JsMap,
			'AbortSignal' => $receiver instanceof JsAbortSignal, 'AbortController' => $receiver instanceof JsAbortController,
			'URL' => $receiver instanceof JsUrl, 'URLSearchParams' => $receiver instanceof JsUrlSearchParams,
			'WeakMap' => $receiver instanceof JsWeakMap, 'WeakSet' => $receiver instanceof JsWeakSet,
			'Symbol' => $receiver instanceof JsSymbol,
			'Function' => $receiver instanceof \Closure, 'Object' => $receiver instanceof JsObject,
			default => false,
		};
		if ( ! $compatible ) {
			throw new JsError( 'Borrowing methods across builtin families is not supported', 'TypeError' ); }
		return self::dynamicCallMethod( $receiver, $name, $args, true );
	}

	/** Array.prototype.slice borrowed by dense arrays or ordinary arguments. */
	private static function dynamicBorrowedSlice( mixed $receiver, JsArray $args ): JsArray {
		self::requirePresent( $receiver );
		if ( ! $receiver instanceof JsArray && ! $receiver instanceof JsArguments ) {
			throw new JsError( 'Borrowed Array.slice supports arrays and arguments only', 'TypeError' );
		}
		$length = $receiver instanceof JsArray ? count( $receiver->a )
			: (int) min( 9007199254740991, max( 0, self::toInteger( self::toNumber( $receiver->length ) ) ) );
		$start  = array_key_exists( 0, $args->a ) ? $args->a[0] : JsUndefined::Value;
		$end    = array_key_exists( 1, $args->a ) ? $args->a[1] : JsUndefined::Value;
		$from   = self::relIndex( self::toNumber( $start ), $length );
		$to     = JsUndefined::Value === $end ? $length : self::relIndex( self::toNumber( $end ), $length );
		$result = new JsArray();
		for ( $i = $from; $i < $to; $i++ ) {
			if ( ! array_key_exists( $i, $receiver->a ) ) {
				throw new JsError( 'Sparse borrowed Array.slice is not supported', 'TypeError' );
			}
			$result->a[] = self::dynamicGet( $receiver, (string) $i );
		}
		return $result;
	}

	public static function undefined(): JsUndefined {
		return JsUndefined::Value; }
	public static function isNullish( mixed $value ): bool {
		return null === $value || JsUndefined::Value === $value; }

	/** The compiler uses this eager fallback only for literal values with no side effects. */
	public static function coalesce( mixed $value, mixed $fallback ): mixed {
		return self::isNullish( $value ) ? $fallback : $value;
	}
	public static function requirePresent( mixed $value ): mixed {
		if ( self::isNullish( $value ) ) {
			throw new JsError( 'Cannot read properties of null or undefined', 'TypeError' ); }
		return $value;
	}
	public static function arguments( array $values ): JsArguments {
		return new JsArguments( $values ); }

	public static function dynamicGet( mixed $value, mixed $key ): mixed {
		// Typed array element reads are the hot path of byte algorithms (hashes, codecs).
		if ( is_int( $key ) && $value instanceof JsTypedArray ) {
			return $key >= 0 && $key < $value->length ? $value->at( $key ) : JsUndefined::Value; }
		if ( self::isNullish( $value ) ) {
			throw new JsError( 'Cannot read properties of null or undefined', 'TypeError' ); }
		if ( $key instanceof JsSymbol ) {
			return self::symbolGet( $value, $key ); }
		$key = self::key( $key );
		if ( $value instanceof JsSymbol ) {
			return 'description' === $key ? $value->description : self::dynamicMethodValue( $value, $key );
		}
		if ( $value instanceof JsObject ) {
			if ( '__proto__' === $key && ! $value->nullPrototype && ! array_key_exists( $key, $value->p ) ) {
				throw new JsError( 'Prototype access is not supported', 'TypeError' ); }
			if ( array_key_exists( $key, $value->p ) ) {
				return $value->p[ $key ]; }
			if ( array_key_exists( $key, $value->hidden ) ) {
				return self::hiddenValue( $value, $key ); }
			if ( null !== $value->class && ( $inherited = $value->class->readInherited( $value, $key, false ) ) !== JsClass::absent() ) {
				return $inherited; }
			return self::dynamicMethodValue( $value, $key );
		}
		if ( $value instanceof JsPrototype ) {
			return self::prototypeGet( $value, $key ); }
		if ( $value instanceof JsClass && 'prototype' === $key ) {
			return $value->prototype(); }
		if ( $value instanceof JsClass ) {
			return $value->has( $key ) || ! $value->hasStaticMethod( $key ) ? $value->get( $key ) ?? JsUndefined::Value : self::dynamicMethodValue( $value, $key ); }
		if ( JsBinary::is( $value ) ) {
			return JsBinary::get( $value, $key ); }
		if ( $value instanceof JsConstructor ) {
			return JsBinary::constructorGet( $value, $key ); }
		if ( $value instanceof JsNamespace && 'AbortSignal' === $value->name ) {
			return in_array( $key, array( 'abort', 'any', 'timeout' ), true ) ? self::dynamicMethodValue( $value, $key ) : JsUndefined::Value;
		}
		if ( $value instanceof JsAbortSignal ) {
			return match ( $key ) {
				'aborted' => $value->aborted, 'reason' => $value->reason, 'onabort' => $value->onabort() ?? null, default => self::dynamicMethodValue( $value, $key ) };
		}
		if ( $value instanceof JsAbortController && 'signal' === $key ) {
			return $value->signal; }
		if ( $value instanceof JsReadableStream || $value instanceof JsWritableStream || $value instanceof JsTransformStream ) {
			return $value->get( $key ); }
		if ( $value instanceof JsNamespace && 'Math' === $value->name ) {
			return match ( $key ) {
				'PI' => M_PI, 'E' => M_E,
				default => Builtins::has( 'Math', $key ) || in_array( $key, array( 'toString', 'valueOf' ), true )
					? self::dynamicMethodValue( $value, $key )
					: throw new JsError( 'Unsupported Math property ' . $key, 'TypeError' ),
			};
		}
		if ( $value instanceof JsError ) {
			return match ( $key ) {
				'name' => $value->jsName, 'message' => $value->getMessage(), 'errors' => $value->errors ?? JsUndefined::Value, 'stack' => self::str( $value ), 'cause' => JsUndefined::Value, default => self::dynamicMethodValue( $value, $key ) };
		}
		if ( $value instanceof JsArray || $value instanceof JsArguments ) {
			if ( $value instanceof JsArguments && 'callee' === $key ) {
				throw new JsError( 'Restricted arguments property', 'TypeError' ); }
			if ( 'length' === $key ) {
				return $value instanceof JsArguments ? $value->length : count( $value->a ); }
			if ( preg_match( '/^(?:0|[1-9][0-9]*)$/D', $key ) && (float) $key < 4294967295 ) {
				return array_key_exists( (int) $key, $value->a ) ? $value->a[ (int) $key ] : JsUndefined::Value;
			}
			return array_key_exists( $key, $value->p ) ? $value->p[ $key ] : self::dynamicMethodValue( $value, $key );
		}
		if ( is_string( $value ) ) {
			if ( 'length' === $key ) {
				return self::length( $value ); }
			if ( preg_match( '/^(?:0|[1-9][0-9]*)$/D', $key ) ) {
				return self::strIndex( $value, (float) $key ) ?? JsUndefined::Value; }
		}
		if ( $value instanceof RegExp ) {
			return match ( $key ) {
				'source' => $value->source, 'flags' => $value->flags, 'global' => $value->global,
				'ignoreCase' => str_contains( $value->flags, 'i' ), 'multiline' => str_contains( $value->flags, 'm' ),
				'unicode' => str_contains( $value->flags, 'u' ), 'dotAll' => str_contains( $value->flags, 's' ),
				'sticky' => $value->sticky, 'lastIndex' => $value->lastIndex, 'hasIndices', 'unicodeSets' => false, default => self::dynamicMethodValue( $value, $key ),
			};
		}
		if ( 'size' === $key && ( $value instanceof JsSet || $value instanceof JsMap || $value instanceof JsUrlSearchParams ) ) {
			return $value->size();
		}
		if ( $value instanceof JsUrl && ( 'searchParams' === $key || in_array( $key, JsUrl::PROPERTIES, true ) ) ) {
			return $value->get( $key ); }
		return self::dynamicMethodValue( $value, $key );
	}

	/** A hidden own property; a lazy stack is formatted from the error's current name and message. */
	private static function hiddenValue( JsObject $value, string $key ): mixed {
		$hidden = $value->hidden[ $key ];
		if ( 'stack' === $key && $hidden === JsClass::lazyStack() ) {
			// V8 formats the header from the error at the first read; SpacePress records no frames.
			$hidden = $value->hidden['stack'] = self::str( $value );
		}
		return $hidden;
	}

	/** A named optional property read; computed keys still need a lazy guard in compiled code. */
	public static function optionalDataGet( mixed $value, string $key ): mixed {
		return self::isNullish( $value ) ? JsUndefined::Value : self::dataGet( $value, $key );
	}

	public static function dataGet( mixed $value, mixed $key ): mixed {
		self::requirePresent( $value );
		$key = self::key( $key );
		if ( $value instanceof JsObject && ! $value->nullPrototype && ! array_key_exists( $key, $value->p ) && Builtins::has( 'object', $key )
			&& ( null === $value->class || $value->class->accessor( $key, false ) === null ) ) {
			throw new JsError( 'Inherited properties are not supported by typed data reads', 'TypeError' );
		}
		return self::dynamicGet( $value, $key );
	}

	public static function dynamicSet( mixed $target, mixed $key, mixed $value ): mixed {
		if ( is_int( $key ) && $target instanceof JsTypedArray ) {
			$number = self::toNumber( $value );
			if ( $key >= 0 && $key < $target->length ) {
				$target->put( $key, $number ); }
			return $value;
		}
		if ( self::isNullish( $target ) ) {
			throw new JsError( 'Cannot set properties of null or undefined', 'TypeError' ); }
		if ( $target instanceof JsPrototype ) {
			throw new JsError( 'Assigning to a class prototype is not supported; use Object.defineProperty with a symbol key', 'TypeError' ); }
		if ( $key instanceof JsSymbol ) {
			if ( ! $target instanceof JsObject ) {
				throw new JsError( 'Symbol-keyed properties are only supported on plain objects', 'TypeError' ); }
			// An inherited read-only data property blocks the write (strict mode: TypeError).
			if ( ! $target->hasSymbol( $key ) && ( $target->class?->symbolReadOnly( $key ) ?? false ) ) {
				throw new JsError( 'Cannot assign to read only property ' . $key->descriptiveString(), 'TypeError' );
			}
			return $target->setSymbol( $key, $value );
		}
		$key = self::key( $key );
		if ( $target instanceof JsObject && array_key_exists( $key, $target->hidden ) ) {
			$target->hidden[ $key ] = $value;
			return $value;
		}
		if ( $target instanceof JsObject || $target instanceof JsClass ) {
			return self::set( $target, $key, $value );
		}
		if ( $target instanceof RegExp && 'lastIndex' === $key ) {
			$target->lastIndex = $value;
			return $value; }
		if ( $target instanceof JsAbortSignal && 'onabort' === $key ) {
			$target->setOnabort( $value );
			return $value; }
		if ( $target instanceof JsAbortSignal || $target instanceof JsAbortController ) {
			throw new JsError( 'Cannot assign to ' . $key . ' on an abort object', 'TypeError' ); }
		if ( $target instanceof JsUrl ) {
			$target->set( $key, $value );
			return $value; }
		if ( JsBinary::is( $target ) ) {
			return JsBinary::set( $target, $key, $value ); }
		if ( $target instanceof JsConstructor ) {
			throw new JsError( 'Cannot assign to ' . $key . ' on a built-in constructor in compiled code', 'TypeError' ); }
		if ( $target instanceof JsArray ) {
			self::writable( $target ); }
		if ( $target instanceof JsArray || $target instanceof JsArguments ) {
			if ( '__proto__' === $key && ! array_key_exists( $key, $target->p ) ) {
				throw new JsError( 'Prototype mutation is not supported', 'TypeError' );
			}
			if ( 'length' === $key ) {
				if ( $target instanceof JsArguments ) {
					$target->length        = $value;
					$target->lengthDeleted = false;
					return $value; }
				$length = self::toUint32( self::toNumber( $value ) );
				if ( (float) $length !== (float) self::toNumber( $value ) ) {
					throw new JsError( 'Invalid array length', 'RangeError' ); }
				if ( $length > count( $target->a ) ) {
					throw new JsError( 'SpacePress arrays are dense: length cannot create holes', 'RangeError' ); }
				$target->a = array_slice( $target->a, 0, (int) $length );
				return $value;
			}
			if ( preg_match( '/^(?:0|[1-9][0-9]*)$/D', $key ) && (float) $key < 4294967295 ) {
				$index = (int) $key;
				if ( $target instanceof JsArray ) {
					return self::setAt( $target, $index, $value ); }
				$target->a[ $index ] = $value;
			} else {
				$target->p[ $key ] = $value; }
			return $value;
		}
		throw new JsError( 'Cannot create property on a primitive value', 'TypeError' );
	}

	/** Reading a symbol key: undefined when absent, unless an unmodeled inherited symbol could answer. */
	private static function symbolGet( mixed $value, JsSymbol $key ): mixed {
		$found = self::symbolLookup( $value, $key );
		return $found === JsClass::absent() ? JsUndefined::Value : $found;
	}

	/** `C.prototype[key]` for a string key: methods, `constructor` and built-in prototype data. */
	private static function prototypeGet( JsPrototype $prototype, string $key ): mixed {
		$class = $prototype->class;
		if ( 'constructor' === $key ) {
			return $class; }
		if ( $class->accessor( $key, false ) !== null ) {
			throw new JsError( 'Reading a class accessor through its prototype is not supported', 'TypeError' );
		}
		$inherited = $class->readInherited( $prototype, $key, false );
		if ( $inherited !== JsClass::absent() ) {
			return $inherited; }
		if ( Builtins::has( 'object', $key ) ) {
			throw new JsError( 'Unsupported inherited method ' . $key, 'TypeError' ); }
		return JsUndefined::Value;
	}

	/**
	 * Object literals with runtime keys or spreads: ['k', key, value] and ['s', source] in
	 * source order. Both define own data properties, so a '__proto__' key is ordinary data.
	 */
	public static function dynamicObject( array ...$parts ): JsObject {
		$out = new JsObject();
		foreach ( $parts as $part ) {
			if ( 'k' === $part[0] ) {
				if ( $part[1] instanceof JsSymbol ) {
					self::defineSymbol( $out, $part[1], $part[2] ); } else {
					$out->p[ self::key( $part[1] ) ] = $part[2]; }
					continue;
			}
			$source = $part[1];
			if ( self::isNullish( $source ) || is_bool( $source ) || is_int( $source ) || is_float( $source ) || $source instanceof JsSymbol ) {
				continue; }
			if ( is_string( $source ) ) {
				for ( $index = 0, $length = self::length( $source ); $index < $length; $index++ ) {
					$out->p[ $index ] = self::strAt( $source, $index ); }
				continue;
			}
			if ( $source instanceof JsObject ) {
				foreach ( self::ownKeys( $source->p ) as $key ) {
					$out->p[ $key ] = $source->p[ $key ]; }
				foreach ( $source->symbols as [$symbol, $value, $enumerable] ) {
					if ( $enumerable ) {
						self::defineSymbol( $out, $symbol, $value ); }
				}
				continue;
			}
			if ( $source instanceof JsArray ) {
				foreach ( $source->a as $index => $item ) {
					$out->p[ $index ] = $item; }
				foreach ( self::ownKeys( $source->p ) as $key ) {
					$out->p[ $key ] = $source->p[ $key ]; }
				continue;
			}
			if ( $source instanceof JsArguments ) {
				foreach ( self::dynamicKeys( $source )->a as $key ) {
					$out->p[ $key ] = self::dynamicGet( $source, $key ); }
				continue;
			}
			if ( $source instanceof JsSet || $source instanceof JsMap || $source instanceof JsWeakMap || $source instanceof JsWeakSet
				|| $source instanceof JsDate || $source instanceof RegExp || $source instanceof JsError || $source instanceof \Closure ) {
				continue; }
			throw new JsError( 'Unsupported object spread source', 'TypeError' );
		}
		return $out;
	}

	/** `{ a, ...rest } = value` in imported JavaScript: the value's own enumerable keys except those named. */
	public static function dynamicRest( mixed $value, array $keys ): JsObject {
		self::requirePresent( $value );
		$skip = array_fill_keys( $keys, true );
		$out  = new JsObject();
		foreach ( self::dynamicKeys( $value )->a as $key ) {
			if ( ! isset( $skip[ $key ] ) ) {
				$out->p[ $key ] = self::dynamicGet( $value, $key ); }
		}
		return $out;
	}

	/** CreateDataProperty for a symbol key: an ordinary writable, enumerable, configurable slot. */
	private static function defineSymbol( JsObject $target, JsSymbol $key, mixed $value ): void {
		$target->symbols[ spl_object_id( $key ) ] = array( $key, $value, true, true, true );
	}

	/**
	 * Object.defineProperty with a data descriptor. Symbol keys keep their attributes;
	 * string keys have no attribute model, so only an ordinary assignment-equivalent
	 * descriptor (writable, enumerable and configurable) is accepted for them.
	 */
	private static function dynamicDefineProperty( mixed $target, mixed $key, mixed $descriptor ): mixed {
		if ( ! is_object( $target ) || $target instanceof JsUndefined || $target instanceof JsSymbol ) {
			throw new JsError( 'Object.defineProperty called on non-object', 'TypeError' ); }
		if ( ! $descriptor instanceof JsObject ) {
			throw new JsError( 'Property description must be an object', 'TypeError' ); }
		foreach ( array( 'get', 'set' ) as $accessor ) {
			if ( array_key_exists( $accessor, $descriptor->p ) ) {
				throw new JsError( 'Accessor property descriptors are not supported', 'TypeError' ); }
		}
		$flag  = static fn ( string $name ): bool => array_key_exists( $name, $descriptor->p ) && self::truthy( $descriptor->p[ $name ] );
		$value = array_key_exists( 'value', $descriptor->p ) ? $descriptor->p['value'] : JsUndefined::Value;
		// A class prototype takes symbol-keyed data (brands); its string members are its methods.
		if ( $target instanceof JsPrototype && $key instanceof JsSymbol ) {
			$target->class->defineSymbol( $key, $value, $flag( 'enumerable' ), $flag( 'writable' ), $flag( 'configurable' ) );
			return $target;
		}
		if ( ! $target instanceof JsObject ) {
			throw new JsError( 'Object.defineProperty is only supported on plain objects', 'TypeError' ); }
		if ( $key instanceof JsSymbol ) {
			$id       = spl_object_id( $key );
			$existing = $target->symbols[ $id ] ?? null;
			if ( null !== $existing && ! $existing[4] ) {
				throw new JsError( 'Cannot redefine property: ' . $key->descriptiveString(), 'TypeError' ); }
			$target->symbols[ $id ] = array( $key, $value, $flag( 'enumerable' ), $flag( 'writable' ), $flag( 'configurable' ) );
			return $target;
		}
		if ( ! $flag( 'writable' ) || ! $flag( 'enumerable' ) || ! $flag( 'configurable' ) ) {
			throw new JsError( 'Non-writable, non-enumerable or non-configurable string-keyed properties are not supported', 'TypeError' );
		}
		self::set( $target, self::key( $key ), $value );
		return $target;
	}

	public static function dynamicKeys( mixed $value ): JsArray {
		if ( self::isNullish( $value ) ) {
			return new JsArray(); }
		if ( $value instanceof JsPrototype ) {
			throw new JsError( 'Enumerating a class prototype is not supported', 'TypeError' ); }
		if ( $value instanceof JsObject ) {
			return new JsArray( array_map( 'strval', self::ownKeys( $value->p ) ) ); }
		// A class's enumerable own properties are its static fields (methods are non-enumerable).
		if ( $value instanceof JsClass ) {
			return new JsArray( array_map( 'strval', self::ownKeys( $value->statics->p ) ) ); }
		if ( $value instanceof JsArray || $value instanceof JsArguments ) {
			$properties = $value->a;
			foreach ( $value->p as $key => $item ) {
				$properties[ $key ] = $item; }
			return new JsArray( array_map( 'strval', self::ownKeys( $properties ) ) );
		}
		if ( is_string( $value ) ) {
			$length = self::length( $value );
			return new JsArray( 0 === $length ? array() : array_map( 'strval', range( 0, $length - 1 ) ) ); }
		if ( JsBinary::is( $value ) ) {
			return new JsArray( JsBinary::keys( $value ) ); }
		if ( $value instanceof JsConstructor ) {
			return new JsArray(); }
		if ( $value instanceof RegExp || $value instanceof JsSet || $value instanceof JsMap || $value instanceof JsIterator || $value instanceof JsAbortSignal || $value instanceof JsAbortController || $value instanceof JsTimeout || $value instanceof JsUrl || $value instanceof JsUrlSearchParams || $value instanceof JsWeakMap || $value instanceof JsWeakSet || $value instanceof JsSymbol || $value instanceof JsDate || $value instanceof JsNamespace || $value instanceof JsError || is_scalar( $value ) || $value instanceof \Closure ) {
			return new JsArray(); }
		throw new JsError( 'Unsupported object enumeration', 'TypeError' );
	}

	public static function dynamicForIn( mixed $value ): \Generator {
		// A class inherits its parent's static fields, which for-in visits after its own (and
		// Object.keys does not).
		if ( $value instanceof JsClass ) {
			$seen = array();
			for ( $class = $value; null !== $class; $class = $class->parent ) {
				foreach ( self::ownKeys( $class->statics->p ) as $key ) {
					$key = (string) $key;
					if ( isset( $seen[ $key ] ) ) {
						continue; }
					$seen[ $key ] = true;
					yield $key;
				}
			}
			return;
		}
		foreach ( self::dynamicKeys( $value )->a as $key ) {
			if ( ( $value instanceof JsArray || $value instanceof JsArguments )
				&& ! array_key_exists( $key, $value->a ) && ! array_key_exists( $key, $value->p ) ) {
				continue; }
			if ( $value instanceof JsObject && ! array_key_exists( $key, $value->p ) ) {
				continue; }
			yield $key;
		}
	}

	/** An array itself (read live by destructuring assignment), or any other iterable's values. */
	public static function dynamicIterableLive( mixed $value ): JsArray {
		return $value instanceof JsArray ? $value : self::dynamicIterable( $value );
	}

	/** The rest element of an array pattern: the elements from `$start`, read now. */
	public static function restFrom( JsArray $list, int $start ): JsArray {
		return new JsArray( array_slice( $list->a, $start ) );
	}

	public static function dynamicIterable( mixed $value ): JsArray {
		return new JsArray( iterator_to_array( self::dynamicIterator( $value ), false ) );
	}

	/** Array-pattern destructuring of a JavaScript value: the first $count iterated values (all when null). */
	public static function destructure( mixed $value, ?int $count ): JsArray {
		if ( self::isNullish( $value ) ) {
			throw new JsError( 'Cannot destructure ' . self::str( $value ) . ' as it is not iterable', 'TypeError' ); }
		$out = new JsArray();
		if ( 0 === $count ) {
			return $out; }
		foreach ( self::dynamicIterator( $value ) as $item ) {
			$out->a[] = $item;
			if ( null !== $count && count( $out->a ) >= $count ) {
				break; }
		}
		return $out;
	}

	public static function dynamicIterator( mixed $value ): \Generator {
		if ( $value instanceof JsArray ) {
			for ( $i = 0; $i < count( $value->a ); $i++ ) {
				yield $value->a[ $i ]; }
		} elseif ( $value instanceof JsArguments ) {
			for ( $i = 0; $i < max( 0, self::toInteger( self::toNumber( $value->length ) ) ); $i++ ) {
				yield self::dynamicGet( $value, (string) $i ); }
		} elseif ( is_string( $value ) ) {
			yield from self::from( $value )->a;
		} elseif ( $value instanceof JsSet ) {
			yield from $value->iterate();
		} elseif ( $value instanceof JsMap ) {
			yield from $value->entriesIterator();
		} elseif ( $value instanceof JsIterator ) {
			yield from $value->rest();
		} elseif ( $value instanceof JsUrlSearchParams ) {
			yield from $value->entriesIterator();
		} elseif ( $value instanceof JsTypedArray ) {
			for ( $i = 0; $i < $value->length; $i++ ) {
				yield $value->at( $i ); }
		} elseif ( $value instanceof JsGenerator || $value instanceof JsObject && JsIter::wellKnownMethod( $value, 'iterator' ) !== null ) {
			// Spread, Array.from and the combinators follow the iterator protocol, closing on a throw.
			$iter = JsIter::open( $value );
			try {
				while ( $iter->step() ) {
					yield $iter->value; }
			} catch ( \Throwable $error ) {
				$iter->abrupt();
				throw $error;
			}
		} else {
			throw new JsError( 'Value is not iterable', 'TypeError' );
		}
	}

	public static function dynamicObjectTag( mixed $value ): string {
		$tag = match ( true ) {
			JsUndefined::Value === $value => 'Undefined', null === $value => 'Null',
			is_bool( $value ) => 'Boolean', is_int( $value ), is_float( $value ) => 'Number', is_string( $value ) => 'String',
			$value instanceof JsArray => 'Array', $value instanceof JsArguments => 'Arguments', $value instanceof JsSet => 'Set',
			$value instanceof JsMap => 'Map', $value instanceof JsDate => 'Date', $value instanceof RegExp => 'RegExp',
			$value instanceof JsIterator => $value->tag,
			$value instanceof JsAbortSignal => 'AbortSignal', $value instanceof JsAbortController => 'AbortController',
			$value instanceof JsTimeout => 'Timeout',
			$value instanceof JsUrl => 'URL', $value instanceof JsUrlSearchParams => 'URLSearchParams',
			$value instanceof JsWeakMap => 'WeakMap', $value instanceof JsWeakSet => 'WeakSet', $value instanceof JsSymbol => 'Symbol',
			$value instanceof JsNamespace => $value->name,
			is_object( $value ) && JsBinary::is( $value ) => JsBinary::tag( $value ),
			$value instanceof JsError, $value instanceof JsObject && $value->class?->builtinRoot() !== null => 'Error',
			$value instanceof \Closure, $value instanceof JsClass, $value instanceof JsConstructor => 'Function', default => 'Object',
		};
		return '[object ' . $tag . ']';
	}

	/** Registers a function value whose receiver comes from call/apply or a method call. */
	/**
	 * An ordinary function that reads `this`, compiled with its receiver as the first parameter.
	 * Called plainly it receives undefined (strict mode); called as a method, or through
	 * call/apply, it receives that receiver.
	 */
	/** Calls a function value with an explicit receiver, as `receiver.method(...args)` does. */
	/**
	 * The callee of `receiver.name?.(...)`: read once with the receiver bound, or null when the
	 * property is null or undefined, so the call short-circuits before its arguments run.
	 */
	public static function optionalMethod( mixed $receiver, mixed $name ): ?\Closure {
		$method = self::dynamicGet( $receiver, $name );
		if ( self::isNullish( $method ) ) {
			return null; }
		// Class and built-in methods dispatch with their receiver; a data property calls the value
		// read above, so a getter runs once as in JavaScript.
		$own = ( $receiver instanceof JsObject || $receiver instanceof JsArray || $receiver instanceof JsArguments )
			&& ! $name instanceof JsSymbol && array_key_exists( self::key( $name ), $receiver->p );
		if ( ! $own && ! $name instanceof JsSymbol ) {
			return self::dynamicMethod( $receiver, $name ); }
		return static fn ( ...$args ) => self::dynamicInvoke( $method, $receiver, new JsArray( $args ) );
	}

	public static function callWithReceiver( mixed $function, mixed $receiver, JsArray $args ): mixed {
		return self::dynamicInvoke( $function, $receiver, $args );
	}

	public static function receiverFunction( \Closure $method ): \Closure {
		return self::dynamicMethodFunction(
			static fn ( ...$args ) => $method( JsUndefined::Value, ...$args ),
			static fn ( $thisArg, JsArray $args ) => $method( $thisArg, ...$args->a ),
		);
	}

	public static function dynamicMethodFunction( \Closure $function, \Closure $invoke ): \Closure {
		self::$dynamicMethodReceivers            ??= new \WeakMap();
		self::$dynamicMethodReceivers[ $function ] = $invoke;
		return $function;
	}

	/** `value instanceof constructor` where the constructor is only known at run time. */
	public static function dynamicInstanceof( mixed $value, mixed $constructor ): bool {
		if ( $constructor instanceof JsClass ) {
			return JsClass::instanceOf( $value, $constructor ); }
		if ( $constructor instanceof JsConstructor ) {
			return JsBinary::instanceOf( $value, $constructor->name ); }
		if ( in_array( $constructor, Builtins::ERROR_CONSTRUCTORS, true ) ) {
			return self::isError( $value, $constructor ); }
		if ( $constructor instanceof \Closure ) {
			throw new JsError( 'instanceof with plain functions is not supported', 'TypeError' ); }
		throw new JsError( "Right-hand side of 'instanceof' is not callable", 'TypeError' );
	}

	/** `value instanceof Error` (or another Builtins::ERROR_CONSTRUCTORS name) for built-in errors and Error subclasses. */
	public static function isError( mixed $value, string $name = 'Error' ): bool {
		if ( $value instanceof JsError ) {
			return 'Error' === $name || $value->jsName === $name;
		}
		return $value instanceof JsObject && ( $value->class?->extendsBuiltin( $name ) ?? false );
	}

	public static function dynamicCall( mixed $function, JsArray $args ): mixed {
		if ( ! $function instanceof \Closure ) {
			throw new JsError( 'Value is not a function', 'TypeError' ); }
		return $function( ...$args->a );
	}

	private static function dynamicInvoke( mixed $function, mixed $receiver, JsArray $args ): mixed {
		if ( $function instanceof \Closure && null !== self::$dynamicMethodReceivers && isset( self::$dynamicMethodReceivers[ $function ] ) ) {
			return ( self::$dynamicMethodReceivers[ $function ] )( $receiver, $args );
		}
		return self::dynamicCall( $function, $args );
	}

	public static function dataMethod( mixed $receiver, mixed $name ): \Closure {
		$method = self::dataGet( $receiver, $name );
		return static fn ( ...$args ) => self::dynamicInvoke( $method, $receiver, new JsArray( $args ) );
	}

	/** Resolve the callee before evaluating arguments, including an own method override. */
	public static function dynamicMethod( mixed $receiver, mixed $name ): \Closure {
		// Byte views have no own properties, so their methods resolve directly (MD5's view.getUint32).
		if ( ( $receiver instanceof JsDataView || $receiver instanceof JsTypedArray ) && ! $name instanceof JsSymbol ) {
			$name = self::key( $name );
			return static fn ( ...$args ) => JsBinary::call( $receiver, $name, $args );
		}
		self::requirePresent( $receiver );
		if ( $name instanceof JsSymbol ) {
			$method = self::symbolGet( $receiver, $name );
			return static fn ( ...$args ) => self::dynamicInvoke( $method, $receiver, new JsArray( $args ) );
		}
		$name       = self::key( $name );
		$properties = match ( true ) {
			$receiver instanceof JsObject, $receiver instanceof JsArray, $receiver instanceof JsArguments => $receiver->p,
			default => array(),
		};
		if ( array_key_exists( $name, $properties ) ) {
			$method = $properties[ $name ];
			return static fn ( ...$args ) => self::dynamicInvoke( $method, $receiver, new JsArray( $args ) );
		}
		if ( $receiver instanceof JsObject && ( $receiver->class?->hasMethod( $name ) ?? false ) ) {
			$class = $receiver->class;
			return static fn ( ...$args ) => $class->invokeOn( $receiver, $name, $args, false );
		}
		if ( $receiver instanceof JsClass ) {
			if ( $receiver->has( $name ) ) {
				$method = $receiver->get( $name );
				return static fn ( ...$args ) => self::dynamicInvoke( $method, $receiver, new JsArray( $args ) );
			}
			if ( $receiver->hasStaticMethod( $name ) ) {
				return static fn ( ...$args ) => $receiver->invokeOn( $receiver, $name, $args, true );
			}
		}
		if ( $receiver instanceof JsObject && $receiver->nullPrototype ) {
			return static fn ( ...$args ) => self::dynamicCall( JsUndefined::Value, new JsArray( $args ) );
		}
		return static fn ( ...$args ) => self::dynamicCallMethod( $receiver, $name, new JsArray( $args ), true );
	}

	public static function dynamicCallMethod( mixed $receiver, string $name, JsArray $args, bool $builtin = false ): mixed {
		if ( self::isNullish( $receiver ) ) {
			throw new JsError( 'Cannot read properties of null or undefined', 'TypeError' ); }
		$a   = $args->a;
		$get = static fn ( int $index, mixed $default = JsUndefined::Value ): mixed => array_key_exists( $index, $a ) ? $a[ $index ] : $default;
		if ( ! $builtin && $receiver instanceof JsObject && array_key_exists( $name, $receiver->p ) ) {
			return self::dynamicInvoke( $receiver->p[ $name ], $receiver, $args ); }
		if ( ! $builtin && $receiver instanceof JsObject && $receiver->nullPrototype ) {
			return self::dynamicCall( JsUndefined::Value, $args ); }
		if ( ! $builtin && ( $receiver instanceof JsArray || $receiver instanceof JsArguments ) && array_key_exists( $name, $receiver->p ) ) {
			return self::dynamicInvoke( $receiver->p[ $name ], $receiver, $args ); }
		if ( $receiver instanceof JsBigInt ) {
			Builtins::check( 'bigint', $name, count( $a ) );
			return match ( $name ) {
				'toString' => $receiver->toRadixArg( $get( 0 ) ),
				'valueOf' => $receiver,
				default => throw new JsError( $name . ' is not a function', 'TypeError' ),
			};
		}
		if ( $receiver instanceof JsPromise ) {
			Builtins::check( 'promise', $name, count( $a ) );
			return $receiver->call( $name, $a ); }
		if ( $receiver instanceof JsReadableStream || $receiver instanceof JsWritableStream ) {
			return $receiver->call( $name, $a ); }
		if ( $receiver instanceof JsGenerator || $receiver instanceof JsAsyncGenerator ) {
			Builtins::check( 'generator', $name, count( $a ) );
			return $receiver->call( $name, $a ); }
		if ( JsBinary::is( $receiver ) ) {
			return JsBinary::call( $receiver, $name, $a ); }
		if ( $receiver instanceof JsConstructor && ! in_array( $name, array( 'call', 'apply', 'toString', 'valueOf' ), true ) ) {
			return JsBinary::staticCall( $receiver->name, $name, $a ); }
		$surface = match ( true ) {
			is_string( $receiver ) => 'string', is_int( $receiver ), is_float( $receiver ) => 'number',
			$receiver instanceof JsArray => 'array', $receiver instanceof RegExp => 'regex',
			$receiver instanceof JsDate => 'date', $receiver instanceof JsSet => 'set', $receiver instanceof JsMap => 'map', $receiver instanceof JsIterator => 'iterator',
			$receiver instanceof JsAbortSignal => 'abortsignal', $receiver instanceof JsAbortController => 'abortcontroller',
			$receiver instanceof JsUrl => 'url', $receiver instanceof JsUrlSearchParams => 'urlsearchparams',
			$receiver instanceof JsWeakMap => 'weakmap', $receiver instanceof JsWeakSet => 'weakset', $receiver instanceof JsSymbol => 'symbol',
			is_bool( $receiver ) => 'boolean', $receiver instanceof \Closure => 'function',
			default => 'object',
		};
		Builtins::check( $surface, $name, count( $a ) );
		if ( $receiver instanceof JsNamespace && Builtins::has( $receiver->name, $name ) ) {
			return self::dynamicStaticCall( $receiver->name, $name, $args ); }
		if ( 'toFixed' === $name && ( is_int( $receiver ) || is_float( $receiver ) ) ) {
			return self::toFixed( $receiver, $get( 0, 0 ) ); }
		if ( 'toString' === $name ) {
			if ( ( is_int( $receiver ) || is_float( $receiver ) ) && $get( 0 ) !== JsUndefined::Value && ( $radix = self::toInteger( self::toNumber( $get( 0 ) ) ) ) !== 10 ) {
				if ( $radix < 2 || $radix > 36 ) {
					throw new JsError( 'toString() radix must be between 2 and 36', 'RangeError' ); }
				// Integer digits are exact in every base; fractional digits depend on the engine.
				if ( ! is_int( $receiver ) || abs( $receiver ) > 9007199254740991 ) {
					throw new JsError( 'Number.toString radix is supported for safe integers only', 'TypeError' ); }
				return ( $receiver < 0 ? '-' : '' ) . base_convert( (string) abs( $receiver ), 10, (int) $radix );
			}
			if ( $receiver instanceof JsArray ) {
				if ( array_key_exists( 'join', $receiver->p ) && ! $receiver->p['join'] instanceof \Closure ) {
					return self::dynamicObjectTag( $receiver ); }
				return self::dynamicCallMethod( $receiver, 'join', new JsArray() );
			}
			if ( $receiver instanceof JsSymbol ) {
				return $receiver->descriptiveString(); }
			if ( $receiver instanceof JsArguments || $receiver instanceof JsObject || $receiver instanceof JsSet || $receiver instanceof JsMap || $receiver instanceof JsWeakMap || $receiver instanceof JsWeakSet || $receiver instanceof JsNamespace ) {
				return self::dynamicObjectTag( $receiver ); }
			if ( $receiver instanceof JsUrl || $receiver instanceof JsUrlSearchParams ) {
				return $receiver->toString(); }
			return self::str( $receiver );
		}
		if ( 'valueOf' === $name ) {
			return $receiver instanceof JsDate ? $receiver->milliseconds : $receiver; }
		if ( $receiver instanceof \Closure && ( 'call' === $name || 'apply' === $name ) ) {
			$values = 'call' === $name ? array_slice( $a, 1 ) : self::dynamicApplyArguments( $get( 1 ) );
			return self::dynamicInvoke( $receiver, $get( 0 ), new JsArray( $values ) );
		}
		if ( $receiver instanceof JsDate ) {
			return match ( $name ) {
				'getTime' => $receiver->milliseconds, 'toISOString' => self::iso( $receiver->milliseconds ),
				'toJSON' => self::dateJSON( $receiver->milliseconds ),
				default => throw new JsError( $name . ' is not a function', 'TypeError' ),
			};
		}
		if ( $receiver instanceof JsSet ) {
			return match ( $name ) {
				'add' => $receiver->add( $get( 0 ) ), 'has' => $receiver->has( $get( 0 ) ), 'delete' => $receiver->delete( $get( 0 ) ),
				'clear' => self::cleared( $receiver ),
				'forEach' => self::dynamicCollectionForEach( $receiver, $get( 0 ), $get( 1 ) ),
				'values', 'keys' => new JsIterator( $receiver->valuesIterator(), 'Set Iterator' ),
				'entries' => new JsIterator( $receiver->entriesIterator(), 'Set Iterator' ),
				default => throw new JsError( $name . ' is not a function', 'TypeError' ),
			};
		}
		if ( $receiver instanceof JsMap ) {
			return match ( $name ) {
				'set' => $receiver->set( $get( 0 ), $get( 1 ) ), 'get' => $receiver->get( $get( 0 ) ), 'has' => $receiver->has( $get( 0 ) ),
				'delete' => $receiver->delete( $get( 0 ) ), 'clear' => self::cleared( $receiver ),
				'forEach' => self::dynamicCollectionForEach( $receiver, $get( 0 ), $get( 1 ) ),
				'keys' => new JsIterator( $receiver->keysIterator(), 'Map Iterator' ),
				'values' => new JsIterator( $receiver->valuesIterator(), 'Map Iterator' ),
				'entries' => new JsIterator( $receiver->entriesIterator(), 'Map Iterator' ),
				default => throw new JsError( $name . ' is not a function', 'TypeError' ),
			};
		}
		if ( $receiver instanceof JsAbortSignal ) {
			return match ( $name ) {
				'throwIfAborted' => $receiver->throwIfAborted(),
				'addEventListener' => $receiver->addEventListener( $get( 0 ), $get( 1 ), $get( 2 ) ),
				'removeEventListener' => $receiver->removeEventListener( $get( 0 ), $get( 1 ), $get( 2 ) ),
				default => throw new JsError( $name . ' is not a function', 'TypeError' ),
			};
		}
		if ( $receiver instanceof JsAbortController ) {
			return match ( $name ) {
				'abort' => $receiver->abort( $get( 0 ) ), default => throw new JsError( $name . ' is not a function', 'TypeError' ) };
		}
		if ( $receiver instanceof JsUrl ) {
			return match ( $name ) {
				'toString' => $receiver->toString(), 'toJSON' => $receiver->toJSON(), default => throw new JsError( $name . ' is not a function', 'TypeError' ) };
		}
		if ( $receiver instanceof JsUrlSearchParams ) {
			return match ( $name ) {
				'append' => $receiver->append( $get( 0 ), $get( 1 ) ), 'set' => $receiver->set( $get( 0 ), $get( 1 ) ),
				'delete' => $receiver->delete( $get( 0 ), $get( 1 ) ), 'has' => $receiver->has( $get( 0 ), $get( 1 ) ),
				'get' => $receiver->get( $get( 0 ) ), 'getAll' => $receiver->getAll( $get( 0 ) ), 'sort' => $receiver->sort(),
				'toString' => $receiver->toString(),
				'forEach' => $get( 1 ) !== JsUndefined::Value ? throw new JsError( 'forEach thisArg is not supported', 'TypeError' ) : $receiver->forEach( self::callback( $get( 0 ) ) ),
				'keys' => new JsIterator( $receiver->keysIterator(), 'URLSearchParams Iterator' ),
				'values' => new JsIterator( $receiver->valuesIterator(), 'URLSearchParams Iterator' ),
				'entries' => new JsIterator( $receiver->entriesIterator(), 'URLSearchParams Iterator' ),
				default => throw new JsError( $name . ' is not a function', 'TypeError' ),
			};
		}
		if ( $receiver instanceof JsIterator ) {
			return match ( $name ) {
				'next' => $receiver->next(), default => throw new JsError( $name . ' is not a function', 'TypeError' ) };
		}
		if ( $receiver instanceof JsArray && in_array( $name, array( 'keys', 'values', 'entries' ), true ) ) {
			return new JsIterator( self::arrayIterator( $receiver, $name ), 'Array Iterator' );
		}
		if ( $receiver instanceof JsWeakMap ) {
			return match ( $name ) {
				'set' => $receiver->set( $get( 0 ), $get( 1 ) ), 'get' => $receiver->get( $get( 0 ) ), 'has' => $receiver->has( $get( 0 ) ), 'delete' => $receiver->delete( $get( 0 ) ), default => throw new JsError( $name . ' is not a function', 'TypeError' ) };
		}
		if ( $receiver instanceof JsWeakSet ) {
			return match ( $name ) {
				'add' => $receiver->add( $get( 0 ) ), 'has' => $receiver->has( $get( 0 ) ), 'delete' => $receiver->delete( $get( 0 ) ), default => throw new JsError( $name . ' is not a function', 'TypeError' ) };
		}
		if ( $receiver instanceof RegExp ) {
			return match ( $name ) {
				'exec' => self::dynamicRegExpExec( $receiver, self::str( $get( 0 ) ) ), 'test' => self::dynamicRegExpExec( $receiver, self::str( $get( 0 ) ) ) !== null, default => throw new JsError( $name . ' is not a function', 'TypeError' ) };
		}
		if ( is_string( $receiver ) ) {
			if ( 'replaceAll' === $name && $get( 0 ) instanceof RegExp && ! $get( 0 )->global ) {
				throw new JsError( 'replaceAll must be called with a global RegExp', 'TypeError' ); }
			if ( in_array( $name, array( 'includes', 'startsWith', 'endsWith' ), true ) && $get( 0 ) instanceof RegExp ) {
				throw new JsError( 'Search argument must not be a regular expression', 'TypeError' ); }
			return match ( $name ) {
				'toUpperCase' => mb_strtoupper( $receiver, 'UTF-8' ), 'toLowerCase' => mb_strtolower( $receiver, 'UTF-8' ),
				'trim' => self::trim( $receiver ), 'trimStart' => self::trimStart( $receiver ), 'trimEnd' => self::trimEnd( $receiver ),
				'charAt' => self::charAt( $receiver, self::toNumber( $get( 0, 0 ) ) ),
				'at' => self::strAt( $receiver, self::toNumber( $get( 0, 0 ) ) ) ?? JsUndefined::Value,
				'padStart', 'padEnd' => self::dynamicPad( $receiver, $name, $get( 0 ), $get( 1 ) ),
				'charCodeAt' => self::dynamicCharCodeAt( $receiver, self::toNumber( $get( 0, 0 ) ) ),
				'slice' => self::slice( $receiver, self::toNumber( $get( 0, 0 ) ), $get( 1 ) === JsUndefined::Value ? null : self::toNumber( $get( 1 ) ) ),
				'substring' => self::substring( $receiver, self::toNumber( $get( 0, 0 ) ), $get( 1 ) === JsUndefined::Value ? null : self::toNumber( $get( 1 ) ) ),
				'includes', 'startsWith', 'endsWith' => self::dynamicStringSearch( $receiver, $name, $get( 0 ), $get( 1 ) ),
				'indexOf' => self::indexOf( $receiver, self::str( $get( 0 ) ), self::toNumber( $get( 1, 0 ) ) ),
				'lastIndexOf' => count( $a ) < 2 ? self::lastIndexOf( $receiver, self::str( $get( 0 ) ) ) : self::lastIndexOf( $receiver, self::str( $get( 0 ) ), self::toNumber( $get( 1 ) ) ),
				'split' => self::dynamicSplit( $receiver, $get( 0 ), $get( 1 ) ),
				'replace', 'replaceAll' => self::{$name}( $receiver, $get( 0 ) instanceof RegExp ? $get( 0 ) : self::str( $get( 0 ) ), $get( 1 ) instanceof \Closure ? $get( 1 ) : self::str( $get( 1 ) ) ),
				'match' => self::strMatch( $receiver, $get( 0 ) instanceof RegExp ? $get( 0 ) : new RegExp( $get( 0 ) === JsUndefined::Value ? '' : self::str( $get( 0 ) ) ) ),
				'repeat' => self::repeat( $receiver, self::toNumber( $get( 0, 0 ) ) ),
				'concat' => $receiver . implode( '', array_map( self::str( ... ), $a ) ),
				default => throw new JsError( $name . ' is not a function', 'TypeError' ),
			};
		}
		if ( $receiver instanceof JsArray ) {
			return match ( $name ) {
				'push', 'unshift', 'concat' => self::{$name}( $receiver, ...$a ),
				'pop', 'shift' => array() === $receiver->a ? JsUndefined::Value : self::{$name}( $receiver ),
				'reverse', 'toReversed' => self::{$name}( $receiver, ...$a ),
				'flat' => self::dynamicFlat( $receiver, $get( 0 ) ),
				'find', 'findLast' => self::dynamicArrayFind( $receiver, $name, self::callback( $get( 0 ) ) ),
				'forEach' => self::forEach( $receiver, self::callback( $get( 0 ) ) ),
				'map', 'filter', 'some', 'every', 'findIndex', 'findLastIndex', 'flatMap' => self::{$name}( $receiver, self::callback( $get( 0 ) ) ),
				'reduce' => count( $a ) < 2 ? self::reduce( $receiver, self::callback( $get( 0 ) ) ) : self::reduce( $receiver, self::callback( $get( 0 ) ), $a[1] ),
				'sort', 'toSorted' => self::{$name}( $receiver, $get( 0 ) === JsUndefined::Value ? null : self::callback( $get( 0 ) ) ),
				'fill' => self::dynamicFill( $receiver, $get( 0 ), $get( 1 ), $get( 2 ) ),
				'slice' => self::dynamicBorrowedSlice( $receiver, $args ),
				'at' => self::dynamicArrayAt( $receiver, $get( 0 ) ),
				'indexOf', 'lastIndexOf', 'includes' => self::{$name}( $receiver, $get( 0 ), ...array_slice( $a, 1, 1 ) ),
				'join' => self::join( $receiver, $get( 0 ) ),
				'splice' => self::dynamicSplice( $receiver, $args ),
				default => throw new JsError( $name . ' is not a function', 'TypeError' ),
			};
		}
		throw new JsError( $name . ' is not a function', 'TypeError' );
	}

	/**
	 * A function value about to be called. Compiled JavaScript functions are always Closures; a
	 * value typed as a function only by an assertion or parsed JSON can still be a string or an
	 * array at run time, and PHP would call the PHP function it names. Typed code wraps every
	 * function value it did not build itself in this check (src/compile.rs, `checked_function`).
	 */
	public static function callback( mixed $callback ): \Closure {
		if ( ! $callback instanceof \Closure ) {
			throw new JsError( 'Callback is not a function', 'TypeError' ); }
		return $callback;
	}

	private static function dynamicPad( string $source, string $method, mixed $length, mixed $fill ): string {
		$length = self::toInteger( self::toNumber( $length ) );
		if ( $length <= self::length( $source ) ) {
			return $source; }
		return self::{$method}( $source, $length, JsUndefined::Value === $fill ? ' ' : self::str( $fill ) );
	}

	private static function dynamicArrayAt( JsArray $source, mixed $index ): mixed {
		$length = count( $source->a );
		$index  = self::toInteger( self::toNumber( $index ) );
		if ( $index < 0 ) {
			$index += $length; }
		return $index >= 0 && $index < $length ? self::dynamicGet( $source, (string) $index ) : JsUndefined::Value;
	}

	private static function dynamicFlat( JsArray $source, mixed $depth ): JsArray {
		$length = count( $source->a );
		$depth  = JsUndefined::Value === $depth ? 1 : self::toNumber( $depth );
		return self::flat( new JsArray( array_slice( $source->a, 0, $length ) ), $depth );
	}

	private static function dynamicFill( JsArray $source, mixed $value, mixed $start, mixed $end ): JsArray {
		self::writable( $source );
		$length = count( $source->a );
		$from   = self::relIndex( self::toNumber( $start ), $length );
		$to     = JsUndefined::Value === $end ? $length : self::relIndex( self::toNumber( $end ), $length );
		if ( $from < $to && $from > count( $source->a ) ) {
			throw new JsError( 'Fill cannot create a sparse array after coercion', 'TypeError' ); }
		for ( $i = $from; $i < $to; $i++ ) {
			$source->a[ $i ] = $value; }
		return $source;
	}

	private static function dynamicSplice( JsArray $source, JsArray $args ): JsArray {
		self::writable( $source );
		$length = count( $source->a );
		if ( array() === $args->a ) {
			return new JsArray(); }
		$start = self::relIndex( self::toNumber( $args->a[0] ), $length );
		$count = count( $args->a ) < 2 ? $length - $start : self::clampIndex( self::toNumber( $args->a[1] ), $length - $start );
		if ( count( $source->a ) < $length ) {
			throw new JsError( 'Splice cannot read a sparse array after coercion', 'TypeError' ); }
		$source->a = array_slice( $source->a, 0, $length );
		return new JsArray( array_splice( $source->a, $start, $count, array_slice( $args->a, 2 ) ) );
	}

	private static function cleared( JsMap|JsSet $collection ): JsUndefined {
		$collection->clear();
		return JsUndefined::Value;
	}

	private static function dynamicCollectionForEach( JsMap|JsSet $collection, mixed $callback, mixed $thisArg ): JsUndefined {
		if ( JsUndefined::Value !== $thisArg ) {
			throw new JsError( 'forEach thisArg is not supported', 'TypeError' ); }
		$collection->forEach( self::callback( $callback ) );
		return JsUndefined::Value;
	}

	/** Array iterators read the live array by index, as %ArrayIteratorPrototype%.next does. */
	public static function arrayIterator( JsArray $array, string $kind ): \Generator {
		for ( $i = 0; $i < count( $array->a ); $i++ ) {
			yield match ( $kind ) {
				'keys' => $i, 'values' => $array->a[ $i ], default => new JsArray( array( $i, $array->a[ $i ] ) ) };
		}
	}

	private static function dynamicArrayFind( JsArray $source, string $method, \Closure $callback ): mixed {
		$matched = JsUndefined::Value;
		$visit   = static function ( $value, $index, $array ) use ( $callback, &$matched ): bool {
			if ( ! self::truthy( $callback( $value, $index, $array ) ) ) {
				return false; }
			$matched = $value;
			return true;
		};
		if ( 'find' === $method ) {
			self::findIndex( $source, $visit );
		} else {
			self::findLastIndex( $source, $visit ); }
		return $matched;
	}

	private static function dynamicArrayFrom( mixed $source, mixed $mapper = JsUndefined::Value ): JsArray {
		self::requirePresent( $source );
		$callback = JsUndefined::Value === $mapper ? null : self::callback( $mapper );
		$result   = new JsArray();
		if ( $source instanceof JsArray ) {
			for ( $i = 0; $i < count( $source->a ); $i++ ) {
				$value       = $source->a[ $i ];
				$result->a[] = null === $callback ? $value : $callback( $value, $i ); }
		} elseif ( $source instanceof JsSet || $source instanceof JsMap || $source instanceof JsIterator ) {
			$i = 0;
			foreach ( self::dynamicIterator( $source ) as $value ) {
				$result->a[] = null === $callback ? $value : $callback( $value, $i );
				++$i;
			}
		} elseif ( $source instanceof JsArguments ) {
			for ( $i = 0; $i < max( 0, self::toInteger( self::toNumber( $source->length ) ) ); $i++ ) {
				$value       = self::dynamicGet( $source, (string) $i );
				$result->a[] = null === $callback ? $value : $callback( $value, $i );
			}
		} elseif ( is_string( $source ) ) {
			foreach ( self::from( $source )->a as $i => $value ) {
				$result->a[] = null === $callback ? $value : $callback( $value, $i ); }
		} else {
			$length = min( 9007199254740991, max( 0, self::toInteger( self::toNumber( self::dynamicGet( $source, 'length' ) ) ) ) );
			for ( $i = 0; $i < $length; $i++ ) {
				$value       = self::dynamicGet( $source, (string) $i );
				$result->a[] = null === $callback ? $value : $callback( $value, $i ); }
		}
		return $result;
	}

	private static function dynamicApplyArguments( mixed $source ): array {
		if ( self::isNullish( $source ) ) {
			return array(); }
		if ( ! is_object( $source ) || $source instanceof \Closure ) {
			throw new JsError( 'apply requires an array-like data object', 'TypeError' ); }
		$length = max( 0, self::toInteger( self::toNumber( self::dynamicGet( $source, 'length' ) ) ) );
		if ( $length > 5000000 ) {
			throw new JsError( 'apply argument list is too large', 'RangeError' ); }
		$values = array();
		for ( $i = 0; $i < $length; $i++ ) {
			$values[] = self::dynamicGet( $source, (string) $i ); }
		return $values;
	}

	private static function dynamicStringSearch( string $source, string $method, mixed $search, mixed $position ): bool {
		if ( $search instanceof RegExp ) {
			throw new JsError( $method . ' does not accept a RegExp', 'TypeError' ); }
		$search   = self::str( $search );
		$position = 'endsWith' === $method && JsUndefined::Value === $position
			? self::length( $source ) : max( 0, self::toNumber( $position ) );
		return match ( $method ) {
			'includes' => str_contains( self::slice( $source, $position ), $search ),
			'startsWith' => str_starts_with( self::slice( $source, $position ), $search ),
			'endsWith' => str_ends_with( self::slice( $source, 0, $position ), $search ),
		};
	}

	private static function dynamicSplit( string $source, mixed $separator, mixed $limit ): JsArray {
		$limit = JsUndefined::Value === $limit ? null : self::toUint32( self::toNumber( $limit ) );
		if ( ! $separator instanceof RegExp && JsUndefined::Value !== $separator ) {
			$separator = self::str( $separator ); }
		if ( 0 === $limit ) {
			return new JsArray(); }
		if ( JsUndefined::Value === $separator ) {
			return new JsArray( array( $source ) ); }
		$result    = self::split( $source, $separator, $limit );
		$result->a = array_map( static fn ( $value ) => $value ?? JsUndefined::Value, $result->a );
		return $result;
	}

	public static function dynamicStaticCall( string $owner, string $method, JsArray $args ): mixed {
		Builtins::check( $owner, $method, count( $args->a ) );
		$a = $args->a;
		if ( in_array( $owner, JsBinary::GLOBALS, true ) ) {
			return JsBinary::staticCall( $owner, $method, $a ); }
		$get = static fn ( int $i, mixed $default = JsUndefined::Value ): mixed => array_key_exists( $i, $a ) ? $a[ $i ] : $default;
		if ( 'AbortSignal' === $owner ) {
			return match ( $method ) {
				'abort' => JsAbortSignal::aborted( $get( 0 ) ), 'timeout' => JsAbortSignal::timeout( $get( 0 ) ),
				'any' => JsAbortSignal::any( iterator_to_array( self::dynamicIterator( $get( 0 ) ), false ) ),
				default => throw new JsError( 'AbortSignal.' . $method . ' is not a function', 'TypeError' ),
			};
		}
		if ( 'URL' === $owner ) {
			return match ( $method ) {
				'canParse' => JsUrl::canParse( $get( 0 ), $get( 1 ) ), 'parse' => JsUrl::parse( $get( 0 ), $get( 1 ) ), default => throw new JsError( 'URL.' . $method . ' is not a function', 'TypeError' ) };
		}
		if ( 'Array' === $owner ) {
			if ( 'isArray' === $method ) {
				return $get( 0 ) instanceof JsArray; }
			if ( 'from' === $method ) {
				if ( $get( 2 ) !== JsUndefined::Value ) {
					throw new JsError( 'Array.from thisArg is not supported', 'TypeError' ); }
				return self::dynamicArrayFrom( $get( 0 ), $get( 1 ) );
			}
			if ( 'of' === $method ) {
				return new JsArray( $a ); }
		}
		if ( 'String' === $owner && 'raw' === $method ) {
			return self::stringRaw( ...$a ); }
		if ( 'String' === $owner && 'fromCharCode' === $method ) {
			return self::fromCharCode( ...$a ); }
		if ( 'String' === $owner && 'fromCodePoint' === $method ) {
			return self::fromCodePoint( ...$a ); }
		if ( 'Reflect' === $owner && 'ownKeys' === $method ) {
			// Own keys of a plain object: integer-like keys ascending, then other strings in
			// insertion order, then symbols. Arrays add "length". Every compiled string key is an
			// own enumerable data property, so this is the object's full key list.
			$target = $get( 0 );
			if ( $target instanceof JsPrototype ) {
				throw new JsError( 'Reflect.ownKeys on a class prototype is not supported', 'TypeError' ); }
			if ( $target instanceof JsObject ) {
				$keys = array_map( 'strval', self::ownKeys( $target->p ) );
				foreach ( $target->symbols as [$symbol] ) {
					$keys[] = $symbol; }
				return new JsArray( $keys );
			}
			if ( $target instanceof JsArray ) {
				$keys   = self::dynamicKeys( $target )->a;
				$keys[] = 'length';
				return new JsArray( $keys );
			}
			throw new JsError( 'Reflect.ownKeys needs an object', 'TypeError' );
		}
		if ( 'Object' === $owner ) {
			$source = $get( 0 );
			if ( in_array( $method, array( 'keys', 'values', 'entries' ), true ) ) {
				if ( self::isNullish( $source ) ) {
					throw new JsError( 'Cannot convert undefined or null to object', 'TypeError' ); }
				$keys = self::dynamicKeys( $source );
				if ( 'keys' === $method ) {
					return $keys; }
				return new JsArray( array_map( static fn ( $key ) => 'values' === $method ? self::dynamicGet( $source, $key ) : new JsArray( array( $key, self::dynamicGet( $source, $key ) ) ), $keys->a ) );
			}
			if ( 'defineProperty' === $method ) {
				return self::dynamicDefineProperty( $source, $get( 1 ), $get( 2 ) ); }
			if ( 'assign' === $method ) {
				// ToObject on the target; each source's own enumerable string keys, then symbols, in order.
				if ( self::isNullish( $source ) ) {
					throw new JsError( 'Cannot convert undefined or null to object', 'TypeError' ); }
				if ( ! $source instanceof JsObject && ! $source instanceof JsArray ) {
					throw new JsError( 'Object.assign in compiled code needs an object or array target', 'TypeError' );
				}
				foreach ( array_slice( $a, 1 ) as $from ) {
					if ( self::isNullish( $from ) ) {
						continue; }
					foreach ( self::dynamicKeys( $from )->a as $key ) {
						self::dynamicSet( $source, $key, self::dynamicGet( $from, $key ) );
					}
					if ( $from instanceof JsObject ) {
						foreach ( $from->symbols as [$symbol, $value, $enumerable] ) {
							if ( $enumerable ) {
								self::dynamicSet( $source, $symbol, $value ); }
						}
					}
				}
				return $source;
			}
			if ( 'hasOwn' === $method && $source instanceof JsPrototype ) {
				throw new JsError( 'Object.hasOwn on a class prototype is not supported', 'TypeError' ); }
			if ( 'hasOwn' === $method && $get( 1 ) instanceof JsSymbol ) {
				self::requirePresent( $source );
				if ( $source instanceof JsObject ) {
					return $source->hasSymbol( $get( 1 ) ); }
				throw new JsError( 'Symbol-keyed properties are only supported on plain objects', 'TypeError' );
			}
			if ( 'hasOwn' === $method ) {
				self::requirePresent( $source );
				$key = self::key( $get( 1 ) );
				if ( $source instanceof \Closure || $source instanceof JsClass ) {
					throw new JsError( 'Object.hasOwn on functions is not supported', 'TypeError' ); }
				if ( $source instanceof JsNamespace ) {
					if ( in_array( $key, array( 'PI', 'E' ), true ) || Builtins::has( $source->name, $key ) ) {
						return true; }
					if ( in_array( $key, array( 'toString', 'valueOf' ), true ) ) {
						return false; }
					throw new JsError( 'Unsupported Math property ' . $key, 'TypeError' );
				}
				if ( $source instanceof JsError ) {
					return 'stack' === $key || 'message' === $key && $source->hasMessage;
				}
				if ( $source instanceof JsObject && array_key_exists( $key, $source->hidden ) ) {
					return true; }
				if ( 'length' === $key && ( $source instanceof JsArray || is_string( $source ) || $source instanceof JsArguments && ! $source->lengthDeleted ) ) {
					return true; }
				if ( 'callee' === $key && $source instanceof JsArguments || 'lastIndex' === $key && $source instanceof RegExp ) {
					return true; }
				return in_array( $key, self::dynamicKeys( $source )->a, true );
			}
			if ( 'fromEntries' === $method ) {
				return self::fromEntries( $source );
			}
		}
		if ( 'Math' === $owner ) {
			$n = array_map( self::toNumber( ... ), $a );
			$x = $n[0] ?? NAN;
			return match ( $method ) {
				'random' => self::random(), 'abs' => abs( $x ), 'floor' => self::n( floor( $x ) ), 'ceil' => self::n( ceil( $x ) ), 'trunc' => self::trunc( $x ),
				'round' => self::round( $x ),
				'min' => self::min( ...$n ), 'max' => self::max( ...$n ), 'pow' => self::pow( $x, $n[1] ?? NAN ),
				'log', 'exp' => self::mathTranscendental( $method, $x ), 'sqrt' => sqrt( $x ), 'sign' => self::sign( $x ),
				default => throw new JsError( 'Unsupported Math method ' . $method, 'TypeError' ),
			};
		}
		if ( 'Number' === $owner ) {
			return match ( $method ) {
				'isFinite' => self::isFinite( $get( 0 ) ), 'isInteger' => self::isInteger( $get( 0 ) ),
				'isNaN' => is_float( $get( 0 ) ) && is_nan( $get( 0 ) ),
				'parseFloat' => self::parseFloat( self::str( $get( 0 ) ) ), 'parseInt' => self::parseInt( self::str( $get( 0 ) ), $get( 1 ) === JsUndefined::Value ? null : self::toNumber( $get( 1 ) ) ),
				default => throw new JsError( 'Unsupported Number method ' . $method, 'TypeError' ),
			};
		}
		if ( 'JSON' === $owner ) {
			if ( $get( 1 ) !== JsUndefined::Value && $get( 1 ) !== null ) {
				throw new JsError( 'JSON replacer and reviver are not supported', 'TypeError' ); }
			return match ( $method ) {
				'parse' => self::jsonParse( self::str( $get( 0 ) ) ),
				'stringify' => self::jsonStringify( $get( 0 ), is_string( $get( 2 ) ) || is_int( $get( 2 ) ) || is_float( $get( 2 ) ) ? $get( 2 ) : null ) ?? JsUndefined::Value,
				default => throw new JsError( 'Unsupported JSON method ' . $method, 'TypeError' ),
			};
		}
		throw new JsError( 'Unsupported static method ' . $owner . '.' . $method, 'TypeError' );
	}

	private static function dynamicCharCodeAt( string $value, int|float $index ): int|float {
		$index = self::toInteger( $index );
		if ( $index < 0 || $index >= self::length( $value ) ) {
			return NAN; }
		return unpack( 'v', substr( self::units( $value ), 2 * (int) $index, 2 ) )[1];
	}

	public static function dynamicRegExpExec( RegExp $regexp, string $value ): ?JsArray {
		$match = $regexp->execMatch( $value );
		if ( null === $match ) {
			return null; }
		[$start, $end, $captures, $groups] = $match;
		$result                            = new JsArray( array( substr( $value, $start, $end - $start ), ...array_map( static fn ( $v ) => $v ?? JsUndefined::Value, $captures ) ) );
		$result->p                         = array(
			'index'  => self::length( substr( $value, 0, $start ) ),
			'input'  => $value,
			'groups' => $regexp->hasNamedGroups() ? new JsObject( array_map( static fn ( $v ) => $v ?? JsUndefined::Value, $groups ), null, true ) : JsUndefined::Value,
		);
		return $result;
	}

	public static function dynamicConstruct( mixed $constructor, JsArray $args ): mixed {
		$a = $args->a;
		if ( $constructor instanceof JsClass ) {
			return $constructor->construct( ...$a ); }
		if ( $constructor instanceof JsConstructor ) {
			$constructor = $constructor->name; }
		if ( is_string( $constructor ) ) {
			Builtins::check( 'constructor', $constructor, count( $a ) ); }
		if ( in_array( $constructor, JsBinary::GLOBALS, true ) ) {
			return JsBinary::construct( $constructor, $a ); }
		if ( 'Promise' === $constructor ) {
			return JsPromise::construct( $a[0] ?? JsUndefined::Value ); }
		if ( 'ReadableStream' === $constructor ) {
			return new JsReadableStream( $a[0] ?? JsUndefined::Value, $a[1] ?? JsUndefined::Value ); }
		if ( 'WritableStream' === $constructor ) {
			return new JsWritableStream( $a[0] ?? JsUndefined::Value, $a[1] ?? JsUndefined::Value ); }
		if ( 'TransformStream' === $constructor ) {
			return new JsTransformStream( $a[0] ?? JsUndefined::Value ); }
		if ( in_array( $constructor, Builtins::ERROR_CONSTRUCTORS, true ) ) {
			$message = array_key_exists( 0, $a ) ? $a[0] : JsUndefined::Value;
			$text    = JsUndefined::Value === $message ? '' : self::str( $message );
			$options = $a[1] ?? JsUndefined::Value;
			if ( ( $options instanceof JsObject || $options instanceof JsArray || $options instanceof JsArguments )
				&& ( array_key_exists( 'cause', $options->p ) || $options instanceof JsObject && ( $options->class?->hasMethod( 'cause' ) ?? false ) ) ) {
				throw new JsError( 'Error cause is not supported', 'TypeError' );
			}
			return new JsError( $text, $constructor, JsUndefined::Value !== $message );
		}
		if ( 'RegExp' === $constructor ) {
			$source = array_key_exists( 0, $a ) ? $a[0] : JsUndefined::Value;
			$flags  = array_key_exists( 1, $a ) ? $a[1] : JsUndefined::Value;
			return new RegExp( $source instanceof RegExp ? $source->source : ( JsUndefined::Value === $source ? '' : self::str( $source ) ), JsUndefined::Value === $flags ? ( $source instanceof RegExp ? $source->flags : '' ) : self::str( $flags ) );
		}
		if ( 'Date' === $constructor ) {
			if ( count( $a ) > 1 ) {
				throw new JsError( 'Date component constructor is not supported', 'TypeError' ); }
			$value = array_key_exists( 0, $a ) ? $a[0] : JsUndefined::Value;
			return new JsDate( array() === $a ? self::now() : ( $value instanceof JsDate ? $value->milliseconds : self::date( $value ) ) );
		}
		if ( 'AbortController' === $constructor ) {
			return new JsAbortController(); }
		if ( 'WeakMap' === $constructor || 'WeakSet' === $constructor ) {
			$result = 'WeakSet' === $constructor ? new JsWeakSet() : new JsWeakMap();
			if ( ! self::isNullish( $a[0] ?? JsUndefined::Value ) ) {
				foreach ( self::dynamicIterable( $a[0] )->a as $value ) {
					if ( $result instanceof JsWeakSet ) {
						$result->add( $value ); } elseif ( $value instanceof JsArray || $value instanceof JsArguments || $value instanceof JsObject ) {
						$result->set( self::dynamicGet( $value, '0' ), self::dynamicGet( $value, '1' ) ); } else {
							throw new JsError( 'Iterator value is not an entry object', 'TypeError' ); }
				}
			}
			return $result;
		}
		if ( 'Set' === $constructor || 'Map' === $constructor ) {
			$result = 'Set' === $constructor ? new JsSet() : new JsMap();
			if ( ! self::isNullish( $a[0] ?? JsUndefined::Value ) ) {
				foreach ( self::dynamicIterable( $a[0] )->a as $value ) {
					if ( $result instanceof JsSet ) {
						$result->add( $value ); } elseif ( $value instanceof JsArray || $value instanceof JsArguments || $value instanceof JsObject ) {
						$result->set( self::dynamicGet( $value, '0' ), self::dynamicGet( $value, '1' ) ); } else {
							throw new JsError( 'Iterator value is not an entry object', 'TypeError' ); }
				}
			}
			return $result;
		}
		if ( 'URL' === $constructor ) {
			return JsUrl::construct( $a[0] ?? JsUndefined::Value, $a[1] ?? JsUndefined::Value ); }
		if ( 'URLSearchParams' === $constructor ) {
			return JsUrlSearchParams::construct( $a[0] ?? JsUndefined::Value ); }
		// `Boolean` reached through a stored reference (`const o = { B: Boolean }; new o.B(x)`)
		// escapes the build-time refusal. A wrapper object is truthy even around `false`, so a
		// primitive here would diverge silently; throw the build-time message instead.
		if ( $constructor === self::booleanFunction() ) {
			throw new JsError( "`new Boolean(...)` creates a wrapper object, which isn't supported; call `Boolean(value)` without `new` for a primitive boolean", 'TypeError' );
		}
		throw new JsError( 'Value is not a supported constructor', 'TypeError' );
	}

	public static function dynamicRegExpCall( JsArray $args ): RegExp {
		Builtins::check( 'global', 'RegExp', count( $args->a ) );
		if ( ( $args->a[0] ?? null ) instanceof RegExp && ( ! array_key_exists( 1, $args->a ) || JsUndefined::Value === $args->a[1] ) ) {
			return $args->a[0]; }
		return self::dynamicConstruct( 'RegExp', $args );
	}

	/** ToPrimitive for callers outside this trait (BigInt conversion). */
	public static function primitive( mixed $value, string $hint = 'default' ): mixed {
		return self::dynamicPrimitive( $value, $hint );
	}

	private static function dynamicPrimitive( mixed $value, string $hint = 'default' ): mixed {
		if ( $value instanceof JsDate ) {
			if ( 'number' !== $hint ) {
				throw new JsError( 'Date string coercion is not supported', 'TypeError' ); }
			return $value->milliseconds;
		}
		if ( $value instanceof JsObject || $value instanceof JsArray || $value instanceof JsArguments ) {
			foreach ( 'string' === $hint ? array( 'toString', 'valueOf' ) : array( 'valueOf', 'toString' ) as $method ) {
				if ( array_key_exists( $method, $value->p ) ) {
					if ( ! $value->p[ $method ] instanceof \Closure ) {
						continue; }
					$result = self::dynamicInvoke( $value->p[ $method ], $value, new JsArray() );
				} elseif ( $value instanceof JsObject && $value->nullPrototype ) {
					continue; } elseif ( $value instanceof JsObject && null !== $value->class
					&& ( $inherited = $value->class->readInherited( $value, $method, false ) ) !== JsClass::absent() ) {
										// Class methods and Error.prototype.toString come before Object.prototype's.
						if ( ! $inherited instanceof \Closure ) {
							continue; }
						$result = self::dynamicInvoke( $inherited, $value, new JsArray() );
					} else {
						$result = self::dynamicCallMethod( $value, $method, new JsArray(), true ); }
					if ( JsUndefined::Value === $result || ! is_object( $result ) || $result instanceof JsBigInt ) {
						return $result; }
			}
			throw new JsError( 'Cannot convert object to primitive value', 'TypeError' );
		}
		if ( is_object( $value ) && ! $value instanceof JsUndefined && ! $value instanceof JsSymbol && ! $value instanceof JsBigInt ) {
			return self::str( $value ); }
		return $value;
	}

	public static function dynamicBinary( string $operator, mixed $left, mixed $right ): mixed {
		if ( '===' === $operator || '!==' === $operator ) {
			$equal = self::strictEq( $left, $right );
			return '===' === $operator ? $equal : ! $equal; }
		if ( '==' === $operator || '!=' === $operator ) {
			$equal = self::looseEq( $left, $right );
			return '==' === $operator ? $equal : ! $equal; }
		$left  = self::dynamicPrimitive( $left );
		$right = self::dynamicPrimitive( $right );
		if ( $left instanceof JsBigInt || $right instanceof JsBigInt ) {
			return self::bigintBinary( $operator, $left, $right ); }
		if ( in_array( $operator, array( '&', '|', '^', '<<', '>>', '>>>' ), true ) ) {
			return self::bitwise( $operator, $left, $right ); }
		if ( '+' === $operator ) {
			return is_string( $left ) || is_string( $right ) ? self::str( $left ) . self::str( $right ) : self::add( self::toNumber( $left ), self::toNumber( $right ) );
		}
		if ( in_array( $operator, array( '<', '<=', '>', '>=' ), true ) && is_string( $left ) && is_string( $right ) ) {
			$comparison = self::stringCompare( $left, $right );
			return match ( $operator ) {
				'<' => $comparison < 0, '<=' => $comparison <= 0, '>' => $comparison > 0, '>=' => $comparison >= 0 };
		}
		$a = self::toNumber( $left );
		$b = self::toNumber( $right );
		return match ( $operator ) {
			'-' => self::sub( $a, $b ), '*' => self::mul( $a, $b ), '/' => self::n( fdiv( $a, $b ) ), '%' => self::n( fmod( $a, $b ) ), '**' => self::pow( $a, $b ),
			'<' => $a < $b, '<=' => $a <= $b, '>' => $a > $b, '>=' => $a >= $b,
			default => throw new JsError( 'Unsupported JavaScript operator ' . $operator, 'TypeError' ),
		};
	}

	/**
	 * An operator on primitives where one is a BigInt (ECMAScript 13.15.3 ApplyStringOrNumericBinaryOperator).
	 * `+` with a string concatenates; relational and equality operators compare mathematically
	 * across BigInt, number and numeric strings; everything else needs two BigInts.
	 */
	private static function bigintBinary( string $operator, mixed $left, mixed $right ): mixed {
		if ( '+' === $operator && ( is_string( $left ) || is_string( $right ) ) ) {
			return self::str( $left ) . self::str( $right ); }
		if ( in_array( $operator, array( '<', '<=', '>', '>=', '==', '!=' ), true ) ) {
			$c = self::bigintCompare( $left, $right );
			if ( '==' === $operator || '!=' === $operator ) {
				return ( 0 === $c ) === ( '==' === $operator ); }
			if ( null === $c ) {
				return false; }
			return match ( $operator ) {
				'<' => $c < 0, '<=' => $c <= 0, '>' => $c > 0, '>=' => $c >= 0 };
		}
		if ( ! $left instanceof JsBigInt || ! $right instanceof JsBigInt ) {
			throw new JsError( 'Cannot mix BigInt and other types, use explicit conversions', 'TypeError' );
		}
		return match ( $operator ) {
			'+' => $left->add( $right ), '-' => $left->sub( $right ), '*' => $left->mul( $right ),
			'/' => $left->divRem( $right )[0], '%' => $left->divRem( $right )[1], '**' => $left->pow( $right ),
			'&', '|', '^' => $left->bitwise( $operator, $right ),
			'<<' => $left->shift( $right, true ), '>>' => $left->shift( $right, false ),
			'>>>' => throw new JsError( 'BigInts have no unsigned right shift, use >> instead', 'TypeError' ),
			default => throw new JsError( 'Unsupported JavaScript operator ' . $operator, 'TypeError' ),
		};
	}

	/** Mathematical comparison of a BigInt with a BigInt, number, string or boolean; null when unordered. */
	private static function bigintCompare( mixed $a, mixed $b ): ?int {
		$side    = static function ( mixed $v ): JsBigInt|int|float|null {
			if ( $v instanceof JsBigInt ) {
				return $v; }
			if ( is_string( $v ) ) {
				return JsBigInt::parse( $v ); }
			if ( is_bool( $v ) || null === $v ) {
				return $v ? 1 : 0; }
			if ( is_int( $v ) || is_float( $v ) ) {
				return $v; }
			return null;
		};
		[$x, $y] = array( $side( $a ), $side( $b ) );
		if ( null === $x || null === $y ) {
			return null; }
		if ( is_float( $x ) && is_nan( $x ) || is_float( $y ) && is_nan( $y ) ) {
			return null; }
		if ( ! $x instanceof JsBigInt && ! $y instanceof JsBigInt ) {
			return $x <=> $y; }
		$flip = ! $x instanceof JsBigInt;
		if ( $flip ) {
			[$x, $y] = array( $y, $x ); }
		if ( $y instanceof JsBigInt ) {
			$c = $x->compare( $y ); } elseif ( is_infinite( (float) $y ) ) {
			$c = $y > 0 ? -1 : 1; } else {
						// Compare with the number's integer part, then its fraction.
						$whole = $y < 0 ? ceil( (float) $y ) : floor( (float) $y );
						$c     = $x->compare( JsBigInt::fromNumber( $whole ) );
				if ( 0 === $c && (float) $y !== $whole ) {
					$c = $y > $whole ? -1 : 1; }
			}
			return $flip ? -$c : $c;
	}

	public static function looseEq( mixed $a, mixed $b ): bool {
		if ( self::isNullish( $a ) || self::isNullish( $b ) ) {
			return self::isNullish( $a ) && self::isNullish( $b ); }
		$ta = self::typeOf( $a );
		$tb = self::typeOf( $b );
		if ( $ta === $tb ) {
			return self::strictEq( $a, $b ); }
		if ( 'bigint' === $ta || 'bigint' === $tb ) {
			$other = 'bigint' === $ta ? $b : $a;
			if ( is_object( $other ) && ! $other instanceof JsBigInt ) {
				return self::looseEq( 'bigint' === $ta ? $a : self::dynamicPrimitive( $a ), 'bigint' === $ta ? self::dynamicPrimitive( $b ) : $b ); }
			return self::bigintCompare( $a, $b ) === 0;
		}
		if ( is_bool( $a ) ) {
			return self::looseEq( (int) $a, $b ); }
		if ( is_bool( $b ) ) {
			return self::looseEq( $a, (int) $b ); }
		if ( 'function' === $ta && ( 'number' === $tb || 'string' === $tb ) ) {
			return self::looseEq( self::dynamicPrimitive( $a ), $b ); }
		if ( 'function' === $tb && ( 'number' === $ta || 'string' === $ta ) ) {
			return self::looseEq( $a, self::dynamicPrimitive( $b ) ); }
		if ( ( 'number' === $ta && 'string' === $tb ) || ( 'string' === $ta && 'number' === $tb ) ) {
			return self::strictEq( self::toNumber( $a ), self::toNumber( $b ) ); }
		if ( 'object' === $ta && ( 'string' === $tb || 'number' === $tb ) ) {
			return self::looseEq( self::dynamicPrimitive( $a ), $b ); }
		if ( 'object' === $tb && ( 'string' === $ta || 'number' === $ta ) ) {
			return self::looseEq( $a, self::dynamicPrimitive( $b ) ); }
		return false;
	}
}
