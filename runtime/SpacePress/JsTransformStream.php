<?php

declare(strict_types=1);

namespace SpacePress;

/**
 * WHATWG TransformStream: a writable side whose writes run `transform(chunk, controller)` and a
 * readable side that receives what the controller enqueues. `flush` runs on close.
 */
final class JsTransformStream {

	public JsReadableStream $readable;
	public JsWritableStream $writable;

	public function __construct( mixed $transformer = JsUndefined::Value ) {
		$transformer         = Js::isNullish( $transformer ) ? new JsObject() : $transformer;
		$readable_controller = null;
		$this->readable      = new JsReadableStream(
			new JsObject(
				array(
					'start' => static function ( $controller ) use ( &$readable_controller ) {
						$readable_controller = $controller;
						return JsUndefined::Value; },
				)
			),
			new JsObject( array( 'highWaterMark' => 0 ) )
		);
		$controller          = new JsObject(
			array(
				'enqueue'   => static function ( mixed $chunk = JsUndefined::Value ) use ( &$readable_controller ) {
					return Js::dynamicCallMethod( $readable_controller, 'enqueue', new JsArray( array( $chunk ) ) );
				},
				'error'     => static function ( mixed $reason = JsUndefined::Value ) use ( &$readable_controller ) {
					return Js::dynamicCallMethod( $readable_controller, 'error', new JsArray( array( $reason ) ) );
				},
				'terminate' => static function () use ( &$readable_controller ) {
					return Js::dynamicCallMethod( $readable_controller, 'close', new JsArray() );
				},
			)
		);
		$method              = static function ( string $name ) use ( $transformer ): ?\Closure {
			$value = Js::dynamicGet( $transformer, $name );
			return $value instanceof \Closure ? $value : null;
		};
		$start               = $method( 'start' );
		if ( null !== $start ) {
			Js::invokeWithReceiver( $start, $transformer, array( $controller ) ); }
		$transform      = $method( 'transform' );
		$flush          = $method( 'flush' );
		$this->writable = new JsWritableStream(
			new JsObject(
				array(
					'write' => static function ( $chunk ) use ( $transform, $transformer, $controller, &$readable_controller ) {
						if ( null === $transform ) {
							return Js::dynamicCallMethod( $controller, 'enqueue', new JsArray( array( $chunk ) ) ); }
						// TransformStreamDefaultControllerPerformTransform: a failure errors the readable side too.
						$fail = static function ( $reason ) use ( &$readable_controller ) {
							Js::dynamicCallMethod( $readable_controller, 'error', new JsArray( array( $reason ) ) );
							throw Js::throwable( $reason );
						};
						try {
							$result = Js::invokeWithReceiver( $transform, $transformer, array( $chunk, $controller ) );
						} catch ( JsError $error ) {
							$fail( Js::thrownValue( $error ) );
						}
						return JsPromise::from( $result )->then( null, $fail );
					},
					'close' => static function () use ( $flush, $transformer, $controller, &$readable_controller ) {
						$done = null === $flush ? JsUndefined::Value : Js::invokeWithReceiver( $flush, $transformer, array( $controller ) );
						return JsPromise::from( $done )->then(
							static function () use ( &$readable_controller ) {
								Js::dynamicCallMethod( $readable_controller, 'close', new JsArray() );
								return JsUndefined::Value;
							}
						);
					},
					'abort' => static function ( $reason ) use ( &$readable_controller ) {
						return Js::dynamicCallMethod( $readable_controller, 'error', new JsArray( array( $reason ) ) );
					},
				)
			)
		);
	}

	public function get( string $key ): mixed {
		return match ( $key ) {
			'readable' => $this->readable,
			'writable' => $this->writable,
			default => JsUndefined::Value,
		};
	}
}
