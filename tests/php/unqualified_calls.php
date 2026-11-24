<?php

declare(strict_types=1);

// unqualified_calls.php FILE...: prints every call to a PHP built-in function that is not fully
// qualified, and exits 1 if there is one. Compiled code lives in `namespace SpacePressApp`, where an
// unqualified `count(...)` is looked up in that namespace first on every call (tests/compiler.rs).
$internal = array_flip( get_defined_functions()['internal'] );
$total    = 0;
foreach ( array_slice( $argv, 1 ) as $file ) {
	$tokens = token_get_all( file_get_contents( $file ) );
	$n      = count( $tokens );
	for ( $i = 0; $i < $n; $i++ ) {
		$t = $tokens[ $i ];
		if ( ! is_array( $t ) || T_STRING !== $t[0] ) {
			continue;
		}
		$name = strtolower( $t[1] );
		if ( ! isset( $internal[ $name ] ) ) {
			continue;
		}
		$j = $i + 1;
		while ( $j < $n && is_array( $tokens[ $j ] ) && T_WHITESPACE === $tokens[ $j ][0] ) {
			++$j;
		}
		if ( ( $tokens[ $j ] ?? null ) !== '(' ) {
			continue;
		}
		$k = $i - 1;
		while ( $k >= 0 && is_array( $tokens[ $k ] ) && T_WHITESPACE === $tokens[ $k ][0] ) {
			--$k;
		}
		$prev = $tokens[ $k ] ?? null;
		if ( is_array( $prev ) && in_array( $prev[0], array( T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR, T_DOUBLE_COLON, T_FUNCTION, T_NEW ), true ) ) {
			continue;
		}
		echo "$file:{$t[2]}: {$t[1]}\n";
		++$total;
	}
}
exit( 0 === $total ? 0 : 1 );
