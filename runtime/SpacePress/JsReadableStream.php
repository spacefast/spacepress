<?php

declare(strict_types=1);

namespace SpacePress;

/**
 * WHATWG ReadableStream (default controller and reader) as a pull-driven chunk queue. There is
 * no event loop: `start` runs at construction, `pull` runs when a read finds the queue below the
 * high-water mark, and every promise settles through JsJobs. A PHP stream resource can back the
 * stream so large bodies are read in chunks, never buffered whole.
 * See docs/decisions/2026-11-07-promises-generators-streams.md.
 */
final class JsReadableStream {

	private const READABLE = 0;
	private const CLOSED   = 1;
	private const ERRORED  = 2;

	private int $state         = self::READABLE;
	private mixed $storedError = JsUndefined::Value; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	/** @var list<mixed> */
	private array $queue = array();
	/** @var list<JsPromise> pending read requests */
	private array $reads         = array();
	private bool $closeRequested = false; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	private bool $started        = false;
	private bool $pulling        = false;
	private bool $pullAgain      = false; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	public ?JsObject $reader     = null;
	private ?JsPromise $closed   = null;
	private JsObject $controller;
	private mixed $source;
	private int|float $highWaterMark; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.

	public function __construct( mixed $source = JsUndefined::Value, mixed $strategy = JsUndefined::Value ) {
		$this->source        = Js::isNullish( $source ) ? new JsObject() : $source;
		$hwm                 = Js::isNullish( $strategy ) ? JsUndefined::Value : Js::dynamicGet( $strategy, 'highWaterMark' );
		$this->highWaterMark = JsUndefined::Value === $hwm ? 1 : Js::toNumber( $hwm ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		if ( ! Js::isNullish( $strategy ) && ! Js::isNullish( Js::dynamicGet( $strategy, 'size' ) ) ) {
			throw new JsError( 'ReadableStream size() strategies are not supported', 'TypeError' );
		}
		if ( ! Js::isNullish( Js::dynamicGet( $this->source, 'type' ) ) ) {
			throw new JsError( 'Byte streams (type: "bytes") are not supported', 'TypeError' );
		}
		$this->controller = new JsObject(
			array(
				'enqueue' => fn ( mixed $chunk = JsUndefined::Value ) => $this->enqueue( $chunk ),
				'close'   => fn () => $this->request_close(),
				'error'   => fn ( mixed $e = JsUndefined::Value ) => $this->error( $e ),
			)
		);
		$start            = $this->source_method( 'start' );
		$started          = null === $start ? JsUndefined::Value : $this->call_source( $start, array( $this->controller ) );
		JsPromise::from( $started )->then(
			function (): JsUndefined {
				$this->started = true;
				$this->pull_if_needed();
				return JsUndefined::Value;
			},
			function ( $reason ): JsUndefined {
				$this->error( $reason );
				return JsUndefined::Value;
			},
			false
		);
	}

	/** A stream over a PHP stream resource (`fopen`, `php://temp`, upload temp files). */
	public static function fromResource( mixed $handle, int $chunkSize = 65536 ): self { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		if ( ! is_resource( $handle ) ) {
			throw new \InvalidArgumentException( 'fromResource needs an open stream resource' ); }
		return new self(
			new JsObject(
				array(
					'pull'   => static function ( $controller ) use ( $handle, $chunkSize ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
						$bytes = fread( $handle, $chunkSize ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
						if ( false === $bytes ) {
							throw new JsError( 'The stream resource could not be read', 'TypeError' ); }
						if ( '' !== $bytes ) {
							Js::dynamicCallMethod( $controller, 'enqueue', new JsArray( array( self::chunk( $bytes ) ) ) );
						}
						if ( feof( $handle ) ) {
							fclose( $handle );
							Js::dynamicCallMethod( $controller, 'close', new JsArray() );
						}
						return JsUndefined::Value;
					},
					'cancel' => static function () use ( $handle ) {
						if ( is_resource( $handle ) ) {
							fclose( $handle );
						} return JsUndefined::Value; },
				)
			),
			new JsObject( array( 'highWaterMark' => 0 ) )
		);
	}

	/** A chunk read from a resource is a Uint8Array, as in Node's web streams. */
	private static function chunk( string $bytes ): JsTypedArray {
		return JsTypedArray::fromBytes( $bytes );
	}

	/** Reads the whole stream into a PHP resource (php://temp), chunk by chunk, driving the job queue. */
	public function toResource(): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$out    = fopen( 'php://temp', 'w+b' );
		$reader = $this->getReader();
		while ( true ) {
			$result = JsJobs::await( Js::dynamicCallMethod( $reader, 'read', new JsArray() ) );
			if ( Js::truthy( Js::dynamicGet( $result, 'done' ) ) ) {
				break; }
			$value = Js::dynamicGet( $result, 'value' );
			fwrite(
				$out,
				match ( true ) {
				is_string( $value ) => $value,
				$value instanceof JsArrayBuffer => $value->bytes,
				$value instanceof JsTypedArray, $value instanceof JsDataView => $value->bytes(),
				default => Js::str( $value ),
				}
			);
		}
		rewind( $out );
		return $out;
	}

	private function source_method( string $name ): ?\Closure {
		$method = Js::dynamicGet( $this->source, $name );
		if ( Js::isNullish( $method ) ) {
			return null; }
		if ( ! $method instanceof \Closure ) {
			throw new JsError( "ReadableStream source $name is not a function", 'TypeError' ); }
		return $method;
	}

	/** Calls a source method, turning a throw into a rejected promise (as the spec's promise-calls do). */
	private function call_source( \Closure $method, array $args ): mixed {
		try {
			return Js::invokeWithReceiver( $method, $this->source, $args );
		} catch ( JsError $error ) {
			return JsPromise::rejected( Js::thrownValue( $error ) );
		}
	}

	public function desiredSize(): int|float|null { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return match ( $this->state ) {
			self::ERRORED => null,
			self::CLOSED => 0,
			default => $this->highWaterMark - count( $this->queue ), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		};
	}

	private function enqueue( mixed $chunk ): JsUndefined {
		if ( $this->closeRequested || self::READABLE !== $this->state ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			throw new JsError( 'Cannot enqueue a chunk into a closed or errored stream', 'TypeError' );
		}
		if ( array() !== $this->reads ) {
			array_shift( $this->reads )->resolve( JsGenerator::result( $chunk, false ) );
		} else {
			$this->queue[] = $chunk;
		}
		$this->pull_if_needed();
		return JsUndefined::Value;
	}

	private function request_close(): JsUndefined {
		if ( $this->closeRequested || self::READABLE !== $this->state ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			throw new JsError( 'Cannot close a closed or errored stream', 'TypeError' );
		}
		$this->closeRequested = true; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		if ( array() === $this->queue ) {
			$this->finish_close(); }
		return JsUndefined::Value;
	}

	private function finish_close(): void {
		$this->state = self::CLOSED;
		foreach ( $this->reads as $read ) {
			$read->resolve( JsGenerator::result( JsUndefined::Value, true ) ); }
		$this->reads = array();
		$this->closed?->resolve( JsUndefined::Value );
	}

	public function error( mixed $reason ): JsUndefined {
		if ( self::READABLE !== $this->state ) {
			return JsUndefined::Value; }
		$this->state       = self::ERRORED;
		$this->storedError = $reason; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		$this->queue       = array();
		foreach ( $this->reads as $read ) {
			$read->reject( $reason ); }
		$this->reads = array();
		if ( null !== $this->closed ) {
			$this->closed->reject( $reason );
			$this->closed->then( null, null, false );
		}
		return JsUndefined::Value;
	}

	/** ReadableStreamDefaultControllerCallPullIfNeeded. */
	private function pull_if_needed(): void {
		if ( ! $this->started || $this->closeRequested || self::READABLE !== $this->state ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			return; }
		if ( array() === $this->reads && $this->desiredSize() <= 0 ) {
			return; }
		if ( $this->pulling ) {
			$this->pullAgain = true; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			return; }
		$pull = $this->source_method( 'pull' );
		if ( null === $pull ) {
			return; }
		$this->pulling = true;
		JsPromise::from( $this->call_source( $pull, array( $this->controller ) ) )->then(
			function (): JsUndefined {
				$this->pulling = false;
				if ( $this->pullAgain ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
					$this->pullAgain = false; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
					$this->pull_if_needed();
				}
				return JsUndefined::Value;
			},
			function ( $reason ): JsUndefined {
				$this->error( $reason );
				return JsUndefined::Value;
			},
			false
		);
	}

	public function read(): JsPromise {
		if ( self::ERRORED === $this->state ) {
			return JsPromise::rejected( $this->storedError ); } // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		if ( array() !== $this->queue ) {
			$chunk = array_shift( $this->queue );
			if ( $this->closeRequested && array() === $this->queue ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				$this->finish_close();
			} else {
				$this->pull_if_needed(); }
			return JsPromise::from( JsGenerator::result( $chunk, false ) );
		}
		if ( self::CLOSED === $this->state ) {
			return JsPromise::from( JsGenerator::result( JsUndefined::Value, true ) ); }
		$promise       = new JsPromise();
		$this->reads[] = $promise;
		$this->pull_if_needed();
		return $promise;
	}

	public function cancel( mixed $reason = JsUndefined::Value ): JsPromise {
		if ( self::CLOSED === $this->state ) {
			return JsPromise::from( JsUndefined::Value ); }
		if ( self::ERRORED === $this->state ) {
			return JsPromise::rejected( $this->storedError ); } // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		$this->queue          = array();
		$this->closeRequested = true; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		$this->finish_close();
		$cancel = $this->source_method( 'cancel' );
		$result = null === $cancel ? JsUndefined::Value : $this->call_source( $cancel, array( $reason ) );
		return JsPromise::from( $result )->then( static fn () => JsUndefined::Value );
	}

	public function locked(): bool {
		return null !== $this->reader;
	}

	/** A default reader. Locking is enforced, as in JavaScript. */
	public function getReader( mixed $options = JsUndefined::Value ): JsObject { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( ! Js::isNullish( $options ) && ! Js::isNullish( Js::dynamicGet( $options, 'mode' ) ) ) {
			throw new JsError( 'BYOB readers are not supported', 'TypeError' );
		}
		if ( null !== $this->reader ) {
			throw new JsError( 'ReadableStream is locked to a reader', 'TypeError' ); }
		$this->closed = new JsPromise();
		if ( self::CLOSED === $this->state ) {
			$this->closed->resolve( JsUndefined::Value ); }
		if ( self::ERRORED === $this->state ) {
			$this->closed->reject( $this->storedError ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			$this->closed->then( null, null, false ); }
		$released     = false;
		$guard        = static function () use ( &$released ): void {
			if ( $released ) {
				throw new JsError( 'This reader has been released', 'TypeError' ); }
		};
		$closed       = $this->closed;
		$reader       = new JsObject();
		$reader->p    = array(
			'read'        => function () use ( $guard ) {
				$guard();
				return $this->read(); },
			'cancel'      => function ( mixed $reason = JsUndefined::Value ) use ( $guard ) {
				$guard();
				return $this->cancel( $reason ); },
			'releaseLock' => function () use ( &$released, $reader, $closed ) {
				if ( $released ) {
					return JsUndefined::Value; }
				$released = true;
				foreach ( $this->reads as $read ) {
					$read->reject( new JsError( 'Reader was released', 'TypeError' ) ); }
				$this->reads = array();
				if ( $closed->state === JsPromise::PENDING ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
					$closed->reject( new JsError( 'Reader was released', 'TypeError' ) );
					$closed->then( null, null, false );
				}
				if ( $this->reader === $reader ) {
					$this->reader = null; }
				return JsUndefined::Value;
			},
			'closed'      => $closed,
		);
		$this->reader = $reader;
		return $reader;
	}

	/** Async iteration (`for await`, `values()`): reads until done; an early exit cancels the stream. */
	public function values( mixed $options = JsUndefined::Value ): JsObject {
		$preventCancel = ! Js::isNullish( $options ) && Js::truthy( Js::dynamicGet( $options, 'preventCancel' ) ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$reader        = $this->getReader();
		return new JsObject(
			array(
				'next'   => function () use ( $reader ) {
					return Js::dynamicCallMethod( $reader, 'read', new JsArray() )->then(
						static function ( $result ) use ( $reader ) {
							if ( Js::truthy( Js::dynamicGet( $result, 'done' ) ) ) {
								Js::dynamicCallMethod( $reader, 'releaseLock', new JsArray() ); }
							return $result;
						}
					);
				},
				'return' => function ( mixed $value = JsUndefined::Value ) use ( $reader, $preventCancel ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
					$done = static function () use ( $reader, $value ) {
						Js::dynamicCallMethod( $reader, 'releaseLock', new JsArray() );
						return JsGenerator::result( $value, true );
					};
					if ( $preventCancel ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
						return JsPromise::from( JsUndefined::Value )->then( $done ); }
					return Js::dynamicCallMethod( $reader, 'cancel', new JsArray( array( $value ) ) )->then( $done );
				},
			)
		);
	}

	/** ReadableStreamDefaultTee: both branches see every chunk; each cancels independently. */
	public function tee(): JsArray {
		$reader      = $this->getReader();
		$branches    = array();
		$canceled    = array( false, false );
		$reasons     = array( JsUndefined::Value, JsUndefined::Value );
		$reading     = false;
		$controllers = array( null, null );
		$pull        = function () use ( $reader, &$branches, &$canceled, &$reading, &$controllers ) {
			if ( $reading ) {
				return JsUndefined::Value; }
			$reading = true;
			return Js::dynamicCallMethod( $reader, 'read', new JsArray() )->then(
				function ( $result ) use ( &$canceled, &$reading, &$controllers ) {
					$reading = false;
					$done    = Js::truthy( Js::dynamicGet( $result, 'done' ) );
					foreach ( array( 0, 1 ) as $i ) {
						if ( $canceled[ $i ] ) {
							continue; }
						$done
						? Js::dynamicCallMethod( $controllers[ $i ], 'close', new JsArray() )
						: Js::dynamicCallMethod( $controllers[ $i ], 'enqueue', new JsArray( array( Js::dynamicGet( $result, 'value' ) ) ) );
					}
					return JsUndefined::Value;
				}
			);
		};
		foreach ( array( 0, 1 ) as $i ) {
			$branches[ $i ] = new self(
				new JsObject(
					array(
						'start'  => function ( $controller ) use ( &$controllers, $i ) {
								$controllers[ $i ] = $controller;
								return JsUndefined::Value; },
						'pull'   => $pull,
						'cancel' => function ( $reason ) use ( &$canceled, &$reasons, $i ) {
							$canceled[ $i ] = true;
							$reasons[ $i ]  = $reason;
							return $canceled[0] && $canceled[1] ? $this->cancel( new JsArray( $reasons ) ) : JsUndefined::Value;
						},
					)
				),
				new JsObject( array( 'highWaterMark' => 0 ) )
			);
		}
		return new JsArray( $branches );
	}

	/** ReadableStreamPipeTo with the default options (and preventClose/preventAbort/preventCancel). */
	public function pipeTo( mixed $destination, mixed $options = JsUndefined::Value ): JsPromise { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( ! $destination instanceof JsWritableStream ) {
			return JsPromise::rejected( new JsError( 'pipeTo needs a WritableStream', 'TypeError' ) );
		}
		$flag = static fn ( string $name ): bool => ! Js::isNullish( $options ) && Js::truthy( Js::dynamicGet( $options, $name ) );
		if ( ! Js::isNullish( $options ) && ! Js::isNullish( Js::dynamicGet( $options, 'signal' ) ) ) {
			return JsPromise::rejected( new JsError( 'pipeTo signal is not supported', 'TypeError' ) );
		}
		return JsJobs::async(
			function () use ( $destination, $flag ) {
				$reader = $this->getReader();
				$writer = $destination->getWriter();
				try {
					while ( true ) {
						try {
							$result = JsJobs::await( Js::dynamicCallMethod( $reader, 'read', new JsArray() ) );
						} catch ( JsError $error ) {
							if ( ! $flag( 'preventAbort' ) ) {
								JsJobs::await( Js::dynamicCallMethod( $writer, 'abort', new JsArray( array( Js::thrownValue( $error ) ) ) ) ); }
							throw $error;
						}
						if ( Js::truthy( Js::dynamicGet( $result, 'done' ) ) ) {
							break; }
						try {
							JsJobs::await( Js::dynamicCallMethod( $writer, 'write', new JsArray( array( Js::dynamicGet( $result, 'value' ) ) ) ) );
						} catch ( JsError $error ) {
							if ( ! $flag( 'preventCancel' ) ) {
								JsJobs::await( $this->cancel( Js::thrownValue( $error ) ) ); }
							throw $error;
						}
					}
					if ( ! $flag( 'preventClose' ) ) {
						JsJobs::await( Js::dynamicCallMethod( $writer, 'close', new JsArray() ) ); }
				} finally {
					Js::dynamicCallMethod( $reader, 'releaseLock', new JsArray() );
					Js::dynamicCallMethod( $writer, 'releaseLock', new JsArray() );
				}
				return JsUndefined::Value;
			}
		);
	}

	public function pipeThrough( mixed $transform, mixed $options = JsUndefined::Value ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$writable = Js::dynamicGet( $transform, 'writable' );
		$readable = Js::dynamicGet( $transform, 'readable' );
		$this->pipeTo( $writable, $options )->then( null, null, false );
		return $readable;
	}

	/** `stream.method(...)` from checked JavaScript. */
	public function call( string $method, array $args ): mixed {
		$arg = static fn ( int $i ) => array_key_exists( $i, $args ) ? $args[ $i ] : JsUndefined::Value;
		return match ( $method ) {
			'getReader' => $this->getReader( $arg( 0 ) ),
			'cancel' => $this->locked() ? JsPromise::rejected( new JsError( 'Cannot cancel a locked stream', 'TypeError' ) ) : $this->cancel( $arg( 0 ) ),
			'tee' => $this->tee(),
			'pipeTo' => $this->pipeTo( $arg( 0 ), $arg( 1 ) ),
			'pipeThrough' => $this->pipeThrough( $arg( 0 ), $arg( 1 ) ),
			'values' => $this->values( $arg( 0 ) ),
			default => throw new JsError( $method . ' is not a function', 'TypeError' ),
		};
	}

	public function get( string $key ): mixed {
		return match ( $key ) {
			'locked' => $this->locked(),
			default => in_array( $key, array( 'getReader', 'cancel', 'tee', 'pipeTo', 'pipeThrough', 'values' ), true )
				? fn ( mixed ...$args ) => $this->call( $key, $args )
				: JsUndefined::Value,
		};
	}
}
