<?php

declare(strict_types=1);

/*
 * Route query strings (runtime/SpacePress/QueryString.php) parse like URLSearchParams, not like PHP's
 * parse_str: names are byte-exact, repeated names keep every value in order, get() is the first.
 */

require __DIR__ . '/../../runtime/SpacePress/bootstrap.php';
require __DIR__ . '/harness.php';

use SpacePress\QueryString;

$q   = static fn ( string $raw ): \SpacePress\JsObject => QueryString::toJs( QueryString::parse( $raw ) );
$get = static fn ( string $raw, string $name ): ?string => ( $q( $raw )->p['get'] )( $name );
$all = static fn ( string $raw, string $name ): array => ( $q( $raw )->p['getAll'] )( $name )->a;

eq( 'a dotted name stays dotted (PHP would rename it a_b)', array( $get( 'a.b=1', 'a.b' ), $get( 'a.b=1', 'a_b' ) ), array( '1', null ) );
eq( 'bracket names stay names with every value (PHP would build an array)', array( $get( 'x[]=1&x[]=2', 'x[]' ), $all( 'x[]=1&x[]=2', 'x[]' ), $get( 'x[]=1', 'x' ) ), array( '1', array( '1', '2' ), null ) );
eq( 'a repeated name keeps all values and get() is the first (PHP keeps the last)', array( $get( 'k=1&k=2', 'k' ), $all( 'k=1&k=2', 'k' ) ), array( '1', array( '1', '2' ) ) );
eq( 'a space in a name stays a space', $get( 'a+b=c%20d', 'a b' ), 'c d' );
eq( 'has() sees an empty value and a bare name', array( ( $q( 'e=&f' )->p['has'] )( 'e' ), ( $q( 'e=&f' )->p['has'] )( 'f' ), ( $q( 'e=&f' )->p['has'] )( 'g' ), $get( 'e=&f', 'f' ) ), array( true, true, false, '' ) );
eq( 'a malformed escape is kept, invalid UTF-8 becomes U+FFFD', array( $get( 'p=100%&q=%zz', 'p' ), $get( 'p=100%&q=%zz', 'q' ), $get( 'r=%FF', 'r' ) ), array( '100%', '%zz', "\u{FFFD}" ) );
eq(
	'pairs keep their order, empty sequences are skipped, a leading ? is ignored',
	array_map( static fn ( $pair ) => $pair->a, ( $q( '?b=2&&a=1&b=3' )->p['entries'] )()->a ),
	array( array( 'b', '2' ), array( 'a', '1' ), array( 'b', '3' ) )
);
eq( '= inside a value is part of the value', $get( 't=a=b', 't' ), 'a=b' );
eq( 'encoded names match decoded lookups', $get( '%61%2Eb=1', 'a.b' ), '1' );

finish( 'query' );
