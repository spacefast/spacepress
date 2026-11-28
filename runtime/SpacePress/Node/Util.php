<?php
declare(strict_types=1);
namespace SpacePress\Node;

use SpacePress\Js;
use SpacePress\JsArray;
use SpacePress\JsArrayBuffer;
use SpacePress\JsBigInt;
use SpacePress\JsClass;
use SpacePress\JsConstructor;
use SpacePress\JsDataView;
use SpacePress\JsDate;
use SpacePress\JsError;
use SpacePress\JsJobs;
use SpacePress\JsMap;
use SpacePress\JsObject;
use SpacePress\JsPromise;
use SpacePress\JsSet;
use SpacePress\JsSymbol;
use SpacePress\JsTypedArray;
use SpacePress\JsUndefined;
use SpacePress\RegExp;

/** Formatting, type checks, and callback adapters for Node-compatible packages. */
final class Util {
	public static function exports(): array {
		return array(
			'format'            => self::format( ... ),
			'inspect'           => self::inspect( ... ),
			'promisify'         => self::promisify( ... ),
			'callbackify'       => self::callbackify( ... ),
			'inherits'          => self::inherits( ... ),
			'deprecate'         => self::deprecate( ... ),
			'types'             => new JsObject(
				array(
					'isUint8Array'  => static fn ( mixed $value = JsUndefined::Value ): bool => $value instanceof JsTypedArray && 'Uint8Array' === $value->kind,
					'isArrayBuffer' => static fn ( mixed $value = JsUndefined::Value ): bool => $value instanceof JsArrayBuffer,
					'isDate'        => static fn ( mixed $value = JsUndefined::Value ): bool => $value instanceof JsDate,
					'isRegExp'      => static fn ( mixed $value = JsUndefined::Value ): bool => $value instanceof RegExp,
					'isPromise'     => static fn ( mixed $value = JsUndefined::Value ): bool => $value instanceof JsPromise,
					'isKeyObject'   => static fn ( mixed $value = JsUndefined::Value ): bool => $value instanceof KeyObject,
					'isCryptoKey'   => static fn ( mixed $value = JsUndefined::Value ): bool => $value instanceof CryptoKey,
				)
			),
			'isDeepStrictEqual' => self::deep_equal( ... ),
			'TextEncoder'       => JsConstructor::of( 'TextEncoder' ),
			'TextDecoder'       => JsConstructor::of( 'TextDecoder' ),
		);
	}

	private static function format( mixed ...$args ): string {
		if ( ! $args ) {
			return '';
		}
		$first = array_shift( $args );
		$index = 0;
		$head  = is_string( $first ) ? $first : self::inspect( $first );
		if ( is_string( $first ) && $args ) {
			$head = preg_replace_callback(
				'/%([sdifjoO%])/',
				static function ( array $captures ) use ( $args, &$index ): string {
					if ( '%' === $captures[1] ) {
						return '%';
					}
					if ( ! array_key_exists( $index, $args ) ) {
						return $captures[0];
					}
					$value = $args[ $index++ ];
					return match ( $captures[1] ) {
						's' => self::format_string( $value ),
						'd', 'i', 'f' => self::format_number( $value, $captures[1] ),
						'j' => self::format_json( $value ),
						'o' => self::inspect(
							$value,
							new JsObject(
								array(
									'depth'      => 4,
									'showHidden' => true,
								)
							)
						),
						'O' => self::inspect( $value ),
					};
				},
				$first
			);
		}
		foreach ( array_slice( $args, $index ) as $arg ) {
			$head .= ' ' . ( is_string( $arg ) ? $arg : self::inspect( $arg ) );
		}
		return $head;
	}

	private static function format_string( mixed $value ): string {
		if ( Buffer::isBuffer( $value ) || is_string( $value ) || $value instanceof JsSymbol ) {
			return Js::stringOf( $value );
		}
		if ( $value instanceof JsObject && Js::hasProperty( 'toString', $value ) ) {
			$method = Js::dynamicGet( $value, 'toString' );
			if ( $method instanceof \Closure && ( array_key_exists( 'toString', $value->p ) || $value->class?->hasMethod( 'toString' ) ) ) {
				return Js::str( $value );
			}
		}
		return self::inspect( $value, new JsObject( array( 'depth' => 0 ) ) );
	}

	private static function format_number( mixed $value, string $specifier ): string {
		if ( $value instanceof JsSymbol ) {
			return 'NaN';
		}
		if ( $value instanceof JsBigInt && 'f' !== $specifier ) {
			return $value . 'n';
		}
		$number = match ( $specifier ) {
			'd' => Js::toNumber( $value ),
			'i' => Js::parseInt( Js::str( $value ) ),
			'f' => Js::parseFloat( Js::str( $value ) ),
		};
		return self::number( $number );
	}

	private static function format_json( mixed $value ): string {
		try {
			return Js::jsonStringify( $value ) ?? 'undefined';
		} catch ( JsError $error ) {
			if ( 'Converting circular structure to JSON' === $error->getMessage() ) {
				return '[Circular]';
			}
			throw $error;
		}
	}

	public static function inspect( mixed $value = JsUndefined::Value, mixed $options = JsUndefined::Value ): string {
		$depth = $options instanceof JsObject ? Js::dynamicGet( $options, 'depth' ) : JsUndefined::Value;
		$depth = match ( true ) {
			null === $depth => INF,
			is_int( $depth ), is_float( $depth ) => $depth,
			default => 2,
		};
		$hidden     = $options instanceof JsObject && Js::truthy( Js::dynamicGet( $options, 'showHidden' ) );
		$references = array();
		$deepest    = 0;
		return self::render( $value, $depth, $hidden, 0, array(), $references, $deepest );
	}

	/** @param array<int, true> $ancestors */
	private static function render( mixed $value, int|float $depth, bool $hidden, int $indent, array $ancestors, array &$references, int &$deepest ): string {
		if ( is_string( $value ) ) {
			return self::quote( $value );
		}
		if ( is_int( $value ) || is_float( $value ) ) {
			return self::number( $value );
		}
		if ( $value instanceof JsBigInt ) {
			return $value . 'n';
		}
		if ( $value instanceof JsSymbol || null === $value || JsUndefined::Value === $value || is_bool( $value ) ) {
			return Js::stringOf( $value );
		}
		if ( $value instanceof JsDate ) {
			return Js::dateJSON( $value->milliseconds ) ?? 'Invalid Date';
		}
		if ( $value instanceof RegExp ) {
			return (string) $value;
		}
		if ( Buffer::isBuffer( $value ) ) {
			$bytes = $value->bytes();
			$tail  = strlen( $bytes ) - 50;
			$hex   = implode( ' ', str_split( bin2hex( substr( $bytes, 0, 50 ) ), 2 ) );
			return '<Buffer ' . $hex . ( $tail > 0 ? ' ... ' . $tail . ' more byte' . ( 1 === $tail ? '' : 's' ) : '' ) . '>';
		}
		if ( $value instanceof KeyObject ) {
			return self::inspect_key( $value, $hidden, $indent );
		}
		if ( Js::isError( $value ) ) {
			$name    = Js::dynamicGet( $value, 'name' );
			$message = Js::dynamicGet( $value, 'message' );
			return '[' . Js::str( $name ) . ( '' === $message ? '' : ': ' . Js::str( $message ) ) . ']';
		}
		if ( $value instanceof \Closure ) {
			return '[Function (anonymous)]';
		}
		if ( $value instanceof JsClass || $value instanceof JsConstructor || $value instanceof Ctor ) {
			$name = $value instanceof JsClass ? $value->get( 'name' ) : $value->name;
			return '[class ' . ( $name ?? 'anonymous' ) . ']';
		}
		$id = spl_object_id( $value );
		if ( isset( $ancestors[ $id ] ) ) {
			$references[ $id ] ??= count( $references ) + 1;
			return '[Circular *' . $references[ $id ] . ']';
		}
		$ancestors[ $id ] = true;
		$child_depth      = $indent;
		$render           = static function ( mixed $item ) use ( $depth, $hidden, $indent, $ancestors, &$references, &$child_depth ): string {
			return self::render( $item, $depth - 1, $hidden, $indent + 2, $ancestors, $references, $child_depth );
		};
		$parts            = array();
		$opening          = '{';
		$closing          = '}';
		if ( $value instanceof JsArray || $value instanceof JsTypedArray ) {
			$typed  = $value instanceof JsTypedArray;
			$length = $typed ? $value->length : count( $value->a );
			if ( $length && $depth < 0 ) {
				return $typed ? '[' . $value->kind . ']' : '[Array]';
			}
			$opening = $typed ? $value->kind . '(' . $length . ') [' : '[';
			$closing = ']';
			for ( $i = 0; $i < min( $length, 100 ); ++$i ) {
				$parts[] = $render( $typed ? $value->get( (string) $i ) : $value->a[ $i ] );
			}
			if ( $length > 100 ) {
				$parts[] = '... ' . ( $length - 100 ) . ' more item' . ( 101 === $length ? '' : 's' );
			}
			if ( $hidden && ! $typed ) {
				$parts[] = '[length]: ' . $length;
			}
			if ( ! $typed ) {
				$parts = array_merge( $parts, self::object_fields( $value->p, array(), $render ) );
			}
		} elseif ( $value instanceof JsMap || $value instanceof JsSet ) {
			$map  = $value instanceof JsMap;
			$name = $map ? 'Map' : 'Set';
			if ( $value->size() && $depth < 0 ) {
				return "[$name]";
			}
			$opening = $name . '(' . $value->size() . ') {';
			foreach ( $map ? $value->entries() : $value->values() as $entry ) {
				$parts[] = $map ? $render( $entry[0] ) . ' => ' . $render( $entry[1] ) : $render( $entry );
			}
		} elseif ( $value instanceof JsObject ) {
			$name = $value->class?->get( 'name' ) ?? 'Object';
			if ( $depth < 0 && ( $value->p || $value->symbols ) ) {
				return "[$name]";
			}
			$opening = $value->nullPrototype ? '[Object: null prototype] {' : ( 'Object' === $name ? '{' : "$name {" ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Access the JavaScript runtime field.
			$parts   = self::object_fields( $value->p, $value->symbols, $render );
		}
		if ( isset( $references[ $id ] ) ) {
			$opening = '<ref *' . $references[ $id ] . '> ' . $opening;
		}
		$deepest = max( $deepest, $child_depth );
		return self::group( $opening, $closing, $parts, $indent, $child_depth - $indent >= 6 );
	}

	private static function inspect_key( KeyObject $value, bool $hidden, int $indent ): string {
		$opening = ucfirst( $value->type ) . 'KeyObject {';
		$parts   = array( "[Symbol(kKeyType)]: '$value->type'" );
		if ( $hidden ) {
			$parts[] = '[Symbol(kHandle)]: {}';
			if ( 'secret' === $value->type ) {
				$parts[] = '[symmetricKeySize]: [Getter]';
			} else {
				$parts[] = '[asymmetricKeyType]: [Getter]';
				$parts[] = '[asymmetricKeyDetails]: [Getter]';
			}
			$parts[] = '[type]: [Getter]';
			$parts[] = "[Symbol(Symbol.toStringTag)]: 'KeyObject'";
		}
		return self::group( $opening, '}', $parts, $indent );
	}

	private static function object_fields( array $properties, array $symbols, \Closure $render ): array {
		$parts = array();
		foreach ( Js::ownKeys( $properties ) as $key ) {
			$label   = preg_match( '/^[$_\p{L}][$_\p{L}\p{N}\p{M}]*$/uD', (string) $key ) ? $key : self::quote( (string) $key );
			$parts[] = $label . ': ' . $render( $properties[ $key ] );
		}
		foreach ( $symbols as [$symbol, $item, $enumerable] ) {
			if ( $enumerable ) {
				$parts[] = '[' . $symbol->descriptiveString() . ']: ' . $render( $item );
			}
		}
		return $parts;
	}

	private static function group( string $opening, string $closing, array $parts, int $indent, bool $multiline = false ): string {
		if ( ! $parts ) {
			return $opening . $closing;
		}
		$preview = $opening . ' ' . implode( ', ', $parts ) . ' ' . $closing;
		if ( ! $multiline && ! str_contains( $preview, "\n" ) && mb_strlen( $preview, 'UTF-8' ) + $indent <= 80 ) {
			return $preview;
		}
		$padding = str_repeat( ' ', $indent + 2 );
		return $opening . "\n" . $padding . implode( ",\n" . $padding, $parts ) . "\n" . str_repeat( ' ', $indent ) . $closing;
	}

	private static function quote( string $text ): string {
		$quote = "'";
		if ( str_contains( $text, "'" ) ) {
			if ( ! str_contains( $text, '"' ) ) {
				$quote = '"';
			} elseif ( ! str_contains( $text, '`' ) && ! str_contains( $text, '${' ) ) {
				$quote = '`';
			}
		}
		$text = strtr(
			$text,
			array(
				'\\'   => '\\\\',
				$quote => '\\' . $quote,
			)
		);
		$text = preg_replace_callback(
			'/[\x00-\x1F\x7F-\x{009F}]/u',
			static function ( array $captures ): string {
				return match ( $captures[0] ) {
					"\n" => '\\n',
					"\r" => '\\r',
					"\t" => '\\t',
					"\v" => '\\v',
					"\f" => '\\f',
					"\x08" => '\\b',
					default => sprintf( '\\x%02X', mb_ord( $captures[0], 'UTF-8' ) ),
				};
			},
			$text
		);
		return $quote . $text . $quote;
	}

	private static function number( int|float $value ): string {
		return is_float( $value ) && 0.0 === $value && -INF === fdiv( 1, $value ) ? '-0' : Js::str( $value );
	}

	private static function promisify( mixed $original = JsUndefined::Value ): \Closure {
		$original = self::function_argument( $original, 'original' );
		return Js::receiverFunction(
			static function ( mixed $receiver, mixed ...$args ) use ( $original ): JsPromise {
				return JsPromise::construct(
					static function ( \Closure $resolve, \Closure $reject ) use ( $receiver, $args, $original ): void {
						$args[] = static function ( mixed $error = JsUndefined::Value, mixed $value = JsUndefined::Value ) use ( $resolve, $reject ): JsUndefined {
							return Js::truthy( $error ) ? $reject( $error ) : $resolve( $value );
						};
						Js::invokeWithReceiver( $original, $receiver, $args );
					}
				);
			}
		);
	}

	private static function callbackify( mixed $original = JsUndefined::Value ): \Closure {
		$original = self::function_argument( $original, 'original' );
		return Js::receiverFunction(
			static function ( mixed $receiver, mixed ...$args ) use ( $original ): JsUndefined {
				$callback     = self::function_argument( array_pop( $args ), 'last argument' );
				$on_fulfilled = static function ( mixed $value = JsUndefined::Value ) use ( $callback, $receiver ): void {
					JsJobs::enqueue( static fn () => Js::invokeWithReceiver( $callback, $receiver, array( null, $value ) ) );
				};
				$on_rejected  = static function ( mixed $reason = JsUndefined::Value ) use ( $callback, $receiver ): void {
					$error = $reason;
					if ( ! Js::truthy( $reason ) ) {
						$error              = JsClass::builtin( 'Error' )->construct( 'Promise was rejected with falsy value' );
						$error->p['code']   = 'ERR_FALSY_VALUE_REJECTION';
						$error->p['reason'] = $reason;
					}
					JsJobs::enqueue( static fn () => Js::invokeWithReceiver( $callback, $receiver, array( $error ) ) );
				};
				$promise      = Js::invokeWithReceiver( $original, $receiver, $args );
				Js::invokeWithReceiver( Js::dynamicGet( $promise, 'then' ), $promise, array( $on_fulfilled, $on_rejected ) );
				return JsUndefined::Value;
			}
		);
	}

	private static function deprecate( mixed $original = JsUndefined::Value, mixed $message = JsUndefined::Value, mixed $code = JsUndefined::Value ): \Closure {
		$original = self::function_argument( $original, 'fn' );
		if ( JsUndefined::Value !== $code && ! is_string( $code ) ) {
			throw JsError::node( 'The "code" argument must be of type string', 'TypeError', 'ERR_INVALID_ARG_TYPE' );
		}
		$warned = false;
		return Js::receiverFunction(
			static function ( mixed $receiver, mixed ...$args ) use ( $original, $message, $code, &$warned ): mixed {
				if ( ! $warned ) {
					$warned = true;
					error_log( ( is_string( $code ) ? '[' . $code . '] ' : '' ) . 'DeprecationWarning: ' . Js::str( $message ) ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- Node reports one warning on first use.
				}
				return Js::invokeWithReceiver( $original, $receiver, $args );
			}
		);
	}

	private static function function_argument( mixed $value, string $name ): \Closure {
		if ( ! $value instanceof \Closure ) {
			throw JsError::node( 'The "' . $name . '" argument must be of type function', 'TypeError', 'ERR_INVALID_ARG_TYPE' );
		}
		return $value;
	}

	private static function inherits( mixed $child = JsUndefined::Value, mixed $superclass = JsUndefined::Value ): JsUndefined {
		if ( ! $child instanceof JsClass || ! $superclass instanceof JsClass ) {
			throw JsError::node( 'The "ctor" and "superCtor" arguments must be supported constructors', 'TypeError', 'ERR_INVALID_ARG_TYPE' );
		}
		$child->inherit_prototype( $superclass );
		return JsUndefined::Value;
	}

	private static function deep_equal( mixed $left = JsUndefined::Value, mixed $right = JsUndefined::Value, array $ancestors = array() ): bool {
		if ( Js::strictEq( $left, $right ) ) {
			return ( is_int( $left ) || is_float( $left ) ) && 0.0 === (float) $left
				? fdiv( 1, $left ) === fdiv( 1, $right )
				: true;
		}
		if ( is_float( $left ) && is_float( $right ) && is_nan( $left ) && is_nan( $right ) ) {
			return true;
		}
		if ( ! is_object( $left ) || ! is_object( $right ) || $left::class !== $right::class ) {
			return false;
		}
		$id    = spl_object_id( $left );
		$other = spl_object_id( $right );
		if ( isset( $ancestors[ $id ] ) ) {
			return $ancestors[ $id ] === $other;
		}
		if ( in_array( $other, $ancestors, true ) ) {
			return false;
		}
		$ancestors[ $id ] = $other;
		if ( $left instanceof JsArray ) {
			return self::equal_fields( $left->a, $right->a, $ancestors ) && self::equal_fields( $left->p, $right->p, $ancestors );
		}
		if ( $left instanceof JsObject ) {
			$symbols = static fn ( JsObject $value ): array => array_map(
				static fn ( array $entry ): mixed => $entry[1],
				array_filter( $value->symbols, static fn ( array $entry ): bool => $entry[2] )
			);
			return $left->class === $right->class && $left->nullPrototype === $right->nullPrototype // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Access the JavaScript runtime field.
				&& self::equal_fields( $left->p, $right->p, $ancestors )
				&& self::equal_fields( $symbols( $left ), $symbols( $right ), $ancestors );
		}
		if ( $left instanceof JsMap || $left instanceof JsSet ) {
			$map = $left instanceof JsMap;
			$lhs = $map ? $left->entries() : $left->values();
			$rhs = $map ? $right->entries() : $right->values();
			if ( count( $lhs ) !== count( $rhs ) ) {
				return false;
			}
			foreach ( $lhs as $entry ) {
				$matched = false;
				foreach ( $rhs as $i => $candidate ) {
					$matches = $map
						? self::deep_equal( $entry[0], $candidate[0], $ancestors ) && self::deep_equal( $entry[1], $candidate[1], $ancestors )
						: self::deep_equal( $entry, $candidate, $ancestors );
					if ( $matches ) {
						unset( $rhs[ $i ] );
						$matched = true;
						break;
					}
				}
				if ( ! $matched ) {
					return false;
				}
			}
			return true;
		}
		return match ( true ) {
			$left instanceof JsDate => self::deep_equal( $left->milliseconds, $right->milliseconds ),
			$left instanceof RegExp => $left->source === $right->source && $left->flags === $right->flags && self::deep_equal( $left->lastIndex, $right->lastIndex, $ancestors ), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Access the JavaScript runtime field.
			$left instanceof JsTypedArray => $left->kind === $right->kind && Buffer::isBuffer( $left ) === Buffer::isBuffer( $right ) && $left->bytes() === $right->bytes(),
			$left instanceof JsArrayBuffer => $left->bytes === $right->bytes,
			$left instanceof JsDataView => $left->bytes() === $right->bytes(),
			$left instanceof JsError => $left->jsName === $right->jsName && $left->getMessage() === $right->getMessage() // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Access the JavaScript runtime field.
				&& self::deep_equal( $left->errors, $right->errors, $ancestors ),
			$left instanceof KeyObject => $left->equals( $right ),
			default => false,
		};
	}

	private static function equal_fields( array $left, array $right, array $ancestors ): bool {
		if ( count( $left ) !== count( $right ) ) {
			return false;
		}
		foreach ( $left as $key => $item ) {
			if ( ! array_key_exists( $key, $right ) || ! self::deep_equal( $item, $right[ $key ], $ancestors ) ) {
				return false;
			}
		}
		return true;
	}
}
