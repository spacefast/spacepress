<?php
// Compare a before/after corpus without discarding strings or comments.
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
	return array_values(
		array_filter(
			token_get_all( $source ),
			static function ( $token ) {
				return ! is_array( $token ) || $token[0] !== T_WHITESPACE;
			}
		)
	);
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
		fwrite( STDERR, basename( $before ) . " changed non-whitespace tokens\n" );
		exit( 1 );
	}
}
echo "Non-whitespace tokens match.\n";
