<?php
declare(strict_types=1);
namespace SpacePress;

/**
 * Descriptors carry dispatch identity; instance own properties stay in JsObject.
 *
 * Private names (`#x`) belong to one class evaluation, as in JavaScript: each
 * descriptor keeps its own brand table from receiver to private slots. Private
 * state never enters JsObject::$p, so enumeration, JSON and cloning cannot see it.
 */
final class JsClass {

	/** @var \WeakMap<JsObject, array<string, mixed>>|null */
	private ?\WeakMap $brands = null;
	/** @var array<string, \Closure> */
	private array $methodValues = array(); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	/**
	 * Symbol-keyed prototype members by spl_object_id(symbol): computed methods
	 * (['m', symbol, closure]) and Object.defineProperty(C.prototype, symbol, ...) data
	 * (['d', symbol, value, enumerable, writable, configurable]); a later definition replaces.
	 * @var array<int, array>
	 */
	private array $prototypeSymbols = array(); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	/** @var array<int, array{0: JsSymbol, 1: \Closure}> static symbol-keyed methods */
	private array $staticSymbols = array(); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	/** @var array<string, \Closure> one function value per symbol member */
	private array $symbolValues     = array(); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	private ?JsPrototype $prototype = null;
	private ?self $prototype_parent = null;

	public function __construct(
		public readonly ?self $parent, // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.parentFound -- Preserve the existing PHP parameter name.
		private readonly ?\Closure $constructor,
		private readonly \Closure $fields,
		private readonly array $methods,
		private readonly array $staticMethods, // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		public readonly JsObject $statics,
		private readonly array $privateMethods = array(), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		private readonly array $staticPrivateMethods = array(), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		private readonly ?JsObject $privateStatics = null, // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		/** @var array<string, array{0: ?\Closure, 1: ?\Closure}> getter/setter pairs on the prototype */
		private readonly array $accessors = array(),
		/** @var array<string, array{0: ?\Closure, 1: ?\Closure}> static getter/setter pairs */
		private readonly array $staticAccessors = array(), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		/** Prototype data properties of a built-in root (Error.prototype.name and .message). */
		private readonly array $prototypeData = array(), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		/** The built-in constructor this descriptor models, if any. */
		public readonly ?string $builtin = null,
		/** @var list<array{0: JsSymbol, 1: \Closure}> `[symbol](...) {}` prototype methods */
		array $symbolMethods = array(), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		/** @var list<array{0: JsSymbol, 1: \Closure}> `static [symbol](...) {}` methods */
		array $staticSymbolMethods = array(), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		/** @var list<array{0: JsSymbol, 1: mixed, 2: bool, 3: bool, 4: bool}> prototype data defined at build time */
		array $prototypeSymbols = array(), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	) {
		foreach ( $symbolMethods as [$symbol, $method] ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$this->prototypeSymbols[ spl_object_id( $symbol ) ] = array( 'm', $symbol, $method ); } // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		foreach ( $staticSymbolMethods as [$symbol, $method] ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$this->staticSymbols[ spl_object_id( $symbol ) ] = array( $symbol, $method ); } // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		foreach ( $prototypeSymbols as [$symbol, $value, $enumerable, $writable, $configurable] ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$this->prototypeSymbols[ spl_object_id( $symbol ) ] = array( 'd', $symbol, $value, $enumerable, $writable, $configurable ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		}
	}

	/** `C.prototype`: one object per class descriptor, so identity comparisons hold. */
	public function prototype(): JsPrototype {
		return $this->prototype ??= new JsPrototype( $this );
	}

	/** util.inherits changes the instance's prototype chain without changing super() or static inheritance. */
	public function inherit_prototype( self $superclass ): void {
		for ( $class = $superclass; null !== $class; $class = $class->lookup_parent( false ) ) {
			if ( $class === $this ) {
				throw new JsError( 'Cyclic prototype value', 'TypeError' );
			}
		}
		$this->prototype_parent = $superclass;
	}

	private function lookup_parent( bool $for_static ): ?self {
		return $for_static ? $this->parent : $this->prototype_parent ?? $this->parent;
	}

	/** The nearest symbol-keyed member along the chain: a prototype slot, or [symbol, closure] for static. */
	private function symbolSlot( JsSymbol $key, bool $static ): ?array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, Universal.NamingConventions.NoReservedKeywordParameterNames.staticFound -- Preserve the existing PHP method name. Preserve the existing PHP parameter name.
		$id = spl_object_id( $key );
		for ( $class = $this; null !== $class; $class = $class->lookup_parent( $static ) ) {
			$slot = ( $static ? $class->staticSymbols : $class->prototypeSymbols )[ $id ] ?? null; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			if ( null !== $slot ) {
				return $static ? array( 'm', $slot[0], $slot[1], $class ) : array( ...$slot, $class ); }
		}
		return null;
	}

	/**
	 * [[Get]] of a symbol key that is not an own property: the class chain's member, or
	 * absent(). Class prototypes inherit from Object.prototype (or Error.prototype), which
	 * own no symbol keys, so a miss here is exact. Static lookups end at Function.prototype,
	 * whose only symbol member is Symbol.hasInstance.
	 */
	public function symbolGet( JsSymbol $key, bool $static ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, Universal.NamingConventions.NoReservedKeywordParameterNames.staticFound -- Preserve the existing PHP method name. Preserve the existing PHP parameter name.
		$slot = $this->symbolSlot( $key, $static );
		if ( null === $slot ) {
			return $static && $key === JsSymbol::wellKnown( 'hasInstance' ) ? self::ordinaryHasInstanceFunction() : self::absent(); // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
		}
		if ( 'd' === $slot[0] ) {
			return $slot[2]; }
		$owner                                  = $slot[3];
		$cache                                  = ( $static ? 'static:' : '' ) . spl_object_id( $key );
		$method                                 = $slot[2];
		return $owner->symbolValues[ $cache ] ??= Js::dynamicMethodFunction( // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			static fn ( ...$args ) => $method( JsUndefined::Value, ...$args ),
			static fn ( $thisArg, JsArray $args ) => $method( $thisArg, ...$args->a ), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		);
	}

	/** Whether an inherited symbol data property is read-only (a strict-mode write throws). */
	public function symbolReadOnly( JsSymbol $key ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$slot = $this->symbolSlot( $key, false );
		return null !== $slot && 'd' === $slot[0] && ! $slot[4];
	}

	/** Object.defineProperty(C.prototype, symbol, { value, ... }) with a data descriptor. */
	public function defineSymbol( JsSymbol $key, mixed $value, bool $enumerable, bool $writable, bool $configurable ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( $key->isWellKnown ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			throw new JsError( 'Defining well-known symbols on a class prototype is not supported', 'TypeError' ); }
		$id       = spl_object_id( $key );
		$existing = $this->prototypeSymbols[ $id ] ?? null; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		if ( null !== $existing && 'd' === $existing[0] && ! $existing[5] ) {
			throw new JsError( 'Cannot redefine property: ' . $key->descriptiveString(), 'TypeError' );
		}
		unset( $this->symbolValues[ (string) $id ] ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		$this->prototypeSymbols[ $id ] = array( 'd', $key, $value, $enumerable, $writable, $configurable ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
	}

	/**
	 * `value instanceof C` (ECMAScript InstanceofOperator): a static [Symbol.hasInstance]
	 * method on the class chain decides, called with C as its receiver; otherwise the
	 * ordinary prototype-chain walk.
	 */
	// phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the method name used by compiled PHP.
	public static function instanceOf( mixed $value, self $constructor ): bool {
		$slot = $constructor->symbolSlot( JsSymbol::wellKnown( 'hasInstance' ), true );
		if ( null !== $slot ) {
			return Js::truthy( ( $slot[2] )( $constructor, $value ) ); }
		return self::isInstance( $value, $constructor );
	}

	/** Function.prototype[Symbol.hasInstance] (OrdinaryHasInstance); call/apply supply the constructor. */
	public static function ordinaryHasInstanceFunction(): \Closure { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		static $function;
		if ( null === $function ) {
			$function = Js::dynamicMethodFunction(
				static fn ( mixed $value = JsUndefined::Value ) => self::ordinaryHasInstance( JsUndefined::Value, $value ),
				static fn ( $thisArg, JsArray $args ) => self::ordinaryHasInstance( $thisArg, array_key_exists( 0, $args->a ) ? $args->a[0] : JsUndefined::Value ), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			);
		}
		return $function;
	}

	/** OrdinaryHasInstance(C, O): a non-callable C is false; a class walks its own chain. */
	public static function ordinaryHasInstance( mixed $constructor, mixed $value ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( $constructor instanceof self ) {
			return self::isInstance( $value, $constructor ); }
		if ( is_string( $constructor ) && in_array( $constructor, Builtins::ERROR_CONSTRUCTORS, true ) ) {
			return Js::isError( $value, $constructor ); }
		if ( $constructor instanceof \Closure ) {
			throw new JsError( 'instanceof with plain functions is not supported', 'TypeError' ); }
		return false;
	}

	/** `Function.prototype[key]`: only Symbol.hasInstance is modeled. */
	// phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the method name used by compiled PHP.
	public static function functionPrototypeGet( mixed $key ): mixed {
		if ( $key === JsSymbol::wellKnown( 'hasInstance' ) ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
			return self::ordinaryHasInstanceFunction(); }
		throw new JsError( 'Function.prototype members other than Symbol.hasInstance are not supported', 'TypeError' );
	}

	/** @var array<string, self> */
	private static array $builtins = array();

	/**
	 * Class roots for EventEmitter and the Error constructors, used for construction,
	 * prototype methods, and instanceof.
	 */
	public static function builtin( string $name ): self {
		if ( isset( self::$builtins[ $name ] ) ) {
			return self::$builtins[ $name ]; }
		if ( 'EventEmitter' === $name ) {
			$descriptor = Node\Events::class_descriptor();
			$descriptor->set( 'EventEmitter', $descriptor );
			self::$builtins[ $name ] = $descriptor;
			return $descriptor;
		}
		if ( ! in_array( $name, Builtins::ERROR_CONSTRUCTORS, true ) ) {
			throw new JsError( "Extending $name is not supported", 'TypeError' );
		}
		$parent                         = 'Error' === $name ? null : self::builtin( 'Error' );
		$constructor                    = static function ( JsObject $self, mixed $message = JsUndefined::Value, mixed $options = JsUndefined::Value ): void { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.selfFound -- Preserve the existing PHP parameter name.
			if ( JsUndefined::Value !== $message ) {
				$self->hidden['message'] = Js::str( $message ); }
			// InstallErrorCause: HasProperty(options, "cause"), so an inherited cause counts too.
			if ( $options instanceof JsObject && Js::hasProperty( 'cause', $options ) ) {
				$self->hidden['cause'] = Js::dynamicGet( $options, 'cause' ); }
			$self->hidden['stack'] = self::lazyStack();
		};
		$toString                       = static function ( mixed $self ): string { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase, Universal.NamingConventions.NoReservedKeywordParameterNames.selfFound -- Preserve the existing PHP variable name. Preserve the existing PHP parameter name.
			$name    = Js::dynamicGet( $self, 'name' );
			$message = Js::dynamicGet( $self, 'message' );
			$name    = JsUndefined::Value === $name ? 'Error' : Js::str( $name );
			$message = JsUndefined::Value === $message ? '' : Js::str( $message );
			return '' === $name ? $message : ( '' === $message ? $name : "$name: $message" );
		};
		return self::$builtins[ $name ] = new self( // phpcs:ignore Squiz.PHP.DisallowMultipleAssignments.Found -- Keep the assignment and its test together.
			$parent,
			$constructor,
			static function (): void {},
			null === $parent ? array( 'toString' => $toString ) : array(), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			array(),
			new JsObject(),
			prototypeData: array(
				'name'    => $name,
				'message' => '',
			),
			builtin: $name,
		);
	}

	/** The root built-in constructor name of a class chain ('Error', 'TypeError', ...), or null. */
	public function builtinRoot(): ?string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		for ( $class = $this; null !== $class; $class = $class->lookup_parent( false ) ) {
			if ( null !== $class->builtin ) {
				return $class->builtin; }
		}
		return null;
	}

	/** True when the chain reaches the built-in constructor $name (TypeError reaches Error too). */
	public function extendsBuiltin( string $name ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		for ( $class = $this; null !== $class; $class = $class->lookup_parent( false ) ) {
			if ( $class->builtin === $name ) {
				return true; }
		}
		return false;
	}

	/** Marks a stack that is formatted on first read, as V8 does, from the error's current name and message. */
	public static function lazyStack(): \stdClass { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		static $marker;
		return $marker ??= new \stdClass();
	}

	/** Error.captureStackTrace(target): defines an own non-enumerable stack; SpacePress records no frames. */
	// phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the method name used by compiled PHP.
	public static function captureStackTrace( mixed $target ): JsUndefined {
		if ( ! $target instanceof JsObject ) {
			throw new JsError( 'Invalid argument', 'TypeError' ); }
		$target->hidden['stack'] = self::lazyStack();
		return JsUndefined::Value;
	}

	/** True for any prototype member: accessor, method or built-in prototype data. */
	public function hasMember( string $name ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( $this->accessor( $name, false ) !== null || $this->hasMethod( $name ) ) {
			return true; }
		for ( $class = $this; null !== $class; $class = $class->lookup_parent( false ) ) {
			if ( array_key_exists( $name, $class->prototypeData ) ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				return true; }
		}
		return false;
	}

	/** The nearest accessor pair for a key along the prototype chain, or null. */
	public function accessor( string $name, bool $static ): ?array { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.staticFound -- Preserve the existing PHP parameter name.
		$own = ( $static ? $this->staticAccessors : $this->accessors )[ $name ] ?? null; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		if ( null !== $own ) {
			return $own; }
		if ( isset( ( $static ? $this->staticMethods : $this->methods )[ $name ] ) ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			return null; }
		if ( $static && array_key_exists( $name, $this->statics->p ) ) {
			return null; }
		return $this->lookup_parent( $static )?->accessor( $name, $static );
	}

	/** Returned by readInherited when no prototype member has the name; compared by identity. */
	public static function absent(): \stdClass {
		static $absent;
		return $absent ??= new \stdClass();
	}

	/** [[Get]] for a name that is not an own data property: accessor first, then methods. */
	public function readInherited( JsObject|self|JsPrototype $receiver, string $name, bool $static ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, Universal.NamingConventions.NoReservedKeywordParameterNames.staticFound -- Preserve the existing PHP method name. Preserve the existing PHP parameter name.
		$accessor = $this->accessor( $name, $static );
		if ( null !== $accessor ) {
			return null === $accessor[0] ? JsUndefined::Value : ( $accessor[0] )( $receiver );
		}
		if ( $static ? $this->hasStaticMethod( $name ) : $this->hasMethod( $name ) ) {
			return $this->methodValue( $name, $static );
		}
		if ( ! $static ) {
			for ( $class = $this; null !== $class; $class = $class->lookup_parent( false ) ) {
				if ( array_key_exists( $name, $class->prototypeData ) ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
					return $class->prototypeData[ $name ]; } // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			}
		}
		return self::absent();
	}

	/** [[Set]] through an inherited accessor; returns false when no accessor intercepts the write. */
	public function writeInherited( JsObject|self $receiver, string $name, mixed $value, bool $static ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, Universal.NamingConventions.NoReservedKeywordParameterNames.staticFound -- Preserve the existing PHP method name. Preserve the existing PHP parameter name.
		$accessor = $this->accessor( $name, $static );
		if ( null === $accessor ) {
			return false; }
		if ( null === $accessor[1] ) {
			throw new JsError( "Cannot set property $name of #<Object> which has only a getter", 'TypeError' );
		}
		( $accessor[1] )( $receiver, $value );
		return true;
	}

	public function construct( mixed ...$args ): JsObject {
		$instance = new JsObject( array(), $this );
		$this->initialize( $instance, $args );
		return $instance;
	}

	public function initialize( JsObject $instance, array $args ): void {
		// A built-in root only runs its own constructor; it has no fields or parent fields.
		if ( null !== $this->builtin ) {
			( $this->constructor )( $instance, ...array_slice( $args, 0, 2 ) );
			return;
		}
		if ( null !== $this->constructor ) {
			if ( null === $this->parent ) {
				( $this->fields )( $instance, $this ); }
			( $this->constructor )( $instance, ...$args );
		} else {
			$this->parent?->initialize( $instance, $args );
			( $this->fields )( $instance, $this );
		}
	}

	public function hasMethod( string $name ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return isset( $this->methods[ $name ] ) || ( $this->lookup_parent( false )?->hasMethod( $name ) ?? false );
	}

	public function hasStaticMethod( string $name ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return isset( $this->staticMethods[ $name ] ) || ( $this->parent?->hasStaticMethod( $name ) ?? false ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
	}

	private function method( string $name, bool $static ): \Closure { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.staticFound -- Preserve the existing PHP parameter name.
		$method = ( $static ? $this->staticMethods : $this->methods )[ $name ] ?? null; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		if ( null !== $method ) {
			return $method; }
		$owner = $this->lookup_parent( $static );
		if ( null !== $owner ) {
			return $owner->method( $name, $static ); }
		throw new JsError( "Unknown class method $name", 'TypeError' );
	}

	/** One function identity per class and member, like a prototype method; call/apply supply the receiver. */
	public function methodValue( string $name, bool $static ): \Closure { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, Universal.NamingConventions.NoReservedKeywordParameterNames.staticFound -- Preserve the existing PHP method name. Preserve the existing PHP parameter name.
		// Inherited members share the declaring class's function, as with one prototype.
		$owner = $this->lookup_parent( $static );
		if ( ! isset( ( $static ? $this->staticMethods : $this->methods )[ $name ] ) && null !== $owner ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			return $owner->methodValue( $name, $static );
		}
		$method = $this->method( $name, $static );
		$key    = ( $static ? 'static:' : '' ) . spl_object_id( $method );
		if ( ! isset( $this->methodValues[ $key ] ) ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			$this->methodValues[ $key ] = Js::dynamicMethodFunction( // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				static fn ( ...$args ) => $method( JsUndefined::Value, ...$args ),
				static fn ( $thisArg, JsArray $args ) => $method( $thisArg, ...$args->a ), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			);
		}
		return $this->methodValues[ $key ]; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
	}

	public function invokeOn( JsObject|self $receiver, string $name, array $args, bool $static ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, Universal.NamingConventions.NoReservedKeywordParameterNames.staticFound -- Preserve the existing PHP method name. Preserve the existing PHP parameter name.
		return ( $this->method( $name, $static ) )( $receiver, ...$args );
	}

	public static function invoke( JsObject|self $receiver, string $name, array $args, bool $static ): mixed { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.staticFound -- Preserve the existing PHP parameter name.
		$class = $receiver instanceof self ? $receiver : $receiver->class;
		if ( null === $class ) {
			throw new JsError( 'Method receiver has no class', 'TypeError' ); }
		return $class->invokeOn( $receiver, $name, $args, $static );
	}

	public function get( string $key ): mixed {
		return $this->getFor( $this, $key );
	}

	/** Static [[Get]] keeps the original class as the receiver for inherited static getters. */
	private function getFor( self $receiver, string $key ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( array_key_exists( $key, $this->statics->p ) ) {
			return $this->statics->p[ $key ]; }
		if ( 'super_' === $key && null !== $this->prototype_parent ) {
			return $this->prototype_parent;
		}
		$accessor = $this->staticAccessors[ $key ] ?? null; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		if ( null !== $accessor ) {
			return null === $accessor[0] ? JsUndefined::Value : ( $accessor[0] )( $receiver ); }
		return $this->parent?->getFor( $receiver, $key );
	}

	public function has( string $key ): bool {
		return ( 'super_' === $key && null !== $this->prototype_parent )
			|| array_key_exists( $key, $this->statics->p ) || isset( $this->staticAccessors[ $key ] ) // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			|| ( $this->parent?->has( $key ) ?? false );
	}

	public function set( string $key, mixed $value ): mixed {
		if ( ! array_key_exists( $key, $this->statics->p ) && $this->writeInherited( $this, $key, $value, true ) ) {
			return $value; }
		$this->statics->p[ $key ] = $value;
		return $value;
	}

	public static function isInstance( mixed $value, self $expected ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( ! $value instanceof JsObject ) {
			return false; }
		for ( $class = $value->class; null !== $class; $class = $class->lookup_parent( false ) ) {
			if ( $class === $expected ) {
				return true; }
		}
		return false;
	}

	/** Adds this class's brand when its field initialization starts (spec: InitializeInstanceElements). */
	public function brand( JsObject $instance ): void {
		$this->brands ??= new \WeakMap();
		if ( isset( $this->brands[ $instance ] ) ) {
			throw new JsError( 'Cannot initialize private methods of class twice on the same object', 'TypeError' );
		}
		$this->brands[ $instance ] = array();
	}

	/** Defines a private field after its initializer ran (spec: PrivateFieldAdd). */
	public function privateDefine( JsObject $instance, string $name, mixed $value ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$slots = $this->brands[ $instance ] ?? null;
		if ( null === $slots || array_key_exists( $name, $slots ) ) {
			throw new JsError( "Cannot initialize $name twice on the same object", 'TypeError' );
		}
		$this->brands[ $instance ][ $name ] = $value;
	}

	public function privateGet( mixed $receiver, string $name ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( $receiver === $this ) {
			if ( null !== $this->privateStatics && array_key_exists( $name, $this->privateStatics->p ) ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				return $this->privateStatics->p[ $name ]; } // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		} elseif ( $receiver instanceof JsObject && null !== $this->brands && isset( $this->brands[ $receiver ] )
			&& array_key_exists( $name, $this->brands[ $receiver ] ) ) {
			return $this->brands[ $receiver ][ $name ];
		}
		throw new JsError( "Cannot read private member $name from an object whose class did not declare it", 'TypeError' );
	}

	public function privateSet( mixed $receiver, string $name, mixed $value ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( $receiver === $this ) {
			if ( null !== $this->privateStatics && array_key_exists( $name, $this->privateStatics->p ) ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				$this->privateStatics->p[ $name ] = $value; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				return $value;
			}
		} elseif ( $receiver instanceof JsObject && null !== $this->brands && isset( $this->brands[ $receiver ] )
			&& array_key_exists( $name, $this->brands[ $receiver ] ) ) {
			$this->brands[ $receiver ][ $name ] = $value;
			return $value;
		}
		throw new JsError( "Cannot write private member $name to an object whose class did not declare it", 'TypeError' );
	}

	public function privateCall( mixed $receiver, string $name, array $args ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( $receiver === $this ) {
			$method = $this->staticPrivateMethods[ $name ] ?? null; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		} else {
			$method = $receiver instanceof JsObject && null !== $this->brands && isset( $this->brands[ $receiver ] )
				? ( $this->privateMethods[ $name ] ?? null ) // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				: null;
		}
		if ( null === $method ) {
			if ( $receiver === $this || $receiver instanceof JsObject && isset( $this->brands[ $receiver ] ) ) {
				return Js::dynamicCall( $this->privateGet( $receiver, $name ), new JsArray( $args ) );
			}
			throw new JsError( "Receiver must be an instance of the class that declares $name", 'TypeError' );
		}
		return $method( $receiver, ...$args );
	}

	/** `#x in value` (spec: PrivateElementFind on an object; primitives throw). */
	public function privateIn( mixed $value, string $name ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( ! is_object( $value ) || $value instanceof JsUndefined ) {
			throw new JsError( "Cannot use 'in' operator to search for '$name' in " . Js::str( $value ), 'TypeError' );
		}
		if ( $value === $this ) {
			return isset( $this->staticPrivateMethods[ $name ] ) // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				|| null !== $this->privateStatics && array_key_exists( $name, $this->privateStatics->p ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		}
		if ( ! $value instanceof JsObject || null === $this->brands || ! isset( $this->brands[ $value ] ) ) {
			return false; }
		return isset( $this->privateMethods[ $name ] ) || array_key_exists( $name, $this->brands[ $value ] ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
	}
}
