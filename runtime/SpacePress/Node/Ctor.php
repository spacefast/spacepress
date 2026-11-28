<?php
declare(strict_types=1);
namespace SpacePress\Node;

use SpacePress\JsError;
use SpacePress\JsUndefined;

/** A class a Node built-in module exports (`Buffer`): its static members, `new` and `instanceof`. */
final class Ctor implements Dispatch {

	/**
	 * @param array<string, mixed> $statics static methods (\Closure) and values
	 * @param \Closure(mixed): bool $instance `value instanceof` this class
	 * @param ?\Closure(array): mixed $construct `new` with its arguments; null when `new` is refused
	 */
	public function __construct(
		public readonly string $name,
		private readonly array $statics,
		private readonly \Closure $instance,
		private readonly ?\Closure $construct = null,
	) {}

	public function read( string $key ): mixed {
		if ( 'name' === $key ) {
			return $this->name; }
		return array_key_exists( $key, $this->statics ) ? $this->statics[ $key ] : JsUndefined::Value;
	}

	public function invoke( string $name, array $args ): mixed {
		$member = $this->read( $name );
		if ( $member instanceof \Closure ) {
			return $member( ...$args ); }
		if ( 'toString' === $name ) {
			return 'function ' . $this->name . '() { [native code] }'; }
		if ( 'valueOf' === $name ) {
			return $this; }
		throw new JsError( $this->name . '.' . $name . ' is not a function', 'TypeError' );
	}

	public function isInstance( mixed $value ): bool {
		return ( $this->instance )( $value ); }

	public function construct( array $args ): mixed {
		if ( null === $this->construct ) {
			throw new JsError( $this->name . ' is not a constructor in compiled code', 'TypeError' ); }
		return ( $this->construct )( $args );
	}
}
