<?php
declare(strict_types=1);
namespace SpacePress;
final class JsObject {

	public bool $nullPrototype = false; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	/**
	 * Non-enumerable own string-keyed properties (an Error's message, cause and stack).
	 * Enumeration, JSON, spread and cloning read only $p, so these stay invisible to them.
	 */
	public array $hidden = array();
	/**
	 * Symbol-keyed own properties, apart from the string keys in $p so that
	 * string enumeration (keys, for…in, JSON) never sees them.
	 * spl_object_id(symbol) => [symbol, value, enumerable, writable, configurable]
	 */
	public array $symbols = array();

	public function __construct( public array $p = array(), public readonly ?JsClass $class = null, bool $nullPrototype = false ) { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.classFound, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP parameter name. Preserve the existing PHP variable name.
		$this->nullPrototype = $nullPrototype; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP property name. Preserve the existing PHP variable name.
	}

	public function hasSymbol( JsSymbol $key ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return isset( $this->symbols[ spl_object_id( $key ) ] ); }

	public function getSymbol( JsSymbol $key ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return $this->symbols[ spl_object_id( $key ) ][1] ?? JsUndefined::Value; }

	public function setSymbol( JsSymbol $key, mixed $value ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$id = spl_object_id( $key );
		if ( isset( $this->symbols[ $id ] ) ) {
			if ( ! $this->symbols[ $id ][3] ) {
				throw new JsError( 'Cannot assign to read only property ' . $key->descriptiveString(), 'TypeError' ); }
			$this->symbols[ $id ][1] = $value;
		} else {
			$this->symbols[ $id ] = array( $key, $value, true, true, true );
		}
		return $value;
	}
}
