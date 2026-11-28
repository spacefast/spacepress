<?php

declare(strict_types=1);

namespace SpacePress;

/**
 * WHATWG WritableStream with a default writer. Writes queue in order; each one waits for the
 * sink's previous `write` promise, so a sink sees one chunk at a time, as in the standard.
 */
final class JsWritableStream {

	private const WRITABLE = 0;
	private const CLOSED   = 1;
	private const ERRORED  = 2;

	private int $state         = self::WRITABLE;
	private mixed $storedError = JsUndefined::Value; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	private JsPromise $tail;
	private bool $closing     = false;
	private ?JsObject $writer = null;
	private JsObject $controller;
	private mixed $sink;

	public function __construct( mixed $sink = JsUndefined::Value, mixed $strategy = JsUndefined::Value ) {
		$this->sink = Js::isNullish( $sink ) ? new JsObject() : $sink;
		if ( ! Js::isNullish( $strategy ) && ! Js::isNullish( Js::dynamicGet( $strategy, 'size' ) ) ) {
			throw new JsError( 'WritableStream size() strategies are not supported', 'TypeError' );
		}
		$this->controller = new JsObject( array( 'error' => fn ( mixed $e = JsUndefined::Value ) => $this->fail( $e ) ) );
		$start            = $this->sink_method( 'start' );
		$this->tail       = JsPromise::from( null === $start ? JsUndefined::Value : $this->call_sink( $start, array( $this->controller ) ) );
		$this->tail->then(
			null,
			function ( $reason ): JsUndefined {
				$this->fail( $reason );
				return JsUndefined::Value;
			},
			false
		);
	}

	/** A stream into a PHP stream resource: each chunk is written as bytes. */
	public static function toResource( mixed $handle ): self { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return new self(
			new JsObject(
				array(
					'write' => static function ( $chunk ) use ( $handle ) {
						$bytes = is_string( $chunk ) ? $chunk : ( is_object( $chunk ) && method_exists( $chunk, 'bytes' ) ? $chunk->bytes() : Js::str( $chunk ) );
						if ( fwrite( $handle, $bytes ) !== strlen( $bytes ) ) {
							throw new JsError( 'The stream resource could not be written', 'TypeError' ); }
						return JsUndefined::Value;
					},
				)
			)
		);
	}

	private function sink_method( string $name ): ?\Closure {
		$method = Js::dynamicGet( $this->sink, $name );
		if ( Js::isNullish( $method ) ) {
			return null; }
		if ( ! $method instanceof \Closure ) {
			throw new JsError( "WritableStream sink $name is not a function", 'TypeError' ); }
		return $method;
	}

	private function call_sink( \Closure $method, array $args ): mixed {
		try {
			return Js::invokeWithReceiver( $method, $this->sink, $args );
		} catch ( JsError $error ) {
			return JsPromise::rejected( Js::thrownValue( $error ) );
		}
	}

	private function fail( mixed $reason ): JsUndefined {
		if ( self::WRITABLE !== $this->state ) {
			return JsUndefined::Value; }
		$this->state       = self::ERRORED;
		$this->storedError = $reason; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		return JsUndefined::Value;
	}

	/** Runs one sink operation after every earlier one has settled. */
	private function chain( \Closure $operation ): JsPromise {
		$next       = $this->tail->then(
			function () use ( $operation ) {
				if ( self::ERRORED === $this->state ) {
					throw Js::throwable( $this->storedError ); } // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				return $operation();
			}
		);
		$this->tail = $next->then( null, static fn () => JsUndefined::Value );
		$next->then(
			null,
			function ( $reason ): JsUndefined {
				$this->fail( $reason );
				return JsUndefined::Value;
			},
			false
		);
		return $next;
	}

	public function write( mixed $chunk ): JsPromise {
		if ( self::ERRORED === $this->state ) {
			return JsPromise::rejected( $this->storedError ); } // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		if ( $this->closing || self::CLOSED === $this->state ) {
			return JsPromise::rejected( new JsError( 'Cannot write to a closing or closed stream', 'TypeError' ) ); }
		return $this->chain(
			function () use ( $chunk ) {
				$write = $this->sink_method( 'write' );
				return null === $write ? JsUndefined::Value : $this->call_sink( $write, array( $chunk, $this->controller ) );
			}
		);
	}

	public function close(): JsPromise {
		if ( self::ERRORED === $this->state ) {
			return JsPromise::rejected( $this->storedError ); } // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		if ( $this->closing || self::CLOSED === $this->state ) {
			return JsPromise::rejected( new JsError( 'The stream is already closing or closed', 'TypeError' ) ); }
		$this->closing = true;
		return $this->chain(
			function () {
				$close  = $this->sink_method( 'close' );
				$result = null === $close ? JsUndefined::Value : $this->call_sink( $close, array() );
				return JsPromise::from( $result )->then(
					function () {
						$this->state = self::CLOSED;
						return JsUndefined::Value;
					}
				);
			}
		);
	}

	public function abort( mixed $reason = JsUndefined::Value ): JsPromise {
		if ( self::WRITABLE !== $this->state ) {
			return JsPromise::from( JsUndefined::Value ); }
		$this->fail( $reason );
		$abort  = $this->sink_method( 'abort' );
		$result = null === $abort ? JsUndefined::Value : $this->call_sink( $abort, array( $reason ) );
		return JsPromise::from( $result )->then( static fn () => JsUndefined::Value );
	}

	public function getWriter(): JsObject { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( null !== $this->writer ) {
			throw new JsError( 'WritableStream is locked to a writer', 'TypeError' ); }
		$released     = false;
		$guard        = static function () use ( &$released ): void {
			if ( $released ) {
				throw new JsError( 'This writer has been released', 'TypeError' ); }
		};
		$writer       = new JsObject();
		$writer->p    = array(
			'write'       => function ( mixed $chunk = JsUndefined::Value ) use ( $guard ) {
				$guard();
				return $this->write( $chunk ); },
			'close'       => function () use ( $guard ) {
				$guard();
				return $this->close(); },
			'abort'       => function ( mixed $reason = JsUndefined::Value ) use ( $guard ) {
				$guard();
				return $this->abort( $reason ); },
			'releaseLock' => function () use ( &$released, $writer ) {
				$released = true;
				if ( $this->writer === $writer ) {
					$this->writer = null; }
				return JsUndefined::Value;
			},
			'ready'       => JsPromise::from( JsUndefined::Value ),
		);
		$this->writer = $writer;
		return $writer;
	}

	public function call( string $method, array $args ): mixed {
		$arg = static fn ( int $i ) => array_key_exists( $i, $args ) ? $args[ $i ] : JsUndefined::Value;
		if ( null !== $this->writer && in_array( $method, array( 'close', 'abort' ), true ) ) {
			return JsPromise::rejected( new JsError( 'Cannot ' . $method . ' a locked stream', 'TypeError' ) );
		}
		return match ( $method ) {
			'getWriter' => $this->getWriter(),
			'close' => $this->close(),
			'abort' => $this->abort( $arg( 0 ) ),
			default => throw new JsError( $method . ' is not a function', 'TypeError' ),
		};
	}

	public function get( string $key ): mixed {
		return match ( $key ) {
			'locked' => null !== $this->writer,
			default => in_array( $key, array( 'getWriter', 'close', 'abort' ), true ) ? fn ( mixed ...$args ) => $this->call( $key, $args ) : JsUndefined::Value,
		};
	}
}
