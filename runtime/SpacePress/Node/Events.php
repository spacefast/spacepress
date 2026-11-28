<?php
declare(strict_types=1);
namespace SpacePress\Node;

use SpacePress\Js;
use SpacePress\JsArray;
use SpacePress\JsClass;
use SpacePress\JsError;
use SpacePress\JsMap;
use SpacePress\JsObject;
use SpacePress\JsPromise;
use SpacePress\JsSymbol;
use SpacePress\JsUndefined;

/** The listener state attached to EventEmitter instances, including JavaScript subclasses. */
final class Events {
	/** @var \WeakMap<JsObject, self>|null */
	private static ?\WeakMap $instances             = null;
	private static int|float $default_max_listeners = 10;
	private JsMap $listeners;
	/** @var array<string, true> */
	private array $warned                 = array();
	private int|float|null $max_listeners = null;

	private function __construct() {
		$this->listeners = new JsMap();
	}

	public static function exports(): array {
		$class = JsClass::builtin( 'EventEmitter' );
		return array(
			'EventEmitter' => $class,
			'once'         => $class->get( 'once' ),
		);
	}

	public static function initialize( JsObject $receiver ): void {
		self::$instances            ??= new \WeakMap();
		self::$instances[ $receiver ] = new self();
	}

	public static function class_descriptor(): JsClass {
		$on  = static fn ( mixed $receiver, mixed $name = JsUndefined::Value, mixed $listener = JsUndefined::Value ): JsObject => self::add( $receiver, $name, $listener, false, false );
		$off = self::remove( ... );
		return new JsClass(
			null,
			self::initialize( ... ),
			static function (): void {},
			array(
				'on'                 => $on,
				'addListener'        => $on,
				'off'                => $off,
				'removeListener'     => $off,
				'once'               => static fn ( mixed $receiver, mixed $name = JsUndefined::Value, mixed $listener = JsUndefined::Value ): JsObject => self::add( $receiver, $name, $listener, true, false ),
				'prependListener'    => static fn ( mixed $receiver, mixed $name = JsUndefined::Value, mixed $listener = JsUndefined::Value ): JsObject => self::add( $receiver, $name, $listener, false, true ),
				'removeAllListeners' => self::remove_all( ... ),
				'emit'               => self::emit( ... ),
				'listeners'          => static fn ( mixed $receiver, mixed $name = JsUndefined::Value ): JsArray => new JsArray( array_column( self::state( $receiver )->for_event( self::key( $name ) ), 'listener' ) ),
				'listenerCount'      => self::count( ... ),
				'eventNames'         => self::names( ... ),
				'setMaxListeners'    => self::set_max( ... ),
				'getMaxListeners'    => static fn ( mixed $receiver ): int|float => self::state( $receiver )->limit(),
			),
			array(),
			new JsObject(
				array(
					'name' => 'EventEmitter',
					'once' => self::once( ... ),
				)
			),
			staticAccessors: array(
				'defaultMaxListeners' => array(
					static fn (): int|float => self::$default_max_listeners,
					static function ( JsClass $receiver, mixed $limit ): void {
						self::$default_max_listeners = self::checked_limit( $limit, 'defaultMaxListeners' );
					},
				),
			),
			builtin: 'EventEmitter',
		);
	}

	private static function state( mixed $receiver ): self {
		if ( ! $receiver instanceof JsObject ) {
			throw new JsError( 'EventEmitter method called on an incompatible receiver', 'TypeError' );
		}
		self::$instances                     ??= new \WeakMap();
		return self::$instances[ $receiver ] ??= new self();
	}

	private static function key( mixed $name ): string|JsSymbol {
		return $name instanceof JsSymbol ? $name : Js::key( $name );
	}

	private function limit(): int|float {
		return $this->max_listeners ?? self::$default_max_listeners;
	}

	private static function set_max( mixed $receiver, mixed $limit = JsUndefined::Value ): JsObject {
		self::state( $receiver )->max_listeners = self::checked_limit( $limit, 'n' );
		return $receiver;
	}

	private static function checked_limit( mixed $limit, string $name ): int|float {
		if ( ( ! is_int( $limit ) && ! is_float( $limit ) ) || is_nan( (float) $limit ) || $limit < 0 ) {
			throw JsError::node( 'The value of "' . $name . '" must be a non-negative number', 'RangeError', 'ERR_OUT_OF_RANGE' );
		}
		return $limit;
	}

	private static function names( mixed $receiver ): JsArray {
		$strings = array();
		$symbols = array();
		foreach ( self::state( $receiver )->listeners->keysIterator() as $key ) {
			if ( $key instanceof JsSymbol ) {
				$symbols[] = $key;
			} else {
				$strings[ $key ] = true;
			}
		}
		return new JsArray( array_merge( array_map( 'strval', Js::ownKeys( $strings ) ), $symbols ) );
	}

	/** @return list<array{id: object, listener: \Closure, once: bool}> */
	private function for_event( string|JsSymbol $name ): array {
		$list = $this->listeners->get( $name );
		return is_array( $list ) ? $list : array();
	}

	private static function listener( mixed $value ): \Closure {
		if ( ! $value instanceof \Closure ) {
			throw JsError::node( 'The "listener" argument must be of type function', 'TypeError', 'ERR_INVALID_ARG_TYPE' );
		}
		return $value;
	}

	private static function add( mixed $receiver, mixed $name, mixed $listener, bool $once, bool $prepend ): JsObject {
		$listener = self::listener( $listener );
		$state    = self::state( $receiver );
		$name     = self::key( $name );
		self::emit( $receiver, 'newListener', $name, $listener );
		$list  = $state->for_event( $name );
		$entry = array(
			'id'       => new \stdClass(),
			'listener' => $listener,
			'once'     => $once,
		);
		if ( $prepend ) {
			array_unshift( $list, $entry );
		} else {
			$list[] = $entry;
		}
		$state->listeners->set( $name, $list );
		$limit = $state->limit();
		$key   = JsMap::key( $name );
		$count = count( $list );
		if ( $count > 1 && $limit > 0 && $count > $limit && ! isset( $state->warned[ $key ] ) ) {
			$state->warned[ $key ] = true;
			$message               = 'MaxListenersExceededWarning: ' . $count . ' ' . Js::stringOf( $name ) . ' listeners added to EventEmitter. MaxListeners is ' . $limit;
			error_log( $message ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- Node warns when a listener list grows past its limit.
		}
		return $receiver;
	}

	private static function count( mixed $receiver, mixed $name = JsUndefined::Value, mixed $listener = JsUndefined::Value ): int {
		$list = self::state( $receiver )->for_event( self::key( $name ) );
		if ( JsUndefined::Value === $listener ) {
			return count( $list );
		}
		return count( array_filter( $list, static fn ( array $entry ): bool => $entry['listener'] === $listener ) );
	}

	private static function remove( mixed $receiver, mixed $name = JsUndefined::Value, mixed $listener = JsUndefined::Value ): JsObject {
		$listener = self::listener( $listener );
		$state    = self::state( $receiver );
		$name     = self::key( $name );
		$list     = $state->for_event( $name );
		for ( $i = count( $list ) - 1; $i >= 0; --$i ) {
			if ( $list[ $i ]['listener'] === $listener ) {
				self::remove_entry( $receiver, $name, $list[ $i ]['id'] );
				break;
			}
		}
		return $receiver;
	}

	private static function remove_entry( JsObject $receiver, string|JsSymbol $name, object $id ): void {
		$state = self::state( $receiver );
		$list  = $state->for_event( $name );
		foreach ( $list as $index => $entry ) {
			if ( $entry['id'] !== $id ) {
				continue;
			}
			array_splice( $list, $index, 1 );
			if ( count( $list ) <= 1 ) {
				unset( $state->warned[ JsMap::key( $name ) ] );
			}
			if ( $list ) {
				$state->listeners->set( $name, $list );
			} else {
				$state->listeners->delete( $name );
			}
			self::emit( $receiver, 'removeListener', $name, $entry['listener'] );
			return;
		}
	}

	private static function remove_all( mixed $receiver, mixed ...$names ): JsObject {
		$state = self::state( $receiver );
		$name  = $names ? self::key( $names[0] ) : null;
		if ( ! $state->listeners->has( 'removeListener' ) ) {
			if ( null === $name ) {
				$state->listeners->clear();
				$state->warned = array();
			} else {
				$state->listeners->delete( $name );
				unset( $state->warned[ JsMap::key( $name ) ] );
			}
			return $receiver;
		}
		if ( null === $name ) {
			foreach ( $state->listeners->keysIterator() as $key ) {
				if ( 'removeListener' !== $key ) {
					self::remove_all( $receiver, $key );
				}
			}
			$name = 'removeListener';
		}
		foreach ( array_reverse( $state->for_event( $name ) ) as $entry ) {
			self::remove_entry( $receiver, $name, $entry['id'] );
		}
		return $receiver;
	}

	private static function emit( mixed $receiver, mixed $name = JsUndefined::Value, mixed ...$args ): bool {
		$name = self::key( $name );
		$list = self::state( $receiver )->for_event( $name );
		if ( ! $list && 'error' === $name ) {
			$reason = array_key_exists( 0, $args ) ? $args[0] : JsUndefined::Value;
			if ( Js::isError( $reason ) ) {
				throw Js::throwable( $reason );
			}
			throw JsError::node( 'Unhandled error. (' . Util::inspect( $reason ) . ')', 'Error', 'ERR_UNHANDLED_ERROR' );
		}
		foreach ( $list as $entry ) {
			if ( $entry['once'] ) {
				// More than one emit can have this snapshot. A once entry fires only once, even reentrantly.
				if ( isset( $entry['id']->fired ) ) {
					continue;
				}
				$entry['id']->fired = true;
				self::remove_entry( $receiver, $name, $entry['id'] );
			}
			Js::invokeWithReceiver( $entry['listener'], $receiver, $args );
		}
		return (bool) $list;
	}

	private static function once( mixed $receiver = JsUndefined::Value, mixed $name = JsUndefined::Value ): JsPromise {
		$promise = new JsPromise();
		if ( ! $receiver instanceof JsObject || ! isset( self::$instances[ $receiver ] ) ) {
			$promise->reject( JsError::node( 'The "emitter" argument must be an instance of EventEmitter', 'TypeError', 'ERR_INVALID_ARG_TYPE' ) );
			return $promise;
		}
		$name     = self::key( $name );
		$listener = null;
		$on_error = static function ( mixed $error = JsUndefined::Value ) use ( $receiver, $name, $promise, &$listener ): void {
			self::remove( $receiver, $name, $listener );
			$promise->reject( $error );
		};
		$listener = static function ( mixed ...$args ) use ( $receiver, $name, $promise, $on_error ): void {
			if ( 'error' !== $name ) {
				self::remove( $receiver, 'error', $on_error );
			}
			$promise->resolve( new JsArray( $args ) );
		};
		self::add( $receiver, $name, $listener, true, false );
		if ( 'error' !== $name ) {
			self::add( $receiver, 'error', $on_error, true, false );
		}
		return $promise;
	}
}
