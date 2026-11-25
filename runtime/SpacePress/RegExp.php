<?php

declare(strict_types=1);

namespace SpacePress;

/**
 * A JavaScript RegExp, translated to a PCRE pattern per instance.
 *
 * PCRE always runs in UTF mode, so offsets are UTF-8 byte offsets internally and
 * `.`/classes consume whole code points. JS semantics kept explicitly: ASCII-only
 * \d \w \b, JS \s, `.` excluding JS line terminators, `$` only at the very end
 * (without m), `[]`/`[^]`, and backreferences to unset groups matching empty.
 */
final class RegExp implements \Stringable {

	private const LINE_TERMINATORS = '\n\r\x{2028}\x{2029}';
	private const WORD             = 'A-Za-z0-9_';
	private const HALF             = "\u{FDD0}";

	public readonly string $source;
	public readonly string $flags;
	public readonly bool $global;
	public readonly bool $sticky;
	public mixed $lastIndex = 0; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	/** The compiled PCRE pattern, including delimiters and modifiers. */
	public readonly string $pattern;
	private readonly string $anchoredPattern; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	/** @var list<string> named groups, in declaration order */
	private array $names    = array();
	private int $groupCount = 0; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.

	// translation state
	private string $src;
	private int $pos;
	private bool $dotAll; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	private bool $multiline;
	private bool $unicode;
	/** These atoms can consume a surrogate half or distinguish it from a UTF-8 stand-in. */
	private bool $requiresUnicodeOnAstral = false; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	private bool $requiresUnitMatching    = false; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.

	public function __construct( string $source, string $flags = '' ) {
		$chars = str_split( $flags );
		foreach ( $chars as $f ) {
			if ( 'd' === $f || 'v' === $f ) {
				throw new JsError( "RegExp flag '$f' is not supported", 'SyntaxError' );
			}
			if ( ! in_array( $f, array( 'g', 'i', 'm', 's', 'u', 'y' ), true ) ) {
				throw new JsError( "Invalid regular expression flags '$flags'", 'SyntaxError' );
			}
		}
		if ( count( array_unique( $chars ) ) !== count( $chars ) ) {
			throw new JsError( "Invalid regular expression flags '$flags'", 'SyntaxError' );
		}
		$order = array_flip( array( 'd', 'g', 'i', 'm', 's', 'u', 'v', 'y' ) );
		usort( $chars, static fn ( $a, $b ) => $order[ $a ] <=> $order[ $b ] );

		$this->source    = self::escape_source( $source );
		$this->flags     = implode( '', $chars );
		$this->global    = in_array( 'g', $chars, true );
		$this->sticky    = in_array( 'y', $chars, true );
		$this->dotAll    = in_array( 's', $chars, true ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		$this->multiline = in_array( 'm', $chars, true );
		$this->unicode   = in_array( 'u', $chars, true );

		if ( str_contains( $flags, 'i' ) && preg_match( '/[^\\x00-\\x7f]/', $source ) === 1 ) {
			throw new JsError( 'Ignore-case regexes require literal ASCII source', 'SyntaxError' );
		}
		if ( ! $this->unicode && preg_match( '/[\\x{10000}-\\x{10FFFF}]/u', $source ) === 1 ) {
			throw new JsError( 'Astral regex literals require Unicode mode; add the u flag', 'SyntaxError' );
		}
		$this->check_capture_contract( $source );
		$this->src                     = $source;
		$this->pos                     = 0;
		$body                          = $this->translate();
		$this->pattern                 = '/' . $body . '/u' . ( in_array( 'i', $chars, true ) ? 'i' : '' );
		$this->anchoredPattern         = $this->pattern . 'A'; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		$this->requiresUnicodeOnAstral = $this->requiresUnicodeOnAstral // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			|| preg_match( '/[\x{10000}-\x{10FFFF}]/u', $source ) === 1;
		$this->requiresUnitMatching    = $this->requiresUnicodeOnAstral; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.

		set_error_handler( static fn () => true );
		try {
			$ok = preg_match( $this->pattern, '' ) !== false;
		} finally {
			restore_error_handler();
		}
		if ( ! $ok ) {
			throw new JsError( "Invalid regular expression: /$source/{$this->flags}: " . preg_last_error_msg(), 'SyntaxError' );
		}
	}

	/** Persist source and observable state; regenerate translation caches when restoring. */
	public function __serialize(): array {
		return array(
			'source'    => $this->src,
			'flags'     => $this->flags,
			'lastIndex' => $this->lastIndex, // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		);
	}

	public function __unserialize( array $data ): void {
		$this->__construct( $data['source'], $data['flags'] );
		$this->lastIndex = $data['lastIndex']; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
	}

	private static function escape_source( string $source ): string {
		if ( '' === $source ) {
			return '(?:)'; }
		$out      = '';
		$escaped  = false;
		$in_class = false;
		foreach ( mb_str_split( $source, 1, 'UTF-8' ) as $char ) {
			$line = match ( $char ) {
				"\n" => '\\n', "\r" => '\\r', "\u{2028}" => '\\u2028', "\u{2029}" => '\\u2029', default => null,
			};
			if ( null !== $line ) {
				if ( $escaped ) {
					$out = substr( $out, 0, -1 ); }
				$out    .= $line;
				$escaped = false;
				continue;
			}
			if ( ! $escaped ) {
				if ( '[' === $char ) {
					$in_class = true; } elseif ( ']' === $char ) {
					$in_class = false; } elseif ( '/' === $char && ! $in_class ) {
						$out .= '\\'; }
			}
			$out    .= $char;
			$escaped = '\\' === $char && ! $escaped;
		}
		return $out;
	}

	public function __toString(): string {
		return '/' . $this->source . '/' . $this->flags;
	}

	public function test( string $s ): bool {
		return $this->execMatch( $s ) !== null;
	}

	/** Stateful RegExpBuiltinExec, shared by test and exec. Empty matches keep lastIndex. */
	public function execMatch( string $s ): ?array {
		$stateful = $this->global || $this->sticky;
		$index    = max( 0, Js::toInteger( Js::toNumber( $this->lastIndex ) ) ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		$offset   = $stateful ? $index : 0;
		if ( $offset > Js::length( $s ) ) {
			$this->lastIndex = 0; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			return null; }
		if ( ! $this->unicode && $this->requiresUnitMatching && preg_match( '/[\x{10000}-\x{10FFFF}]/u', $s ) === 1 ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			throw new JsError( 'This RegExp on astral text requires the u flag', 'RangeError' );
		}
		$byte_offset = strlen( Js::slice( $s, 0, $offset ) );
		$match       = $this->matchAt( $s, $byte_offset, $this->sticky );
		if ( $stateful ) {
			$this->lastIndex = null === $match ? 0 : Js::length( substr( $s, 0, $match[1] ) ); } // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		return $match;
	}

	public function hasNamedGroups(): bool {
		return array() !== $this->names;
	}

	/**
	 * SpacePress match at or after byte offset $offset.
	 *
	 * @return ?array{int, int, list<?string>, array<string, ?string>} [start, end, groups, named groups]
	 */
	public function matchAt( string $s, int $offset, bool $anchored = false ): ?array {
		if ( str_contains( $this->flags, 'i' ) && preg_match( '/[^\\x00-\\x7f]/', $s ) === 1 ) {
			throw new JsError( 'Ignore-case regexes require ASCII input', 'RangeError' );
		}
		$r = preg_match( $anchored ? $this->anchoredPattern : $this->pattern, $s, $m, PREG_OFFSET_CAPTURE | PREG_UNMATCHED_AS_NULL, $offset ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		if ( false === $r ) {
			throw new JsError( 'RegExp execution failed: ' . preg_last_error_msg() );
		}
		if ( 0 === $r ) {
			return null;
		}
		$groups = array();
		$named  = array();
		foreach ( $m as $k => [$text] ) {
			if ( is_int( $k ) && $k > 0 ) {
				$groups[] = $text;
			} elseif ( is_string( $k ) ) {
				$named[ $k ] = $text;
			}
		}
		// PCRE omits trailing unset groups; JS reports them as undefined.
		for ( $i = count( $groups ); $i < $this->groupCount; $i++ ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			$groups[] = null;
		}

		return array( $m[0][1], $m[0][1] + strlen( $m[0][0] ), $groups, $named );
	}

	/**
	 * All matches left to right; empty matches advance one code point, or one UTF-16 unit without
	 * the u flag, as in JS. Without it, JS also tries the position between a surrogate pair's two
	 * halves, including where PCRE finds no match at the character's start (see insidePair()).
	 *
	 * @return list<array{0: int, 1: int, 2: list<?string>, 3: array<string, ?string>, 4?: true}>
	 */
	public function matchAll( string $s ): array {
		if ( ! $this->unicode && $this->requiresUnicodeOnAstral // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			&& preg_match( '/[\x{10000}-\x{10FFFF}]/u', $s ) === 1 ) {
			throw new JsError( 'Dots, complemented shorthands, character classes, lookarounds and surrogate or astral literals on text outside the Basic Multilingual Plane (an emoji, say) require Unicode mode; add the u flag', 'RangeError' );
		}
		// Expand once; every probe then runs anchored against this shared buffer. Mapping the
		// original byte positions keeps callback offsets and ordinary matches on the real string.
		$inside_offsets = array();
		$shadow         = $this->unicode ? $s : preg_replace_callback(
			'/[\x{10000}-\x{10FFFF}]/u',
			static function ( array $m ) use ( &$inside_offsets ): string {
				$pos                    = $m[0][1];
				$inside_offsets[ $pos ] = $pos + ( 2 * strlen( self::HALF ) - 4 ) * count( $inside_offsets ) + strlen( self::HALF );

				return self::HALF . self::HALF;
			},
			$s,
			-1,
			$count,
			PREG_OFFSET_CAPTURE,
		);
		// Starting at zero lets PHP cache UTF-8 validity across the interior probes.
		if ( null === $shadow || preg_match( '//u', $shadow ) === false ) {
			throw new JsError( 'RegExp execution failed: ' . preg_last_error_msg() );
		}
		$out    = array();
		$offset = 0;
		$size   = strlen( $s );
		while ( $offset <= $size ) {
			$m = $this->matchAt( $s, $offset, $this->sticky );
			if ( null === $m && $this->sticky ) {
				break; }
			if ( array() !== $inside_offsets ) {
				// PCRE may find no boundary match at the astral character's start. Try every
				// in-pair position before the next ordinary match, including when none exists.
				$until = $m[0] ?? $size;
				for ( $scan = $offset; $scan < $until; $scan += Js::charLenAt( $s, $scan ) ) {
					if ( isset( $inside_offsets[ $scan ] ) && ( $in = $this->inside_pair( $shadow, $inside_offsets[ $scan ], $scan ) ) !== null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
						$out[] = $in;
					}
				}
			}
			if ( null === $m ) {
				break;
			}
			$out[]  = $m;
			$offset = $m[1] > $m[0] ? $m[1] : $m[1] + Js::charLenAt( $s, $m[1] );
			if ( $m[1] === $m[0] && isset( $inside_offsets[ $m[1] ] ) ) {
				$in = $this->inside_pair( $shadow, $inside_offsets[ $m[1] ], $m[1] );
				if ( null !== $in ) {
					$out[] = $in; } elseif ( $this->sticky ) {
					break; }
			}
		}

		return $out;
	}

	/**
	 * The match JS finds between the two halves of the surrogate pair at byte `$pos`, if any: an
	 * empty match there, flagged with a fifth element. PCRE can't stand inside a UTF-8 character,
	 * so the pattern runs on a shared shadow string, where every pair becomes two noncharacter
	 * stand-ins. An empty match only looks at its neighbours through anchors, `\b`/`\B` (a half
	 * and a stand-in are both non-word, non-line-terminator) and literals. Dots, complemented
	 * shorthands, character classes, lookarounds and surrogate or astral literals could distinguish the representation, so
	 * matchAll refuses those before trying any stand-in.
	 * A match that consumes a half
	 * would make a lone surrogate, which throws (the documented deviation).
	 *
	 * @return ?array{0: int, 1: int, 2: list<?string>, 3: array<string, ?string>, 4: true}
	 */
	private function inside_pair( string $shadow, int $at, int $pos ): ?array {
		$m = $this->matchAt( $shadow, $at, true );
		if ( null === $m || $m[0] !== $at ) {
			return null;
		}
		if ( $m[1] !== $at ) {
			Js::splitsPair();
		}

		return array( $pos, $pos, $m[2], $m[3], true );
	}

	// ---------------------------------------------------------------- translation

	private function check_capture_contract( string $source ): void {
		$stack    = array();
		$captures = 0;
		$in_class = false;
		for ( $i = 0, $length = strlen( $source ); $i < $length; $i++ ) {
			$c = $source[ $i ];
			if ( '\\' === $c ) {
				$kind = $source[ ++$i ] ?? '';
				if ( $this->unicode && in_array( $kind, array( 'u', 'p', 'P' ), true ) && ( $source[ $i + 1 ] ?? '' ) === '{' ) {
					$end = strpos( $source, '}', $i + 2 );
					if ( false !== $end ) {
						$i = $end; }
				}
				continue;
			}
			if ( '[' === $c ) {
				$in_class = true;
				continue; }
			if ( ']' === $c ) {
				$in_class = false;
				continue; }
			if ( $in_class ) {
				continue; }
			$quantifier = in_array( $c, array( '*', '+', '?' ), true );
			if ( '{' === $c && preg_match( '/\G[0-9]+(?:,[0-9]*)?\}/A', $source, $bound, 0, $i + 1 ) ) {
				$i         += strlen( $bound[0] );
				$quantifier = true;
			}
			$next = $source[ $i + 1 ] ?? '';
			if ( $quantifier && ( in_array( $next, array( '*', '+', '{' ), true )
				|| '?' === $next && in_array( $source[ $i + 2 ] ?? '', array( '*', '+', '?', '{' ), true ) ) ) {
				throw new JsError( 'This RegExp quantifier sequence is not supported', 'SyntaxError' );
			}
			if ( '(' === $c ) {
				$tail    = substr( $source, $i + 1 );
				$special = str_starts_with( $tail, '?' );
				$named   = str_starts_with( $tail, '?<' ) && ! str_starts_with( $tail, '?<=' ) && ! str_starts_with( $tail, '?<!' );
				if ( str_starts_with( $tail, '*' ) || $special && ! $named && ! preg_match( '/^\?(?::|=|!|<=|<!)/', $tail ) ) {
					throw new JsError( 'This regex group syntax is not supported', 'SyntaxError' );
				}
				$stack[] = array( $captures, $i );
				if ( ! $special || $named ) {
					++$captures; }
			} elseif ( ')' === $c && array() !== $stack ) {
				[$before, $start] = array_pop( $stack );
				if ( $captures > $before && in_array( substr( $source, $start + 1, 3 ), array( '?<=', '?<!' ), true ) ) {
					throw new JsError( 'Capturing lookbehind is not supported', 'SyntaxError' );
				}
				if ( $captures > $before && in_array( $source[ $i + 1 ] ?? '', array( '*', '+', '{' ), true ) ) {
					throw new JsError( 'Repeated regex groups containing captures are not supported', 'SyntaxError' );
				}
				if ( $captures > $before && ( $source[ $i + 1 ] ?? '' ) === '?' ) {
					$body = substr( $source, $start + 1, $i - $start - 1 );
					if ( ! $this->consuming_group_body( $body ) ) {
						throw new JsError( 'Optional regex groups containing captures must have a nonempty body', 'SyntaxError' );
					}
				}
				if ( $captures === $before && in_array( $source[ $i + 1 ] ?? '', array( '*', '+', '?', '{' ), true ) ) {
					$body = substr( $source, $start + 1, $i - $start - 1 );
					if ( ! $this->consuming_group_body( $body ) ) {
						throw new JsError( 'Quantified regex groups must have a provably nonempty body', 'SyntaxError' );
					}
				}
			}
		}
	}

	private function consuming_group_body( string $body ): bool {
		if ( str_starts_with( $body, '?<' ) ) {
			$body = substr( $body, strpos( $body, '>' ) + 1 ); } elseif ( str_starts_with( $body, '?:' ) ) {
			$body = substr( $body, 2 ); }
			$in_class = false;
			for ( $i = 0, $n = strlen( $body ); $i < $n; $i++ ) {
				$c = $body[ $i ];
				if ( '\\' === $c ) {
					$next = $body[ ++$i ] ?? '';
					if ( ! $in_class && ( '' !== $next && str_contains( 'bBk123456789', $next ) ) ) {
						return false; }
				} elseif ( '[' === $c ) {
					$in_class = true; } elseif ( ']' === $c ) {
								$in_class = false; } elseif ( ! $in_class && ( '^' === $c || '$' === $c ) ) {
						return false; } elseif ( ! $in_class && '(' === $c && preg_match( '/^\(\?(?:[=!]|<[=!])/', substr( $body, $i ) ) ) {
									return false; }
			}
			$probe      = clone $this;
			$probe->src = $body;
			$probe->pos = 0;
			$pattern    = '/' . $probe->translate() . '/u';
			set_error_handler( static fn () => true );
			try {
				return preg_match( $pattern, '' ) === 0; } finally {
						restore_error_handler(); }
	}

	private function translate(): string {
		$this->groupCount = preg_match_all( '/\((?!\?)|\(\?<(?![=!])/', preg_replace( '/\\\\.|\[(?:\\\\.|[^\]\\\\])*\]/s', '', $this->src ) ?? '' ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		$out              = '';
		$len              = strlen( $this->src );
		while ( $this->pos < $len ) {
			$c = $this->src[ $this->pos++ ];
			if ( '.' === $c ) {
				$this->requiresUnicodeOnAstral = true; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			}
			$out .= match ( $c ) {
				'\\' => $this->escape( false ),
				'[' => $this->char_class(),
				'.' => $this->dotAll ? '(?s:.)' : '[^' . self::LINE_TERMINATORS . ']', // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				'^' => $this->multiline ? '(?<![^' . self::LINE_TERMINATORS . '])' : '^',
				'$' => $this->multiline ? '(?![^' . self::LINE_TERMINATORS . '])' : '\z',
				'/' => '\/',
				'(' => $this->group_open(),
				'{' => $this->quantifier_open(),
				'}' => $this->unicode ? throw new JsError( 'Unmatched regular expression brace', 'SyntaxError' ) : '\\}',
				']' => $this->unicode ? throw new JsError( 'Unmatched regular expression bracket', 'SyntaxError' ) : '\\]',
				default => $c,
			};
		}

		return $out;
	}

	private function quantifier_open(): string {
		if ( preg_match( '/\\G[0-9]+(?:,[0-9]*)?\\}/A', $this->src, $match, 0, $this->pos ) ) {
			$this->pos += strlen( $match[0] );
			return '{' . $match[0];
		}
		if ( $this->unicode ) {
			throw new JsError( 'Invalid regular expression quantifier', 'SyntaxError' );
		}
		return '\\{';
	}

	private function group_open(): string {
		if ( preg_match( '/\G\?<?[=!]/A', $this->src, $look, 0, $this->pos ) ) {
			$this->requiresUnicodeOnAstral = true; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		}
		if ( preg_match( '/\G\?<([A-Za-z_$][\w$]*)>/A', $this->src, $m, 0, $this->pos ) ) {
			if ( str_contains( $m[1], '$' ) ) {
				throw new JsError( "Group name '{$m[1]}' is not supported", 'SyntaxError' );
			}
			$this->names[] = $m[1];
		}

		return '(';
	}

	/** Escape sequence after a backslash. Inside a class, returns a class-body fragment. */
	private function escape( bool $in_class ): string {
		if ( $this->pos >= strlen( $this->src ) ) {
			throw new JsError( 'Trailing regular expression escape', 'SyntaxError' ); }
		$c = $this->src[ $this->pos++ ];
		if ( str_contains( $this->flags, 'i' ) && ( 'u' === $c || 'x' === $c ) ) {
			throw new JsError( 'Ignore-case regexes do not support encoded character escapes', 'SyntaxError' );
		}
		if ( in_array( $c, array( 'D', 'W', 'S' ), true ) ) {
			$this->requiresUnicodeOnAstral = true; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		}

		switch ( $c ) {
			case 'd':
				return $in_class ? '0-9' : '[0-9]';
			case 'D':
				return $in_class ? "\0D" : '[^0-9]';
			case 'w':
				return $in_class ? self::WORD : '[' . self::WORD . ']';
			case 'W':
				return $in_class ? "\0W" : '[^' . self::WORD . ']';
			case 's':
				return $in_class ? Js::WS : '[' . Js::WS . ']';
			case 'S':
				return $in_class ? "\0S" : '[^' . Js::WS . ']';
			case 'b':
				return $in_class ? '\x{8}' : '(?:(?<=[' . self::WORD . '])(?![' . self::WORD . '])|(?<![' . self::WORD . '])(?=[' . self::WORD . ']))';
			case 'B':
				if ( $this->unicode && $in_class ) {
					throw new JsError( 'Invalid Unicode class escape', 'SyntaxError' ); }
				return $in_class ? 'B' : '(?:(?<=[' . self::WORD . '])(?=[' . self::WORD . '])|(?<![' . self::WORD . '])(?![' . self::WORD . ']))';
			case 'n':
			case 'r':
			case 't':
			case 'f':
				return '\\' . $c;
			case 'v':
				return '\x{b}';
			case 'c':
				$l = $this->src[ $this->pos ] ?? '';
				if ( preg_match( '/^[A-Za-z]$/D', $l ) || ( ! $this->unicode && $in_class && ( '_' === $l || preg_match( '/^[0-9]$/D', $l ) ) ) ) {
					++$this->pos;

					return sprintf( '\x{%x}', ord( $l ) % 32 );
				}

				throw new JsError( 'Unsupported regular expression control escape', 'SyntaxError' );
			case 'x':
				if ( preg_match( '/\G[0-9A-Fa-f]{2}/A', $this->src, $m, 0, $this->pos ) ) {
					$this->pos += 2;

					return '\x{' . $m[0] . '}';
				}

				if ( $this->unicode ) {
					throw new JsError( 'Invalid Unicode hex escape', 'SyntaxError' ); }
				return 'x';
			case 'u':
				return $this->unicode_escape( $in_class );
			case 'k':
				if ( $in_class ) {
					if ( $this->unicode ) {
						throw new JsError( 'Invalid class escape \\k', 'SyntaxError' ); }
					return 'k';
				}
				if ( preg_match( '/\G<([^>]+)>/A', $this->src, $m, 0, $this->pos ) ) {
					$this->pos += strlen( $m[0] );

					return "(?:\\k<{$m[1]}>|(?(<{$m[1]}>)(?!)))";
				}

				if ( $this->unicode ) {
					throw new JsError( 'Invalid Unicode named reference', 'SyntaxError' ); }
				return 'k';
			case 'p':
			case 'P':
				if ( $this->unicode ) {
					throw new JsError( 'Unicode regex properties are not supported; use an explicit character class', 'SyntaxError' );
				}
				return $c;
		}
		if ( '0' === $c && ! ctype_digit( $this->src[ $this->pos ] ?? '' ) ) {
			return '\x{0}';
		}
		if ( ctype_digit( $c ) ) {
			preg_match( '/\G\d*/A', $this->src, $m, 0, $this->pos );
			$n = (int) ( $c . $m[0] );
			if ( '0' !== $c && ! $in_class && $n <= $this->groupCount ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				$this->pos += strlen( $m[0] );

				return "(?:\\g{{$n}}|(?({$n})(?!)))";
			}
			if ( $this->unicode ) {
				throw new JsError( "Invalid escape '\\$c'", 'SyntaxError' );
			}
			if ( $c >= '8' ) {
				return $c; // legacy identity escape
			}
			// Legacy octal escape: up to three octal digits, value <= 0377.
			preg_match( '/\G[0-7]{0,2}/A', $this->src, $o, 0, $this->pos );
			$oct = $c . $o[0];
			if ( octdec( $oct ) > 0377 ) {
				$oct = substr( $oct, 0, 2 );
			}
			$this->pos += strlen( $oct ) - 1;

			return sprintf( '\x{%x}', octdec( $oct ) );
		}
		if ( ctype_alnum( $c ) ) {
			if ( $this->unicode ) {
				throw new JsError( "Invalid escape '\\$c'", 'SyntaxError' );
			}

			return $c; // legacy identity escape
		}

		if ( $this->unicode && ! str_contains( '^$\\.*+?()[]{}|/', $c ) && ! ( $in_class && '-' === $c ) ) {
			throw new JsError( 'Invalid Unicode identity escape', 'SyntaxError' );
		}

		// Punctuation (and any UTF-8 lead byte): keep it literal.
		if ( ord( $c ) >= 0x80 ) {
			--$this->pos;
			$len        = Js::charLenAt( $this->src, $this->pos );
			$ch         = substr( $this->src, $this->pos, $len );
			$this->pos += $len;

			return $ch;
		}

		return '\\' . $c;
	}

	private function unicode_escape( bool $in_class ): string {
		if ( $this->unicode && preg_match( '/\G\{([0-9A-Fa-f]+)\}/A', $this->src, $m, 0, $this->pos ) ) {
			$this->pos += strlen( $m[0] );
			$cp         = hexdec( $m[1] );
			if ( $cp >= 0xD800 && $cp <= 0xDFFF ) {
				if ( $in_class ) {
					throw new JsError( 'Lone surrogate escapes in regex character classes are not supported', 'SyntaxError' ); }
				return '(?!)';
			}

			return '\x{' . $m[1] . '}';
		}
		if ( ! preg_match( '/\G[0-9A-Fa-f]{4}/A', $this->src, $m, 0, $this->pos ) ) {
			if ( $this->unicode ) {
				throw new JsError( 'Invalid Unicode escape', 'SyntaxError' ); }
			return 'u';
		}
		$this->pos += 4;
		$cp         = hexdec( $m[0] );
		if ( ! $this->unicode && $cp >= 0xD800 && $cp <= 0xDFFF ) {
			throw new JsError( 'Surrogate regex escapes require Unicode mode; add the u flag', 'SyntaxError' );
		}
		if ( $cp >= 0xD800 && $cp <= 0xDBFF && preg_match( '/\G\\\\u([dD][c-fC-F][0-9A-Fa-f]{2})/A', $this->src, $lo, 0, $this->pos ) ) {
			$this->pos                    += 6;
			$cp                            = 0x10000 + ( ( $cp - 0xD800 ) << 10 ) + ( hexdec( $lo[1] ) - 0xDC00 );
			$this->requiresUnicodeOnAstral = true; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		} elseif ( $cp >= 0xD800 && $cp <= 0xDFFF ) {
			if ( $in_class ) {
				throw new JsError( 'Lone surrogate escapes in regex character classes are not supported', 'SyntaxError' ); }
			$this->requiresUnicodeOnAstral = true; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			return '(?!)'; // a lone surrogate can never occur in UTF-8 input
		}

		return sprintf( '\x{%x}', $cp );
	}

	/**
	 * A character class. Negated shorthands (\D \W \S) cannot nest in a PCRE
	 * class, so a class containing them becomes an alternation/lookahead.
	 */
	private function char_class(): string {
		$this->requiresUnicodeOnAstral = true; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		$negated                       = ( $this->src[ $this->pos ] ?? '' ) === '^';
		if ( $negated ) {
			++$this->pos;
		}
		$body        = '';
		$class_dash  = false;
		$complements = array();
		$len         = strlen( $this->src );
		while ( $this->pos < $len && ']' !== $this->src[ $this->pos ] ) {
			$c = $this->src[ $this->pos++ ];
			if ( '\\' === $c ) {
				$set_escape = in_array( $this->src[ $this->pos ] ?? '', array( 'd', 'D', 'w', 'W', 's', 'S' ), true );
				if ( $set_escape && ( $class_dash || ( $this->src[ $this->pos + 1 ] ?? '' ) === '-' ) ) {
					throw new JsError( 'Character-class escapes adjacent to hyphens are not supported; escape literal hyphens', 'SyntaxError' );
				}
				$class_dash = false;
				$frag       = $this->escape( true );
				if ( str_starts_with( $frag, "\0" ) ) {
					$complements[] = array(
						'D' => '0-9',
						'W' => self::WORD,
						'S' => Js::WS,
					)[ $frag[1] ];
					continue;
				}
				$body .= $frag;
			} elseif ( '[' === $c || '/' === $c ) {
				$class_dash = false;
				$body      .= '\\' . $c;
			} else {
				$class_dash = '-' === $c;
				$body      .= $c;
			}
		}
		if ( $this->pos >= $len ) {
			throw new JsError( "Invalid regular expression: /{$this->src}/: Unterminated character class", 'SyntaxError' );
		}
		++$this->pos; // ']'

		if ( array() === $complements ) {
			if ( '' === $body ) {
				return $negated ? '(?s:.)' : '(?!)';
			}

			return '[' . ( $negated ? '^' : '' ) . $body . ']';
		}
		if ( ! $negated ) {
			$alts = '' === $body ? array() : array( '[' . $body . ']' );
			foreach ( $complements as $set ) {
				$alts[] = '[^' . $set . ']';
			}

			return '(?:' . implode( '|', $alts ) . ')';
		}
		$out = '' === $body ? '' : '(?![' . $body . '])';
		foreach ( $complements as $set ) {
			$out .= '(?=[' . $set . '])';
		}

		return '(?:' . $out . '(?s:.))';
	}
}
