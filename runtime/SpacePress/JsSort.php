<?php

declare(strict_types=1);

namespace SpacePress;

/**
 * `Array.prototype.sort` as Node runs it. V8 (third_party/v8/builtins/array-sort.tq) sorts with
 * TimSort, ported from CPython's listsort. This is the same algorithm step for step, so a
 * comparator is called with the same pairs in the same order as under Node, and an inconsistent
 * or effectful comparator gives Node's result too. src/sort.rs carries the same port for
 * configuration evaluation; keep the two in step.
 *
 * `$less($x, $y)` answers ToNumber(compare(x, y)) < 0, with NaN counting as 0. The caller removes
 * undefined elements first and appends them afterwards.
 *
 * @internal
 */
final class JsSort {

	private const MIN_GALLOP = 7;

	/** @var list<array{int, int}> pending runs as [base, length] */
	private array $runs    = array();
	private int $minGallop = self::MIN_GALLOP;

	/** @param list<mixed> $work */
	private function __construct( private array $work, private readonly \Closure $less ) {}

	/**
	 * @param list<mixed> $items
	 * @return list<mixed>
	 */
	public static function sort( array $items, \Closure $less ): array {
		$sort = new self( $items, $less );
		$sort->run();
		return $sort->work;
	}

	private function run(): void {
		$length = count( $this->work );
		if ( $length < 2 ) {
			return; }
		$remaining = $length;
		$low       = 0;
		$n         = $remaining;
		$r         = 0;
		while ( $n >= 64 ) {
			$r  |= $n & 1;
			$n >>= 1; }
		$min_run = $n + $r;
		while ( 0 !== $remaining ) {
			$run = $this->count_and_make_run( $low, $low + $remaining );
			if ( $run < $min_run ) {
				$forced = min( $min_run, $remaining );
				$this->binary_insertion_sort( $low, $low + $run, $low + $forced );
				$run = $forced;
			}
			$this->runs[] = array( $low, $run );
			$this->merge_collapse();
			$low       += $run;
			$remaining -= $run;
		}
		while ( count( $this->runs ) > 1 ) {
			$n = count( $this->runs ) - 2;
			if ( $n > 0 && $this->runs[ $n - 1 ][1] < $this->runs[ $n + 1 ][1] ) {
				--$n; }
			$this->merge_at( $n );
		}
	}

	private function binary_insertion_sort( int $low, int $start, int $high ): void {
		$less = $this->less;
		if ( $low === $start ) {
			++$start; }
		for ( ; $start < $high; $start++ ) {
			$left  = $low;
			$right = $start;
			$pivot = $this->work[ $right ];
			while ( $left < $right ) {
				$middle = $left + ( ( $right - $left ) >> 1 );
				if ( $less( $pivot, $this->work[ $middle ] ) ) {
					$right = $middle;
				} else {
					$left = $middle + 1; }
			}
			for ( $p = $start; $p > $left; $p-- ) {
				$this->work[ $p ] = $this->work[ $p - 1 ]; }
			$this->work[ $left ] = $pivot;
		}
	}

	private function count_and_make_run( int $low_start, int $high ): int {
		$less = $this->less;
		$low  = $low_start + 1;
		if ( $low === $high ) {
			return 1; }
		$run        = 2;
		$previous   = $this->work[ $low ];
		$descending = $less( $previous, $this->work[ $low - 1 ] );
		for ( $index = $low + 1; $index < $high; $index++ ) {
			$current = $this->work[ $index ];
			if ( $descending !== $less( $current, $previous ) ) {
				break; }
			$previous = $current;
			++$run;
		}
		if ( $descending ) {
			for ( $i = $low_start, $j = $low_start + $run - 1; $i < $j; $i++, $j-- ) {
				[$this->work[ $i ], $this->work[ $j ]] = array( $this->work[ $j ], $this->work[ $i ] );
			}
		}
		return $run;
	}

	private function merge_collapse(): void {
		$established = fn ( int $n ): bool => $n < 2 || $this->runs[ $n - 2 ][1] > $this->runs[ $n - 1 ][1] + $this->runs[ $n ][1];
		while ( count( $this->runs ) > 1 ) {
			$n = count( $this->runs ) - 2;
			if ( ! $established( $n + 1 ) || ! $established( $n ) ) {
				if ( $this->runs[ $n - 1 ][1] < $this->runs[ $n + 1 ][1] ) {
					--$n; }
				$this->merge_at( $n );
			} elseif ( $this->runs[ $n ][1] <= $this->runs[ $n + 1 ][1] ) {
				$this->merge_at( $n );
			} else {
				break;
			}
		}
	}

	private function merge_at( int $i ): void {
		[$base_a, $length_a] = $this->runs[ $i ];
		[$base_b, $length_b] = $this->runs[ $i + 1 ];
		$this->runs[ $i ][1] = $length_a + $length_b;
		if ( $i + 3 === count( $this->runs ) ) {
			$this->runs[ $i + 1 ] = $this->runs[ $i + 2 ]; }
		array_pop( $this->runs );
		$k         = $this->gallop_right( $this->work, $this->work[ $base_b ], $base_a, $length_a, 0 );
		$base_a   += $k;
		$length_a -= $k;
		if ( 0 === $length_a ) {
			return; }
		$length_b = $this->gallop_left( $this->work, $this->work[ $base_a + $length_a - 1 ], $base_b, $length_b, $length_b - 1 );
		if ( 0 === $length_b ) {
			return; }
		if ( $length_a <= $length_b ) {
			$this->merge_low( $base_a, $length_a, $base_b, $length_b ); } else {
			$this->merge_high( $base_a, $length_a, $base_b, $length_b ); }
	}

	/** @param list<mixed> $items where `$key` belongs: before the leftmost equal element */
	private function gallop_left( array $items, mixed $key, int $base, int $length, int $hint ): int {
		$less   = $this->less;
		$last   = 0;
		$offset = 1;
		if ( $less( $items[ $base + $hint ], $key ) ) {
			$max = $length - $hint;
			while ( $offset < $max ) {
				if ( ! $less( $items[ $base + $hint + $offset ], $key ) ) {
					break; }
				$last   = $offset;
				$offset = ( $offset << 1 ) + 1;
			}
			$offset  = min( $offset, $max );
			$last   += $hint;
			$offset += $hint;
		} else {
			$max = $hint + 1;
			while ( $offset < $max ) {
				if ( $less( $items[ $base + $hint - $offset ], $key ) ) {
					break; }
				$last   = $offset;
				$offset = ( $offset << 1 ) + 1;
			}
			$offset          = min( $offset, $max );
			[$last, $offset] = array( $hint - $offset, $hint - $last );
		}
		++$last;
		while ( $last < $offset ) {
			$middle = $last + ( ( $offset - $last ) >> 1 );
			if ( $less( $items[ $base + $middle ], $key ) ) {
				$last = $middle + 1;
			} else {
				$offset = $middle; }
		}
		return $offset;
	}

	/** @param list<mixed> $items where `$key` belongs: after the rightmost equal element */
	private function gallop_right( array $items, mixed $key, int $base, int $length, int $hint ): int {
		$less   = $this->less;
		$last   = 0;
		$offset = 1;
		if ( $less( $key, $items[ $base + $hint ] ) ) {
			$max = $hint + 1;
			while ( $offset < $max ) {
				if ( ! $less( $key, $items[ $base + $hint - $offset ] ) ) {
					break; }
				$last   = $offset;
				$offset = ( $offset << 1 ) + 1;
			}
			$offset          = min( $offset, $max );
			[$last, $offset] = array( $hint - $offset, $hint - $last );
		} else {
			$max = $length - $hint;
			while ( $offset < $max ) {
				if ( $less( $key, $items[ $base + $hint + $offset ] ) ) {
					break; }
				$last   = $offset;
				$offset = ( $offset << 1 ) + 1;
			}
			$offset  = min( $offset, $max );
			$last   += $hint;
			$offset += $hint;
		}
		++$last;
		while ( $last < $offset ) {
			$middle = $last + ( ( $offset - $last ) >> 1 );
			if ( $less( $key, $items[ $base + $middle ] ) ) {
				$offset = $middle;
			} else {
				$last = $middle + 1; }
		}
		return $offset;
	}

	/** Copies `$length` elements within the work array, from the back when ranges overlap that way. */
	private function move( int $src, int $dst, int $length ): void {
		if ( $src < $dst ) {
			for ( $o = $length - 1; $o >= 0; $o-- ) {
				$this->work[ $dst + $o ] = $this->work[ $src + $o ]; }
		} else {
			for ( $o = 0; $o < $length; $o++ ) {
				$this->work[ $dst + $o ] = $this->work[ $src + $o ]; }
		}
	}

	/** @param list<mixed> $temp */
	private function copy_in( array $temp, int $src, int $dst, int $length ): void {
		for ( $o = 0; $o < $length; $o++ ) {
			$this->work[ $dst + $o ] = $temp[ $src + $o ]; }
	}

	/** Merges adjacent runs, `a` (the shorter) before `b`, copying `a` out first. */
	private function merge_low( int $base_a, int $length_a, int $base_b, int $length_b ): void {
		$less                  = $this->less;
		$temp                  = array_slice( $this->work, $base_a, $length_a );
		$dest                  = $base_a;
		$cursor_temp           = 0;
		$cursor_b              = $base_b;
		$this->work[ $dest++ ] = $this->work[ $cursor_b++ ];
		$exit                  = ( function () use ( &$length_a, &$length_b, &$dest, &$cursor_temp, &$cursor_b, $temp, $less ): bool {
			if ( 0 === --$length_b ) {
				return true; }
			if ( 1 === $length_a ) {
				return false; }
			$min_gallop = $this->minGallop;
			while ( true ) {
				$wins_a = 0;
				$wins_b = 0;
				while ( true ) {
					if ( $less( $this->work[ $cursor_b ], $temp[ $cursor_temp ] ) ) {
						$this->work[ $dest++ ] = $this->work[ $cursor_b++ ];
						$wins_b++;
						$length_b--;
						$wins_a = 0;
						if ( 0 === $length_b ) {
							return true; }
						if ( $wins_b >= $min_gallop ) {
							break; }
					} else {
						$this->work[ $dest++ ] = $temp[ $cursor_temp++ ];
						$wins_a++;
						$length_a--;
						$wins_b = 0;
						if ( 1 === $length_a ) {
							return false; }
						if ( $wins_a >= $min_gallop ) {
							break; }
					}
				}
				$min_gallop++;
				$first = true;
				while ( $wins_a >= self::MIN_GALLOP || $wins_b >= self::MIN_GALLOP || $first ) {
					$first           = false;
					$min_gallop      = max( 1, $min_gallop - 1 );
					$this->minGallop = $min_gallop;
					$wins_a          = $this->gallop_right( $temp, $this->work[ $cursor_b ], $cursor_temp, $length_a, 0 );
					if ( $wins_a > 0 ) {
						$this->copy_in( $temp, $cursor_temp, $dest, $wins_a );
						$dest        += $wins_a;
						$cursor_temp += $wins_a;
						$length_a    -= $wins_a;
						if ( 1 === $length_a ) {
							return false; }
						if ( 0 === $length_a ) {
							return true; }
					}
					$this->work[ $dest++ ] = $this->work[ $cursor_b++ ];
					if ( 0 === --$length_b ) {
						return true; }
					$wins_b = $this->gallop_left( $this->work, $temp[ $cursor_temp ], $cursor_b, $length_b, 0 );
					if ( $wins_b > 0 ) {
						$this->move( $cursor_b, $dest, $wins_b );
						$dest     += $wins_b;
						$cursor_b += $wins_b;
						$length_b -= $wins_b;
						if ( 0 === $length_b ) {
							return true; }
					}
					$this->work[ $dest++ ] = $temp[ $cursor_temp++ ];
					if ( 1 === --$length_a ) {
						return false; }
				}
				$min_gallop++;
				$this->minGallop = $min_gallop;
			}
		} )();
		if ( $exit ) {
			if ( $length_a > 0 ) {
				$this->copy_in( $temp, $cursor_temp, $dest, $length_a ); }
		} else {
			$this->move( $cursor_b, $dest, $length_b );
			$this->work[ $dest + $length_b ] = $temp[ $cursor_temp ];
		}
	}

	/** Merges adjacent runs, `a` before `b` (the shorter), copying `b` out and merging from the end. */
	private function merge_high( int $base_a, int $length_a, int $base_b, int $length_b ): void {
		$less                  = $this->less;
		$temp                  = array_slice( $this->work, $base_b, $length_b );
		$dest                  = $base_b + $length_b - 1;
		$cursor_temp           = $length_b - 1;
		$cursor_a              = $base_a + $length_a - 1;
		$this->work[ $dest-- ] = $this->work[ $cursor_a-- ];
		$exit                  = ( function () use ( &$length_a, &$length_b, &$dest, &$cursor_temp, &$cursor_a, $temp, $base_a, $less ): bool {
			if ( 0 === --$length_a ) {
				return true; }
			if ( 1 === $length_b ) {
				return false; }
			$min_gallop = $this->minGallop;
			while ( true ) {
				$wins_a = 0;
				$wins_b = 0;
				while ( true ) {
					if ( $less( $temp[ $cursor_temp ], $this->work[ $cursor_a ] ) ) {
						$this->work[ $dest-- ] = $this->work[ $cursor_a-- ];
						$wins_a++;
						$length_a--;
						$wins_b = 0;
						if ( 0 === $length_a ) {
							return true; }
						if ( $wins_a >= $min_gallop ) {
							break; }
					} else {
						$this->work[ $dest-- ] = $temp[ $cursor_temp-- ];
						$wins_b++;
						$length_b--;
						$wins_a = 0;
						if ( 1 === $length_b ) {
							return false; }
						if ( $wins_b >= $min_gallop ) {
							break; }
					}
				}
				$min_gallop++;
				$first = true;
				while ( $wins_a >= self::MIN_GALLOP || $wins_b >= self::MIN_GALLOP || $first ) {
					$first           = false;
					$min_gallop      = max( 1, $min_gallop - 1 );
					$this->minGallop = $min_gallop;
					$k               = $this->gallop_right( $this->work, $temp[ $cursor_temp ], $base_a, $length_a, $length_a - 1 );
					$wins_a          = $length_a - $k;
					if ( $wins_a > 0 ) {
						$dest     -= $wins_a;
						$cursor_a -= $wins_a;
						$this->move( $cursor_a + 1, $dest + 1, $wins_a );
						$length_a -= $wins_a;
						if ( 0 === $length_a ) {
							return true; }
					}
					$this->work[ $dest-- ] = $temp[ $cursor_temp-- ];
					if ( 1 === --$length_b ) {
						return false; }
					$k      = $this->gallop_left( $temp, $this->work[ $cursor_a ], 0, $length_b, $length_b - 1 );
					$wins_b = $length_b - $k;
					if ( $wins_b > 0 ) {
						$dest        -= $wins_b;
						$cursor_temp -= $wins_b;
						$this->copy_in( $temp, $cursor_temp + 1, $dest + 1, $wins_b );
						$length_b -= $wins_b;
						if ( 1 === $length_b ) {
							return false; }
						if ( 0 === $length_b ) {
							return true; }
					}
					$this->work[ $dest-- ] = $this->work[ $cursor_a-- ];
					if ( 0 === --$length_a ) {
						return true; }
				}
				$min_gallop++;
				$this->minGallop = $min_gallop;
			}
		} )();
		if ( $exit ) {
			if ( $length_b > 0 ) {
				$this->copy_in( $temp, 0, $dest - ( $length_b - 1 ), $length_b ); }
		} else {
			$dest     -= $length_a;
			$cursor_a -= $length_a;
			$this->move( $cursor_a + 1, $dest + 1, $length_a );
			$this->work[ $dest ] = $temp[ $cursor_temp ];
		}
	}
}
