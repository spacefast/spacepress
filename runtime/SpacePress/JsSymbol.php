<?php
declare(strict_types=1);
namespace SpacePress;

/**
 * A JavaScript symbol. PHP object identity is symbol identity. The registry
 * behind Symbol.for lives for one request, like every module-level value.
 */
final class JsSymbol {

	private const WELL_KNOWN         = array( 'asyncIterator', 'hasInstance', 'iterator', 'toStringTag' );
	private static array $registry   = array();
	private static array $well_known = array();

	private function __construct( public readonly string|JsUndefined $description, public readonly ?string $registryKey = null, public readonly bool $isWellKnown = false ) {} // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.

	/** `Symbol(description)`: a fresh symbol each call. */
	public static function create( JsArray $args ): self {
		$description = array_key_exists( 0, $args->a ) ? $args->a[0] : JsUndefined::Value;
		return new self( JsUndefined::Value === $description ? JsUndefined::Value : Js::str( $description ) );
	}

	/** `Symbol.for(key)`: one symbol per key string for the request. */
	public static function for( mixed $key ): self {
		$key                             = Js::str( $key );
		return self::$registry[ $key ] ??= new self( $key, $key );
	}

	public static function keyFor( mixed $symbol ): string|JsUndefined { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( ! $symbol instanceof self ) {
			throw new JsError( Js::typeOf( $symbol ) . ' is not a symbol', 'TypeError' ); }
		return $symbol->registryKey ?? JsUndefined::Value; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
	}

	// phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the method name used by compiled PHP.
	public static function wellKnown( string $name ): self {
		if ( ! in_array( $name, self::WELL_KNOWN, true ) ) {
			throw new JsError( 'Unsupported well-known symbol Symbol.' . $name, 'TypeError' ); }
		return self::$well_known[ $name ] ??= new self( 'Symbol.' . $name, null, true );
	}

	/** Registered symbols are not weakly held, so they can't be weak collection keys. */
	public function registered(): bool {
		return null !== $this->registryKey; } // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.

	/** `String(symbol)` and `symbol.toString()`; implicit conversion throws instead. */
	public function descriptiveString(): string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return 'Symbol(' . ( JsUndefined::Value === $this->description ? '' : $this->description ) . ')';
	}
}
