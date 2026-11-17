<?php
// Compare PHP tokens, allowing whitespace and equivalent array literal syntax.
if ( $argc !== 3 || ! is_dir( $argv[1] ) || ! is_dir( $argv[2] ) ) {
	fwrite( STDERR, "Usage: php compare.php BEFORE_DIRECTORY AFTER_DIRECTORY\n" );
	exit( 1 );
}
$before_files = glob( $argv[1] . '/*.php' );
$after_files  = glob( $argv[2] . '/*.php' );
if ( ! $before_files || array_map( 'basename', $before_files ) !== array_map( 'basename', $after_files ) ) {
	fwrite( STDERR, "Expected matching, nonempty PHP corpora.\n" );
	exit( 1 );
}
function tokens( $file ) {
	$source = file_get_contents( $file );
	if ( false === $source ) {
		fwrite( STDERR, "Cannot read $file\n" );
		exit( 1 );
	}
	$tokens = array_values(
		array_filter(
			token_get_all( $source ),
			static function ( $token ) {
				return ! is_array( $token ) || $token[0] !== T_WHITESPACE;
			}
		)
	);
	// Canonicalize only explicit array(...) tokens. Indexing and destructuring
	// brackets, quoted strings, comments, and all other tokens retain their values.
	$normalized  = array();
	$parentheses = array();
	foreach ( $tokens as $i => $token ) {
		if ( is_array( $token ) && T_ARRAY === $token[0] && '(' === ( $tokens[ $i + 1 ] ?? null ) ) {
			continue;
		}
		if ( ',' === $token ) {
			$next = $i + 1;
			while ( isset( $tokens[ $next ] ) && is_array( $tokens[ $next ] ) && in_array( $tokens[ $next ][0], array( T_COMMENT, T_DOC_COMMENT ), true ) ) {
				++$next;
			}
			if ( ']' === ( $tokens[ $next ] ?? null ) || ( ')' === ( $tokens[ $next ] ?? null ) && end( $parentheses ) ) ) {
				continue;
			}
		}
		if ( '(' === $token ) {
			$is_array      = $i > 0 && is_array( $tokens[ $i - 1 ] ) && T_ARRAY === $tokens[ $i - 1 ][0];
			$parentheses[] = $is_array;
			$normalized[]  = $is_array ? '[' : '(';
		} elseif ( ')' === $token ) {
			$normalized[] = array_pop( $parentheses ) ? ']' : ')';
		} else {
			$normalized[] = $token;
		}
	}
	return $normalized;
}
foreach ( $before_files as $before ) {
	$after     = $argv[2] . '/' . basename( $before );
	$normalize = static function ( $tokens ) {
		return array_map(
			static function ( $token ) {
				return is_array( $token ) ? array( $token[0], $token[1] ) : $token;
			},
			$tokens
		);
	};
	if ( $normalize( tokens( $before ) ) !== $normalize( tokens( $after ) ) ) {
		fwrite( STDERR, basename( $before ) . " changed tokens beyond whitespace/array syntax or optional array commas\n" );
		exit( 1 );
	}
}
echo "Tokens match after whitespace/array syntax normalization.\n";
