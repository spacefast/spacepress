<?php

declare(strict_types=1);

namespace SpacePress;

/**
 * A JavaScript promise (ECMA-262 §27.2). Reactions run as jobs on JsJobs' FIFO queue,
 * structured like QuickJS's `perform_promise_then` and Boa's `PromiseCapability`/`job.rs`.
 * See docs/decisions/2026-11-07-promises-generators-streams.md.
 */
final class JsPromise {

	public const PENDING   = 0;
	public const FULFILLED = 1;
	public const REJECTED  = 2;

	public int $state    = self::PENDING;
	public mixed $result = JsUndefined::Value;
	/** @var list<array{?\Closure, ?\Closure, ?self}> fulfil handler, reject handler, derived promise */
	private array $reactions = array();
	public bool $handled     = false;

	/** `new Promise(executor)`: the executor runs synchronously with fresh resolving functions. */
	public static function construct( mixed $executor ): self {
		if ( ! $executor instanceof \Closure ) {
			throw new JsError( 'Promise resolver is not a function', 'TypeError' );
		}
		$promise            = new self();
		[$resolve, $reject] = $promise->resolvingFunctions();
		try {
			$executor( $resolve, $reject );
		} catch ( JsError $error ) {
			$reject( Js::thrownValue( $error ) );
		}
		return $promise;
	}

	/** CreateResolvingFunctions: the first call wins; later calls are ignored. */
	public function resolvingFunctions(): array {
		$done    = false;
		$resolve = function ( mixed $value = JsUndefined::Value ) use ( &$done ): JsUndefined {
			if ( $done ) {
				return JsUndefined::Value; }
			$done = true;
			$this->resolve( $value );
			return JsUndefined::Value;
		};
		$reject  = function ( mixed $reason = JsUndefined::Value ) use ( &$done ): JsUndefined {
			if ( $done ) {
				return JsUndefined::Value; }
			$done = true;
			$this->reject( $reason );
			return JsUndefined::Value;
		};
		return array( $resolve, $reject );
	}

	/** Promise Resolve Functions step 7-16: self-resolution, thenable adoption, or fulfilment. */
	public function resolve( mixed $value ): void {
		if ( self::PENDING !== $this->state ) {
			return; }
		if ( $value === $this ) {
			$this->reject( new JsError( 'Chaining cycle detected for promise', 'TypeError' ) );
			return;
		}
		if ( $value instanceof self ) {
			// NewPromiseResolveThenableJob with the native `then`: two extra ticks, as in V8 and QuickJS.
			JsJobs::enqueue(
				function () use ( $value ): void {
					[$resolve, $reject] = $this->resolvingFunctions();
					$value->then( $resolve, $reject, false );
				}
			);
			return;
		}
		if ( $value instanceof JsObject || $value instanceof JsArray || $value instanceof \Closure ) {
			try {
				$then = $value instanceof \Closure ? JsUndefined::Value : Js::dynamicGet( $value, 'then' );
			} catch ( JsError $error ) {
				$this->reject( Js::thrownValue( $error ) );
				return;
			}
			if ( $then instanceof \Closure ) {
				JsJobs::enqueue(
					function () use ( $value, $then ): void {
						[$resolve, $reject] = $this->resolvingFunctions();
						try {
							Js::invokeWithReceiver( $then, $value, array( $resolve, $reject ) );
						} catch ( JsError $error ) {
							$reject( Js::thrownValue( $error ) );
						}
					}
				);
				return;
			}
		}
		$this->settle( self::FULFILLED, $value );
	}

	public function reject( mixed $reason ): void {
		if ( self::PENDING !== $this->state ) {
			return; }
		$this->settle( self::REJECTED, $reason );
	}

	private function settle( int $state, mixed $value ): void {
		if ( self::PENDING !== $this->state ) {
			return; }
		$this->state     = $state;
		$this->result    = $value;
		$reactions       = $this->reactions;
		$this->reactions = array();
		if ( self::REJECTED === $state && array() === $reactions && ! $this->handled ) {
			JsJobs::trackRejection( $this );
		}
		foreach ( $reactions as $reaction ) {
			$this->enqueue_reaction( $reaction );
		}
	}

	private function enqueue_reaction( array $reaction ): void {
		[$on_fulfilled, $on_rejected, $derived, $viewer] = $reaction;
		$state = $this->state;
		$value = $this->result;
		JsJobs::enqueue(
			static function () use ( $state, $value, $on_fulfilled, $on_rejected, $derived, $viewer ): void {
				$handler = self::FULFILLED === $state ? $on_fulfilled : $on_rejected;
				if ( null === $handler ) {
					if ( null === $derived ) {
						return; }
					self::FULFILLED === $state ? $derived->resolve( $value ) : $derived->reject( $value );
					return;
				}
				try {
					// A reaction reads as the viewer bound where it was registered, whenever it runs.
					$result = Seam::asViewer( $viewer, static fn () => $handler( $value ) );
				} catch ( JsError $error ) {
					$derived?->reject( Js::thrownValue( $error ) );
					return;
				}
				$derived?->resolve( $result );
			}
		);
	}

	/** PerformPromiseThen. A null derived promise is an internal reaction (await, combinators). */
	public function then( ?\Closure $onFulfilled = null, ?\Closure $onRejected = null, bool $derive = true ): ?self {
		$derived  = $derive ? new self() : null;
		$reaction = array( $onFulfilled, $onRejected, $derived, Seam::viewer() );
		if ( self::REJECTED === $this->state && ! $this->handled ) {
			JsJobs::untrackRejection( $this );
		}
		$this->handled = true;
		if ( self::PENDING === $this->state ) {
			$this->reactions[] = $reaction;
		} else {
			$this->enqueue_reaction( $reaction );
		}
		return $derived;
	}

	/** PromiseResolve(%Promise%, x): a native promise is returned as is. */
	public static function from( mixed $value ): self {
		if ( $value instanceof self ) {
			return $value; }
		$promise = new self();
		$promise->resolve( $value );
		return $promise;
	}

	public static function rejected( mixed $reason ): self {
		$promise = new self();
		$promise->reject( $reason );
		return $promise;
	}

	/** `promise.then/catch/finally` from JavaScript, with non-callable handlers ignored. */
	public function call( string $method, array $args ): mixed {
		$callable = static fn ( mixed $value ): ?\Closure => $value instanceof \Closure ? $value : null;
		return match ( $method ) {
			'then' => $this->then(
				( $f = $callable( $args[0] ?? null ) ) === null ? null : static fn ( $v ) => $f( $v ),
				( $r = $callable( $args[1] ?? null ) ) === null ? null : static fn ( $v ) => $r( $v ),
			),
			'catch' => $this->then( null, ( $r = $callable( $args[0] ?? null ) ) === null ? null : static fn ( $v ) => $r( $v ) ),
			'finally' => $this->finally( $callable( $args[0] ?? null ) ),
			default => throw new JsError( $method . ' is not a function', 'TypeError' ),
		};
	}

	/** Promise.prototype.finally: the callback's result is awaited, then the original settlement passes through. */
	private function finally( ?\Closure $on_finally ): self {
		if ( null === $on_finally ) {
			return $this->then(); }
		return $this->then(
			static fn ( $value ) => self::from( $on_finally() )->then( static fn () => $value ),
			static fn ( $reason ) => self::from( $on_finally() )->then(
				static function () use ( $reason ) {
				throw Js::throwable( $reason ); }
			),
		);
	}

	// ---------------------------------------------------------------- statics

	public static function staticCall( string $method, array $args ): mixed {
		$first = array_key_exists( 0, $args ) ? $args[0] : JsUndefined::Value;
		return match ( $method ) {
			'resolve' => self::from( $first ),
			'reject' => self::rejected( $first ),
			'all', 'allSettled', 'any' => self::combine( $method, $first ),
			'race' => self::race( $first ),
			'withResolvers' => self::withResolvers(),
			default => throw new JsError( 'Promise.' . $method . ' is not a function', 'TypeError' ),
		};
	}

	private static function withResolvers(): JsObject {
		$promise            = new self();
		[$resolve, $reject] = $promise->resolvingFunctions();
		return new JsObject(
			array(
				'promise' => $promise,
				'resolve' => $resolve,
				'reject'  => $reject,
			)
		);
	}

	/** PerformPromiseAll / AllSettled / Any. Each element goes through Promise.resolve, then `then`. */
	private static function combine( string $method, mixed $iterable ): self {
		$result = new self();
		try {
			$items = Js::dynamicIterable( $iterable )->a;
		} catch ( JsError $error ) {
			$result->reject( Js::thrownValue( $error ) );
			return $result;
		}
		$values    = array();
		$remaining = 1;
		$finish    = static function () use ( &$values, &$remaining, $result, $method ): void {
			if ( 0 !== --$remaining ) {
				return; }
			ksort( $values );
			if ( 'any' === $method ) {
				$error         = new JsError( 'All promises were rejected', 'AggregateError' );
				$error->errors = new JsArray( array_values( $values ) );
				$result->reject( $error );
				return;
			}
			$result->resolve( new JsArray( array_values( $values ) ) );
		};
		foreach ( $items as $index => $item ) {
			++$remaining;
			$values[ $index ] = JsUndefined::Value;
			// A fresh flag per element: a by-reference capture would otherwise be shared by the loop.
			unset( $called );
			$called       = false;
			$on_fulfilled = static function ( $value ) use ( &$values, &$called, $index, $method, $finish, $result ) {
				if ( $called ) {
					return JsUndefined::Value; }
				$called = true;
				if ( 'any' === $method ) {
					$result->resolve( $value );
					return JsUndefined::Value; }
				$values[ $index ] = 'allSettled' === $method ? new JsObject(
					array(
						'status' => 'fulfilled',
						'value'  => $value,
					)
				) : $value;
				$finish();
				return JsUndefined::Value;
			};
			$on_rejected  = static function ( $reason ) use ( &$values, &$called, $index, $method, $finish, $result ) {
				if ( $called ) {
					return JsUndefined::Value; }
				$called = true;
				if ( 'all' === $method ) {
					$result->reject( $reason );
					return JsUndefined::Value; }
				$values[ $index ] = 'allSettled' === $method ? new JsObject(
					array(
						'status' => 'rejected',
						'reason' => $reason,
					)
				) : $reason;
				$finish();
				return JsUndefined::Value;
			};
			self::from( $item )->then( $on_fulfilled, $on_rejected );
		}
		$finish();
		return $result;
	}

	private static function race( mixed $iterable ): self {
		$result = new self();
		try {
			$items = Js::dynamicIterable( $iterable )->a;
		} catch ( JsError $error ) {
			$result->reject( Js::thrownValue( $error ) );
			return $result;
		}
		foreach ( $items as $item ) {
			self::from( $item )->then( static fn ( $v ) => $result->resolve( $v ), static fn ( $r ) => $result->reject( $r ) );
		}
		return $result;
	}
}
